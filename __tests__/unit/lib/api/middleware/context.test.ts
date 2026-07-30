/**
 * Unit Tests for API Context Middleware
 * Tests lib/api/middleware/context.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NextRequest, NextResponse } from 'next/server';

// Mock dependencies before importing
jest.mock('@/lib/auth/session');
jest.mock('@/lib/repositories/factory');
jest.mock('@/lib/startup/startup-state', () => ({
  startupState: {
    isReady: jest.fn().mockReturnValue(true),
    waitForReady: jest.fn().mockResolvedValue(true),
    getPhase: jest.fn().mockReturnValue('ready'),
    isPepperResolved: jest.fn().mockReturnValue(true),
    getPepperState: jest.fn().mockReturnValue('resolved'),
  },
}));

const {
  withContext,
  withContextParams,
  createContextHandler,
  createContextParamsHandler,
  exists,
} = require('@/lib/api/middleware/context');

const { getServerSession } = require('@/lib/auth/session');
const { getRepositoriesSafe } = require('@/lib/repositories/factory');

const mockGetServerSession = jest.mocked(getServerSession);
const mockGetRepositoriesSafe = jest.mocked(getRepositoriesSafe);

describe('API Context Middleware', () => {
  let mockRepos: any;
  let mockUser: any;
  let mockSession: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockUser = {
      id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      email: 'user@localhost.localdomain',
      username: 'localUser',
    };

    mockSession = {
      user: {
        id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
        email: 'user@localhost.localdomain',
      },
    };

    mockRepos = {
      users: {
        findById: jest.fn().mockResolvedValue(mockUser),
      },
      characters: {
        findById: jest.fn(),
      },
    };

    mockGetServerSession.mockResolvedValue(mockSession);
    mockGetRepositoriesSafe.mockResolvedValue(mockRepos);
  });

  describe('withContext', () => {
    it('should call handler with request context', async () => {
      const handler = jest.fn().mockResolvedValue(NextResponse.json({ success: true }));
      const response = await withContext(handler);

      expect(mockGetServerSession).toHaveBeenCalled();
      expect(mockGetRepositoriesSafe).toHaveBeenCalled();
      expect(mockRepos.users.findById).toHaveBeenCalledWith('ffffffff-ffff-ffff-ffff-ffffffffffff');
      expect(handler).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          user: mockUser,
          repos: mockRepos,
          session: mockSession,
        })
      );

      const body = await response.json();
      expect(body).toEqual({ success: true });
    });

    it('should return 500 when session fails', async () => {
      mockGetServerSession.mockResolvedValue(null);
      const handler = jest.fn();

      const response = await withContext(handler);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ error: 'Internal server error' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 500 when session missing user ID', async () => {
      mockGetServerSession.mockResolvedValue({ user: {} });
      const handler = jest.fn();

      const response = await withContext(handler);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ error: 'Internal server error' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 500 when user not found in database', async () => {
      mockRepos.users.findById.mockResolvedValue(null);
      const handler = jest.fn();

      const response = await withContext(handler);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ error: 'User not found' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should propagate handler errors', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Handler error'));

      await expect(withContext(handler)).rejects.toThrow('Handler error');
    });
  });

  describe('withContextParams', () => {
    it('should call handler with params and request context', async () => {
      const request = new NextRequest('https://example.com/api/characters/char-1');
      const params = { id: 'char-1' };
      const handler = jest.fn().mockResolvedValue(NextResponse.json({ id: 'char-1' }));

      const response = await withContextParams(request, params, handler);

      expect(handler).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          user: mockUser,
          repos: mockRepos,
          session: mockSession,
        }),
        params
      );

      const body = await response.json();
      expect(body).toEqual({ id: 'char-1' });
    });

    it('should return 500 when session fails with params', async () => {
      mockGetServerSession.mockResolvedValue(null);
      const request = new NextRequest('https://example.com/api/test');
      const params = { id: 'test-1' };
      const handler = jest.fn();

      const response = await withContextParams(request, params, handler);

      expect(response.status).toBe(500);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return 500 when user not found with params', async () => {
      mockRepos.users.findById.mockResolvedValue(null);
      const request = new NextRequest('https://example.com/api/test');
      const params = { id: 'test-1' };
      const handler = jest.fn();

      const response = await withContextParams(request, params, handler);

      expect(response.status).toBe(500);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle multiple params', async () => {
      const request = new NextRequest('https://example.com/api/test');
      const params = { id: 'char-1', action: 'favorite' };
      const handler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }));

      await withContextParams(request, params, handler);

      expect(handler).toHaveBeenCalledWith(
        request,
        expect.anything(),
        params
      );
    });
  });

  describe('createContextHandler', () => {
    it('should create handler that provides context and calls inner handler', async () => {
      const innerHandler = jest.fn().mockResolvedValue(
        NextResponse.json({ data: 'test' })
      );
      const handler = createContextHandler(innerHandler);
      const request = new NextRequest('https://example.com/api/test');

      const response = await handler(request);

      expect(mockGetServerSession).toHaveBeenCalled();
      expect(mockRepos.users.findById).toHaveBeenCalledWith('ffffffff-ffff-ffff-ffff-ffffffffffff');
      expect(innerHandler).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          user: mockUser,
          repos: mockRepos,
          session: mockSession,
        })
      );

      const body = await response.json();
      expect(body).toEqual({ data: 'test' });
    });

    it('should return 500 when session fails', async () => {
      mockGetServerSession.mockResolvedValue(null);
      const innerHandler = jest.fn();
      const handler = createContextHandler(innerHandler);
      const request = new NextRequest('https://example.com/api/test');

      const response = await handler(request);

      expect(response.status).toBe(500);
      expect(innerHandler).not.toHaveBeenCalled();
    });

    it('should be usable as Next.js route handler', async () => {
      // Pattern: export const GET = createContextHandler(async (req, { user, repos }) => {...})
      const handler = createContextHandler(async (req, { user, repos }) => {
        return NextResponse.json({ userId: user.id });
      });

      const request = new NextRequest('https://example.com/api/test');
      const response = await handler(request);

      const body = await response.json();
      expect(body).toEqual({ userId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' });
    });
  });

  describe('createContextParamsHandler', () => {
    it('should create handler that provides context with params', async () => {
      const innerHandler = jest.fn().mockResolvedValue(
        NextResponse.json({ id: 'char-1' })
      );
      const handler = createContextParamsHandler<{ id: string }>(innerHandler);
      const request = new NextRequest('https://example.com/api/characters/char-1');
      const context = { params: Promise.resolve({ id: 'char-1' }) };

      const response = await handler(request, context);

      expect(innerHandler).toHaveBeenCalledWith(
        request,
        expect.objectContaining({
          user: mockUser,
          repos: mockRepos,
        }),
        { id: 'char-1' }
      );

      const body = await response.json();
      expect(body).toEqual({ id: 'char-1' });
    });

    it('should await params promise before processing', async () => {
      let resolveParams: any;
      const paramsPromise = new Promise<{ id: string }>((resolve) => {
        resolveParams = resolve;
      });

      const innerHandler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }));
      const handler = createContextParamsHandler(innerHandler);
      const request = new NextRequest('https://example.com/api/test');
      const context = { params: paramsPromise };

      const responsePromise = handler(request, context);

      // Handler shouldn't be called yet
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(innerHandler).not.toHaveBeenCalled();

      // Resolve params
      resolveParams({ id: 'test-1' });
      await responsePromise;

      expect(innerHandler).toHaveBeenCalledWith(
        request,
        expect.anything(),
        { id: 'test-1' }
      );
    });

    it('should return 500 when session fails', async () => {
      mockGetServerSession.mockResolvedValue(null);

      const innerHandler = jest.fn();
      const handler = createContextParamsHandler(innerHandler);
      const request = new NextRequest('https://example.com/api/test');
      const context = { params: Promise.resolve({ id: 'test-1' }) };

      const response = await handler(request, context);

      expect(response.status).toBe(500);
      expect(innerHandler).not.toHaveBeenCalled();
    });

    it('should be usable as Next.js route handler with params', async () => {
      // Pattern: export const GET = createContextParamsHandler<{ id: string }>(...)
      const handler = createContextParamsHandler<{ id: string }>(
        async (req, { user }, { id }) => {
          return NextResponse.json({ userId: user.id, characterId: id });
        }
      );

      const request = new NextRequest('https://example.com/api/characters/char-1');
      const context = { params: Promise.resolve({ id: 'char-1' }) };
      const response = await handler(request, context);

      const body = await response.json();
      expect(body).toEqual({ userId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', characterId: 'char-1' });
    });
  });

  describe('exists', () => {
    it('should return true for defined values', () => {
      expect(exists({ id: 'test' })).toBe(true);
      expect(exists('string')).toBe(true);
      expect(exists(0)).toBe(true);
      expect(exists(false)).toBe(true);
      expect(exists([])).toBe(true);
    });

    it('should return false for null', () => {
      expect(exists(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(exists(undefined)).toBe(false);
    });

    it('should work as type guard', () => {
      const resource: { id: string } | null = { id: 'test' };

      if (exists(resource)) {
        // TypeScript should know resource is not null
        expect(resource.id).toBe('test');
      }
    });
  });
});
