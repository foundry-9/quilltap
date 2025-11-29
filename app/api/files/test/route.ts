/**
 * File System Test Endpoint
 * GET /api/files/test - Verify new file system is working
 */

import { NextResponse } from 'next/server';
import { getAllFiles, getFileStats } from '@/lib/file-manager';

export async function GET() {
  try {
    const files = await getAllFiles();
    const stats = await getFileStats();

    return NextResponse.json({
      status: 'OK',
      message: 'New file system is working',
      stats,
      sampleFiles: files.slice(0, 5).map(f => ({
        id: f.id,
        filename: f.originalFilename,
        url: `/data/files/storage/${f.id}.${f.originalFilename.split('.').pop()}`,
        category: f.category,
        source: f.source,
      })),
    });
  } catch (error) {
    return NextResponse.json({
      status: 'ERROR',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
