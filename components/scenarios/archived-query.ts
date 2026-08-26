/**
 * The one place the `includeArchived` query parameter is spelled on the client.
 *
 * Both scenario hooks (`useProjectScenarios`, `useGeneralScenarios`) route every
 * list-returning request through this so the param can't drift from the server's
 * reader in `lib/api/query-params.ts`.
 *
 * @module components/scenarios/archived-query
 */

export function withArchivedParam(url: string, showArchived: boolean): string {
  if (!showArchived) return url
  return `${url}${url.includes('?') ? '&' : '?'}includeArchived=true`
}
