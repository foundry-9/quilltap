/**
 * Markdown transcript export — pure-function tests.
 *
 * The builder must be deterministic: same chat state, byte-identical output.
 * Every fixture pins an explicit timezone so assertions don't depend on the
 * machine running the suite.
 */

import { buildMarkdownTranscript, transcriptFilename, type MarkdownTranscriptInput } from '@/lib/export/markdown-transcript';
import { BRAHMA_CARINA_ANSWERER_ID } from '@/lib/services/carina/brahma-answerer';
import type { ChatMetadata, ChatEvent, MessageEvent } from '@/lib/schemas/chat.types';
import type { TimestampConfig } from '@/lib/schemas/types';

const CHAR_ID = 'c1000000-0000-4000-8000-000000000001';
const USER_CHAR_ID = 'c2000000-0000-4000-8000-000000000002';
const OFFSCENE_ID = 'c3000000-0000-4000-8000-000000000003';
const PARTICIPANT_ID = 'a1000000-0000-4000-8000-000000000001';
const USER_PARTICIPANT_ID = 'a2000000-0000-4000-8000-000000000002';

function makeConfig(overrides: Partial<TimestampConfig> = {}): TimestampConfig {
  return {
    mode: 'NONE',
    format: 'FRIENDLY',
    useFictionalTime: false,
    autoPrepend: true,
    intervalMinutes: 15,
    timezone: 'UTC',
    ...overrides,
  } as TimestampConfig;
}

function makeChat(overrides: Partial<ChatMetadata> = {}): ChatMetadata {
  return {
    id: 'b1000000-0000-4000-8000-000000000001',
    title: 'The Test Salon',
    createdAt: '2026-01-01T00:00:00.000Z',
    scenarioText: null,
    timestampConfig: makeConfig(),
    participants: [
      { id: PARTICIPANT_ID, type: 'CHARACTER', characterId: CHAR_ID, controlledBy: 'llm' },
      { id: USER_PARTICIPANT_ID, type: 'CHARACTER', characterId: USER_CHAR_ID, controlledBy: 'user' },
    ],
    ...overrides,
  } as unknown as ChatMetadata;
}

let messageCounter = 0;
function makeMessage(overrides: Partial<MessageEvent> = {}): MessageEvent {
  messageCounter += 1;
  return {
    type: 'message',
    id: `d${String(messageCounter).padStart(7, '0')}-0000-4000-8000-000000000001`,
    role: 'ASSISTANT',
    content: 'Hello there.',
    createdAt: '2026-01-01T12:00:00.000Z',
    participantId: PARTICIPANT_ID,
    ...overrides,
  } as unknown as MessageEvent;
}

function build(events: ChatEvent[], overrides: Partial<MarkdownTranscriptInput> = {}): string {
  return buildMarkdownTranscript({
    chat: makeChat(),
    events,
    characterNamesById: new Map([
      [CHAR_ID, 'Aria'],
      [USER_CHAR_ID, 'Charlie'],
      [OFFSCENE_ID, 'The Stranger'],
    ]),
    userName: 'Charlie',
    ...overrides,
  });
}

describe('buildMarkdownTranscript', () => {
  it('renders title, scenario, and speaker headings with timestamps', () => {
    const md = build(
      [
        makeMessage({ role: 'USER', participantId: USER_PARTICIPANT_ID, content: 'Good evening.' }),
        makeMessage({ content: 'And to you.', createdAt: '2026-01-01T12:05:00.000Z' }),
      ],
      { chat: makeChat({ scenarioText: '{{char}} waits for {{user}} on a rainy night at the observatory.' }) }
    );

    expect(md).toMatch(/^# The Test Salon\n/);
    expect(md).toContain('## Scenario\n\nAria waits for Charlie on a rainy night at the observatory.');
    expect(md).toMatch(/^## Charlie — January 1, 2026(,| at) 12:00 PM$/m);
    expect(md).toMatch(/^## Aria — January 1, 2026(,| at) 12:05 PM$/m);
    expect(md).toContain('Good evening.');
    expect(md).toContain('And to you.');
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('is deterministic', () => {
    const events = [
      makeMessage({ role: 'USER', participantId: USER_PARTICIPANT_ID }),
      makeMessage({ createdAt: '2026-01-01T12:30:00.000Z' }),
    ];
    expect(build(events)).toBe(build(events));
  });

  it('excludes SYSTEM/TOOL roles and Staff housekeeping, includes the requested announcements', () => {
    const md = build([
      makeMessage({ role: 'SYSTEM', content: 'raw system prompt text' }),
      makeMessage({ role: 'TOOL', content: 'tool result payload' }),
      makeMessage({ systemSender: 'lantern', participantId: null, content: 'The Lantern flickers with a new image.' }),
      makeMessage({ systemSender: 'commonplaceBook', participantId: null, content: 'A memory resurfaces.' }),
      makeMessage({ systemSender: 'host', systemKind: 'timestamp', participantId: null, content: 'The Host marks the time as noon.' }),
      makeMessage({ systemSender: 'pascal', systemKind: 'custom-tool-result', participantId: null, content: 'Pascal rolls the dice: 17.' }),
      makeMessage({ systemSender: 'host', systemKind: 'continuation-from', participantId: null, content: 'This conversation continues from [Older Chat](/salon/x).' }),
      makeMessage({ systemSender: 'aurora', systemKind: 'announcement', participantId: null, content: 'Dinner is served.' }),
    ]);

    expect(md).not.toContain('raw system prompt text');
    expect(md).not.toContain('tool result payload');
    expect(md).not.toContain('The Lantern flickers');
    expect(md).not.toContain('A memory resurfaces.');
    expect(md).not.toContain('marks the time');
    expect(md).toContain('## Pascal — ');
    expect(md).toContain('Pascal rolls the dice: 17.');
    expect(md).toContain('## The Host — ');
    expect(md).toContain('continues from [Older Chat](/salon/x)');
    expect(md).toContain('## Aurora — ');
    expect(md).toContain('Dinner is served.');
  });

  it('attributes Carina answers to the answerer, and Brahma via the sentinel', () => {
    const md = build([
      makeMessage({
        systemSender: 'carina',
        systemKind: 'carina-response',
        participantId: null,
        carinaMeta: { answererId: CHAR_ID, question: 'What year is it?' },
        content: 'It is 1926.',
      }),
      makeMessage({
        systemSender: 'carina',
        systemKind: 'carina-response',
        participantId: null,
        carinaMeta: { answererId: BRAHMA_CARINA_ANSWERER_ID, question: 'How many chats?' },
        content: 'There are 42 chats.',
      }),
    ]);

    expect(md).toContain('## Aria — ');
    expect(md).toContain('It is 1926.');
    expect(md).toContain('## Brahma — ');
    expect(md).toContain('There are 42 chats.');
  });

  it('names user announcements from customAnnouncer', () => {
    const md = build([
      makeMessage({
        participantId: null,
        systemKind: 'announcement',
        customAnnouncer: { kind: 'custom', displayName: 'The Narrator' },
        content: 'Night falls.',
      }),
      makeMessage({
        participantId: null,
        systemKind: 'announcement',
        customAnnouncer: { kind: 'character', characterId: OFFSCENE_ID },
        content: 'A knock at the door.',
      }),
    ]);

    expect(md).toContain('## The Narrator — ');
    expect(md).toContain('## The Stranger — ');
  });

  it('marks whispers', () => {
    const md = build([
      makeMessage({ targetParticipantIds: [USER_PARTICIPANT_ID], content: 'Between us only.' }),
    ]);
    expect(md).toContain('## Aria (whisper) — ');
  });

  it('collapses swipe groups to the highest swipeIndex at the group position', () => {
    const md = build([
      makeMessage({ role: 'USER', participantId: USER_PARTICIPANT_ID, content: 'Tell me a story.', createdAt: '2026-01-01T12:00:00.000Z' }),
      makeMessage({ swipeGroupId: 'g1', swipeIndex: 0, content: 'First draft.', createdAt: '2026-01-01T12:01:00.000Z' }),
      makeMessage({ swipeGroupId: 'g1', swipeIndex: 1, content: 'Second draft.', createdAt: '2026-01-01T12:02:00.000Z' }),
      makeMessage({ role: 'USER', participantId: USER_PARTICIPANT_ID, content: 'Go on.', createdAt: '2026-01-01T12:03:00.000Z' }),
    ]);

    expect(md).not.toContain('First draft.');
    expect(md).toContain('Second draft.');
    expect(md.indexOf('Second draft.')).toBeLessThan(md.indexOf('Go on.'));
  });

  it('renders the fictional clock offset from the real anchor', () => {
    const chat = makeChat({
      timestampConfig: makeConfig({
        useFictionalTime: true,
        fictionalBaseTimestamp: '1920-05-01T20:00',
        fictionalBaseRealTime: '2026-01-01T00:00:00.000Z',
      }),
    });
    const md = build(
      [makeMessage({ createdAt: '2026-01-01T00:45:00.000Z', content: 'The clock strikes.' })],
      { chat }
    );

    expect(md).toMatch(/^## Aria — May 1, 1920(,| at) 8:45 PM$/m);
  });

  it('anchors a fictional clock without fictionalBaseRealTime at chat creation', () => {
    const chat = makeChat({
      createdAt: '2026-01-01T00:00:00.000Z',
      timestampConfig: makeConfig({
        useFictionalTime: true,
        fictionalBaseTimestamp: '1920-05-01T20:00',
        fictionalBaseRealTime: null,
      }),
    });
    const md = build(
      [makeMessage({ createdAt: '2026-01-01T01:30:00.000Z', content: 'Later that night.' })],
      { chat }
    );

    expect(md).toMatch(/^## Aria — May 1, 1920(,| at) 9:30 PM$/m);
  });

  it('promotes DATE_ONLY and TIME_ONLY formats to a full timestamp', () => {
    const chat = makeChat({ timestampConfig: makeConfig({ format: 'TIME_ONLY' }) });
    const md = build([makeMessage({ createdAt: '2026-01-01T12:00:00.000Z' })], { chat });
    expect(md).toMatch(/^## Aria — January 1, 2026(,| at) 12:00 PM$/m);
  });

  it('falls back to Salon defaults, then to real time, when the chat has no clock', () => {
    const chat = makeChat({ timestampConfig: null });
    const md = build([makeMessage({ createdAt: '2026-01-01T12:00:00.000Z' })], {
      chat,
      defaultTimestampConfig: makeConfig({ format: 'ISO8601' }),
    });
    expect(md).toContain('## Aria — 2026-01-01T12:00:00+00:00');
  });
});

describe('transcriptFilename', () => {
  it('names the file after the chat title', () => {
    expect(transcriptFilename(makeChat())).toBe('The Test Salon_transcript.md');
  });

  it('sanitizes filesystem-hostile characters', () => {
    expect(transcriptFilename(makeChat({ title: 'What: a "chat"?/Really' }))).toBe(
      'What_ a _chat___Really_transcript.md'
    );
  });
});
