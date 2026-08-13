'use client'

/**
 * Shared typeahead shell — types.
 *
 * Tier C. This shell is deliberately generic: it was built for the emoji
 * typeahead (Layer 2.0e) because emoji is its cheapest consumer, and Layer 2's
 * `@` / `#` / `/` plugins are meant to consume it unchanged. See
 * `docs/developer/features/composer-typeahead.md`.
 *
 * @module components/chat/lexical/typeahead/types
 */

import type { ReactNode } from 'react'

/** One rendered row in a typeahead menu. */
export interface TypeaheadRow {
  /** Stable identity — also the underlying Lexical `MenuOption` key. */
  key: string
  /** Leading glyph: an emoji character, or an icon element. */
  glyph?: ReactNode
  /** Primary label. This is the row's accessible name. */
  label: string
  /** Muted trailing detail, e.g. `:shortcode:`. */
  detail?: string
}

export interface TypeaheadInsertOptions {
  /**
   * Whether to append a single space after the inserted text.
   *
   * Layer 2's chips DO (a chip is a word). Emoji does NOT — an emoji is
   * punctuation-adjacent and writers frequently want `word😄` or `😄😄`. This
   * divergence is deliberate; please do not "fix" it into consistency.
   */
  trailingSpace: boolean
}
