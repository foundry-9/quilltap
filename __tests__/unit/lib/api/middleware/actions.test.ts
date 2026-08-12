/**
 * Unit Tests for API Action Middleware
 * Tests lib/api/middleware/actions.ts
 * v2.7-dev: Action dispatch pattern for consolidated routes
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NextRequest, NextResponse } from 'next/server';
import type { RequestContext } from '@/lib/api/middleware/context';

const {
  getActionParam,
  withActionDispatch,
  withCollectionActionDispatch,
  isValidAction,
  getQueryParamsWithoutAction,
} = require('@/lib/api/middleware/actions');

describe('API Action Middleware', () => {
  describe('getActionParam', () => {
    it('should extract action parameter from URL', () => {
      const request = new NextRequest('https://example.com/api/test?action=favorite');
      const action = getActionParam(request);
      expect(action).toBe('favorite');
    });

    it('should return null when no action parameter', () => {
      const request = new NextRequest('https://example.com/api/test');
      const action = getActionParam(request);
      expect(action).toBeNull();
    });

    it('should return first value when multiple action parameters', () => {
      const request = new NextRequest('https://example.com/api/test?action=first&action=second');
      const action = getActionParam(request);
      expect(action).toBe('first');
    });

    it('should return empty string for empty action value', () => {
      const request = new NextRequest('https://example.com/api/test?action=');
      const action = getActionParam(request);
      expect(action).toBe('');
    });
  });

  describe('withActionDispatch', () => {
    let mockContext: RequestContext;
    let mockHandlers: any;

    beforeEach(() => {
      mockContext = {
        user: { id: 'user-1', email: 'test@example.com' },
        repos: {} as any,
        session: { user: { id: 'user-1' } } as any,
      };

      mockHandlers = {
        favorite: jest.fn().mockResolvedValue(NextResponse.json({ action: 'favorite' })),
        export: jest.fn().mockResolvedValue(NextResponse.json({ action: 'export' })),
        avatar: jest.fn().mockResolvedValue(NextResponse.json({ action: 'avatar' })),
      };
    });

    it('should dispatch to correct handler based on action param', async () => {
      const request = new NextRequest('https://example.com/api/test?action=favorite');
      const params = { id: 'char-1' };
      const handler = withActionDispatch(mockHandlers);

      const response = await handler(request, mockContext, params);
      
      expect(mockHandlers.favorite).toHaveBeenCalledWith(request, mockContext, params);
      expect(mockHandlers.export).not.toHaveBeenCalled();
      expect(mockHandlers.avatar).not.toHaveBeenCalled();

      const body = await response.json();
      expect(body).toEqual({ action: 'favorite' });
    });

    it('should call default handler when no action param', async () => {
      const request = new NextRequest('https://example.com/api/test');
      const params = { id: 'char-1' };
      const defaultHandler = jest.fn().mockResolvedValue(NextResponse.json({ action: 'default' }));
      const handler = withActionDispatch(mockHandlers, defaultHandler);

      const response = await handler(request, mockContext, params);
      
      expect(defaultHandler).toHaveBeenCalledWith(request, mockContext, params);
      expect(mockHandlers.favorite).not.toHaveBeenCalled();

      const body = await response.json();
      expect(body).toEqual({ action: 'default' });
    });

    it('should return 400 error when action not found and no default handler', async () => {
      const request = new NextRequest('https://example.com/api/test?action=unknown');
      const params = { id: 'char-1' };
      const handler = withActionDispatch(mockHandlers);

      const response = await handler(request, mockContext, params);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({
        error: 'Unknown action: unknown',
        availableActions: ['favorite', 'export', 'avatar'],
      });
    });

    it('should return 400 error when no action param and no default handler', async () => {
      const request = new NextRequest('https://example.com/api/test');
      const params = { id: 'char-1' };
      const handler = withActionDispatch(mockHandlers);

      const response = await handler(request, mockContext, params);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({
        error: 'Action parameter required',
        availableActions: ['favorite', 'export', 'avatar'],
      });
    });

    it('should pass params correctly to handler', async () => {
      const request = new NextRequest('https://example.com/api/characters/char-1?action=favorite');
      const params = { id: 'char-1', another: 'value' };
      const handler = withActionDispatch(mockHandlers);

      await handler(request, mockContext, params);
      
      expect(mockHandlers.favorite).toHaveBeenCalledWith(request, mockContext, params);
    });

    it('should handle empty action handlers map', async () => {
      const request = new NextRequest('https://example.com/api/test?action=any');
      const params = {};
      const handler = withActionDispatch({});

      const response = await handler(request, mockContext, params);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Unknown action: any');
      expect(body.availableActions).toEqual([]);
    });

    it('should preserve request context through dispatch', async () => {
      const request = new NextRequest('https://example.com/api/test?action=favorite&extra=param');
      const params = { id: 'test-id' };
      const handler = withActionDispatch(mockHandlers);

      await handler(request, mockContext, params);
      
      const calledRequest = mockHandlers.favorite.mock.calls[0][0];
      expect(calledRequest.url).toContain('extra=param');
    });
  });

  describe('withCollectionActionDispatch', () => {
    let mockContext: RequestContext;
    let mockHandlers: any;

    beforeEach(() => {
      mockContext = {
        user: { id: 'user-1', email: 'test@example.com' },
        repos: {} as any,
        session: { user: { id: 'user-1' } } as any,
      };

      mockHandlers = {
        'ai-wizard': jest.fn().mockResolvedValue(NextResponse.json({ action: 'ai-wizard' })),
        'quick-create': jest.fn().mockResolvedValue(NextResponse.json({ action: 'quick-create' })),
        import: jest.fn().mockResolvedValue(NextResponse.json({ action: 'import' })),
      };
    });

    it('should dispatch to collection action handler', async () => {
      const request = new NextRequest('https://example.com/api/characters?action=ai-wizard');
      const handler = withCollectionActionDispatch(mockHandlers);

      const response = await handler(request, mockContext);
      
      expect(mockHandlers['ai-wizard']).toHaveBeenCalledWith(request, mockContext, {});

      const body = await response.json();
      expect(body).toEqual({ action: 'ai-wizard' });
    });

    it('should use default handler for collection without action', async () => {
      const request = new NextRequest('https://example.com/api/characters');
      const defaultHandler = jest.fn().mockResolvedValue(NextResponse.json({ action: 'create' }));
      const handler = withCollectionActionDispatch(mockHandlers, defaultHandler);

      const response = await handler(request, mockContext);
      
      expect(defaultHandler).toHaveBeenCalledWith(request, mockContext, {});

      const body = await response.json();
      expect(body).toEqual({ action: 'create' });
    });

    it('should return 400 for unknown collection action', async () => {
      const request = new NextRequest('https://example.com/api/characters?action=unknown');
      const handler = withCollectionActionDispatch(mockHandlers);

      const response = await handler(request, mockContext);
      
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Unknown action: unknown');
    });
  });

  describe('isValidAction', () => {
    const validActions = ['create', 'update', 'delete'] as const;

    it('should return true for valid action', () => {
      expect(isValidAction('create', validActions)).toBe(true);
      expect(isValidAction('update', validActions)).toBe(true);
      expect(isValidAction('delete', validActions)).toBe(true);
    });

    it('should return false for invalid action', () => {
      expect(isValidAction('invalid', validActions)).toBe(false);
      expect(isValidAction('unknown', validActions)).toBe(false);
    });

    it('should return false for null action', () => {
      expect(isValidAction(null, validActions)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidAction('', validActions)).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(isValidAction('CREATE', validActions)).toBe(false);
      expect(isValidAction('Create', validActions)).toBe(false);
    });
  });

  describe('getQueryParamsWithoutAction', () => {
    it('should extract all query params except action', () => {
      const request = new NextRequest(
        'https://example.com/api/test?action=favorite&limit=10&offset=20'
      );
      const params = getQueryParamsWithoutAction(request);
      
      expect(params).toEqual({
        limit: '10',
        offset: '20',
      });
      expect(params).not.toHaveProperty('action');
    });

    it('should return empty object when only action param present', () => {
      const request = new NextRequest('https://example.com/api/test?action=favorite');
      const params = getQueryParamsWithoutAction(request);
      
      expect(params).toEqual({});
    });

    it('should return empty object when no params present', () => {
      const request = new NextRequest('https://example.com/api/test');
      const params = getQueryParamsWithoutAction(request);
      
      expect(params).toEqual({});
    });

    it('should handle multiple params with same name', () => {
      const request = new NextRequest(
        'https://example.com/api/test?action=favorite&tag=a&tag=b'
      );
      const params = getQueryParamsWithoutAction(request);
      
      // URLSearchParams.forEach returns last value for duplicate keys
      expect(params).toHaveProperty('tag');
      expect(params.tag).toMatch(/^(a|b)$/); // Could be either depending on implementation
      expect(params).not.toHaveProperty('action');
    });

    it('should preserve param values with special characters', () => {
      const request = new NextRequest(
        'https://example.com/api/test?action=export&name=Test%20Name&tag=sci-fi'
      );
      const params = getQueryParamsWithoutAction(request);
      
      expect(params).toEqual({
        name: 'Test Name',
        tag: 'sci-fi',
      });
    });
  });
});
