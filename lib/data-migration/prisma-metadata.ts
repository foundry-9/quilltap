/**
 * Prisma Metadata Dump Utility - DEPRECATED
 *
 * This file is retained for historical reference only.
 * It was used during Phase 1-3 of the JSON store migration to generate
 * metadata about the old Prisma schema.
 *
 * The application now uses the JSON store exclusively.
 * See docs/MIGRATION.md for details about the migration.
 */

// Stub implementations for backwards compatibility
interface ModelInfo {
  name: string;
  fields: any[];
  recordCount?: number;
}

interface PrismaMetadata {
  version: string;
  timestamp: string;
  models: ModelInfo[];
  summary: {
    totalModels: number;
    totalRecords: number;
    estimatedSize: string;
  };
}

/**
 * DEPRECATED: This function is no longer used
 * The application now uses JSON file storage exclusively
 */
export async function generatePrismaMetadata(): Promise<PrismaMetadata> {
  console.warn(
    'WARNING: generatePrismaMetadata is deprecated. The application now uses JSON store exclusively.'
  );
  return {
    version: '0.7.0',
    timestamp: new Date().toISOString(),
    models: [],
    summary: {
      totalModels: 0,
      totalRecords: 0,
      estimatedSize: '0 KB',
    },
  };
}

/**
 * DEPRECATED: This function is no longer used
 * Use JSON store repositories instead
 */
export async function savePrismaMetadata(
  _metadata: PrismaMetadata,
  _outputDir = './data/cache'
): Promise<string> {
  console.warn('WARNING: savePrismaMetadata is deprecated. The application now uses JSON store exclusively.');
  return '';
}
