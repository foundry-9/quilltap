/**
 * The Almanack's markdown renderer.
 *
 * The renderer is a pure function of the report data, which is what makes a
 * whole-document snapshot worth having: it catches a section silently
 * disappearing, a heading drifting, or a table losing a column — the class of
 * regression that produced the old report's mislabelled Pascal section and went
 * unnoticed for months.
 *
 * The targeted assertions below the snapshot pin the things that are load-
 * bearing rather than cosmetic: the caveats. A figure without its caveat is
 * worse than no figure, so those are asserted by name.
 */

import { renderAlmanackMarkdown } from '@/lib/tools/almanack/render'
import { ALMANACK_PHASES, ALMANACK_TITLE } from '@/lib/tools/almanack/phases'
import { makeAlmanackFixture } from '@/__tests__/helpers/almanack/fixture'

// The date stamps below go through `toLocaleString()`, which formats in the
// ambient timezone. The pin that makes this snapshot machine-independent lives
// in jest.config.ts (`process.env.TZ = 'UTC'`) — pinning it from inside this
// file is too late, because ICU has already cached the worker's default zone.

describe('renderAlmanackMarkdown', () => {
  it('renders the whole volume', () => {
    expect(renderAlmanackMarkdown(makeAlmanackFixture())).toMatchSnapshot()
  })

  it('titles the document with the feature name', () => {
    const md = renderAlmanackMarkdown(makeAlmanackFixture())
    expect(md.startsWith(`# ${ALMANACK_TITLE}`)).toBe(true)
  })

  it('emits a top-level section for every phase that produces one', () => {
    const md = renderAlmanackMarkdown(makeAlmanackFixture())
    for (const heading of [
      '## The Premises',
      '## The Machinery',
      '## The Ledgers',
      '## The Scriptorium',
      '## Dramatis Personae',
      '## The Wire Records',
    ]) {
      expect(md).toContain(heading)
    }
    // Six rendered sections plus "Binding the volume", which produces the file
    // rather than a section of its own.
    expect(ALMANACK_PHASES).toHaveLength(7)
  })

  describe('caveats', () => {
    it('states the LLM-logging retention that bounds the wire records', () => {
      const md = renderAlmanackMarkdown(makeAlmanackFixture())
      expect(md).toContain('These figures are drawn from the LLM logs')
      expect(md).toContain('retention window of **30 days**')
      expect(md).toContain('Settings → Chat → LLM Logging')
    })

    it('says "forever" rather than "0 days" when retention is unlimited', () => {
      const md = renderAlmanackMarkdown(
        makeAlmanackFixture({
          wireRecords: {
            ...makeAlmanackFixture().wireRecords,
            retentionDays: 0,
          },
        }),
      )
      expect(md).toContain('retention window of **forever**')
    })

    it('warns that profile attribution is approximate on a pre-4.9 database', () => {
      const exact = renderAlmanackMarkdown(makeAlmanackFixture())
      expect(exact).not.toContain('Attribution is approximate')

      const approximate = renderAlmanackMarkdown(
        makeAlmanackFixture({
          wireRecords: {
            ...makeAlmanackFixture().wireRecords,
            exactProfileAttribution: false,
          },
        }),
      )
      expect(approximate).toContain('**Attribution is approximate.**')
      expect(approximate).toContain('grouped by provider and model')
    })

    it('gives every latency average its measured denominator', () => {
      const md = renderAlmanackMarkdown(makeAlmanackFixture())
      // 23,000 of 24,000 CHAT_MESSAGE requests carried a usable durationMs.
      expect(md).toContain('| 23000/24000 |')
      expect(md).toContain('requests carrying a usable `durationMs`')
    })

    it('warns that Concierge reroutes double-count image generations', () => {
      const md = renderAlmanackMarkdown(makeAlmanackFixture())
      expect(md).toContain('A Concierge reroute logs a second row under the fallback profile')
    })

    it('footnotes the top-ten ranking rules and the shared-bytes caveat', () => {
      const md = renderAlmanackMarkdown(makeAlmanackFixture())
      expect(md).toContain('Ranked by chats, ties broken by memories')
      expect(md).toContain('Participants marked `removed` still count')
      expect(md).toContain('bytes shared between two characters appear in both rows')
    })

    it('flips the removed-participant footnote when the flag is off', () => {
      const base = makeAlmanackFixture()
      const md = renderAlmanackMarkdown(
        makeAlmanackFixture({
          personae: { ...base.personae, countsRemovedParticipants: false },
        }),
      )
      expect(md).toContain('Participants marked `removed` are not counted')
    })

    it('says photographs are counted, never named', () => {
      const md = renderAlmanackMarkdown(makeAlmanackFixture())
      expect(md).toContain('Counts and bytes only — never titles, captions or filenames.')
    })
  })

  describe('problem states', () => {
    it('calls out character vaults missing their keystone', () => {
      const md = renderAlmanackMarkdown(makeAlmanackFixture())
      expect(md).toContain('Missing the keystone**: 1')
      expect(md).toContain('CharacterVaultUnavailableError')
    })

    it('flags a group with no official store', () => {
      const md = renderAlmanackMarkdown(makeAlmanackFixture())
      expect(md).toContain('⚠ missing')
      expect(md).toContain('A group without an official store never had one provisioned')
    })

    it('flags an embedding dimension mismatch', () => {
      const base = makeAlmanackFixture()
      const clean = renderAlmanackMarkdown(base)
      expect(clean).not.toContain('Dimension mismatch')

      const mismatched = renderAlmanackMarkdown(
        makeAlmanackFixture({
          embeddingPipeline: { ...base.embeddingPipeline, dimensionMismatch: true },
        }),
      )
      expect(mismatched).toContain('⚠ Dimension mismatch')
    })

    it('flags theme icon overrides that name nothing', () => {
      const md = renderAlmanackMarkdown(makeAlmanackFixture())
      expect(md).toContain('Overrides naming an unknown icon**: 1')
      expect(md).toContain('take effect on nothing')
    })

    it('reports an unreachable Scriptorium as unreachable rather than as zeroes', () => {
      const base = makeAlmanackFixture()
      const md = renderAlmanackMarkdown(
        makeAlmanackFixture({
          scriptorium: { ...base.scriptorium, available: false },
        }),
      )
      expect(md).toContain('The mount-index database could not be opened')
      expect(md).not.toContain('### Document Stores')
    })
  })

  it('escapes pipes so a stray one cannot shear a table in half', () => {
    const base = makeAlmanackFixture()
    const md = renderAlmanackMarkdown(
      makeAlmanackFixture({
        personae: {
          ...base.personae,
          topCharacters: [
            { name: 'Bertie | Wooster', chats: 1, memories: 0, storageBytes: 0 },
          ],
        },
      }),
    )
    expect(md).toContain('Bertie \\| Wooster')
  })
})
