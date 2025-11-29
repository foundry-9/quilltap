#!/usr/bin/env tsx

/**
 * File Cleanup Utility
 *
 * Removes old file storage after successful migration to the new system.
 *
 * This script:
 * - Backs up old files to a timestamped directory
 * - Removes public/uploads/ directory
 * - Removes data/binaries/ directory
 * - Preserves backups for safety
 *
 * Usage:
 *   npm run cleanup-old-files [--skip-backup]
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const SKIP_BACKUP = process.argv.includes('--skip-backup');

const OLD_UPLOADS_DIR = 'public/uploads';
const OLD_BINARIES_DIR = 'data/binaries';
const BACKUP_DIR = `backups/pre-migration-${Date.now()}`;

interface CleanupStats {
  uploadsSize: number;
  binariesSize: number;
  backupCreated: boolean;
  uploadsRemoved: boolean;
  binariesRemoved: boolean;
}

const stats: CleanupStats = {
  uploadsSize: 0,
  binariesSize: 0,
  backupCreated: false,
  uploadsRemoved: false,
  binariesRemoved: false,
};

/**
 * Get directory size in bytes
 */
async function getDirectorySize(dir: string): Promise<number> {
  try {
    const { stdout } = await execAsync(`du -sk "${dir}"`);
    const sizeInKB = parseInt(stdout.split('\t')[0]);
    return sizeInKB * 1024;
  } catch {
    return 0;
  }
}

/**
 * Format bytes as human-readable
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Check if directory exists
 */
async function directoryExists(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Create backup of old files
 */
async function createBackup(): Promise<void> {
  console.log('\n📦 Creating backup...');

  await fs.mkdir(BACKUP_DIR, { recursive: true });

  // Backup uploads directory if it exists
  if (await directoryExists(OLD_UPLOADS_DIR)) {
    console.log(`  Copying ${OLD_UPLOADS_DIR} to ${BACKUP_DIR}/uploads/`);
    await execAsync(`cp -R "${OLD_UPLOADS_DIR}" "${BACKUP_DIR}/uploads"`);
  }

  // Backup binaries directory if it exists
  if (await directoryExists(OLD_BINARIES_DIR)) {
    console.log(`  Copying ${OLD_BINARIES_DIR} to ${BACKUP_DIR}/binaries/`);
    await execAsync(`cp -R "${OLD_BINARIES_DIR}" "${BACKUP_DIR}/binaries"`);
  }

  stats.backupCreated = true;
  console.log(`✓ Backup created in ${BACKUP_DIR}`);
}

/**
 * Verify new system is working
 */
async function verifyNewSystem(): Promise<boolean> {
  console.log('\n🔍 Verifying new file system...');

  // Check if new directories exist
  const newFilesDir = 'data/files';
  const newStorageDir = 'data/files/storage';
  const newIndexFile = 'data/files/files.jsonl';

  try {
    // Check directories
    if (!(await directoryExists(newFilesDir))) {
      console.error('  ✗ data/files/ directory not found');
      return false;
    }

    if (!(await directoryExists(newStorageDir))) {
      console.error('  ✗ data/files/storage/ directory not found');
      return false;
    }

    // Check index file
    await fs.access(newIndexFile);

    // Count files in new system
    const files = await fs.readdir(newStorageDir);
    console.log(`  ✓ Found ${files.length} files in new storage`);

    // Read index and count entries
    const indexContent = await fs.readFile(newIndexFile, 'utf-8');
    const entries = indexContent.trim().split('\n').filter(l => l.length > 0);
    console.log(`  ✓ Found ${entries.length} entries in new index`);

    if (entries.length === 0) {
      console.warn('  ⚠️  Warning: New index file is empty');
      console.warn('  ⚠️  This might indicate migration hasn\'t been run yet');
      return false;
    }

    return true;
  } catch (error) {
    console.error('  ✗ New file system not found or incomplete');
    console.error('  Error:', error);
    return false;
  }
}

/**
 * Remove old directories
 */
async function removeOldDirectories(): Promise<void> {
  console.log('\n🗑️  Removing old directories...');

  // Remove uploads directory
  if (await directoryExists(OLD_UPLOADS_DIR)) {
    console.log(`  Removing ${OLD_UPLOADS_DIR}/`);
    await fs.rm(OLD_UPLOADS_DIR, { recursive: true, force: true });
    stats.uploadsRemoved = true;
    console.log('  ✓ Removed public/uploads/');
  } else {
    console.log('  ℹ️  public/uploads/ does not exist');
  }

  // Remove binaries directory
  if (await directoryExists(OLD_BINARIES_DIR)) {
    console.log(`  Removing ${OLD_BINARIES_DIR}/`);
    await fs.rm(OLD_BINARIES_DIR, { recursive: true, force: true });
    stats.binariesRemoved = true;
    console.log('  ✓ Removed data/binaries/');
  } else {
    console.log('  ℹ️  data/binaries/ does not exist');
  }
}

/**
 * Main cleanup function
 */
async function cleanup() {
  console.log('='.repeat(80));
  console.log('File Cleanup Utility');
  console.log('='.repeat(80));
  console.log();

  // Get sizes of old directories
  console.log('Analyzing old file system...');
  if (await directoryExists(OLD_UPLOADS_DIR)) {
    stats.uploadsSize = await getDirectorySize(OLD_UPLOADS_DIR);
    console.log(`  public/uploads/: ${formatBytes(stats.uploadsSize)}`);
  } else {
    console.log(`  public/uploads/: Not found`);
  }

  if (await directoryExists(OLD_BINARIES_DIR)) {
    stats.binariesSize = await getDirectorySize(OLD_BINARIES_DIR);
    console.log(`  data/binaries/: ${formatBytes(stats.binariesSize)}`);
  } else {
    console.log(`  data/binaries/: Not found`);
  }

  const totalSize = stats.uploadsSize + stats.binariesSize;
  console.log(`  Total: ${formatBytes(totalSize)}`);

  // Verify new system is in place
  const newSystemValid = await verifyNewSystem();

  if (!newSystemValid) {
    console.error('\n❌ ERROR: New file system not found or incomplete!');
    console.error('Please run the migration first:');
    console.error('  npm run migrate-files');
    process.exit(1);
  }

  // Create backup unless skipped
  if (!SKIP_BACKUP) {
    await createBackup();
  } else {
    console.log('\n⚠️  Skipping backup (--skip-backup flag provided)');
  }

  // Confirm before deletion
  if (!SKIP_BACKUP && !process.argv.includes('--yes')) {
    console.log('\n⚠️  WARNING: This will permanently delete old files!');
    console.log('A backup has been created, but please verify your new system is working.');
    console.log('\nTo proceed with cleanup, run:');
    console.log('  npm run cleanup-old-files -- --yes');
    process.exit(0);
  }

  // Remove old directories
  await removeOldDirectories();

  // Print summary
  console.log();
  console.log('='.repeat(80));
  console.log('Cleanup Summary');
  console.log('='.repeat(80));
  console.log(`Old uploads size:    ${formatBytes(stats.uploadsSize)}`);
  console.log(`Old binaries size:   ${formatBytes(stats.binariesSize)}`);
  console.log(`Total freed:         ${formatBytes(totalSize)}`);
  console.log();
  console.log(`Backup created:      ${stats.backupCreated ? '✓ Yes' : '✗ No'}`);
  if (stats.backupCreated) {
    console.log(`Backup location:     ${BACKUP_DIR}`);
  }
  console.log(`Uploads removed:     ${stats.uploadsRemoved ? '✓ Yes' : 'N/A'}`);
  console.log(`Binaries removed:    ${stats.binariesRemoved ? '✓ Yes' : 'N/A'}`);
  console.log('='.repeat(80));

  if (stats.uploadsRemoved || stats.binariesRemoved) {
    console.log('\n✅ Cleanup complete!');
    console.log('\nYou can safely delete the backup after verifying everything works:');
    console.log(`  rm -rf ${BACKUP_DIR}`);
  } else {
    console.log('\n✅ No cleanup needed - old directories not found');
  }
}

// Run cleanup
cleanup().catch(error => {
  console.error('Fatal error during cleanup:', error);
  process.exit(1);
});
