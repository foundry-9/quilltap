/**
 * Composer source-mode surface resolution.
 *
 * The Salon composer has two writing surfaces that are never both live:
 *
 * - the Lexical editor, which owns the live text and is read imperatively via
 *   its handle (`getMarkdown()`) because the page's `input` state deliberately
 *   lags every keystroke (see [[project_salon_composer_input_decoupling]]); and
 * - the raw-source `<textarea>` shown by "Edit markdown source", which is a
 *   controlled input over that same `input` state while the editor sits hidden
 *   with its sync bridge suspended.
 *
 * **Bug 67** was the send path reading the editor handle unconditionally: in
 * source view the handle still holds the pre-toggle document, so every source
 * edit was silently discarded on send. These two
 * helpers are the one place that decides which surface is authoritative, for
 * the bytes that ship and for whether Send lights at all.
 *
 * @module app/salon/[id]/composer-source-mode
 */

/**
 * The markdown a submit should actually send.
 *
 * @param showSource - whether the raw-source textarea is the visible surface
 * @param sourceValue - the page's `input` state (what the textarea shows)
 * @param editorMarkdown - the Lexical handle's markdown, if the handle is live
 */
export function resolveComposerSubmitText(
  showSource: boolean,
  sourceValue: string,
  editorMarkdown: string | undefined,
): string {
  // Source view: the textarea is what the writer can see and has been editing,
  // and the editor's bridge is suspended — send the visible bytes.
  if (showSource) return sourceValue
  return editorMarkdown ?? sourceValue
}

/**
 * Whether the composer holds anything worth sending — the Send button's gate.
 *
 * In source view the editor reports no content changes (its bridge is
 * suspended), so its presence flag is stale; the textarea's own value decides.
 */
export function resolveComposerHasContent(
  showSource: boolean,
  sourceValue: string,
  editorHasContent: boolean,
): boolean {
  if (showSource) return sourceValue.trim().length > 0
  return editorHasContent
}
