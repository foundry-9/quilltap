'use client'

/**
 * BrahmaConsoleView — the Brahma Console as a workspace tab (singleton).
 *
 * Reuses the dialog body via {@link BrahmaConsoleDialog}'s `asTab` mode, so the
 * console logic lives in one place and the floating-dialog path is unchanged.
 *
 * @module components/brahma-console/BrahmaConsoleView
 */

import { BrahmaConsoleDialog } from './BrahmaConsoleDialog'

export function BrahmaConsoleView() {
  return <BrahmaConsoleDialog asTab />
}
