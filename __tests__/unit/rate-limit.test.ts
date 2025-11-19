/**
 * Unit tests for rate limiting functionality
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  checkRateLimit,
  getClientIdentifier,
  createRateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

describe('Rate Limiting', () => {
  beforeEach(() => {
    // Reset time for each test
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('checkRateLimit', () => {
    it('should allow requests within limit', () => {
      const config = { maxRequests: 5, windowSeconds: 60 };
      const identifier = 'test-user-1';

      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit(identifier, config);
        expect(result.success).toBe(true);
        expect(result.remaining).toBe(5 - i - 1);
      }
    });

    it('should block requests exceeding limit', () => {
      const config = { maxRequests: 3, windowSeconds: 60 };
      const identifier = 'test-user-2';

      // Make 3 allowed requests
      for (let i = 0; i < 3; i++) {
        const result = checkRateLimit(identifier, config);
        expect(result.success).toBe(true);
      }

      // 4th request should be blocked
      const blockedResult = checkRateLimit(identifier, config);
      expect(blockedResult.success).toBe(false);
      expect(blockedResult.remaining).toBe(0);
    });

    it('should reset after window expires', () => {
      const config = { maxRequests: 2, windowSeconds: 60 };
      const identifier = 'test-user-3';

      // Make 2 requests (hit limit)
      checkRateLimit(identifier, config);
      checkRateLimit(identifier, config);

      // Verify we're blocked
      let result = checkRateLimit(identifier, config);
      expect(result.success).toBe(false);

      // Fast-forward time by 61 seconds
      jest.advanceTimersByTime(61 * 1000);

      // Should be allowed again
      result = checkRateLimit(identifier, config);
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('should track different identifiers separately', () => {
      const config = { maxRequests: 2, windowSeconds: 60 };

      // User 1 hits limit
      checkRateLimit('user-1', config);
      checkRateLimit('user-1', config);
      const user1Result = checkRateLimit('user-1', config);
      expect(user1Result.success).toBe(false);

      // User 2 should still be allowed
      const user2Result = checkRateLimit('user-2', config);
      expect(user2Result.success).toBe(true);
    });

    it('should include correct rate limit headers info', () => {
      const config = { maxRequests: 10, windowSeconds: 60 };
      const identifier = 'test-user-4';

      const result = checkRateLimit(identifier, config);

      expect(result.limit).toBe(10);
      expect(result.remaining).toBe(9);
      expect(result.reset).toBeGreaterThan(Date.now() / 1000);
    });
  });

  describe('getClientIdentifier', () => {
    it('should extract IP from x-forwarded-for header', () => {
      const headers = new Headers();
      headers.set('x-forwarded-for', '192.168.1.1, 10.0.0.1');
      const request = { headers } as Request;

      const identifier = getClientIdentifier(request);
      expect(identifier).toBe('192.168.1.1');
    });

    it('should extract IP from x-real-ip header', () => {
      const headers = new Headers();
      headers.set('x-real-ip', '192.168.1.2');
      const request = { headers } as Request;

      const identifier = getClientIdentifier(request);
      expect(identifier).toBe('192.168.1.2');
    });

    it('should prefer x-forwarded-for over x-real-ip', () => {
      const headers = new Headers();
      headers.set('x-forwarded-for', '192.168.1.1');
      headers.set('x-real-ip', '192.168.1.2');
      const request = { headers } as Request;

      const identifier = getClientIdentifier(request);
      expect(identifier).toBe('192.168.1.1');
    });

    it('should return unknown when no IP headers present', () => {
      const headers = new Headers();
      const request = { headers } as Request;

      const identifier = getClientIdentifier(request);
      expect(identifier).toBe('unknown');
    });
  });

  describe('createRateLimitResponse', () => {
    it('should create rate limit response', () => {
      const result = {
        success: false,
        limit: 10,
        remaining: 0,
        reset: Math.floor(Date.now() / 1000) + 60,
      };

      // Verify function runs without error
      const response = createRateLimitResponse(result);
      expect(response).toBeDefined();

      // Note: Full Response object testing requires browser/Edge runtime environment
      // The actual middleware functionality is tested in integration tests
    });
  });

  describe('RATE_LIMITS configuration', () => {
    it('should have valid rate limit configurations', () => {
      expect(RATE_LIMITS.api.maxRequests).toBeGreaterThan(0);
      expect(RATE_LIMITS.api.windowSeconds).toBeGreaterThan(0);

      expect(RATE_LIMITS.auth.maxRequests).toBeGreaterThan(0);
      expect(RATE_LIMITS.auth.windowSeconds).toBeGreaterThan(0);

      expect(RATE_LIMITS.chat.maxRequests).toBeGreaterThan(0);
      expect(RATE_LIMITS.chat.windowSeconds).toBeGreaterThan(0);

      expect(RATE_LIMITS.general.maxRequests).toBeGreaterThan(0);
      expect(RATE_LIMITS.general.windowSeconds).toBeGreaterThan(0);
    });

    it('should have stricter limits for auth than general', () => {
      expect(RATE_LIMITS.auth.maxRequests).toBeLessThan(RATE_LIMITS.general.maxRequests);
    });
  });
});
