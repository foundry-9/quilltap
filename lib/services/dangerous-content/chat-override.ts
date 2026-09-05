/**
 * Per-chat Concierge override helpers — the single source of truth for a
 * chat's danger status.
 *
 * Danger lives in two stored fields, `isDangerousChat` (the classification
 * label) and `conciergeOverride` (`'OFF'` = the operator vouched the chat
 * safe; `'UNCENSORED'` = the operator asserted it spicy and opened the
 * uncensored door themselves). Neither field is meaningful on its own: both
 * operator states *preserve* the label (so the user can return to Monitored
 * or Flagged later) while taking the classifier off the case.
 *
 * The four states are a 2×2 — rows are the route, columns are the provenance:
 *
 *   |                    | Concierge decides | operator decides |
 *   | ordinary route     | 'monitored'       | 'vouched'        |
 *   | uncensored route   | 'flagged'         | 'uncensored'     |
 *
 * Because the two fields must always be read together, NOTHING outside this
 * module (and the handful of sanctioned writers/serializers) should read the
 * raw fields. Derive everything from {@link getConciergeState}, or ask one of
 * the purpose-named questions:
 *
 *   - "Take the uncensored routes right now?" → {@link shouldUseUncensoredRoute}
 *     (or {@link conciergeStateUsesUncensoredRoute}, given a derived state)
 *   - "Paint danger styling in the UI?"        → {@link shouldShowDangerStyling}
 *   - "May the classifier run at all?"          → {@link isClassifierOnDuty}
 *
 * Reading a raw field on its own — or answering one question with another
 * question's predicate — is how an override gets silently dropped.
 */

import type { ChatMetadata, ChatMetadataBase } from '@/lib/schemas/types';

/** The stored `chats.conciergeOverride` domain (NULL = the classifier decides). */
export type ConciergeOverrideValue = 'OFF' | 'UNCENSORED';

type ChatLike = Pick<ChatMetadata, 'conciergeOverride' | 'isDangerousChat'>
  | Pick<ChatMetadataBase, 'conciergeOverride' | 'isDangerousChat'>
  | { conciergeOverride?: ConciergeOverrideValue | null; isDangerousChat?: boolean | null };

/**
 * The canonical four-state for a chat's Concierge status. The string values
 * are also the wire contract for the manual-flip control
 * (`PUT /api/v1/chats/[id]` `conciergeState`), so they must stay
 * `'monitored' | 'flagged' | 'vouched' | 'uncensored'`.
 *
 *   - `'monitored'`  — not classified dangerous; the classifier keeps watch
 *                      and may auto-flip to `'flagged'`.
 *   - `'flagged'`    — classified dangerous (auto or manual): uncensored
 *                      routes, danger styling, the works.
 *   - `'vouched'`    — operator vouched the chat safe (`conciergeOverride ===
 *                      'OFF'`). No classification, no uncensored routes; the
 *                      label is preserved underneath.
 *   - `'uncensored'` — operator asserted the chat spicy (`conciergeOverride
 *                      === 'UNCENSORED'`). Every uncensored route, zero
 *                      classification, zero danger styling; the label is
 *                      preserved underneath.
 *
 * Only the classifier moves a chat between `'monitored'` and `'flagged'`;
 * only the operator can enter or leave `'vouched'` / `'uncensored'`.
 */
export type ConciergeState = 'monitored' | 'flagged' | 'vouched' | 'uncensored';

/**
 * THE canonical derivation of a chat's Concierge status from its two stored
 * fields. Every other helper — and every display/management read — should go
 * through this so an operator override can never be silently dropped. Either
 * override wins over the classification label.
 */
export function getConciergeState(chat: ChatLike | null | undefined): ConciergeState {
  if (chat?.conciergeOverride === 'UNCENSORED') return 'uncensored';
  if (chat?.conciergeOverride === 'OFF') return 'vouched';
  return chat?.isDangerousChat === true ? 'flagged' : 'monitored';
}

/**
 * Is this state on the uncensored row of the 2×2 — `'flagged'` (the
 * classifier's verdict) or `'uncensored'` (the operator's assertion)?
 *
 * The state-only twin of {@link shouldUseUncensoredRoute}, for callers that
 * already hold a derived state (list payloads carry `conciergeState` rather
 * than the raw pair) and would otherwise have to fabricate a chat-like to ask
 * the question. This is THE one place that says which states take the
 * uncensored route; `shouldUseUncensoredRoute` delegates to it.
 */
export function conciergeStateUsesUncensoredRoute(state: ConciergeState): boolean {
  return state === 'flagged' || state === 'uncensored';
}

/**
 * Should this chat take the Concierge's uncensored routes right now?
 *
 * True for `'flagged'` (the classifier's verdict) and `'uncensored'` (the
 * operator's assertion) — the two states on the uncensored row of the 2×2.
 * Use this everywhere the Concierge would reroute providers, pick candid
 * over concealed prompt guidance, or select an uncensored cheap-LLM.
 */
export function shouldUseUncensoredRoute(chat: ChatLike | null | undefined): boolean {
  return conciergeStateUsesUncensoredRoute(getConciergeState(chat));
}

/**
 * Should the UI paint this chat with danger styling (red rings, warning
 * accents)?
 *
 * True only for `'flagged'`: the styling announces the *Concierge's* verdict.
 * An `'uncensored'` chat takes the same routes by the operator's own hand and
 * is deliberately not painted as a hazard.
 */
export function shouldShowDangerStyling(chat: ChatLike | null | undefined): boolean {
  return getConciergeState(chat) === 'flagged';
}

/**
 * Is the classifier allowed to run on this chat at all?
 *
 * True for the two Concierge-decides states (`'monitored'`, `'flagged'`);
 * false for both operator states — once the operator has spoken, nothing may
 * reclassify the chat out from under them.
 */
export function isClassifierOnDuty(chat: ChatLike | null | undefined): boolean {
  const s = getConciergeState(chat);
  return s === 'monitored' || s === 'flagged';
}
