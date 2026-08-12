/**
 * System Backup API v1 - Collection Endpoint
 *
 * POST /api/v1/system/backup - Create a new backup for download
 */

import { NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { createBackup } from '@/lib/backup/backup-service';
import { storeTemporaryBackup } from '@/lib/backup/temporary-storage';
import { logger } from '@/lib/logger';
import { randomUUID } from 'crypto';
import { serverError } from '@/lib/api/responses';

// Extend timeout for backup operations
export const maxDuration = 300; // 5 minutes

/**
 * POST /api/v1/system/backup - Create a new backup
 */
export const POST = createContextHandler(async (req, { user }) => {
  try {
    // `{ compact?: boolean }` — omit or send `false` for a full-fidelity
    // backup, which is the default. A body is optional; a malformed one is
    // treated as absent rather than rejected, matching how this route has
    // always behaved.
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const compact = (body as { compact?: unknown }).compact === true;

    logger.info('[System Backup v1] Creating backup', {
      userId: user.id,
      compact,
    });

    // Create the backup (returns path to zip on disk)
    const { zipPath, manifest } = await createBackup(user.id, { compact });

    // Store zip path temporarily for download
    const backupId = randomUUID();
    storeTemporaryBackup(backupId, zipPath, user.id);

    logger.info('[System Backup v1] Backup stored for download', {
      userId: user.id,
      backupId,
      zipPath,
      expiresInMinutes: 30,
      manifest,
    });

    return NextResponse.json(
      {
        success: true,
        backupId,
        manifest,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('[System Backup v1] Error creating backup', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create backup');
  }
});
