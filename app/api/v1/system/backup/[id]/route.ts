/**
 * System Backup API v1 - Individual Backup Endpoint
 *
 * GET /api/v1/system/backup/[id] - Download a temporary backup
 *
 * Streams the backup ZIP from disk rather than holding it in memory.
 */

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { createContextParamsHandler } from '@/lib/api/middleware';
import { retrieveTemporaryBackup } from '@/lib/backup/temporary-storage';
import { logger } from '@/lib/logger';
import { notFound, serverError } from '@/lib/api/responses';

/**
 * GET /api/v1/system/backup/[id] - Download a backup
 */
export const GET = createContextParamsHandler<{ id: string }>(
  async (req, { user }, { id }) => {
    try {
      // Look up temporary backup (also removes it from storage)
      const backupData = retrieveTemporaryBackup(id);

      if (!backupData) {
        logger.warn('[System Backup v1] Temporary backup not found', {
          backupId: id,
        });
        return notFound('Backup not found or has expired');
      }

      const { zipPath } = backupData;

      // Verify the zip file still exists on disk
      try {
        await fs.promises.access(zipPath);
      } catch {
        logger.error('[System Backup v1] Backup zip file missing from disk', {
          backupId: id,
          zipPath,
        });
        return notFound('Backup file not found on disk');
      }

      // Get file size for Content-Length header
      const stat = await fs.promises.stat(zipPath);
      const filename = `quilltap-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

      logger.info('[System Backup v1] Streaming backup download from disk', {
        backupId: id,
        userId: user.id,
        zipPath,
        size: stat.size,
      });

      // Create a Node.js ReadStream and convert to Web ReadableStream
      const nodeStream = fs.createReadStream(zipPath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;

      // Schedule cleanup of the temp zip file after the stream is consumed
      nodeStream.on('close', () => {
        fs.unlink(zipPath, (err) => {
          if (err) {
            logger.warn('[System Backup v1] Failed to clean up backup zip after download', {
              zipPath,
              error: err.message,
            });
          }
          // Also try to remove the parent temp directory
          const tempDir = path.dirname(zipPath);
          fs.rm(tempDir, { recursive: true, force: true }, () => {
            // Best-effort cleanup, ignore errors
          });
        });
      });

      return new NextResponse(webStream, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': stat.size.toString(),
        },
      });
    } catch (error) {
      logger.error('[System Backup v1] Error downloading backup', {}, error instanceof Error ? error : undefined);
      return serverError('Failed to download backup');
    }
  }
);
