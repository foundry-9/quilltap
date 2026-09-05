/**
 * `qtap://` Document URI codec
 *
 * A `qtap://` URI is the first-class, human- and model-readable serialization of
 * the document-addressing triple `{ scope, mount_point, path }` that the path
 * resolver already understands (see `path-resolver.ts`). The codec is **pure
 * string work**: it never touches the database and never resolves anything. It
 * only turns a triple into a URI and back.
 *
 * Grammar:
 *
 * ```
 * qtap-uri    = "qtap://" authority "/" path [ "#" fragment ] [ "?" query ]
 * authority   = reserved / store-ref
 * reserved    = "self" / "project" / "general"          ; case-insensitive
 * store-ref   = encoded-name / uuid                       ; a store name OR a UUID
 * path        = path-segment *( "/" path-segment )        ; each segment percent-encoded
 * fragment    = encoded-heading [ ":" level ]             ; optional markdown heading anchor
 * query       = key "=" value *( "&" key "=" value )      ; reserved for future use
 * ```
 *
 * Authority → `{ scope, mount_point }`:
 *
 * | Authority (decoded, lower-cased) | scope            | mount_point           |
 * |----------------------------------|------------------|-----------------------|
 * | `self`                           | `document_store` | `self` (SELF token)   |
 * | `project`                        | `project`        | *(none)*              |
 * | `general`                        | `general`        | *(none)*              |
 * | anything else (name or UUID)     | `document_store` | the decoded authority |
 *
 * Reserved authorities always win in the authority slot; a real store literally
 * named `self`/`project`/`general` is reachable only by its UUID. This mirrors
 * the `SELF_VAULT_TOKEN` rule in the resolver.
 *
 * Encoding notes:
 * - Authority and every path segment are percent-encoded with
 *   `encodeURIComponent` and joined with literal `/`.
 * - A literal `:` is **accepted on parse** (it never confuses authority/path
 *   splitting, which keys off the first `/`), but the canonical emitted form
 *   always encodes `:` as `%3A` so a `qtap://` URI round-trips through any
 *   generic URL parser.
 * - `.`/`..` are NOT normalized here — that is the path resolver's job (it
 *   rejects `..`). The codec only decodes segments.
 * - A path segment containing an encoded slash (`%2F`) decodes to a literal `/`
 *   inside that one segment and is NOT re-split on parse. Because
 *   `formatQtapUri` re-encodes by splitting on `/`, such a segment does not
 *   survive a format round-trip (no current store needs it; documented here).
 *
 * @module doc-edit/qtap-uri
 */

// Type-only import — fully erased at compile time, so this module has NO
// runtime dependency on path-resolver (which pulls in Node-only fs/repos). That
// keeps the codec pure and safe to import into a client component (see §9a).
import type { DocEditScope } from './path-resolver';

export const QTAP_URI_SCHEME = 'qtap://';

/**
 * The reserved authority for the acting character's own vault. Must equal
 * `SELF_VAULT_TOKEN` in `path-resolver.ts` (`'self'`); kept as a local literal
 * here so the codec stays dependency-free. The codec unit test pins the two
 * together.
 */
const SELF_VAULT_TOKEN = 'self';

/** The reserved authorities that name a non-`document_store` scope (or the
 *  self-vault). Matched case-insensitively in the authority slot. */
const RESERVED_AUTHORITIES = new Set(['self', 'project', 'general']);

/** The fully-decoded address a `qtap://` URI denotes. */
export interface QtapUriParts {
  /** 'document_store' | 'project' | 'general'. */
  scope: DocEditScope;
  /**
   * Present only when `scope === 'document_store'`. The reserved value 'self'
   * (SELF_VAULT_TOKEN) or a store name/UUID, verbatim and decoded.
   */
  mountPoint?: string;
  /** Relative path within the store/scope. '' means the store root. */
  path: string;
  /** Optional markdown heading anchor (decoded), for heading-aware tools. */
  heading?: string;
  /** Optional heading level (1–6) if the fragment carried ':N'. */
  level?: number;
  /** Reserved for future use; parsed but currently unused. */
  query?: Record<string, string>;
}

export type QtapUriErrorCode =
  | 'NOT_A_QTAP_URI'
  | 'MALFORMED'
  | 'EMPTY_AUTHORITY'
  | 'BAD_LEVEL';

export class QtapUriError extends Error {
  constructor(
    message: string,
    public code: QtapUriErrorCode
  ) {
    super(message);
    this.name = 'QtapUriError';
  }
}

/** True iff the string starts with the `qtap://` scheme (cheap, case-insensitive guard). */
export function isQtapUri(s: unknown): s is string {
  return typeof s === 'string' && s.toLowerCase().startsWith(QTAP_URI_SCHEME);
}

/**
 * Decode a single percent-encoded component, surfacing a malformed escape (e.g.
 * a stray `%` or `%zz`) as a `QtapUriError` rather than a bare `URIError`.
 */
function safeDecode(component: string): string {
  try {
    return decodeURIComponent(component);
  } catch {
    throw new QtapUriError(
      `Malformed percent-encoding in qtap:// URI segment: "${component}"`,
      'MALFORMED'
    );
  }
}

/**
 * Decode the optional `#fragment` into `{ heading, level }`. The fragment is
 * `encoded-heading [ ":" level ]`; because canonical form encodes any heading
 * colon as `%3A`, an *unencoded* `:` in the fragment is always the level
 * separator. We therefore split on the last literal `:` BEFORE decoding.
 */
function parseFragment(fragment: string): { heading?: string; level?: number } {
  if (fragment === '') return {};
  const colonIdx = fragment.lastIndexOf(':');
  if (colonIdx === -1) {
    return { heading: safeDecode(fragment) };
  }
  const headingPart = fragment.slice(0, colonIdx);
  const levelPart = fragment.slice(colonIdx + 1);
  if (!/^[0-9]+$/.test(levelPart)) {
    throw new QtapUriError(
      `Invalid heading level "${levelPart}" in qtap:// fragment; expected an integer 1–6.`,
      'BAD_LEVEL'
    );
  }
  const level = parseInt(levelPart, 10);
  if (level < 1 || level > 6) {
    throw new QtapUriError(
      `Heading level ${level} out of range in qtap:// fragment; expected 1–6.`,
      'BAD_LEVEL'
    );
  }
  return { heading: safeDecode(headingPart), level };
}

/** Decode the optional `?query` into a flat key→value map. */
function parseQuery(query: string): Record<string, string> | undefined {
  if (query === '') return undefined;
  const out: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    if (eq === -1) {
      out[safeDecode(pair)] = '';
    } else {
      out[safeDecode(pair.slice(0, eq))] = safeDecode(pair.slice(eq + 1));
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Parse a `qtap://` URI into its parts. Throws `QtapUriError` on malformed
 * input. Does NOT touch the database or resolve anything — pure string work.
 */
export function parseQtapUri(uri: string): QtapUriParts {
  if (!isQtapUri(uri)) {
    throw new QtapUriError(
      `Not a qtap:// URI: ${typeof uri === 'string' ? `"${uri}"` : typeof uri}`,
      'NOT_A_QTAP_URI'
    );
  }

  // Parse order (per spec): strip scheme → split query → split fragment →
  // split authority/path. The scheme is a fixed 7-char prefix; slice by length
  // so a mixed-case scheme (`QTAP://`) is handled uniformly.
  let rest = uri.slice(QTAP_URI_SCHEME.length);

  // Split off the query (`?…`). Per the grammar the query trails the fragment.
  let query: Record<string, string> | undefined;
  const qIdx = rest.indexOf('?');
  if (qIdx !== -1) {
    query = parseQuery(rest.slice(qIdx + 1));
    rest = rest.slice(0, qIdx);
  }

  // Split off the fragment (`#…`).
  let heading: string | undefined;
  let level: number | undefined;
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) {
    const frag = parseFragment(rest.slice(hashIdx + 1));
    heading = frag.heading;
    level = frag.level;
    rest = rest.slice(0, hashIdx);
  }

  // Split authority from path on the FIRST `/`. Everything after it is the path.
  const slashIdx = rest.indexOf('/');
  const rawAuthority = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  const rawPath = slashIdx === -1 ? '' : rest.slice(slashIdx + 1);

  const authority = safeDecode(rawAuthority);
  if (authority === '') {
    throw new QtapUriError('qtap:// URI has an empty authority.', 'EMPTY_AUTHORITY');
  }

  // Decode each path segment independently; never re-split or normalize.
  const path =
    rawPath === ''
      ? ''
      : rawPath
          .split('/')
          .map((seg) => safeDecode(seg))
          .join('/');

  const lower = authority.toLowerCase();
  let scope: DocEditScope;
  let mountPoint: string | undefined;
  if (lower === SELF_VAULT_TOKEN) {
    scope = 'document_store';
    mountPoint = SELF_VAULT_TOKEN;
  } else if (lower === 'project') {
    scope = 'project';
  } else if (lower === 'general') {
    scope = 'general';
  } else {
    scope = 'document_store';
    mountPoint = authority;
  }

  const parts: QtapUriParts = { scope, path };
  if (mountPoint !== undefined) parts.mountPoint = mountPoint;
  if (heading !== undefined) parts.heading = heading;
  if (level !== undefined) parts.level = level;
  if (query !== undefined) parts.query = query;
  return parts;
}

/** Encode the authority for a parsed parts object. */
function encodeAuthority(parts: QtapUriParts): string {
  if (parts.scope === 'project') return 'project';
  if (parts.scope === 'general') return 'general';
  // document_store
  const mp = parts.mountPoint ?? '';
  if (mp.toLowerCase() === SELF_VAULT_TOKEN) return 'self';
  return encodeURIComponent(mp);
}

/** Encode a relative path: split on `/`, percent-encode each segment, rejoin. */
function encodePath(path: string): string {
  if (path === '') return '';
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/**
 * Inverse of `parseQtapUri`. Always emits the canonical encoded form (authority
 * and each path segment percent-encoded; `:` as `%3A`).
 */
export function formatQtapUri(parts: QtapUriParts): string {
  const authority = encodeAuthority(parts);
  let out = `${QTAP_URI_SCHEME}${authority}/${encodePath(parts.path ?? '')}`;
  if (parts.heading !== undefined && parts.heading !== '') {
    out += `#${encodeURIComponent(parts.heading)}`;
    if (parts.level !== undefined) out += `:${parts.level}`;
  }
  if (parts.query && Object.keys(parts.query).length > 0) {
    const q = Object.entries(parts.query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    out += `?${q}`;
  }
  return out;
}

/**
 * Convenience: build the `{ scope, mount_point, path }` triple the path
 * resolver expects from a parsed URI. (`mount_point` omitted for
 * project/general scopes.)
 */
export function qtapUriToResolverInput(parts: QtapUriParts): {
  scope: DocEditScope;
  mount_point?: string;
  path: string;
} {
  const out: { scope: DocEditScope; mount_point?: string; path: string } = {
    scope: parts.scope,
    path: parts.path,
  };
  if (parts.mountPoint !== undefined) out.mount_point = parts.mountPoint;
  return out;
}

// ---------------------------------------------------------------------------
// Producer-side helpers — so every emitter makes the name-vs-ID decision the
// same way. A producer holds a resolved document (name, id, scope, path) and
// wants a human-facing URI back.
// ---------------------------------------------------------------------------

/**
 * Pick the addressable reference for a document store: its **name** when that
 * reads unambiguously, else its **UUID**. The UUID wins when the caller says
 * the name is ambiguous (`nameIsAmbiguous: true` — two enabled stores share it)
 * OR when the name collides with a reserved authority (`self`/`project`/
 * `general`), since a store so named is only reachable by UUID.
 *
 * Every producer of a store reference goes through this — `qtap://` URIs via
 * {@link formatDocStoreUri}, and the global search bar's document results via
 * `buildDocStoreRefResolver` — so a name that's safe in one is safe in both.
 * Both forms are accepted by the path resolver.
 */
export function docStoreAuthority(args: {
  mountPointName: string;
  mountPointId: string;
  nameIsAmbiguous?: boolean;
}): string {
  const nameCollidesWithReserved = RESERVED_AUTHORITIES.has(
    args.mountPointName.trim().toLowerCase()
  );
  const useId = args.nameIsAmbiguous === true || nameCollidesWithReserved;
  return useId ? args.mountPointId : args.mountPointName;
}

/**
 * Build a human-facing `qtap://` URI for a `document_store` document. The
 * authority is chosen by {@link docStoreAuthority}: the store name, or its
 * UUID when the name is ambiguous or reserved.
 */
export function formatDocStoreUri(args: {
  mountPointName: string;
  mountPointId: string;
  path: string;
  nameIsAmbiguous?: boolean;
  heading?: string;
  level?: number;
}): string {
  return formatQtapUri({
    scope: 'document_store',
    mountPoint: docStoreAuthority(args),
    path: args.path,
    heading: args.heading,
    level: args.level,
  });
}

/** Build a `qtap://` URI for project/general scope (no authority store). */
export function formatScopedUri(
  scope: 'project' | 'general',
  path: string,
  opts?: { heading?: string; level?: number }
): string {
  return formatQtapUri({
    scope,
    path,
    heading: opts?.heading,
    level: opts?.level,
  });
}

/** Build the canonical self-vault URI: `qtap://self/<path>`. */
export function formatSelfUri(
  path: string,
  opts?: { heading?: string; level?: number }
): string {
  return formatQtapUri({
    scope: 'document_store',
    mountPoint: SELF_VAULT_TOKEN,
    path,
    heading: opts?.heading,
    level: opts?.level,
  });
}
