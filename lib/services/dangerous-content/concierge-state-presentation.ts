/**
 * How the Concierge's four states are *shown* — the single source for every
 * word, icon and tone a UI puts on screen.
 *
 * Its sibling, `chat-override.ts`, is the single source for *deriving* a state
 * from a chat's two stored fields. This module never derives anything; hand it
 * a {@link ConciergeState} and it hands back the presentation.
 *
 * It exists because the same four states were being described in three places
 * with three different sets of words — the Salon header pill's `title`
 * strings, the sidebar's helper sentences, and the list asterisk's terse
 * "Flagged as dangerous" — and a fourth consumer by copy-paste is how the copy
 * drifts. The `detail` sentences below are the sidebar's, moved verbatim: they
 * are the fullest statement of each state and already in voice.
 *
 * Client-safe: types only, no server imports, no side effects.
 */

import type { IconName } from '@/components/ui/icons/icon-registry';
import type { ConciergeState } from './chat-override';

/**
 * The colour families the four states speak in. `danger` is the red of the
 * Concierge's own verdict, `muted` the grey of a state he is not party to,
 * `info` the blue of a door the operator opened, `success` the green of a
 * watch being kept.
 */
export type ConciergeTone = 'danger' | 'muted' | 'info' | 'success';

export interface ConciergeStatePresentation {
  /** Short label — badge text, aria-label, tooltip title. */
  label: string;
  /** Canonical icon for the state (the sidebar's icon, the badge's glyph). */
  icon: IconName;
  /** Colour family; see {@link conciergeToneSuffix} and {@link conciergeToneTextClass}. */
  tone: ConciergeTone;
  /** The full "what this means" sentence, in Quilltap's voice. */
  detail: string;
  /** Where to change it; appended to tooltips outside the sidebar. */
  hint: string;
}

/** Where every state is changed from — one sentence, said once. */
const CHANGE_HINT = "Change it from the Salon sidebar's Chat section.";

/**
 * THE table. Four states, four presentations; every badge, mark, icon and
 * helper sentence in the application reads from here, so a copy edit lands
 * everywhere at once.
 */
export const CONCIERGE_STATE_PRESENTATION: Record<ConciergeState, ConciergeStatePresentation> = {
  monitored: {
    label: 'Monitored',
    icon: 'eye',
    tone: 'success',
    detail: 'The Concierge keeps watch, and will flip the switch himself if the conversation calls for it.',
    hint: CHANGE_HINT,
  },
  flagged: {
    label: 'Flagged',
    icon: 'alert-triangle',
    tone: 'danger',
    detail: 'The Concierge has this chat down as dangerous, and routes it through the uncensored providers.',
    hint: CHANGE_HINT,
  },
  vouched: {
    label: 'Vouched Safe',
    icon: 'check-circle',
    tone: 'muted',
    detail: 'You have vouched for this chat. The Concierge stops watching; the ordinary providers still apply, and may still refuse.',
    hint: CHANGE_HINT,
  },
  uncensored: {
    label: 'Uncensored',
    icon: 'eye-off',
    tone: 'info',
    detail: 'You have sent the Concierge away and opened the uncensored door yourself. Nothing is scanned, nothing is softened — the risk is yours.',
    hint: CHANGE_HINT,
  },
};

/**
 * Tone → the class suffix shared by the `qt-danger-badge` and
 * `qt-concierge-mark` families. `danger` is the base rule, so it suffixes with
 * nothing; `success` has no modifier in either family (Monitored draws no badge
 * and no mark) and likewise falls through to the base.
 */
export function conciergeToneSuffix(tone: ConciergeTone): '' | '-muted' | '-info' {
  if (tone === 'muted') return '-muted';
  if (tone === 'info') return '-info';
  return '';
}

/** Tone → the `qt-text-*` utility, for the icons that carry a colour of their own. */
export function conciergeToneTextClass(tone: ConciergeTone): string {
  switch (tone) {
    case 'muted': return 'qt-text-muted';
    case 'info': return 'qt-text-info';
    case 'success': return 'qt-text-success';
    default: return 'qt-text-danger';
  }
}

/** Everything a tooltip needs, in the order it is read. */
export interface ConciergeStateDescription {
  /** The state's short label — the tooltip's title line. */
  title: string;
  /** The full sentence. */
  detail: string;
  /** The classifier's categories — Flagged only, and only when it has any. */
  categories: string[] | null;
  /** Where to change the state. */
  hint: string;
}

/**
 * Describe a state for a tooltip or an accessible summary.
 *
 * `dangerCategories` is surfaced only for `'flagged'`: they are the
 * classifier's own reasons, and on the two operator states they are a
 * preserved artefact of an earlier scan rather than a live verdict.
 */
export function describeConciergeState(
  state: ConciergeState,
  dangerCategories?: string[],
): ConciergeStateDescription {
  const presentation = CONCIERGE_STATE_PRESENTATION[state];
  const categories = state === 'flagged' && dangerCategories && dangerCategories.length > 0
    ? dangerCategories
    : null;

  return {
    title: presentation.label,
    detail: presentation.detail,
    categories,
    hint: presentation.hint,
  };
}
