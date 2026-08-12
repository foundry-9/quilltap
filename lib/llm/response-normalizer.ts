/**
 * Pure, dependency-free response-normalization helpers.
 *
 * These live apart from `message-formatter.ts` deliberately: that module pulls
 * in the provider registry (which reaches `node:fs`), so it cannot be bundled
 * for the client. The two functions here are pure string transforms with no
 * such dependency, so client-safe modules (e.g. the turn-manager skip-signal
 * logic) can import them directly. `message-formatter.ts` re-exports them for
 * backward compatibility.
 */

/**
 * Normalize LLM response content that may be wrapped in content block format.
 *
 * Some providers return content in Anthropic's content block array format:
 * [{'type': 'text', 'text': "actual content"}]
 *
 * This function extracts the text if it detects this format.
 *
 * @param content The raw content from the LLM
 * @returns The normalized text content
 */
export function normalizeContentBlockFormat(content: string): string {
  if (!content) return content

  // Check for patterns that look like content block arrays
  // Handles both single quotes (Python repr) and double quotes (JSON)
  // Pattern: [{'type': 'text', 'text': "..."} or [{"type": "text", "text": "..."}

  const trimmed = content.trim()

  // Quick checks to avoid expensive regex on normal content
  if (!trimmed.startsWith('[')) return content
  if (!trimmed.includes("'type'") && !trimmed.includes('"type"')) return content

  // Pattern for Python-style single quotes: [{'type': 'text', 'text': "..."}]
  // The inner text value can use double quotes
  const pythonPattern = /^\[\s*\{\s*'type'\s*:\s*'text'\s*,\s*'text'\s*:\s*"([\s\S]*)"\s*\}\s*\]$/
  const pythonMatch = trimmed.match(pythonPattern)
  if (pythonMatch) {
    return pythonMatch[1]
  }

  // Try parsing as JSON (handles double-quoted format)
  // Pattern: [{"type": "text", "text": "..."}]
  try {
    const parsed = JSON.parse(trimmed)
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed[0]?.type === 'text' &&
      typeof parsed[0]?.text === 'string'
    ) {
      return parsed[0].text
    }
  } catch {
    // Not valid JSON, that's fine - return original content
  }

  return content
}

/**
 * Strip character name prefixes from the beginning of a response.
 *
 * LLMs sometimes mimic the [Name] prefix format from the input in their responses.
 * This function removes any such prefixes from the start of the response,
 * including multiple occurrences across newlines.
 *
 * @param content The response content to clean
 * @param characterName The responding character's name (to specifically target)
 * @returns Cleaned content without leading name prefixes
 */
export function stripCharacterNamePrefix(content: string, characterName?: string, aliases?: string[]): string {
  if (!content) return content

  let result = content

  // Build targeted patterns from the known character name and aliases.
  // We ONLY strip brackets that contain the actual character name or alias,
  // not arbitrary bracketed content — that would eat roleplay action tags
  // like [*sighs*], status messages like [Whisper sent.], etc.
  const namePatterns: RegExp[] = []

  if (characterName) {
    const escapedName = characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    namePatterns.push(new RegExp(`^\\s*\\[${escapedName}\\]\\s*`, 'i'))
    // Also match "Name:" without brackets
    namePatterns.push(new RegExp(`^\\s*${escapedName}\\s*:\\s*`, 'i'))
  }

  if (aliases && aliases.length > 0) {
    for (const alias of aliases) {
      const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      namePatterns.push(new RegExp(`^\\s*\\[${escapedAlias}\\]\\s*`, 'i'))
      namePatterns.push(new RegExp(`^\\s*${escapedAlias}\\s*:\\s*`, 'i'))
    }
  }

  // If we have no character name at all, fall back to a conservative general
  // pattern that only matches short name-like content in brackets (1-3 words,
  // letters/spaces/hyphens/apostrophes only — no punctuation or sentences)
  if (namePatterns.length === 0) {
    namePatterns.push(/^\s*\[[\p{L}\p{M}'\- ]{1,40}\]\s*/u)
  }

  // Keep stripping prefixes until we don't find any more.
  // This handles cases like "[Name]\n[Name]\n[Name]\n*content*"
  let previousLength = -1
  let iterations = 0
  const MAX_ITERATIONS = 10

  while (result.length !== previousLength && iterations < MAX_ITERATIONS) {
    previousLength = result.length
    iterations++

    let matched = false
    for (const pattern of namePatterns) {
      if (pattern.test(result)) {
        result = result.replace(pattern, '')
        matched = true
        break
      }
    }

    if (!matched) break
  }

  return result
}
