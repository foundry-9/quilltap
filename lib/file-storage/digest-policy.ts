/**
 * Which `files` rows carry a digest of something OTHER than their disk bytes.
 *
 * Nearly every `files` row's `sha256` is the digest of exactly the bytes at its
 * `storageKey`, which is why the watcher and the boot reconciliation may
 * re-derive it from disk whenever a file changes underneath them.
 *
 * An archived character's bundle is the exception. The bytes on disk are
 * **encrypted**; the row deliberately records the digest of the *plaintext*
 * (`archive-service.ts` §4.2d), because that is what survives a passphrase
 * change and is what rehydration verifies after decrypting. Re-deriving that
 * row's `sha256` from disk replaces the content digest with a ciphertext
 * digest, and the next rehydrate refuses the bundle as corrupt — bug 69, which
 * made archiving one-way for every character archived while the watcher ran.
 *
 * Anything writing `sha256` from a file on disk must ask this module first.
 * `size` is not affected: an archive row's `size` is the real on-disk
 * (encrypted) byte count and may be corrected freely.
 *
 * @module file-storage/digest-policy
 */

/**
 * File categories whose `sha256` is a digest of content that is not what sits
 * at `storageKey`. Never re-derive these from disk.
 */
const CONTENT_DIGEST_CATEGORIES = new Set(['ARCHIVE']);

/**
 * True when the row's `sha256` describes content other than its disk bytes —
 * i.e. it must be preserved verbatim rather than recomputed.
 *
 * @param category - the `files` row's category (unknown/absent counts as an
 *   ordinary row, since disk-derived digests are the norm)
 */
export function preservesContentDigest(category: string | null | undefined): boolean {
  return !!category && CONTENT_DIGEST_CATEGORIES.has(category);
}
