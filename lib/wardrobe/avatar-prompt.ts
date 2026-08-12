/**
 * Shared avatar prompt builder.
 *
 * Builds the portrait prompt used by both the background avatar-generation
 * job and the dialog's "preview avatar" endpoint. Single source of truth for
 * the prompt shape; callers differ only in how they obtain `equippedSlots`.
 */

import type { Character } from '@/lib/schemas/character.types';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';
import type { getRepositories } from '@/lib/repositories/factory';
import { describeOutfit, decorateOutfitItems } from '@/lib/wardrobe/outfit-description';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';
import { genderNounFromPronouns } from '@/lib/characters/pronoun-gender';

interface BuildPromptOptions {
  /**
   * Equipped slots to describe. When `null`/`undefined`, no outfit is
   * appended — the prompt relies on physical descriptions alone.
   */
  equippedSlots?: EquippedSlots | null;
  /**
   * Project document stores in scope, so equipped items that live in a project
   * store (not just the character vault or Quilltap General) resolve. Omit when
   * there is no project context (two-tier fallback).
   */
  projectMountPointIds?: string[];
  /**
   * Resolved Aurora character aesthetic (from `aurora-aesthetics.md`,
   * project-over-global). Avatars have no LLM rewrite step, so this is
   * prepended as a short capped art-direction preamble. The Ariel Clause
   * (`depiction-guidelines.md`) does NOT apply to avatars.
   */
  characterAesthetic?: string | null;
}

/** Cap for the avatar aesthetic preamble — a long doc can't blow the budget. */
const AVATAR_AESTHETIC_MAX_CHARS = 600;

interface BuildPromptResult {
  /** Final portrait prompt suitable for an image-generation provider. */
  prompt: string;
  /** Whether any appearance data (physical description or wardrobe) was found. */
  hasAppearance: boolean;
  /** Per-slot leaf counts after composite expansion (for logging/debug). */
  leafCounts: { top: number; bottom: number; footwear: number; accessories: number };
}

/**
 * Build the portrait prompt for a character, optionally including their
 * equipped outfit. Composites in `equippedSlots` are expanded to leaves and
 * decorated with `(description)` where present.
 */
export async function buildCharacterAvatarPrompt(
  repos: ReturnType<typeof getRepositories>,
  character: Character,
  options: BuildPromptOptions = {},
): Promise<BuildPromptResult> {
  const { equippedSlots } = options;
  const projectMountPointIds = options.projectMountPointIds;

  const leafCounts = { top: 0, bottom: 0, footwear: 0, accessories: 0 };

  // Physical description — fall back through the canonical fields the avatar
  // handler has always favored.
  let physicalText = '';
  const desc = character.physicalDescription;
  if (desc) {
    // Avatars are a head-and-shoulders crop, so prefer the dedicated
    // head-and-shoulders prompt (face/hair/expression/neckline only). It avoids
    // sending below-the-crop anatomy that image-provider moderation rejects.
    // Fall back through the full-body variants when it isn't set yet.
    physicalText = (
      desc.headAndShouldersPrompt ||
      desc.mediumPrompt ||
      desc.shortPrompt ||
      desc.longPrompt ||
      desc.completePrompt ||
      desc.fullDescription ||
      ''
    ).trim();
  }

  let outfitText = '';
  // Whether the character's upper body is bare (no item bubbles up into the
  // top slot). Drives a tighter crop below so a bare chest is never in frame.
  let topIsBare = false;
  if (equippedSlots) {
    // Avatars are head-and-shoulders only. We pass the FULL equipped slots in
    // so the resolver can route coverage by each leaf's own `types` — an item
    // sitting in slots.bottom whose types include "top" still bubbles up into
    // the rendered top. We then `omit` bottom/footwear at render time so the
    // image generator doesn't paste shoes/pants onto a cropped torso.
    const resolved = await resolveEquippedOutfitForCharacter(repos, character.id, equippedSlots, {
      projectMountPointIds,
    });

    topIsBare = resolved.leafItemsBySlot.top.length === 0;
    const accessories = decorateOutfitItems(resolved.leafItemsBySlot.accessories, { titleOnly: true });

    if (topIsBare) {
      // Bare-topped character. We deliberately do NOT emit "topless"/"naked"
      // wardrobe language: it trips SFW image-provider moderation and implies
      // breasts in frame. The tighter collarbone crop in the intro conveys the
      // exposure honestly (bare shoulders, chest out of frame); here we only
      // list any accessories that sit at or above the collar. We also avoid
      // describeOutfit's "completely naked and unadorned" fallback, which would
      // fire (and reintroduce nudity language) when accessories are empty too.
      outfitText = accessories.length > 0
        ? describeOutfit(
            { top: [], bottom: [], footwear: [], accessories },
            { omit: ['top', 'bottom', 'footwear'] },
          ).trimEnd()
        : '';
    } else {
      outfitText = describeOutfit({
        top: decorateOutfitItems(resolved.leafItemsBySlot.top, { titleOnly: true }),
        bottom: decorateOutfitItems(resolved.leafItemsBySlot.bottom, { titleOnly: true }),
        footwear: decorateOutfitItems(resolved.leafItemsBySlot.footwear, { titleOnly: true }),
        accessories,
      }, { omit: ['bottom', 'footwear'] }).trimEnd();
    }

    leafCounts.top = resolved.leafItemsBySlot.top.length;
    leafCounts.bottom = resolved.leafItemsBySlot.bottom.length;
    leafCounts.footwear = resolved.leafItemsBySlot.footwear.length;
    leafCounts.accessories = resolved.leafItemsBySlot.accessories.length;
  }

  const hasAppearance = Boolean(physicalText) || Boolean(outfitText);
  let prompt = '';
  if (hasAppearance) {
    // Anchor the figure's apparent sex from the character's pronouns. Without
    // it, a gender-neutral physical description plus an outfit cue (e.g. a
    // "men's" shirt) can make the generator render the wrong sex. `they`/
    // neopronouns/unset → no anchor, leaving "person" so we never force a
    // binary presentation onto a character who hasn't declared one.
    const subjectNoun = genderNounFromPronouns(character.pronouns) ?? 'person';
    // For a bare-topped character, crop higher — at the collarbone — so the
    // chest is physically out of frame. Bare shoulders and neck are unremarkable
    // to SFW image providers; a bare chest is what gets refused. The framing
    // constraint keeps the portrait generatable without any "topless" wording.
    const intro = topIsBare
      ? `Solo portrait of a single ${subjectNoun}: ${character.name}. Show exactly one figure. Close-up headshot cropped at the collarbone — only the face, neck, and bare shoulders are visible; the chest and torso are outside the frame.`
      : `Solo portrait of a single ${subjectNoun}: ${character.name}. Show exactly one figure, head-and-shoulders crop, three-quarter view.`;
    const outro = `Character portrait, detailed, high quality, natural lighting. Only one person in the image.`;
    // Strip any trailing terminal punctuation off the physical description so
    // we don't end up with "background.." once we re-append a period.
    const physBlock = physicalText ? `${physicalText.replace(/[.!?]+$/, '')}.` : '';
    // Outfit is a markdown list (lines starting with "- "). Markdown renderers
    // need a blank line before the first list item, so the outfit block is
    // separated from neighboring paragraphs by `\n\n` on each side.
    const outfitBlock = outfitText ? `\n\n${outfitText}\n\n` : ' ';
    prompt = physBlock
      ? `${intro} ${physBlock}${outfitBlock}${outro}`
      : `${intro}${outfitBlock}${outro}`;

    // Prepend the Aurora character aesthetic as a capped art-direction preamble.
    // No LLM compresses this path, so cap it so a long doc can't dominate the
    // provider's prompt budget.
    const aesthetic = options.characterAesthetic?.trim();
    if (aesthetic) {
      const capped = aesthetic.length > AVATAR_AESTHETIC_MAX_CHARS
        ? aesthetic.slice(0, AVATAR_AESTHETIC_MAX_CHARS)
        : aesthetic;
      prompt = `Art direction (apply this overall style): ${capped}\n\n${prompt}`;
    }
  }

  return { prompt, hasAppearance, leafCounts };
}
