/**
 * qtap:// bare-URL linkification for markdown content.
 *
 * Upgrades surfaced literal qtap:// URIs to markdown link form while skipping
 * inline/fenced code spans. Used by both client and server renderers so they
 * stay in lockstep.
 */

const INLINE_CODE_OR_FENCE_RE = /(```[\s\S]*?```|`[^`\n]*`)/g
const BARE_QTAP_URI_RE = /(?<!\]\()(?<!<)(qtap:\/\/[^\s<>()\]]+)/g

export function linkifyBareQtapUris(text: string): string {
  return text
    .split(INLINE_CODE_OR_FENCE_RE)
    .map((segment) => {
      if (!segment) return segment
      if (segment.startsWith('```') || segment.startsWith('`')) {
        return segment
      }
      return segment.replace(BARE_QTAP_URI_RE, (uri) => `[${uri}](${uri})`)
    })
    .join('')
}
