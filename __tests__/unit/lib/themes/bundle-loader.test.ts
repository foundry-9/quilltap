/**
 * Theme Bundle Loader Tests
 *
 * Tests for .qtap-theme bundle validation, installation, and loading.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

// Create a unique temp dir for each test run
const mockThemesDir = path.join(os.tmpdir(), 'qtap-test-themes-' + Date.now());

jest.mock('@/lib/paths', () => ({
  getThemesDir: () => mockThemesDir,
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Import after mocks are set up
import {
  validateThemeBundle,
  installThemeBundle,
  uninstallThemeBundle,
  loadInstalledBundles,
} from '@/lib/themes/bundle-loader';
import { safeValidateQtapThemeManifest } from '@/lib/themes/types';

// Sample theme manifest
const VALID_MANIFEST = {
  format: 'qtap-theme' as const,
  formatVersion: 1 as const,
  id: 'test-theme',
  name: 'Test Theme',
  description: 'A test theme',
  version: '1.0.0',
  author: 'Test Author',
  supportsDarkMode: true,
  tags: ['test'],
  tokens: {
    colors: {
      light: {
        background: '#ffffff',
        foreground: '#000000',
        primary: '#3b82f6',
        primaryForeground: '#ffffff',
        secondary: '#f1f5f9',
        secondaryForeground: '#0f172a',
        muted: '#f1f5f9',
        mutedForeground: '#64748b',
        accent: '#f1f5f9',
        accentForeground: '#0f172a',
        destructive: '#ef4444',
        destructiveForeground: '#ffffff',
        card: '#ffffff',
        cardForeground: '#000000',
        popover: '#ffffff',
        popoverForeground: '#000000',
        border: '#e2e8f0',
        input: '#e2e8f0',
        ring: '#3b82f6',
      },
      dark: {
        background: '#0f172a',
        foreground: '#f8fafc',
        primary: '#3b82f6',
        primaryForeground: '#ffffff',
        secondary: '#1e293b',
        secondaryForeground: '#f8fafc',
        muted: '#1e293b',
        mutedForeground: '#94a3b8',
        accent: '#1e293b',
        accentForeground: '#f8fafc',
        destructive: '#ef4444',
        destructiveForeground: '#ffffff',
        card: '#0f172a',
        cardForeground: '#f8fafc',
        popover: '#0f172a',
        popoverForeground: '#f8fafc',
        border: '#1e293b',
        input: '#1e293b',
        ring: '#3b82f6',
      },
    },
  },
};

async function createTestBundle(
  dir: string,
  manifest: Record<string, unknown> = VALID_MANIFEST,
  extraFiles?: Record<string, string>
): Promise<string> {
  const bundleDir = path.join(dir, 'bundle-source');
  await fs.mkdir(bundleDir, { recursive: true });

  // Write manifest
  await fs.writeFile(
    path.join(bundleDir, 'theme.json'),
    JSON.stringify(manifest, null, 2)
  );

  // Write extra files
  if (extraFiles) {
    for (const [name, content] of Object.entries(extraFiles)) {
      const filePath = path.join(bundleDir, name);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
    }
  }

  // Create zip
  const zipPath = path.join(dir, 'test.qtap-theme');
  execSync(`cd "${bundleDir}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });

  return zipPath;
}

describe('Theme Bundle Loader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-bundle-test-'));
    // Clean and recreate the mock themes dir for each test
    await fs.rm(mockThemesDir, { recursive: true, force: true });
    await fs.mkdir(mockThemesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(mockThemesDir, { recursive: true, force: true });
  });

  describe('validateThemeBundle', () => {
    test('validates a valid bundle', async () => {
      const zipPath = await createTestBundle(tempDir);

      const result = await validateThemeBundle(zipPath);
      expect(result.valid).toBe(true);
      expect(result.manifest).toBeDefined();
      expect(result.manifest?.id).toBe('test-theme');
      expect(result.errors).toHaveLength(0);
    });

    test('rejects bundle without theme.json', async () => {
      const bundleDir = path.join(tempDir, 'no-manifest');
      await fs.mkdir(bundleDir, { recursive: true });
      await fs.writeFile(path.join(bundleDir, 'styles.css'), 'body {}');

      const zipPath = path.join(tempDir, 'bad.qtap-theme');
      execSync(`cd "${bundleDir}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });

      const result = await validateThemeBundle(zipPath);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('theme.json'))).toBe(true);
    });

    test('rejects bundle with blocked file types', async () => {
      const zipPath = await createTestBundle(tempDir, VALID_MANIFEST, {
        'malicious.js': 'alert("xss")',
      });

      const result = await validateThemeBundle(zipPath);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('.js'))).toBe(true);
    });

    test('rejects invalid manifest', async () => {
      const invalidManifest = { ...VALID_MANIFEST, format: 'wrong' };
      const zipPath = await createTestBundle(tempDir, invalidManifest);

      const result = await validateThemeBundle(zipPath);
      expect(result.valid).toBe(false);
    });

    test('rejects non-zip file', async () => {
      const fakePath = path.join(tempDir, 'not-a-zip.qtap-theme');
      await fs.writeFile(fakePath, 'this is not a zip file');

      const result = await validateThemeBundle(fakePath);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid zip'))).toBe(true);
    });
  });

  describe('installThemeBundle', () => {
    test('installs a valid bundle', async () => {
      const zipPath = await createTestBundle(tempDir);

      const result = await installThemeBundle(zipPath);
      expect(result.success).toBe(true);
      expect(result.themeId).toBe('test-theme');
      expect(result.version).toBe('1.0.0');

      // Verify files were extracted
      const themeJson = await fs.readFile(
        path.join(mockThemesDir, 'test-theme', 'theme.json'),
        'utf-8'
      );
      expect(JSON.parse(themeJson).id).toBe('test-theme');

      // Verify index was updated
      const indexData = await fs.readFile(
        path.join(mockThemesDir, 'themes-index.json'),
        'utf-8'
      );
      const index = JSON.parse(indexData);
      expect(index.themes).toHaveLength(1);
      expect(index.themes[0].id).toBe('test-theme');
    });
  });

  describe('uninstallThemeBundle', () => {
    test('uninstalls an installed bundle', async () => {
      const zipPath = await createTestBundle(tempDir);

      await installThemeBundle(zipPath);
      const result = await uninstallThemeBundle('test-theme');

      expect(result.success).toBe(true);

      // Verify directory was removed
      await expect(
        fs.access(path.join(mockThemesDir, 'test-theme'))
      ).rejects.toThrow();

      // Verify index was updated
      const indexData = await fs.readFile(
        path.join(mockThemesDir, 'themes-index.json'),
        'utf-8'
      );
      const index = JSON.parse(indexData);
      expect(index.themes).toHaveLength(0);
    });

    test('returns error for non-existent theme', async () => {
      const result = await uninstallThemeBundle('non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('loadInstalledBundles', () => {
    test('loads installed bundles', async () => {
      const zipPath = await createTestBundle(tempDir);

      await installThemeBundle(zipPath);
      const bundles = await loadInstalledBundles();

      expect(bundles).toHaveLength(1);
      expect(bundles[0].manifest.id).toBe('test-theme');
      expect(bundles[0].tokens).toBeDefined();
      expect(bundles[0].tokens.colors.light.primary).toBe('#3b82f6');
    });

    test('returns empty array when no themes installed', async () => {
      const bundles = await loadInstalledBundles();
      expect(bundles).toHaveLength(0);
    });
  });

  describe('Zod schema validation', () => {
    test('validates QtapThemeManifest schema', () => {
      const result = safeValidateQtapThemeManifest(VALID_MANIFEST);
      expect(result.success).toBe(true);
    });

    test('rejects manifest without tokens or tokensPath', () => {
      const noTokens = { ...VALID_MANIFEST };
      delete (noTokens as Record<string, unknown>).tokens;

      const result = safeValidateQtapThemeManifest(noTokens);
      expect(result.success).toBe(false);
    });

    test('accepts manifest with tokensPath instead of inline tokens', () => {
      const withPath = { ...VALID_MANIFEST, tokensPath: 'tokens.json' };
      delete (withPath as Record<string, unknown>).tokens;

      const result = safeValidateQtapThemeManifest(withPath);
      expect(result.success).toBe(true);
    });

    test('rejects invalid theme ID format', () => {
      const badId = { ...VALID_MANIFEST, id: 'Invalid ID!' };
      const result = safeValidateQtapThemeManifest(badId);
      expect(result.success).toBe(false);
    });
  });
});
