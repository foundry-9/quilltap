/**
 * Tests for the AI Import Service helpers
 */

import {
  stripCodeFences,
  parseLLMJson,
  repairTruncatedJson,
  escapeControlCharsInStrings,
} from '@/lib/llm/llm-json';
import {
  assembleQtapExport,
  restampStructuralFields,
} from '@/lib/services/ai-import.service';
import { validateQtapExport } from '@/lib/validation/qtap-schema-validator';

describe('ai-import.service', () => {
  describe('stripCodeFences', () => {
    it('strips ```json ... ``` fences', () => {
      const input = '```json\n{"name": "Test"}\n```';
      expect(stripCodeFences(input)).toBe('{"name": "Test"}');
    });

    it('strips ``` ... ``` fences without language hint', () => {
      const input = '```\n{"name": "Test"}\n```';
      expect(stripCodeFences(input)).toBe('{"name": "Test"}');
    });

    it('returns plain JSON unchanged', () => {
      const input = '{"name": "Test"}';
      expect(stripCodeFences(input)).toBe('{"name": "Test"}');
    });

    it('trims surrounding whitespace', () => {
      const input = '  \n{"name": "Test"}\n  ';
      expect(stripCodeFences(input)).toBe('{"name": "Test"}');
    });

    it('handles empty string', () => {
      expect(stripCodeFences('')).toBe('');
    });

    it('handles fences with extra content after language hint', () => {
      const input = '```json\n[{"a": 1}, {"b": 2}]\n```';
      expect(stripCodeFences(input)).toBe('[{"a": 1}, {"b": 2}]');
    });
  });

  describe('parseLLMJson', () => {
    it('parses plain JSON object', () => {
      const result = parseLLMJson<{ name: string }>('{"name": "Test"}');
      expect(result).toEqual({ name: 'Test' });
    });

    it('parses JSON array', () => {
      const result = parseLLMJson<number[]>('[1, 2, 3]');
      expect(result).toEqual([1, 2, 3]);
    });

    it('parses JSON with code fences', () => {
      const result = parseLLMJson<{ name: string }>('```json\n{"name": "Test"}\n```');
      expect(result).toEqual({ name: 'Test' });
    });

    it('throws on invalid JSON', () => {
      expect(() => parseLLMJson('not json at all')).toThrow();
    });

    it('throws on empty string', () => {
      expect(() => parseLLMJson('')).toThrow();
    });

    it('parses nested objects', () => {
      const input = '```json\n{"character": {"name": "Alice", "traits": ["brave", "kind"]}}\n```';
      const result = parseLLMJson<{ character: { name: string; traits: string[] } }>(input);
      expect(result.character.name).toBe('Alice');
      expect(result.character.traits).toEqual(['brave', 'kind']);
    });

    it('handles JSON with unicode characters', () => {
      const result = parseLLMJson<{ name: string }>('{"name": "Ren\\u00e9e"}');
      expect(result.name).toBe('Ren\u00e9e');
    });

    it('parses JSON with a raw newline inside a string literal (regression: first_message step)', () => {
      // The LLM emitted a literal newline inside the value instead of \\n \u2014
      // JSON.parse would throw "Bad control character in string literal".
      const input = '{"firstMessage": "Hello there.\nHow do you do?"}';
      const result = parseLLMJson<{ firstMessage: string }>(input);
      expect(result.firstMessage).toBe('Hello there.\nHow do you do?');
    });

    it('parses JSON with raw tabs and carriage returns inside strings', () => {
      const input = '{"a": "x\ty", "b": "line1\r\nline2"}';
      const result = parseLLMJson<{ a: string; b: string }>(input);
      expect(result.a).toBe('x\ty');
      expect(result.b).toBe('line1\r\nline2');
    });

    it('leaves structural whitespace between tokens untouched', () => {
      const input = '{\n  "name": "Maya",\n  "age": 30\n}';
      const result = parseLLMJson<{ name: string; age: number }>(input);
      expect(result).toEqual({ name: 'Maya', age: 30 });
    });
  });

  describe('escapeControlCharsInStrings', () => {
    it('escapes a raw newline only when inside a string', () => {
      expect(escapeControlCharsInStrings('{"a": "x\ny"}')).toBe('{"a": "x\\ny"}');
    });

    it('does not touch newlines outside of strings', () => {
      const input = '{\n"a": 1\n}';
      expect(escapeControlCharsInStrings(input)).toBe(input);
    });

    it('respects escaped quotes when tracking string boundaries', () => {
      const input = '{"a": "she said \\"hi\\"\nthen left"}';
      expect(escapeControlCharsInStrings(input)).toBe('{"a": "she said \\"hi\\"\\nthen left"}');
    });
  });

  // ====================================================================
  // Regression: truncated JSON repair
  // ====================================================================

  describe('repairTruncatedJson', () => {
    it('returns valid JSON unchanged', () => {
      const input = '{"name": "Alice"}';
      expect(repairTruncatedJson(input)).toBe(input);
    });

    it('closes a single unclosed brace', () => {
      const input = '{"name": "Alice"';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      expect(JSON.parse(repaired)).toEqual({ name: 'Alice' });
    });

    it('closes multiple unclosed braces', () => {
      const input = '{"outer": {"inner": "value"';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      const parsed = JSON.parse(repaired);
      expect(parsed.outer.inner).toBe('value');
    });

    it('closes unclosed array bracket', () => {
      const input = '[1, 2, 3';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      expect(JSON.parse(repaired)).toEqual([1, 2, 3]);
    });

    it('closes mixed unclosed braces and brackets', () => {
      const input = '{"items": [{"name": "a"}, {"name": "b"';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      const parsed = JSON.parse(repaired);
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[1].name).toBe('b');
    });

    it('removes trailing comma before closing', () => {
      const input = '{"items": [1, 2,';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      expect(JSON.parse(repaired)).toEqual({ items: [1, 2] });
    });

    it('closes an unclosed string', () => {
      const input = '{"name": "Alice';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      expect(JSON.parse(repaired).name).toBe('Alice');
    });

    it('removes trailing key without value', () => {
      const input = '{"name": "Alice", "age":';
      const repaired = repairTruncatedJson(input);
      expect(() => JSON.parse(repaired)).not.toThrow();
      expect(JSON.parse(repaired)).toEqual({ name: 'Alice' });
    });
  });

  describe('parseLLMJson truncation regression', () => {
    it('handles truncated JSON with missing closing braces', () => {
      const input = '{"behavioralPatterns": [{"pattern": "speaks softly", "evidence": "whispers", "frequency": "often"}], "summary": "The character is quiet"';
      const result = parseLLMJson<{ behavioralPatterns: Array<{ pattern: string }>; summary: string }>(input);
      expect(result.behavioralPatterns[0].pattern).toBe('speaks softly');
      expect(result.summary).toBe('The character is quiet');
    });

    it('handles truncated JSON array with missing closing bracket', () => {
      const input = '[{"field": "description", "proposedValue": "A quiet soul", "significance": 0.5}';
      const result = parseLLMJson<Array<{ field: string; proposedValue: string }>>(input);
      expect(result).toHaveLength(1);
      expect(result[0].field).toBe('description');
    });

    it('handles JSON wrapped in markdown code fences (```json)', () => {
      const input = '```json\n{"behavioralPatterns": [], "summary": "No patterns found"}\n```';
      const result = parseLLMJson<{ summary: string }>(input);
      expect(result.summary).toBe('No patterns found');
    });

    it('handles JSON wrapped in plain code fences (```)', () => {
      const input = '```\n[{"field": "personality", "proposedValue": "Bold"}]\n```';
      const result = parseLLMJson<Array<{ field: string }>>(input);
      expect(result[0].field).toBe('personality');
    });

    it('handles truncated JSON inside markdown code fences', () => {
      const input = '```json\n{"patterns": [{"name": "verbose"';
      const result = parseLLMJson<{ patterns: Array<{ name: string }> }>(input);
      expect(result.patterns[0].name).toBe('verbose');
    });
  });

  describe('assembleQtapExport', () => {
    it('omits optional text fields a step did not produce instead of writing null', () => {
      const exportData = assembleQtapExport(
        {
          // first_message intentionally absent (the step failed for Maya Kapoor)
          character_basics: { name: 'Maya Kapoor', identity: 'A botanist of repute.' },
          system_prompts: [{ name: 'Main', content: 'You are Maya.', isDefault: true }],
        },
        false,
        false,
        '4.6.0'
      );
      const character = (exportData.data as { characters: Record<string, unknown>[] }).characters[0];
      expect('personality' in character).toBe(false);
      expect('firstMessage' in character).toBe(false);
      expect('exampleDialogues' in character).toBe(false);
      expect('manifesto' in character).toBe(false);
      // Fields that were produced are kept.
      expect(character.name).toBe('Maya Kapoor');
      expect(character.identity).toBe('A botanist of repute.');
    });

    it('produces a qtap-schema-valid export when a content step failed (regression: Maya Kapoor)', () => {
      const exportData = assembleQtapExport(
        {
          character_basics: { name: 'Maya Kapoor', identity: 'A botanist of repute.' },
          system_prompts: [{ name: 'Main', content: 'You are Maya.', isDefault: true }],
        },
        false,
        false,
        '4.6.0'
      );
      const result = validateQtapExport(exportData);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('emits schema-complete wardrobe items (componentItemIds + replace) so import does not crash', () => {
      // Regression: wardrobe.create reads componentItemIds.length in the vault
      // writer; an assembled item that omitted it threw
      // "Cannot read properties of undefined (reading 'length')" at import time.
      const exportData = assembleQtapExport(
        {
          character_basics: { name: 'Maya Kapoor' },
          wardrobe_items: [{ title: 'Wedding Guest Sari', description: 'A teal silk sari.', types: ['top', 'bottom'] }],
        },
        false,
        false,
        '4.6.0'
      );
      const item = (exportData.data as { characters: Array<{ wardrobeItems: Record<string, unknown>[] }> })
        .characters[0].wardrobeItems[0];
      expect(item.componentItemIds).toEqual([]);
      expect(item.replace).toBe(false);
      expect(item.title).toBe('Wedding Guest Sari');
    });

    it('writes extracted aliases onto the character', () => {
      const exportData = assembleQtapExport(
        {
          character_basics: { name: 'Maya Kapoor' },
          aliases: ['Em', 'The Botanist'],
        },
        false,
        false,
        '4.6.0'
      );
      const character = (exportData.data as { characters: Record<string, unknown>[] }).characters[0];
      expect(character.aliases).toEqual(['Em', 'The Botanist']);
    });

    it('resolves generated composite outfits to componentItemIds and keeps imagePrompt/isDefault/replace', () => {
      const exportData = assembleQtapExport(
        {
          character_basics: { name: 'Maya Kapoor' },
          wardrobe_items: [
            {
              title: 'Everyday Outfit',
              description: 'Her usual ensemble.',
              types: ['top', 'bottom'],
              isDefault: true,
              components: ['Field Blouse', 'Khaki Trousers'],
              replace: true,
            },
            { title: 'Field Blouse', description: 'Linen blouse.', imagePrompt: 'cream linen blouse', types: ['top'] },
            { title: 'Khaki Trousers', description: 'Practical trousers.', types: ['bottom'] },
          ],
        },
        false,
        false,
        '4.6.0'
      );
      const items = (exportData.data as { characters: Array<{ wardrobeItems: Record<string, unknown>[] }> })
        .characters[0].wardrobeItems;
      // Leaf items come before the composite that bundles them.
      expect(items.map((i) => i.title)).toEqual(['Field Blouse', 'Khaki Trousers', 'Everyday Outfit']);
      const byTitle = new Map(items.map((i) => [i.title as string, i]));
      const outfit = byTitle.get('Everyday Outfit')!;
      expect(outfit.componentItemIds).toEqual([
        byTitle.get('Field Blouse')!.id,
        byTitle.get('Khaki Trousers')!.id,
      ]);
      expect(outfit.isDefault).toBe(true);
      expect(outfit.replace).toBe(true);
      expect(byTitle.get('Field Blouse')!.imagePrompt).toBe('cream linen blouse');
      // The whole export still validates.
      const result = validateQtapExport(exportData);
      expect(result.errors).toEqual([]);
    });

    it('stamps id/createdAt/updatedAt on every system prompt', () => {
      const exportData = assembleQtapExport(
        {
          character_basics: { name: 'Maya Kapoor' },
          system_prompts: [{ name: 'Main', content: 'You are Maya.', isDefault: true }],
        },
        false,
        false,
        '4.6.0'
      );
      const sp = (exportData.data as { characters: Array<{ systemPrompts: Record<string, unknown>[] }> })
        .characters[0].systemPrompts[0];
      expect(typeof sp.id).toBe('string');
      expect(typeof sp.createdAt).toBe('string');
      expect(typeof sp.updatedAt).toBe('string');
    });
  });

  describe('restampStructuralFields', () => {
    const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const now = '2026-01-01T00:00:00.000Z';

    it('restores nested ids and timestamps an LLM repair step stripped', () => {
      // Shape a repair model might return — content kept, scaffolding dropped.
      const data = {
        characters: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Maya Kapoor',
            systemPrompts: [{ name: 'Main', content: 'You are Maya.', isDefault: true }],
            scenarios: [{ title: 'Default', content: 'A glasshouse at dawn.' }],
            physicalDescription: { shortPrompt: 'green eyes' },
            wardrobeItems: [{ title: 'Linen apron', types: ['top'] }],
          },
        ],
        memories: [{ content: 'x', summary: 'x', keywords: [], importance: 0.5 }],
      };

      const fixes = restampStructuralFields(data as never, now);
      expect(fixes).toBeGreaterThan(0);

      const character = data.characters[0] as Record<string, any>;
      expect(character.systemPrompts[0].id).toMatch(UUID_LIKE);
      expect(character.systemPrompts[0].createdAt).toBe(now);
      expect(character.systemPrompts[0].updatedAt).toBe(now);
      expect(character.scenarios[0].id).toMatch(UUID_LIKE);
      expect(character.physicalDescription.id).toMatch(UUID_LIKE);
      expect(character.physicalDescription.name).toBe('AI Generated');
      expect(character.wardrobeItems[0].id).toMatch(UUID_LIKE);
      expect(character.wardrobeItems[0].characterId).toBe(character.id);
      expect((data.memories[0] as Record<string, unknown>).id).toMatch(UUID_LIKE);
    });

    it('is a no-op when the scaffolding is already present', () => {
      const data = {
        characters: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Maya Kapoor',
            systemPrompts: [
              {
                id: '22222222-2222-4222-8222-222222222222',
                name: 'Main',
                content: 'You are Maya.',
                isDefault: true,
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
        ],
      };
      expect(restampStructuralFields(data as never, now)).toBe(0);
    });
  });
});
