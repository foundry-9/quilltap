/**
 * Tool input schemas — tolerance for LLM-quoted numbers.
 *
 * Models routinely quote their numbers: `{"limit": "5"}` rather than
 * `{"limit": 5}`. A bare z.number() rejected that outright, so the call failed
 * validation and the character was told their perfectly sensible request was
 * invalid. Every numeric field in every tool input schema is now wrapped in
 * `llmNumber`, which converts numeric-looking strings and nothing else.
 *
 * These tests pin both halves of the bargain, for each touched field:
 *  - the quoted form is accepted and lands as a real number;
 *  - genuine numbers still work;
 *  - nonsense is still refused;
 *  - true/null/[] are REFUSED rather than coerced — the z.coerce.number() trap,
 *    which would quietly turn true into 1 and null/[] into 0, trading a rejected
 *    call for a wrong one;
 *  - bounds still apply after conversion.
 */

import { z } from 'zod'
import { deleteAnnotationToolInputSchema } from '@/lib/tools/delete-annotation-tool'
import { docFocusToolInputSchema } from '@/lib/tools/doc-focus-tool'
import { docGrepToolInputSchema } from '@/lib/tools/doc-grep-tool'
import { docReadFileToolInputSchema } from '@/lib/tools/doc-read-file-tool'
import { docReadHeadingToolInputSchema } from '@/lib/tools/doc-read-heading-tool'
import { docUpdateHeadingToolInputSchema } from '@/lib/tools/doc-update-heading-tool'
import { docWriteFileToolInputSchema } from '@/lib/tools/doc-write-file-tool'
import { helpSearchToolInputSchema } from '@/lib/tools/help-search-tool'
import { imageGenerationToolInputSchema } from '@/lib/tools/image-generation-tool'
import { listImagesToolInputSchema } from '@/lib/tools/list-images-tool'
import { runSqlToolInputSchema } from '@/lib/tools/run-sql-tool'
import { readConversationToolInputSchema } from '@/lib/tools/read-conversation-tool'
import {
  searchScriptoriumToolInputSchema,
  searchScriptoriumBrahmaToolInputSchema,
} from '@/lib/tools/search-scriptorium-tool'
import { submitFinalResponseToolInputSchema } from '@/lib/tools/submit-final-response-tool'
import { terminalReadToolInputSchema } from '@/lib/tools/terminal-read-tool'
import { upsertAnnotationToolInputSchema } from '@/lib/tools/upsert-annotation-tool'
import { webSearchToolInputSchema } from '@/lib/tools/web-search-tool'

interface NumericFieldCase {
  /** Human label: "<tool>.<field>" */
  name: string
  schema: z.ZodType
  field: string
  /** Whatever else the schema requires so the object is otherwise valid. */
  base: Record<string, unknown>
  /** The quoted form a model might send. */
  quoted: string
  /** What it must parse to. */
  expected: number
  /** A quoted value outside the field's declared bounds, where it has any. */
  outOfBounds?: string
}

const cases: NumericFieldCase[] = [
  {
    name: 'delete_annotation.message_index',
    schema: deleteAnnotationToolInputSchema,
    field: 'message_index',
    base: {},
    quoted: '3',
    expected: 3,
    outOfBounds: '-1',
  },
  {
    name: 'doc_focus.line',
    schema: docFocusToolInputSchema,
    field: 'line',
    base: {},
    quoted: '42',
    expected: 42,
  },
  {
    name: 'doc_grep.context_lines',
    schema: docGrepToolInputSchema,
    field: 'context_lines',
    base: { query: 'nimue' },
    quoted: '2',
    expected: 2,
    outOfBounds: '-1',
  },
  {
    name: 'doc_grep.max_results',
    schema: docGrepToolInputSchema,
    field: 'max_results',
    base: { query: 'nimue' },
    quoted: '50',
    expected: 50,
    outOfBounds: '0',
  },
  {
    name: 'doc_read_file.offset',
    schema: docReadFileToolInputSchema,
    field: 'offset',
    base: { path: 'Notes/today.md' },
    quoted: '2',
    expected: 2,
    outOfBounds: '0',
  },
  {
    name: 'doc_read_file.limit',
    schema: docReadFileToolInputSchema,
    field: 'limit',
    base: { path: 'Notes/today.md' },
    quoted: '10',
    expected: 10,
    outOfBounds: '0',
  },
  {
    name: 'doc_read_heading.level',
    schema: docReadHeadingToolInputSchema,
    field: 'level',
    base: { path: 'Notes/today.md', heading: 'Backstory' },
    quoted: '3',
    expected: 3,
    outOfBounds: '7',
  },
  {
    name: 'doc_update_heading.level',
    schema: docUpdateHeadingToolInputSchema,
    field: 'level',
    base: { path: 'Notes/today.md', heading: 'Backstory', content: 'New text' },
    quoted: '3',
    expected: 3,
    outOfBounds: '0',
  },
  {
    name: 'doc_write_file.expected_mtime',
    schema: docWriteFileToolInputSchema,
    field: 'expected_mtime',
    base: { path: 'Notes/today.md', content: 'New text' },
    quoted: '1700000000000',
    expected: 1700000000000,
  },
  {
    name: 'help_search.limit',
    schema: helpSearchToolInputSchema,
    field: 'limit',
    base: { query: 'embedding profiles' },
    quoted: '5',
    expected: 5,
    outOfBounds: '11',
  },
  {
    name: 'generate_image.count',
    schema: imageGenerationToolInputSchema,
    field: 'count',
    base: { prompt: '{{me}} in a garden' },
    quoted: '3',
    expected: 3,
    outOfBounds: '11',
  },
  {
    name: 'list_images.limit',
    schema: listImagesToolInputSchema,
    field: 'limit',
    base: {},
    quoted: '5',
    expected: 5,
  },
  {
    name: 'list_images.offset',
    schema: listImagesToolInputSchema,
    field: 'offset',
    base: {},
    quoted: '10',
    expected: 10,
  },
  {
    name: 'search.minImportance',
    schema: searchScriptoriumToolInputSchema,
    field: 'minImportance',
    base: { query: 'their birthday' },
    // A float — llmNumber is not integer-only, and minImportance never was.
    quoted: '0.5',
    expected: 0.5,
    outOfBounds: '2',
  },
  {
    name: 'read_conversation.interchange_start',
    schema: readConversationToolInputSchema,
    field: 'interchange_start',
    base: {},
    quoted: '3',
    expected: 3,
  },
  {
    name: 'run_sql.max_rows',
    schema: runSqlToolInputSchema,
    field: 'max_rows',
    base: { sql: 'SELECT 1' },
    quoted: '50',
    expected: 50,
    outOfBounds: '1001',
  },
  {
    name: 'search_scriptorium.limit',
    schema: searchScriptoriumToolInputSchema,
    field: 'limit',
    base: { query: 'the duel' },
    quoted: '5',
    expected: 5,
    outOfBounds: '21',
  },
  {
    name: 'search_scriptorium.minImportance',
    schema: searchScriptoriumToolInputSchema,
    field: 'minImportance',
    base: { query: 'the duel' },
    quoted: '0.5',
    expected: 0.5,
    outOfBounds: '2',
  },
  {
    name: 'search_scriptorium_brahma.limit',
    schema: searchScriptoriumBrahmaToolInputSchema,
    field: 'limit',
    base: { query: 'the duel' },
    quoted: '5',
    expected: 5,
    outOfBounds: '21',
  },
  {
    name: 'submit_final_response.confidence',
    schema: submitFinalResponseToolInputSchema,
    field: 'confidence',
    base: { response: 'The answer.' },
    // A float, 0-1 — no .int() here, so "0.75" must survive intact.
    quoted: '0.75',
    expected: 0.75,
    outOfBounds: '1.5',
  },
  {
    name: 'terminal_read.lines',
    schema: terminalReadToolInputSchema,
    field: 'lines',
    base: { sessionId: 'd3b1f0e2-0000-4000-8000-000000000000' },
    quoted: '500',
    expected: 500,
    outOfBounds: '2001',
  },
  {
    name: 'terminal_read.start',
    schema: terminalReadToolInputSchema,
    field: 'start',
    base: { sessionId: 'd3b1f0e2-0000-4000-8000-000000000000' },
    // Negative values are meaningful here ("50 lines before the last").
    quoted: '-50',
    expected: -50,
  },
  {
    name: 'terminal_read.end',
    schema: terminalReadToolInputSchema,
    field: 'end',
    base: { sessionId: 'd3b1f0e2-0000-4000-8000-000000000000' },
    quoted: '-1',
    expected: -1,
  },
  {
    name: 'upsert_annotation.message_index',
    schema: upsertAnnotationToolInputSchema,
    field: 'message_index',
    base: { content: 'She flinched.' },
    quoted: '3',
    expected: 3,
    outOfBounds: '-1',
  },
  {
    name: 'web_search.maxResults',
    schema: webSearchToolInputSchema,
    field: 'maxResults',
    base: { query: 'latest news about AI' },
    quoted: '5',
    expected: 5,
    outOfBounds: '11',
  },
]

describe.each(cases)('$name', ({ schema, field, base, quoted, expected, outOfBounds }) => {
  const parse = (value: unknown) => schema.safeParse({ ...base, [field]: value })

  it('accepts the quoted number and converts it', () => {
    const result = parse(quoted)
    expect(result.success).toBe(true)
    expect((result.data as Record<string, unknown>)[field]).toBe(expected)
  })

  it('still accepts a genuine number', () => {
    const result = parse(expected)
    expect(result.success).toBe(true)
    expect((result.data as Record<string, unknown>)[field]).toBe(expected)
  })

  it('rejects a non-numeric string', () => {
    expect(parse('nonsense').success).toBe(false)
  })

  it('rejects an empty string rather than reading it as zero', () => {
    expect(parse('').success).toBe(false)
  })

  it.each([
    ['true', true],
    ['null', null],
    ['an array', []],
  ])('rejects %s rather than coercing it', (_label, value) => {
    // z.coerce.number() would turn true into 1 and null/[] into 0 — a wrong
    // number is worse than a refused call. Only strings are converted.
    expect(parse(value).success).toBe(false)
  })

  if (outOfBounds !== undefined) {
    it('still enforces bounds after conversion', () => {
      expect(parse(outOfBounds).success).toBe(false)
    })
  }
})

describe('the LLM-facing contract is unchanged', () => {
  it('still declares integer types, bounds, and defaults to the model', () => {
    // The leniency is runtime-only. The published JSON Schema must keep asking
    // for a properly-typed integer — a model that listens is never penalised.
    const params = z.toJSONSchema(webSearchToolInputSchema, { target: 'draft-7' }) as {
      properties: Record<string, Record<string, unknown>>
    }
    expect(params.properties.maxResults.type).toBe('integer')
    expect(params.properties.maxResults.minimum).toBe(1)
    expect(params.properties.maxResults.maximum).toBe(10)
    expect(params.properties.maxResults.default).toBe(5)
    expect(params.properties.maxResults.description).toBe(
      'Maximum number of search results to retrieve. Default is 5.'
    )
  })
})
