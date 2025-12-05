/**
 * File System Test Endpoint
 * GET /api/files/test - Verify new file system is working
 */

import { NextResponse } from 'next/server';
import { getRepositories } from '@/lib/repositories/factory';
import { isS3Enabled } from '@/lib/s3/config';
import type { FileEntry, FileCategory, FileSource } from '@/lib/json-store/schemas/types';

/**
 * Get the filepath for a file based on storage type
 */
function getFilePath(file: FileEntry): string {
  if (file.s3Key) {
    return `/api/files/${file.id}`;
  }
  const ext = file.originalFilename.includes('.')
    ? file.originalFilename.substring(file.originalFilename.lastIndexOf('.'))
    : '';
  return `data/files/storage/${file.id}${ext}`;
}

export async function GET() {
  try {
    const repos = getRepositories();
    const files = await repos.files.findAll();

    // Calculate stats
    const stats = {
      totalFiles: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
      byCategory: {} as Record<FileCategory, number>,
      bySource: {} as Record<FileSource, number>,
      s3Enabled: isS3Enabled(),
      withS3Key: files.filter(f => f.s3Key).length,
      withoutS3Key: files.filter(f => !f.s3Key).length,
    };

    // Initialize category counts
    const categories: FileCategory[] = ['IMAGE', 'DOCUMENT', 'AVATAR', 'ATTACHMENT', 'EXPORT'];
    for (const cat of categories) {
      stats.byCategory[cat] = 0;
    }

    // Initialize source counts
    const sources: FileSource[] = ['UPLOADED', 'GENERATED', 'IMPORTED', 'SYSTEM'];
    for (const src of sources) {
      stats.bySource[src] = 0;
    }

    // Count files
    for (const f of files) {
      if (f.category in stats.byCategory) {
        stats.byCategory[f.category]++;
      }
      if (f.source in stats.bySource) {
        stats.bySource[f.source]++;
      }
    }

    return NextResponse.json({
      status: 'OK',
      message: 'File system is working (repository pattern)',
      stats,
      sampleFiles: files.slice(0, 5).map(f => ({
        id: f.id,
        filename: f.originalFilename,
        url: getFilePath(f),
        category: f.category,
        source: f.source,
        hasS3Key: !!f.s3Key,
      })),
    });
  } catch (error) {
    return NextResponse.json({
      status: 'ERROR',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
