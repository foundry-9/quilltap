/**
 * Leading-system-message collapse.
 *
 * Quilltap's context builder deliberately emits the head of a turn as up to
 * three consecutive `system` messages — the cacheable persona prefix, the
 * static identity reinforcement, and the compressed-history summary — so that a
 * cache breakpoint on the first is not invalidated by churn in the others.
 * Hosted providers accept that happily.
 *
 * A local runtime does not answer for itself: it applies the *model's own* chat
 * template, and several families (Qwen most notably, plus Llama- and
 * Gemma-derived templates) `raise_exception` on any system message after index
 * 0. The whole request is then rejected before a token is generated, so the
 * opening greeting — one system message — works and every turn after it dies.
 *
 * The repair belongs here, at request-build time, rather than in the context
 * assembly: the blocks stay separate for every provider that wants them
 * separate, and the providers that cannot take them fold the run on the way
 * out. See Bug 82.
 *
 * @packageDocumentation
 */

/** The shape this helper needs; wire messages carry more, and keep it. */
interface RoleAndContent {
  role: string;
  content?: string | null;
}

/**
 * Fold a run of consecutive leading `system` messages into a single one,
 * joining their contents with a blank line.
 *
 * Only the *leading* run is touched — a system message that appears later is
 * left where it is, because moving or merging it would change what the model is
 * told and when. Arrays with fewer than two leading system messages are
 * returned unchanged (the same array reference), so a provider that opts in
 * still sends byte-identical requests everywhere the problem does not arise.
 *
 * @param messages - Wire-format messages, already mapped for the endpoint
 * @returns The messages with their leading system run collapsed
 */
export function collapseLeadingSystemMessages<T extends RoleAndContent>(messages: T[]): T[] {
  let runLength = 0;
  while (runLength < messages.length && messages[runLength].role === 'system') {
    runLength++;
  }

  if (runLength < 2) return messages;

  const run = messages.slice(0, runLength);
  const merged: T = {
    ...run[0],
    content: run
      .map((m) => m.content ?? '')
      .filter((c) => c.length > 0)
      .join('\n\n'),
  };

  return [merged, ...messages.slice(runLength)];
}
