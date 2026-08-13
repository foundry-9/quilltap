'use client'

/**
 * CharTypeaheadPlugin
 *
 * The composer's inline character typeahead, in one implementation and two
 * dataset profiles:
 *
 * - **Layer 2.0e (emoji)** — type `:` plus at least two characters and pick an
 *   emoji by name. A closing `:` on an exact shortcode (`:smile:`) commits
 *   without the menu ever mattering.
 * - **Layer 2.0u (Unicode)** — type `\` plus a LaTeX name (`\to`, `\phi`) or a
 *   code point (`→`). A trailing space on an exact alias (`\to `) commits
 *   without the menu ever mattering.
 *
 * Two commit paths per profile, one engine. What it inserts is the literal
 * Unicode character — not a shortcode, not a node, not an image. That single
 * decision is why markdown round-trip, export, search, embeddings, and the LLM
 * wire are all untouched by both features.
 *
 * Every DECISION (which characters match, in what order, where the trigger
 * starts and ends, whether the cursor is inside math) lives in
 * `lib/char-insert/`, which imports nothing and is copied wholesale into
 * quilltap-v5. This file is the adapter that asks the questions and applies the
 * answers. Keep it that way.
 *
 * Registered at COMMAND_PRIORITY_NORMAL, ABOVE TextReplacementPlugin's
 * COMMAND_PRIORITY_LOW — see "Interaction with Layer 1.5" below.
 *
 * @module components/chat/lexical/plugins/CharTypeaheadPlugin
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LexicalTypeaheadMenuPlugin } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import type { MenuTextMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_NORMAL,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type TextNode,
} from 'lexical'

import { findTrigger, isTriggerOpenerContext } from '@/lib/char-insert/trigger'
import { searchChars, findByAlias, findByCodePoint } from '@/lib/char-insert/search'
import { isInsideMathSpan } from '@/lib/char-insert/math-span'
import type { CharEntry, CharIndex, CharProfile } from '@/lib/char-insert/types'
import {
  TypeaheadOption,
  useTypeaheadShell,
  toMenuTextMatch,
  $insertWithoutTrailingSpace,
} from '../typeahead/useTypeaheadShell'
import { $isInCodeContext } from '../utils/code-context'
import { recordRecent } from '../../char-insert/recents-storage'
import { CHAR_INSERT_TAG } from '../../char-insert/insert-char'

/** Rows visible at once; the menu scrolls with the keyboard beyond this. */
const MENU_LIMIT = 10

/** Both profiles' toggles live on the chat-settings row. */
type ChatSettingsResponse = Partial<Record<CharProfile['settingsKey'], boolean>>

function toOption(profile: CharProfile, entry: CharEntry): TypeaheadOption<CharEntry> {
  return new TypeaheadOption<CharEntry>(
    {
      key: entry.char,
      glyph: entry.char,
      label: entry.name,
      detail: entry.aliases[0] ? profile.ui.formatAlias(entry.aliases[0]) : undefined,
    },
    entry,
  )
}

/**
 * The text of the anchor node up to the cursor — the same slice Lexical's own
 * trigger machinery works from, so our offsets and its node-splitting agree.
 *
 * Returns null in every position a typing aid must stay out of. Must run inside
 * a read/update context.
 */
function $textBeforeCursor(): { node: TextNode; text: string } | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
  if ($isInCodeContext(selection)) return null

  const anchor = selection.anchor
  if (anchor.type !== 'text') return null

  const node = anchor.getNode()
  if (!$isTextNode(node) || !node.isSimpleText()) return null

  return { node, text: node.getTextContent().slice(0, anchor.offset) }
}

/**
 * A trigger at offset 0 of the anchor node is only really at a word opening if
 * nothing is glued to it in the preceding inline run — `**bold**:smi` must not
 * open a menu. The rule itself comes from Tier B rather than being re-derived.
 */
function $isGluedToPreviousRun(node: TextNode, start: number): boolean {
  if (start !== 0) return false

  const previous = node.getPreviousSibling()
  if (!previous) return false

  const previousText = previous.getTextContent()
  const lastChar = previousText[previousText.length - 1]
  if (!lastChar) return false

  return !isTriggerOpenerContext(lastChar)
}

/**
 * Resolve a query to the single character the menu-free commit path should
 * insert, or null to leave the literal text alone rather than guess.
 */
function resolveExact(profile: CharProfile, index: CharIndex, query: string): CharEntry | null {
  const byAlias = findByAlias(index, query, { caseSensitive: profile.caseSensitiveAliases })
  if (byAlias) return byAlias
  if (profile.codePointQueries) return findByCodePoint(index, query)
  return null
}

export interface CharTypeaheadPluginProps {
  /**
   * Which dataset this instance serves. Both profiles are mounted, side by side.
   *
   * ⚠ FIXED FOR THE LIFE OF THE MOUNT. `index` is seeded from the profile's
   * loader once and would otherwise go on pointing at the old dataset. Both call
   * sites pass a module-level constant; if a caller ever needs to swap, give the
   * element a `key={profile.id}` so React remounts it rather than adding a reset
   * effect here.
   */
  profile: CharProfile
}

export function CharTypeaheadPlugin({
  profile,
}: Readonly<CharTypeaheadPluginProps>): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const { data: chatSettings } = useQuery({
    queryKey: queryKeys.settings.chat,
    queryFn: ({ signal }) => apiFetch<ChatSettingsResponse>('/api/v1/settings/chat', { signal }),
  })

  const [index, setIndex] = useState<CharIndex | null>(() => profile.loader.getLoaded())
  const [query, setQuery] = useState<string | null>(null)
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null)

  const enabled = chatSettings?.[profile.settingsKey] ?? true

  // Refs so the registered command handler never needs re-registering when
  // settings or the dataset arrive — same shape as TextReplacementPlugin.
  const enabledRef = useRef(enabled)
  const indexRef = useRef(index)
  const profileRef = useRef(profile)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    indexRef.current = index
  }, [index])

  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  // The contenteditable can be swapped out (mode toggles), so subscribe rather
  // than reading it once. `registerRootListener` invokes the listener
  // IMMEDIATELY with the current root, so no separate seeding call is needed —
  // and adding one would be a synchronous setState in an effect body.
  useEffect(() => editor.registerRootListener((next) => setRootElement(next)), [editor])

  /**
   * Kick off the lazy fetch. Called only once an opener is actually in play, so
   * an instance whose writer never types one never pays for the dataset.
   */
  const ensureIndex = useCallback(() => {
    if (indexRef.current) return
    void profileRef.current.loader.load().then((loaded) => {
      if (loaded) setIndex(loaded)
    })
  }, [])

  const options = useMemo(() => {
    if (!index || query === null) return []

    const results = searchChars(index, query, MENU_LIMIT)

    // A code-point query resolves arithmetically, so it can name a character the
    // curation dropped. Put it first — someone who typed `→` asked for
    // exactly one thing.
    if (profile.codePointQueries) {
      const direct = findByCodePoint(index, query)
      if (direct) {
        return [direct, ...results.filter((entry) => entry.char !== direct.char)]
          .slice(0, MENU_LIMIT)
          .map((entry) => toOption(profile, entry))
      }
    }

    return results.map((entry) => toOption(profile, entry))
  }, [index, query, profile])

  const menuRenderFn = useTypeaheadShell<CharEntry>({
    listboxId: profile.ui.listboxId,
    emptyLabel: profile.ui.emptyLabel,
    activeDescendantTarget: rootElement,
  })

  /**
   * Bail conditions, in order — these MIRROR Layer 1.5's and must not drift from
   * them. 3-5 are enforced inside `$textBeforeCursor`.
   *
   *   1. feature disabled       4. inside a fenced code block
   *   2. IME composition        5. inside an inline `code` run
   *   3. no collapsed selection 6. inside a math span (Unicode only)
   *                             7. dataset not loaded yet
   */
  const triggerFn = useCallback(
    (text: string, activeEditor: LexicalEditor): MenuTextMatch | null => {
      if (!enabledRef.current) return null
      if (activeEditor.isComposing()) return null

      const match = findTrigger(text, profile.trigger)
      if (!match) return null

      // A closed trigger (`:smile:`) is the keydown handler's business; if it
      // reached here the alias did not resolve, and re-opening a menu on the
      // text the user just closed would be a jack-in-the-box.
      if (match.closed) return null

      // `$$\ph` is a formula being typed, not a request for φ. Checked against
      // the text BEFORE the trigger, so the trigger's own backslash can never
      // be mistaken for a delimiter.
      if (profile.bailInsideMath && isInsideMathSpan(text.slice(0, match.start))) return null

      const current = $textBeforeCursor()
      if (!current) return null
      if ($isGluedToPreviousRun(current.node, match.start)) return null

      if (!indexRef.current) {
        ensureIndex()
        return null
      }

      return toMenuTextMatch(text, match)
    },
    [ensureIndex, profile],
  )

  const commit = useCallback(
    (nodeToReplace: TextNode | null, entry: CharEntry) => {
      editor.update(
        () => {
          // No trailing space: an inserted character is punctuation-adjacent,
          // and writers frequently want `word😄`, `😄😄` or `x→y`. Deliberate
          // divergence from the chip path — see $insertWithoutTrailingSpace.
          $insertWithoutTrailingSpace(nodeToReplace, entry.char)
        },
        { tag: CHAR_INSERT_TAG },
      )
      recordRecent(profile, entry.char)
    },
    [editor, profile],
  )

  const onSelectOption = useCallback(
    (option: TypeaheadOption<CharEntry>, nodeToReplace: TextNode | null, closeMenu: () => void) => {
      commit(nodeToReplace, option.payload)
      closeMenu()
    },
    [commit],
  )

  /**
   * The menu-free commit keystroke: emoji's closing `:` and Unicode's trailing
   * space, which are the same idea with different punctuation.
   *
   * ### Interaction with Layer 1.5
   *
   * Both `:` and ` ` are ALSO text-replacement word-boundary triggers, so this
   * handler sits at COMMAND_PRIORITY_NORMAL, above TextReplacementPlugin's LOW.
   * It swallows the keystroke (`return true`) ONLY when it commits a character.
   * Otherwise it returns false, so a `:` typed after a replaceable word still
   * fires the replacement AND still opens the menu on the resulting text — which
   * is what a writer expects. `\to` is not a plausible replacement trigger, so
   * the space path swallows nothing anyone wanted.
   */
  useEffect(() => {
    const commitKey = profile.commitKey
    if (!commitKey) return

    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event === null) return false
        if (event.key !== commitKey.key) return false
        if (!enabledRef.current) return false
        if (editor.isComposing()) return false

        const charIndex = indexRef.current
        if (!charIndex) {
          // Only the emoji profile fetches from here — see `mayTriggerLoad`.
          if (commitKey.mayTriggerLoad) ensureIndex()
          return false
        }

        const target = editor.getEditorState().read(() => {
          const current = $textBeforeCursor()
          if (!current) return null

          // The commit key has not landed yet — preventDefault below stops it
          // ever doing so — so ask Tier B about the text as it WOULD read.
          const match = findTrigger(`${current.text}${commitKey.probeSuffix}`, profile.trigger)
          if (!match) return null
          if (commitKey.requireClosed && !match.closed) return null
          if ($isGluedToPreviousRun(current.node, match.start)) return null
          if (profile.bailInsideMath && isInsideMathSpan(current.text.slice(0, match.start))) {
            return null
          }

          const entry = resolveExact(profile, charIndex, match.query)
          if (!entry) return null

          return { nodeKey: current.node.getKey(), match, entry }
        })

        if (!target) return false

        event.preventDefault()
        editor.update(
          () => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection)) return
            const node = selection.anchor.getNode()
            if (!$isTextNode(node) || node.getKey() !== target.nodeKey) return

            const text = node.getTextContent()
            const { start, end } = target.match

            // Bail if the world shifted under us between read and update.
            if (end > text.length || text[start] !== profile.trigger.opener) return

            const replacement = target.entry.char + commitKey.insertSuffix
            const next = text.slice(0, start) + replacement + text.slice(end)
            node.setTextContent(next)
            const cursor = start + replacement.length
            node.select(cursor, cursor)
          },
          { tag: CHAR_INSERT_TAG },
        )
        recordRecent(profile, target.entry.char)

        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )
  }, [editor, ensureIndex, profile])

  if (!enabled) return null

  return (
    <LexicalTypeaheadMenuPlugin<TypeaheadOption<CharEntry>>
      options={options}
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      menuRenderFn={menuRenderFn}
      /*
       * CRITICAL, not NORMAL — and this is load-bearing. `KeyboardPlugin`
       * registers KEY_ENTER_COMMAND at COMMAND_PRIORITY_HIGH to submit the
       * message, so a lower-priority menu never sees Enter and picking a
       * character with the keyboard silently sends the draft instead.
       *
       * Safe because these handlers exist ONLY while the menu is open:
       * `LexicalTypeaheadMenuPlugin` mounts `LexicalMenu` (which registers
       * Enter / arrows / Escape / Tab) only once a trigger has resolved. With
       * the menu shut, Enter reaches KeyboardPlugin exactly as before.
       *
       * The separate commit-key KEY_DOWN handler above stays at NORMAL, where
       * it needs to be to sit above TextReplacementPlugin's LOW.
       */
      commandPriority={COMMAND_PRIORITY_CRITICAL}
    />
  )
}

export default CharTypeaheadPlugin
