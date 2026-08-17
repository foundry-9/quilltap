/**
 * Tests for the Quilltap Export Schema Validator
 */

import { validateQtapExport, resetValidatorCache } from '@/lib/validation/qtap-schema-validator';

describe('qtap-schema-validator', () => {
  beforeEach(() => {
    resetValidatorCache();
  });

  describe('validateQtapExport', () => {
    it('validates a well-formed character export', () => {
      const validExport = {
        manifest: {
          format: 'quilltap-export',
          version: '1.0',
          exportType: 'characters',
          createdAt: '2026-02-18T00:00:00.000Z',
          appVersion: '3.0.0',
          settings: {
            includeMemories: false,
            scope: 'selected',
            selectedIds: ['550e8400-e29b-41d4-a716-446655440000'],
          },
          counts: {
            characters: 1,
          },
        },
        data: {
          characters: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              userId: '550e8400-e29b-41d4-a716-446655440001',
              name: 'Test Character',
              createdAt: '2026-02-18T00:00:00.000Z',
              updatedAt: '2026-02-18T00:00:00.000Z',
            },
          ],
        },
      };

      const result = validateQtapExport(validExport);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts a wardrobe item in the hair slot', () => {
      const withHair = {
        manifest: {
          format: 'quilltap-export',
          version: '1.0',
          exportType: 'characters',
          createdAt: '2026-02-18T00:00:00.000Z',
          appVersion: '3.0.0',
          settings: { includeMemories: false, scope: 'selected', selectedIds: [] },
          counts: { characters: 1 },
        },
        data: {
          characters: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              userId: '550e8400-e29b-41d4-a716-446655440001',
              name: 'Test Character',
              createdAt: '2026-02-18T00:00:00.000Z',
              updatedAt: '2026-02-18T00:00:00.000Z',
              wardrobeItems: [
                {
                  id: '550e8400-e29b-41d4-a716-446655440002',
                  title: 'Braided Crown',
                  types: ['hair'],
                  createdAt: '2026-02-18T00:00:00.000Z',
                  updatedAt: '2026-02-18T00:00:00.000Z',
                },
              ],
            },
          ],
        },
      };

      const result = validateQtapExport(withHair);
      expect(result.errors).toHaveLength(0);
      expect(result.valid).toBe(true);
    });

    it('rejects data missing manifest', () => {
      const result = validateQtapExport({ data: {} });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects data missing data field', () => {
      const result = validateQtapExport({
        manifest: {
          format: 'quilltap-export',
          version: '1.0',
          exportType: 'characters',
          createdAt: '2026-02-18T00:00:00.000Z',
          appVersion: '3.0.0',
          settings: {
            includeMemories: false,
            scope: 'all',
            selectedIds: [],
          },
          counts: {},
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects invalid format identifier', () => {
      const result = validateQtapExport({
        manifest: {
          format: 'wrong-format',
          version: '1.0',
          exportType: 'characters',
          createdAt: '2026-02-18T00:00:00.000Z',
          appVersion: '3.0.0',
          settings: {
            includeMemories: false,
            scope: 'all',
            selectedIds: [],
          },
          counts: {},
        },
        data: {
          characters: [],
        },
      });
      expect(result.valid).toBe(false);
    });

    it('rejects null input', () => {
      const result = validateQtapExport(null);
      expect(result.valid).toBe(false);
    });

    it('rejects non-object input', () => {
      const result = validateQtapExport('not an object');
      expect(result.valid).toBe(false);
    });

    it('validates export with memories', () => {
      const exportWithMemories = {
        manifest: {
          format: 'quilltap-export',
          version: '1.0',
          exportType: 'characters',
          createdAt: '2026-02-18T00:00:00.000Z',
          appVersion: '3.0.0',
          settings: {
            includeMemories: true,
            scope: 'selected',
            selectedIds: ['550e8400-e29b-41d4-a716-446655440000'],
          },
          counts: {
            characters: 1,
            memories: 1,
          },
        },
        data: {
          characters: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              userId: '550e8400-e29b-41d4-a716-446655440001',
              name: 'Test Character',
              createdAt: '2026-02-18T00:00:00.000Z',
              updatedAt: '2026-02-18T00:00:00.000Z',
            },
          ],
          memories: [
            {
              id: '550e8400-e29b-41d4-a716-446655440002',
              characterId: '550e8400-e29b-41d4-a716-446655440000',
              content: 'A test memory',
              summary: 'Test',
              createdAt: '2026-02-18T00:00:00.000Z',
              updatedAt: '2026-02-18T00:00:00.000Z',
            },
          ],
        },
      };

      const result = validateQtapExport(exportWithMemories);
      expect(result.valid).toBe(true);
    });
  });
});
