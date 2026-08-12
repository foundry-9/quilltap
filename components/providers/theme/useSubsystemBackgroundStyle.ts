'use client';

import { useMemo } from 'react';
import type React from 'react';
import { useSubsystemInfo } from './useSubsystemInfo';
import type { SubsystemId } from '@/lib/foundry/subsystem-defaults';
import { useReportWorkspaceBackdrop } from '@/components/workspace/workspace-backdrop';

/**
 * Inline style object setting --story-background-url for a .qt-page-container,
 * resolved through the active theme's subsystem overrides.
 *
 * Returns undefined when the resolved image is empty (the theme set
 * backgroundImage: 'none'), so the page renders with no story background — the
 * .qt-page-container:not([style*="--story-background-url"])::before rule in
 * app/styles/qt-components/_content.css then hides the layer.
 *
 * This is the shared replacement for the hardcoded inline url(...) values the
 * content pages used to carry; it mirrors what app/settings/page.tsx already
 * does so any theme shipping subsystems.<id>.backgroundImage overrides the page.
 */
export function useSubsystemBackgroundStyle(
  id: SubsystemId,
): React.CSSProperties | undefined {
  const { backgroundImage } = useSubsystemInfo(id);
  // Inside the workspace, surrender this subsystem background to the single
  // arbitrated workspace backdrop (no-op on the legacy routes).
  useReportWorkspaceBackdrop(backgroundImage || null, false);
  return useMemo(() => {
    if (!backgroundImage) return undefined;
    return { '--story-background-url': `url(${backgroundImage})` } as React.CSSProperties;
  }, [backgroundImage]);
}
