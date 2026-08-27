/**
 * Cheap-LLM JSON Parsing Helpers
 *
 * Shared plumbing for every path that asks an LLM for structured JSON and has
 * to survive what actually comes back: markdown code fences, raw control
 * characters inside string literals, and output truncated at the maxTokens
 * boundary. `parseLLMJson` is the front door; the other exports are its
 * individually-testable stages.
 */

/**
 * Strip markdown code fences from LLM output before JSON parsing
 */
export function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  // Remove ```json ... ``` or ``` ... ``` (single source for every cheap-LLM JSON
  // parser; the regex form tolerates both newline- and inline-delimited fences).
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return cleaned.trim();
}

/**
 * Attempt to repair truncated JSON from LLM output that was cut off
 * by maxTokens limits. Closes unclosed strings, arrays, and objects.
 */
export function repairTruncatedJson(text: string): string {
  let repaired = text.trim();

  // If it already parses, return as-is
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    // Continue with repair
  }

  // Remove trailing comma (common at truncation point)
  repaired = repaired.replace(/,\s*$/, '');

  // Track bracket/brace depth to close unclosed structures
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (const ch of repaired) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }

  // If we're mid-string, close it
  if (inString) {
    repaired += '"';
  }

  // Remove any trailing key without a value (e.g. `"field":` or `"field": `)
  repaired = repaired.replace(/,?\s*"[^"]*"\s*:\s*$/, '');

  // Remove trailing comma again after cleanup
  repaired = repaired.replace(/,\s*$/, '');

  // Close all unclosed brackets/braces
  while (stack.length > 0) {
    repaired += stack.pop();
  }

  return repaired;
}

/**
 * Escape raw control characters (newlines, tabs, etc.) that appear *inside* a
 * JSON string literal. LLMs routinely emit a literal newline within a string
 * value instead of the `\n` escape sequence, which makes JSON.parse throw
 * "Bad control character in string literal". This walks the text with a small
 * string-aware state machine and escapes only the control characters that fall
 * inside a string, leaving structural whitespace between tokens untouched.
 */
export function escapeControlCharsInStrings(text: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    const code = text.charCodeAt(i);
    if (inString && code <= 0x1f) {
      switch (ch) {
        case '\n': result += '\\n'; break;
        case '\r': result += '\\r'; break;
        case '\t': result += '\\t'; break;
        case '\b': result += '\\b'; break;
        case '\f': result += '\\f'; break;
        default: result += '\\u' + code.toString(16).padStart(4, '0'); break;
      }
      continue;
    }

    result += ch;
  }

  return result;
}

/**
 * Parse JSON from LLM output, handling code fences, truncated output,
 * and common formatting issues from LLM responses.
 */
export function parseLLMJson<T>(text: string): T {
  const cleaned = stripCodeFences(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // LLMs commonly emit raw control characters inside string literals and/or
    // truncate output at the maxTokens boundary. Escape control chars first,
    // then repair any truncation before a final parse attempt.
    const escaped = escapeControlCharsInStrings(cleaned);
    try {
      return JSON.parse(escaped) as T;
    } catch {
      const repaired = repairTruncatedJson(escaped);
      return JSON.parse(repaired) as T;
    }
  }
}
