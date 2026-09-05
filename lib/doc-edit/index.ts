/**
 * Document Editing Module
 *
 * Foundation layer for Scriptorium Phase 3.3 editing tools.
 * Provides path resolution, diacritics normalization, markdown parsing,
 * and single-file re-indexing.
 *
 * @module doc-edit
 */

export {
  normalizeDiacritics,
  findAllMatches,
  findUniqueMatch,
  type DiacriticsMatchOptions,
  type MatchTier,
  type UniqueMatchResult,
} from './diacritics';

export {
  TYPOGRAPHIC_FOLDINGS,
  foldTypographicChar,
  foldTypography,
  hasTypographicVariants,
} from './typographic-folding';

export {
  resolveDocEditPath,
  readFileWithMtime,
  writeFileWithMtimeCheck,
  getAccessibleMountPoints,
  isTextFile,
  resolveSelfVaultMountPointId,
  resolveMountPointRef,
  SELF_VAULT_TOKEN,
  PathResolutionError,
  type DocEditScope,
  type PathResolutionContext,
  type ResolvedPath,
} from './path-resolver';

export {
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatterInContent,
  slugifyHeading,
  parseHeadingTree,
  findHeadingSection,
  readHeadingContent,
  replaceHeadingContent,
  type ParsedFrontmatter,
  type HeadingInfo,
} from './markdown-parser';

export {
  coercePolicyBool,
  policyFromFrontmatterData,
  policyFromContent,
  DEFAULT_DOCUMENT_POLICY,
  type DocumentPolicy,
} from './document-policy';

export {
  generateUnifiedDiff,
  formatAutosaveNotification,
} from './unified-diff';

export {
  QTAP_URI_SCHEME,
  isQtapUri,
  parseQtapUri,
  formatQtapUri,
  qtapUriToResolverInput,
  formatDocStoreUri,
  formatScopedUri,
  formatSelfUri,
  QtapUriError,
  type QtapUriParts,
  type QtapUriErrorCode,
} from './qtap-uri';

export {
  reindexSingleFile,
} from './reindex-file';
