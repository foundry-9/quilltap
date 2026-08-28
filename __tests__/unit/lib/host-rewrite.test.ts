/**
 * Tests for host URL rewriting utility
 *
 * @module __tests__/unit/lib/host-rewrite.test
 */

// Mock dependencies before imports
jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

// isDockerEnvironment() probes /.dockerenv and /app; stub both away so the
// "bare metal" cases are decided by env vars alone and not by the host running
// the suite.
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => false),
  statSync: jest.fn(() => {
    throw new Error('ENOENT');
  }),
}));

describe('lib/host-rewrite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.DOCKER_CONTAINER;
    delete process.env.QUILLTAP_HOST_IP;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('rewriteLocalhostUrl', () => {
    it('should return URL unchanged on bare metal (no container, no QUILLTAP_HOST_IP)', async () => {
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');
      expect(rewriteLocalhostUrl('http://localhost:11434')).toBe('http://localhost:11434');
    });

    it('should return non-localhost URLs unchanged even when rewriting is active', async () => {
      process.env.QUILLTAP_HOST_IP = '192.168.5.2';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      expect(rewriteLocalhostUrl('https://api.openai.com/v1/chat')).toBe('https://api.openai.com/v1/chat');
    });

    it('should rewrite localhost using QUILLTAP_HOST_IP in a self-managed VM', async () => {
      // A hand-rolled VM is not auto-detectable: QUILLTAP_HOST_IP both opts in
      // and supplies the gateway.
      process.env.QUILLTAP_HOST_IP = '192.168.5.2';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      expect(rewriteLocalhostUrl('http://localhost:11434')).toBe('http://192.168.5.2:11434/');
    });

    it('should let QUILLTAP_HOST_IP win over host.docker.internal in Docker', async () => {
      process.env.DOCKER_CONTAINER = 'true';
      process.env.QUILLTAP_HOST_IP = '172.17.0.1';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      expect(rewriteLocalhostUrl('http://127.0.0.1:8080')).toBe('http://172.17.0.1:8080/');
    });

    it('should handle URLs with paths', async () => {
      process.env.QUILLTAP_HOST_IP = '192.168.5.2';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      const result = rewriteLocalhostUrl('http://localhost:11434/api/chat');
      expect(result).toBe('http://192.168.5.2:11434/api/chat');
    });

    it('should handle URLs with query strings', async () => {
      process.env.QUILLTAP_HOST_IP = '192.168.5.2';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      const result = rewriteLocalhostUrl('http://localhost:8080/v1/models?limit=10');
      expect(result).toBe('http://192.168.5.2:8080/v1/models?limit=10');
    });

    it('should return invalid URLs unchanged', async () => {
      process.env.QUILLTAP_HOST_IP = '192.168.5.2';
      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');

      expect(rewriteLocalhostUrl('not-a-url')).toBe('not-a-url');
    });

    it('should rewrite localhost to host.docker.internal in Docker (no explicit IP)', async () => {
      process.env.DOCKER_CONTAINER = 'true';

      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');
      expect(rewriteLocalhostUrl('http://localhost:11434')).toBe('http://host.docker.internal:11434/');
    });

    it('should rewrite 127.0.0.1 to host.docker.internal in Docker', async () => {
      process.env.DOCKER_CONTAINER = 'true';

      const { rewriteLocalhostUrl } = await import('@/lib/host-rewrite');
      expect(rewriteLocalhostUrl('http://127.0.0.1:8080/v1/chat')).toBe('http://host.docker.internal:8080/v1/chat');
    });
  });

  describe('isVMEnvironment', () => {
    it('should return false on bare metal', async () => {
      const { isVMEnvironment } = await import('@/lib/host-rewrite');
      expect(isVMEnvironment()).toBe(false);
    });

    it('should return true in Docker', async () => {
      process.env.DOCKER_CONTAINER = 'true';
      const { isVMEnvironment } = await import('@/lib/host-rewrite');
      expect(isVMEnvironment()).toBe(true);
    });

    it('should return true when QUILLTAP_HOST_IP opts a self-managed VM in', async () => {
      process.env.QUILLTAP_HOST_IP = '192.168.5.2';
      const { isVMEnvironment } = await import('@/lib/host-rewrite');
      expect(isVMEnvironment()).toBe(true);
    });
  });
});
