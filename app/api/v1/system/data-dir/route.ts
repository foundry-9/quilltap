/**
 * System Data Directory API v1
 *
 * GET /api/v1/system/data-dir - Returns data directory information
 * POST /api/v1/system/data-dir?action=open - Opens the data directory in the system file browser
 */

import { NextRequest } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { withCollectionActionDispatch } from '@/lib/api/middleware/actions';
import { successResponse, errorResponse } from '@/lib/api/responses';
import {
  getBaseDataDirWithSource,
  getElectronShellVersion,
  getHostDataDir,
  getPlatform,
  getShellCapabilities,
  isDockerEnvironment,
  isElectronShell,
  Platform,
} from '@/lib/paths';
import { logger } from '@/lib/logger';

const execFileAsync = promisify(execFile);

/**
 * Response shape for data directory info
 */
interface DataDirInfo {
  /** The base data directory path */
  path: string;
  /** Where the path came from */
  source: 'environment' | 'platform-default';
  /** Human-readable description of the source */
  sourceDescription: string;
  /** Current platform */
  platform: Platform;
  /** Whether running in Docker */
  isDocker: boolean;
  /** Whether the server was spawned by the Quilltap Electron shell */
  isElectronShell: boolean;
  /** quilltap-shell version string, if running under Electron */
  shellVersion: string | null;
  /** Capability flags advertised by the shell */
  shellCapabilities: string[];
  /** Whether the "open" action is supported */
  canOpen: boolean;
  /** Host-side data directory path (for display in footer) */
  hostPath: string;
}

/**
 * GET /api/v1/system/data-dir
 * Returns information about the data directory location
 */
export const GET = createContextHandler(async () => {
  const dirInfo = getBaseDataDirWithSource();
  const platform = getPlatform();
  const isDocker = isDockerEnvironment();

  const hostPath = getHostDataDir();

  const response: DataDirInfo = {
    path: dirInfo.path,
    source: dirInfo.source,
    sourceDescription: dirInfo.sourceDescription,
    platform,
    isDocker,
    isElectronShell: isElectronShell(),
    shellVersion: getElectronShellVersion(),
    shellCapabilities: [...getShellCapabilities()],
    canOpen: !isDocker,
    hostPath,
  };

  return successResponse(response);
});

/**
 * Handle POST ?action=open
 * Opens the data directory in the system file browser
 */
async function handleOpen(
  _request: NextRequest,
  _context: RequestContext,
  _params: Record<string, never>,
): Promise<ReturnType<typeof successResponse>> {
  const isDocker = isDockerEnvironment();
  if (isDocker) {
    return errorResponse(
      'Cannot open file browser in Docker environment. Access the data directory through your host system or container volume mounts.',
      400
    );
  }

  const dirInfo = getBaseDataDirWithSource();
  const platform = getPlatform();
  const dirPath = dirInfo.path;

  try {
    switch (platform) {
      case 'darwin':
        await execFileAsync('open', [dirPath]);
        break;

      case 'win32':
        await execFileAsync('explorer', [dirPath]);
        break;

      case 'linux':
      default:
        await openLinuxFileBrowser(dirPath);
        break;
    }

    logger.info('Opened data directory in file browser', { platform, path: dirPath });

    return successResponse({
      message: 'Data directory opened in file browser',
      path: dirPath,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to open data directory', { error: errorMessage, platform, path: dirPath });

    return errorResponse(
      `Failed to open file browser: ${errorMessage}`,
      500
    );
  }
}

/**
 * POST /api/v1/system/data-dir?action=open
 * Dispatches to action handlers
 */
export const POST = createContextHandler(
  withCollectionActionDispatch({
    open: handleOpen,
  })
);

/**
 * Try to open a file browser on Linux using common file manager commands.
 * Uses execFile with sequential fallbacks (no shell chaining).
 */
async function openLinuxFileBrowser(dirPath: string): Promise<void> {
  const commands = ['xdg-open', 'nautilus', 'dolphin', 'thunar'];

  for (const cmd of commands) {
    try {
      await execFileAsync(cmd, [dirPath]);
      return;
    } catch {
      // File manager not available, trying next
    }
  }

  throw new Error('No supported file manager found. Tried: ' + commands.join(', '));
}
