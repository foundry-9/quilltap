/**
 * The Almanack — `state.json` queries against the mount index.
 *
 * The state cascade's project, group and general tiers each live as a
 * root-level `state.json` in the tier's official store. Two phases ask the
 * same question of it — the Scriptorium tour counts stores carrying state,
 * the dramatis personae marks each project that does — so the predicate
 * lives here once. "Carrying state" means the document exists and its body
 * is neither blank nor the empty object.
 *
 * @module lib/tools/almanack/state-files
 */

import { inClause, mountRows } from './db';

/**
 * The ids, among `mountIds`, whose root `state.json` holds a non-empty object.
 *
 * `context` labels the warning logged if the query fails.
 */
export function statefulMountIds(
  mountIds: Iterable<string>,
  context = 'almanack.statefulMountIds',
): Set<string> {
  const { sql, params } = inClause(mountIds);
  const rows = mountRows<{ mountPointId: string }>(
    `SELECT DISTINCT l."mountPointId" AS mountPointId
     FROM "doc_mount_file_links" l
     JOIN "doc_mount_documents" d ON d."fileId" = l."fileId"
     WHERE l."mountPointId" IN ${sql}
       AND lower(l."relativePath") = 'state.json'
       AND trim(d."content") NOT IN ('', '{}')`,
    params,
    context,
  );
  return new Set(rows.map(r => r.mountPointId));
}

/** How many of `mountIds` carry a non-empty root `state.json` — the cascade's tiers. */
export function countStateFiles(
  mountIds: Iterable<string>,
  context = 'almanack.countStateFiles',
): number {
  return statefulMountIds(mountIds, context).size;
}
