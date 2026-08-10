/**
 * In-memory cache of the passphrase the operator last proved knowledge of.
 *
 * The `.dbkey` flow only ever sees the passphrase at the moments it passes
 * through (setup, unlock, change, store) — it derives the pepper and discards
 * it. Archive encryption (§4.2c of the character-archive spec) needs the
 * passphrase *later*, at archive time, because an archive bundle must be
 * decryptable from the passphrase alone: bundles outlive the instance, so the
 * key material has to be knowledge the operator carries, freshly salted per
 * bundle — nothing derivable without the passphrase itself.
 *
 * So `dbkey.ts` deposits the effective passphrase here at each of those
 * moments, and `lockDbKey` clears it alongside the pepper. Exposure calculus:
 * the pepper — the actual database key — already sits in `process.env` for the
 * life of the unlocked process, so within this process the cached passphrase
 * adds nothing an attacker with memory access didn't already have. The
 * marginal risk is passphrase reuse across services, which is why locking
 * clears it and nothing ever writes it to disk or logs.
 *
 * Stored on `global` (the `dbkey.ts` pattern) to survive Next.js HMR reloads.
 * Dependency-free by design — this sits on the pepper startup path, which
 * must stay clear of `lib/env` / `lib/logger` / `lib/encryption` cycles.
 */

declare global {
  var __quilltapRuntimePassphrase: string | undefined;
}

/** Remember the effective passphrase (the internal sentinel counts too). */
export function cacheRuntimePassphrase(passphrase: string): void {
  global.__quilltapRuntimePassphrase = passphrase;
}

/**
 * The effective passphrase last proven to this process, or null when none has
 * passed through yet (e.g. the pepper came straight from the environment).
 */
export function getRuntimePassphrase(): string | null {
  return global.__quilltapRuntimePassphrase ?? null;
}

/** Forget the passphrase — called when the database key is locked. */
export function clearRuntimePassphrase(): void {
  delete global.__quilltapRuntimePassphrase;
}
