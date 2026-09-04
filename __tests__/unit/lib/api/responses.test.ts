/**
 * Unit Tests for API Response Helpers
 * Tests lib/api/responses.ts
 * v2.7-dev: API Response Utilities
 */

import { describe, it, expect } from '@jest/globals';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// Import all functions from responses.ts
const {
  errorResponse,
  successResponse,
  messageResponse,
  validationError,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  badRequest,
  serverError,
  created,
  noContent,
  withErrorHandling,
  deprecatedRedirect,
  withDeprecationHeaders,
  buildRedirectUrl,
} = require('@/lib/api/responses');

describe('API Response Helpers', () => {
  describe('errorResponse', () => {
    it('should create error response with default status 500', async () => {
      const response = errorResponse('Internal error');
      expect(response.status).toBe(500);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Internal error' });
    });

    it('should create error response with custom status', async () => {
      const response = errorResponse('Bad request', 400);
      expect(response.status).toBe(400);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Bad request' });
    });

    it('should include details when provided', async () => {
      const details = { field: 'email', issue: 'invalid format' };
      const response = errorResponse('Validation failed', 400, details);
      expect(response.status).toBe(400);
      
      const body = await response.json();
      expect(body).toEqual({
        error: 'Validation failed',
        details,
      });
    });

    it('should omit details when undefined', async () => {
      const response = errorResponse('Error', 500, undefined);
      const body = await response.json();
      expect(body).toEqual({ error: 'Error' });
      expect(body).not.toHaveProperty('details');
    });

    it('should handle null details', async () => {
      const response = errorResponse('Error', 500, null);
      const body = await response.json();
      expect(body).toHaveProperty('details', null);
    });
  });

  describe('successResponse', () => {
    it('should create success response with default status 200', async () => {
      const data = { key: 'value', count: 42 };
      const response = successResponse(data);
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body).toEqual(data);
    });

    it('should create success response with custom status', async () => {
      const data = { result: 'ok' };
      const response = successResponse(data, 202);
      expect(response.status).toBe(202);
      
      const body = await response.json();
      expect(body).toEqual(data);
    });

    it('should handle null data', async () => {
      const response = successResponse(null);
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body).toBeNull();
    });

    it('should handle empty object', async () => {
      const response = successResponse({});
      const body = await response.json();
      expect(body).toEqual({});
    });

    it('should handle complex nested data', async () => {
      const data = {
        user: { id: '123', name: 'Test' },
        items: [1, 2, 3],
        metadata: { timestamp: '2026-01-22' },
      };
      const response = successResponse(data);
      const body = await response.json();
      expect(body).toEqual(data);
    });
  });

  describe('messageResponse', () => {
    it('should create message response with default status 200', async () => {
      const response = messageResponse('Operation successful');
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body).toEqual({ message: 'Operation successful' });
    });

    it('should create message response with custom status', async () => {
      const response = messageResponse('Created successfully', 201);
      expect(response.status).toBe(201);
      
      const body = await response.json();
      expect(body).toEqual({ message: 'Created successfully' });
    });
  });

  describe('validationError', () => {
    it('should create validation error from Zod error', async () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(18),
      });

      try {
        schema.parse({ email: 'invalid', age: 10 });
      } catch (error) {
        if (error instanceof z.ZodError) {
          const response = validationError(error);
          expect(response.status).toBe(400);
          
          const body = await response.json();
          expect(body.error).toBe('Validation error');
          expect(body.details).toBeDefined();
          expect(Array.isArray(body.details)).toBe(true);
          expect((body.details as unknown[]).length).toBeGreaterThan(0);
        }
      }
    });

    it('should include all validation errors', async () => {
      const schema = z.object({
        name: z.string().min(1),
        count: z.number().positive(),
      });

      try {
        schema.parse({ name: '', count: -5 });
      } catch (error) {
        if (error instanceof z.ZodError) {
          const response = validationError(error);
          const body = await response.json();
          expect((body.details as unknown[]).length).toBe(2);
        }
      }
    });
  });

  describe('unauthorized', () => {
    it('should create unauthorized response with default message', async () => {
      const response = unauthorized();
      expect(response.status).toBe(401);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('should create unauthorized response with custom message', async () => {
      const response = unauthorized('Invalid token');
      expect(response.status).toBe(401);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Invalid token' });
    });
  });

  describe('forbidden', () => {
    it('should create forbidden response with default message', async () => {
      const response = forbidden();
      expect(response.status).toBe(403);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Forbidden' });
    });

    it('should create forbidden response with custom message', async () => {
      const response = forbidden('Access denied');
      expect(response.status).toBe(403);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Access denied' });
    });
  });

  describe('notFound', () => {
    it('should create not found response without resource', async () => {
      const response = notFound();
      expect(response.status).toBe(404);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Not found' });
    });

    it('should create not found response with resource', async () => {
      const response = notFound('Character');
      expect(response.status).toBe(404);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Character not found' });
    });
  });

  describe('conflict', () => {
    it('should create conflict response', async () => {
      const response = conflict('Resource already exists');
      expect(response.status).toBe(409);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Resource already exists' });
    });
  });

  describe('badRequest', () => {
    it('should create bad request response without details', async () => {
      const response = badRequest('Invalid input');
      expect(response.status).toBe(400);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Invalid input' });
    });

    it('should create bad request response with details', async () => {
      const details = { field: 'userId', reason: 'required' };
      const response = badRequest('Missing required field', details);
      expect(response.status).toBe(400);
      
      const body = await response.json();
      expect(body).toEqual({
        error: 'Missing required field',
        details,
      });
    });
  });

  describe('serverError', () => {
    it('should create server error with default message', async () => {
      const response = serverError();
      expect(response.status).toBe(500);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Internal server error' });
    });

    it('should create server error with custom message', async () => {
      const response = serverError('Database connection failed');
      expect(response.status).toBe(500);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Database connection failed' });
    });
  });

  describe('created', () => {
    it('should create 201 response with data', async () => {
      const data = { id: '123', name: 'New Resource' };
      const response = created(data);
      expect(response.status).toBe(201);
      
      const body = await response.json();
      expect(body).toEqual(data);
    });
  });

  describe('noContent', () => {
    it('should create 204 response with no body', () => {
      const response = noContent();
      expect(response.status).toBe(204);
      expect(response.body).toBeNull();
    });
  });

  describe('withErrorHandling', () => {
    it('should return successful response from handler', async () => {
      const handler = async () => successResponse({ success: true });
      const response = await withErrorHandling(handler);
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body).toEqual({ success: true });
    });

    it('should handle Zod validation errors', async () => {
      const schema = z.object({ email: z.string().email() });
      const handler = async () => {
        schema.parse({ email: 'invalid' });
        return successResponse({ success: true });
      };

      const response = await withErrorHandling(handler);
      expect(response.status).toBe(400);
      
      const body = await response.json();
      expect(body.error).toBe('Validation error');
    });

    it('should handle generic errors with default message', async () => {
      const handler = async () => {
        throw new Error('Something broke');
      };

      const response = await withErrorHandling(handler);
      expect(response.status).toBe(500);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Operation failed' });
    });

    it('should handle generic errors with custom message', async () => {
      const handler = async () => {
        throw new Error('Database error');
      };

      const response = await withErrorHandling(handler, 'Failed to save data');
      expect(response.status).toBe(500);
      
      const body = await response.json();
      expect(body).toEqual({ error: 'Failed to save data' });
    });
  });

  describe('deprecatedRedirect', () => {
    it('should create 308 redirect without deprecation info', () => {
      const response = deprecatedRedirect('/api/v1/new-path');
      expect(response.status).toBe(308);
      expect(response.headers.get('Location')).toBe('/api/v1/new-path');
    });

    it('should include sunset header when sunsetDate provided', () => {
      const response = deprecatedRedirect('/api/v1/new', {
        sunsetDate: '2026-04-01',
      });
      
      const sunset = response.headers.get('Sunset');
      expect(sunset).toBeDefined();
      expect(sunset).toContain('2026');
    });

    it('should include deprecation header', () => {
      const response = deprecatedRedirect('/api/v1/new', {
        sunsetDate: '2026-04-01',
      });
      
      expect(response.headers.get('Deprecation')).toBe('true');
    });

    it('should include link headers for docs', () => {
      const response = deprecatedRedirect('/api/v1/new', {
        sunsetDate: '2026-04-01',
        docsUrl: '/docs/migration',
      });
      
      const link = response.headers.get('Link');
      expect(link).toContain('/docs/migration');
      expect(link).toContain('rel="deprecation"');
    });

    it('should include link headers for replacement', () => {
      const response = deprecatedRedirect('/api/v1/new', {
        sunsetDate: '2026-04-01',
        replacement: '/api/v1/replacement',
      });
      
      const link = response.headers.get('Link');
      expect(link).toContain('/api/v1/replacement');
      expect(link).toContain('rel="successor-version"');
    });

    it('should include all deprecation info', () => {
      const response = deprecatedRedirect('/api/v1/new', {
        sunsetDate: '2026-04-01',
        docsUrl: '/docs/migration',
        replacement: '/api/v1/replacement',
      });
      
      expect(response.status).toBe(308);
      expect(response.headers.get('Location')).toBe('/api/v1/new');
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Sunset')).toBeDefined();
      
      const link = response.headers.get('Link');
      expect(link).toContain('/docs/migration');
      expect(link).toContain('/api/v1/replacement');
    });
  });

  describe('withDeprecationHeaders', () => {
    it('should add deprecation headers to response', async () => {
      const originalResponse = successResponse({ data: 'test' });
      const response = withDeprecationHeaders(originalResponse, {
        sunsetDate: '2026-04-01',
      });
      
      expect(response.status).toBe(200);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Sunset')).toBeDefined();
      
      const body = await response.json();
      expect(body).toEqual({ data: 'test' });
    });

    it('should preserve original response body and status', async () => {
      const originalResponse = created({ id: '123' });
      const response = withDeprecationHeaders(originalResponse, {
        sunsetDate: '2026-04-01',
        replacement: '/api/v1/items',
      });
      
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toEqual({ id: '123' });
    });

    it('should add link headers when provided', () => {
      const originalResponse = successResponse({ data: 'test' });
      const response = withDeprecationHeaders(originalResponse, {
        sunsetDate: '2026-04-01',
        docsUrl: '/docs/api',
        replacement: '/api/v1/new',
      });
      
      const link = response.headers.get('Link');
      expect(link).toContain('/docs/api');
      expect(link).toContain('rel="deprecation"');
      expect(link).toContain('/api/v1/new');
      expect(link).toContain('rel="successor-version"');
    });
  });

  describe('buildRedirectUrl', () => {
    it('should build redirect URL with base path', () => {
      const request = new Request('https://example.com/api/old');
      const url = buildRedirectUrl(request, '/api/v1/new');
      expect(url).toBe('/api/v1/new');
    });

    it('should preserve query parameters', () => {
      const request = new Request('https://example.com/api/old?limit=10&offset=20');
      const url = buildRedirectUrl(request, '/api/v1/new');
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=20');
    });

    it('should add additional parameters', () => {
      const request = new Request('https://example.com/api/old?limit=10');
      const url = buildRedirectUrl(request, '/api/v1/new', {
        additionalParams: { characterId: '123' },
      });
      expect(url).toContain('limit=10');
      expect(url).toContain('characterId=123');
    });

    it('should exclude specified parameters', () => {
      const request = new Request('https://example.com/api/old?limit=10&token=secret&offset=20');
      const url = buildRedirectUrl(request, '/api/v1/new', {
        excludeParams: ['token'],
      });
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=20');
      expect(url).not.toContain('token');
    });

    it('should rename parameters', () => {
      const request = new Request('https://example.com/api/old?id=123&name=test');
      const url = buildRedirectUrl(request, '/api/v1/new', {
        renameParams: { id: 'characterId' },
      });
      expect(url).toContain('characterId=123');
      expect(url).toContain('name=test');
      expect(url).not.toContain('id=123');
    });

    it('should handle all options together', () => {
      const request = new Request('https://example.com/api/old?id=123&limit=10&token=secret');
      const url = buildRedirectUrl(request, '/api/v1/new', {
        additionalParams: { userId: '456' },
        excludeParams: ['token'],
        renameParams: { id: 'characterId' },
      });
      expect(url).toContain('characterId=123');
      expect(url).toContain('limit=10');
      expect(url).toContain('userId=456');
      expect(url).not.toContain('token');
      expect(url).not.toContain('id=123');
    });
  });

});
