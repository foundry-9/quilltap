/**
 * Unit tests for environment variable validation
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('Environment Validation', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set up minimum required environment variables
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
    process.env.NEXTAUTH_SECRET = 'test-secret-key-minimum-32-characters-long';
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.ENCRYPTION_MASTER_PEPPER = 'test-pepper-key-minimum-32-characters';
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Clear module cache to reset env validation
    jest.resetModules();
  });

  it('should validate with all required variables', async () => {
    const { validateEnv } = await import('@/lib/env');

    expect(() => validateEnv()).not.toThrow();
  });

  it('should succeed without DATABASE_URL (JSON store is default)', async () => {
    delete process.env.DATABASE_URL;

    // We need to re-import after changing env
    jest.resetModules();

    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('should fail with short NEXTAUTH_SECRET', async () => {
    process.env.NEXTAUTH_SECRET = 'short';

    jest.resetModules();

    await expect(async () => {
      const { validateEnv } = await import('@/lib/env');
      validateEnv();
    }).rejects.toThrow();
  });

  it('should fail with short ENCRYPTION_MASTER_PEPPER', async () => {
    process.env.ENCRYPTION_MASTER_PEPPER = 'short';

    jest.resetModules();

    await expect(async () => {
      const { validateEnv } = await import('@/lib/env');
      validateEnv();
    }).rejects.toThrow();
  });

  it('should accept valid NODE_ENV values', async () => {
    const validEnvs = ['development', 'production', 'test'];

    for (const env of validEnvs) {
      process.env.NODE_ENV = env;
      jest.resetModules();

      const { validateEnv } = await import('@/lib/env');
      expect(() => validateEnv()).not.toThrow();
    }
  });

  it('should accept optional rate limit configuration', async () => {
    process.env.RATE_LIMIT_API_MAX = '100';
    process.env.RATE_LIMIT_API_WINDOW = '60';

    jest.resetModules();

    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('should accept optional log level', async () => {
    process.env.LOG_LEVEL = 'debug';

    jest.resetModules();

    const { validateEnv } = await import('@/lib/env');
    const env = validateEnv();

    expect(env.LOG_LEVEL).toBe('debug');
  });

  it('should default log level to info', async () => {
    delete process.env.LOG_LEVEL;

    jest.resetModules();

    const { validateEnv } = await import('@/lib/env');
    const env = validateEnv();

    expect(env.LOG_LEVEL).toBe('info');
  });
});
