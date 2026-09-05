/**
 * Unit tests for new features in lib/startup/startup-state.ts
 *
 * Tests the version guard block and instance lock conflict methods
 * added since commit 27566b52.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// jest.setup.ts globally mocks startup-state with a minimal stub.
// We need the REAL module. Use jest.requireActual to bypass the mock.
const { startupState } = jest.requireActual('@/lib/startup/startup-state') as typeof import('@/lib/startup/startup-state');

type VersionGuardBlock = Parameters<typeof startupState.setVersionGuardBlock>[0];
type InstanceLockConflict = Parameters<typeof startupState.setInstanceLockConflict>[0];

describe('Startup State - Version Guard Block and Instance Lock Conflict', () => {
  beforeEach(() => {
    startupState.reset();
  });

  // ==========================================================================
  // setVersionGuardBlock / getVersionGuardBlock
  // ==========================================================================

  describe('setVersionGuardBlock / getVersionGuardBlock', () => {
    it('should return null initially after reset', () => {
      expect(startupState.getVersionGuardBlock()).toBeNull();
    });

    it('should store the block and return it', () => {
      const block: VersionGuardBlock = {
        currentVersion: '2.5.0',
        highestVersion: '2.6.0',
      };

      startupState.setVersionGuardBlock(block);
      expect(startupState.getVersionGuardBlock()).toEqual(block);
    });

    it('should set phase to failed', () => {
      startupState.setVersionGuardBlock({
        currentVersion: '2.5.0',
        highestVersion: '2.6.0',
      });

      expect(startupState.getPhase()).toBe('failed');
    });

    it('should set error message with both versions', () => {
      startupState.setVersionGuardBlock({
        currentVersion: '2.5.0',
        highestVersion: '2.6.0',
      });

      const stats = startupState.getStats();
      expect(stats.error).toBe(
        'Database was last used by Quilltap v2.6.0, but this is v2.5.0'
      );
    });

    it('should be cleared by reset()', () => {
      startupState.setVersionGuardBlock({
        currentVersion: '2.5.0',
        highestVersion: '2.6.0',
      });
      expect(startupState.getVersionGuardBlock()).not.toBeNull();

      startupState.reset();
      expect(startupState.getVersionGuardBlock()).toBeNull();
    });

    it('should replace previous block', () => {
      startupState.setVersionGuardBlock({
        currentVersion: '2.4.0',
        highestVersion: '2.5.0',
      });

      startupState.setVersionGuardBlock({
        currentVersion: '2.5.0',
        highestVersion: '2.6.0',
      });

      expect(startupState.getVersionGuardBlock()?.currentVersion).toBe('2.5.0');
      expect(startupState.getVersionGuardBlock()?.highestVersion).toBe('2.6.0');
    });
  });

  // ==========================================================================
  // setInstanceLockConflict / getInstanceLockConflict
  // ==========================================================================

  describe('setInstanceLockConflict / getInstanceLockConflict', () => {
    const testConflict: InstanceLockConflict = {
      pid: 12345,
      hostname: 'mycomputer.local',
      environment: 'docker',
      startedAt: '2026-03-22T10:30:00Z',
      lockPath: '/data/quilltap/quilltap.lock',
    };

    it('should return null initially after reset', () => {
      expect(startupState.getInstanceLockConflict()).toBeNull();
    });

    it('should store the conflict and return it', () => {
      startupState.setInstanceLockConflict(testConflict);
      expect(startupState.getInstanceLockConflict()).toEqual(testConflict);
    });

    it('should set phase to failed', () => {
      startupState.setInstanceLockConflict(testConflict);
      expect(startupState.getPhase()).toBe('failed');
    });

    it('should set error message with PID and environment', () => {
      startupState.setInstanceLockConflict(testConflict);

      const stats = startupState.getStats();
      expect(stats.error).toBe(
        'Database locked by another instance (PID 12345, docker)'
      );
    });

    it('should be cleared by reset()', () => {
      startupState.setInstanceLockConflict(testConflict);
      expect(startupState.getInstanceLockConflict()).not.toBeNull();

      startupState.reset();
      expect(startupState.getInstanceLockConflict()).toBeNull();
    });

    it('should replace previous conflict', () => {
      startupState.setInstanceLockConflict(testConflict);
      startupState.setInstanceLockConflict({
        ...testConflict,
        pid: 99999,
        environment: 'docker',
      });

      expect(startupState.getInstanceLockConflict()?.pid).toBe(99999);
      expect(startupState.getInstanceLockConflict()?.environment).toBe('docker');
    });
  });

  // ==========================================================================
  // Integration: reset() clears both
  // ==========================================================================

  describe('reset() integration', () => {
    it('should clear both version guard block and instance lock conflict', () => {
      startupState.setVersionGuardBlock({
        currentVersion: '2.5.0',
        highestVersion: '2.6.0',
      });
      startupState.setInstanceLockConflict({
        pid: 12345,
        hostname: 'test',
        environment: 'docker',
        startedAt: '2026-03-22T10:30:00Z',
        lockPath: '/tmp/lock',
      });

      startupState.reset();

      expect(startupState.getVersionGuardBlock()).toBeNull();
      expect(startupState.getInstanceLockConflict()).toBeNull();
    });

    it('should restore phase to pending and clear error', () => {
      startupState.setVersionGuardBlock({
        currentVersion: '2.5.0',
        highestVersion: '2.6.0',
      });
      expect(startupState.getPhase()).toBe('failed');
      expect(startupState.getStats().error).not.toBeNull();

      startupState.reset();

      expect(startupState.getPhase()).toBe('pending');
      expect(startupState.getStats().error).toBeNull();
    });
  });
});
