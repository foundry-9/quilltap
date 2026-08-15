/**
 * Inline `<think>` block recognition for Ollama responses.
 *
 * Ollama separates a thinking model's reasoning into `message.thinking` when
 * it recognises the model's template, but plenty of community GGUF imports
 * (and older Ollama versions) leak the raw `<think>...</think>` block straight
 * into `message.content`. This parser routes that text into the reasoning
 * channel instead of the visible message, surviving tags that straddle
 * streaming chunk boundaries.
 */

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

/**
 * Length of the longest strict prefix of `tag` that `text` ends with.
 * Used to hold back a partial tag at the end of a streaming chunk until
 * the next chunk reveals whether it completes.
 */
function partialTagSuffixLength(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1);
  for (let k = max; k > 0; k--) {
    if (tag.startsWith(text.slice(text.length - k))) return k;
  }
  return 0;
}

/**
 * Stateful streaming splitter: feed content deltas through `push()`, which
 * returns the text safe to display; anything inside `<think>...</think>`
 * accumulates on `reasoning`. Call `flush()` once the stream ends to release
 * any held-back partial tag (an unterminated think block counts as reasoning).
 *
 * Leading whitespace between a closed think block and the first visible
 * character is dropped, so `<think>...</think>\n\nHello` renders as `Hello`.
 * Responses containing no think block pass through byte-for-byte.
 */
export class ThinkTagStreamParser {
  private pending = '';
  private inThink = false;
  private sawThinkBlock = false;
  private emittedVisible = false;
  private reasoningText = '';

  /** Reasoning captured so far (raw, monotonically growing). */
  get reasoning(): string {
    return this.reasoningText;
  }

  /** Feed a content delta; returns the displayable text it releases. */
  push(delta: string): string {
    this.pending += delta;
    let out = '';
    for (;;) {
      if (this.inThink) {
        const close = this.pending.indexOf(CLOSE_TAG);
        if (close !== -1) {
          this.reasoningText += this.pending.slice(0, close);
          this.pending = this.pending.slice(close + CLOSE_TAG.length);
          this.inThink = false;
          continue;
        }
        const hold = partialTagSuffixLength(this.pending, CLOSE_TAG);
        this.reasoningText += this.pending.slice(0, this.pending.length - hold);
        this.pending = this.pending.slice(this.pending.length - hold);
        break;
      }
      const open = this.pending.indexOf(OPEN_TAG);
      // Swallowed-opening-tag pattern: some templates driven in no-think mode
      // (Qwen3 GGUF imports, notably) let the model reason anyway and Ollama
      // eats the opening <think>, so the reasoning arrives untagged with only
      // the closing tag surviving. A close tag showing up before any think
      // block and before any visible output means everything ahead of it is
      // reasoning, not content. Once real content has been emitted the rule is
      // off the table — a stray close tag in an ordinary answer stays put.
      const orphanEligible = !this.sawThinkBlock && !this.emittedVisible;
      if (orphanEligible) {
        const close = this.pending.indexOf(CLOSE_TAG);
        if (close !== -1 && (open === -1 || close < open)) {
          this.reasoningText += out + this.pending.slice(0, close);
          out = '';
          this.pending = this.pending.slice(close + CLOSE_TAG.length);
          this.sawThinkBlock = true;
          continue;
        }
      }
      if (open !== -1) {
        out += this.pending.slice(0, open);
        this.pending = this.pending.slice(open + OPEN_TAG.length);
        this.inThink = true;
        this.sawThinkBlock = true;
        continue;
      }
      const holdOpen = partialTagSuffixLength(this.pending, OPEN_TAG);
      const holdClose = orphanEligible ? partialTagSuffixLength(this.pending, CLOSE_TAG) : 0;
      const hold = Math.max(holdOpen, holdClose);
      out += this.pending.slice(0, this.pending.length - hold);
      this.pending = this.pending.slice(this.pending.length - hold);
      break;
    }
    return this.sanitize(out);
  }

  /** Release whatever is still held. Call exactly once, at end of stream. */
  flush(): string {
    const tail = this.pending;
    this.pending = '';
    if (this.inThink) {
      // Unterminated think block — the stream ended mid-thought.
      this.reasoningText += tail;
      return '';
    }
    return this.sanitize(tail);
  }

  /**
   * Drop the whitespace a template leaves between the think block and the
   * real answer — but only when a think block was actually consumed, so
   * ordinary responses come through untouched.
   */
  private sanitize(text: string): string {
    if (!text) return text;
    if (!this.emittedVisible && this.sawThinkBlock) {
      text = text.replace(/^\s+/, '');
      if (!text) return text;
    }
    this.emittedVisible = true;
    return text;
  }
}

/**
 * One-shot variant for non-streaming responses: split `content` into the
 * displayable text and the reasoning captured from `<think>` blocks.
 */
export function extractThinkBlocks(content: string): { content: string; reasoning: string } {
  const parser = new ThinkTagStreamParser();
  const out = parser.push(content) + parser.flush();
  return { content: out, reasoning: parser.reasoning };
}
