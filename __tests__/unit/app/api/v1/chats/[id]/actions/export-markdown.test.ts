/**
 * Tests for the Markdown transcript export action
 * (GET /api/v1/chats/[id]?action=export-markdown).
 *
 * The transcript builder itself is mocked — this covers the route's own work:
 * gathering every character id the transcript may need a name for (participants,
 * custom announcers, Carina answerers, minus the Brahma sentinel), threading the
 * user's timestamp settings through, and shaping the download response.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('@/lib/export/markdown-transcript', () => ({
  buildMarkdownTranscript: jest.fn(() => '# Transcript\n'),
  transcriptFilename: jest.fn(() => 'A Night Out_transcript.md'),
}));

import { handleExportMarkdown } from '@/app/api/v1/chats/[id]/actions/export-markdown';
import { buildMarkdownTranscript, transcriptFilename } from '@/lib/export/markdown-transcript';
import { BRAHMA_CARINA_ANSWERER_ID } from '@/lib/services/carina/brahma-answerer';

const buildTranscript = buildMarkdownTranscript as jest.MockedFunction<typeof buildMarkdownTranscript>;
const filename = transcriptFilename as jest.MockedFunction<typeof transcriptFilename>;

type Ctx = {
  ctx: never;
  findByIds: jest.Mock;
  getMessages: jest.Mock;
};

function makeCtx(options: {
  chat?: Record<string, unknown> | null;
  events?: Array<Record<string, unknown>>;
  characters?: Array<{ id: string; name: string }>;
  chatSettings?: Record<string, unknown> | null;
  user?: { id: string; name?: string | null };
} = {}): Ctx {
  const {
    chat = { id: 'chat-1', title: 'A Night Out', participants: [] },
    events = [],
    characters = [],
    chatSettings = null,
    user = { id: 'user-1', name: 'Bertie' },
  } = options;

  const getMessages = jest.fn(async () => events);
  const findByIds = jest.fn(async () => characters);

  const ctx = {
    user,
    repos: {
      chats: { findById: jest.fn(async () => chat), getMessages },
      characters: { findByIds },
      chatSettings: { findByUserId: jest.fn(async () => chatSettings) },
    },
  } as never;

  return { ctx, findByIds, getMessages };
}

/** The set of ids the route asked to resolve, order-independent. */
function requestedIds(findByIds: jest.Mock): string[] {
  return [...(findByIds.mock.calls[0][0] as string[])].sort();
}

beforeEach(() => {
  jest.clearAllMocks();
  buildTranscript.mockReturnValue('# Transcript\n');
  filename.mockReturnValue('A Night Out_transcript.md');
});

describe('handleExportMarkdown', () => {
  it('404s when the chat is missing', async () => {
    const { ctx } = makeCtx({ chat: null });

    const res = await handleExportMarkdown('chat-1', ctx);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Chat not found' });
    expect(buildTranscript).not.toHaveBeenCalled();
  });

  it('serves the rendered Markdown as a download', async () => {
    const { ctx } = makeCtx();

    const res = await handleExportMarkdown('chat-1', ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBe(
      'attachment; filename="A Night Out_transcript.md"'
    );
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    // Non-JSON NextResponse bodies are readable directly under the test runtime.
    expect(res.body).toBe('# Transcript\n');
  });

  it('RFC 5987-encodes a non-ASCII transcript filename', async () => {
    filename.mockReturnValue('Café_transcript.md');
    const { ctx } = makeCtx();

    const res = await handleExportMarkdown('chat-1', ctx);

    expect(res.headers.get('Content-Disposition')).toBe(
      "attachment; filename=\"Caf__transcript.md\"; filename*=UTF-8''Caf%C3%A9_transcript.md"
    );
  });

  it('collects character ids from participants, announcers, and Carina answerers', async () => {
    const { ctx, findByIds } = makeCtx({
      chat: {
        id: 'chat-1',
        title: 'A Night Out',
        participants: [
          { characterId: 'char-a' },
          { characterId: 'char-b' },
          { characterId: null }, // the human operator's seat
        ],
      },
      events: [
        { type: 'message', customAnnouncer: { characterId: 'char-c' } },
        { type: 'message', carinaMeta: { answererId: 'char-d' } },
      ],
    });

    await handleExportMarkdown('chat-1', ctx);

    expect(requestedIds(findByIds)).toEqual(['char-a', 'char-b', 'char-c', 'char-d']);
  });

  it('excludes the Brahma sentinel, which is not a real character', async () => {
    const { ctx, findByIds } = makeCtx({
      chat: { id: 'chat-1', title: 't', participants: [{ characterId: 'char-a' }] },
      events: [
        { type: 'message', carinaMeta: { answererId: BRAHMA_CARINA_ANSWERER_ID } },
        { type: 'message', carinaMeta: { answererId: 'char-e' } },
      ],
    });

    await handleExportMarkdown('chat-1', ctx);

    expect(requestedIds(findByIds)).toEqual(['char-a', 'char-e']);
  });

  it('de-duplicates ids and ignores non-message events', async () => {
    const { ctx, findByIds } = makeCtx({
      chat: { id: 'chat-1', title: 't', participants: [{ characterId: 'char-a' }] },
      events: [
        { type: 'message', customAnnouncer: { characterId: 'char-a' } },
        { type: 'summary', customAnnouncer: { characterId: 'char-z' } },
        { type: 'divider', carinaMeta: { answererId: 'char-y' } },
      ],
    });

    await handleExportMarkdown('chat-1', ctx);

    expect(requestedIds(findByIds)).toEqual(['char-a']);
  });

  it('builds a name map from the characters that resolved', async () => {
    const { ctx } = makeCtx({
      chat: {
        id: 'chat-1',
        title: 't',
        participants: [{ characterId: 'char-a' }, { characterId: 'char-broken' }],
      },
      // char-broken is dropped by findByIds (broken vault) and simply has no name.
      characters: [{ id: 'char-a', name: 'Madeline' }],
    });

    await handleExportMarkdown('chat-1', ctx);

    const args = buildTranscript.mock.calls[0][0];
    expect(args.characterNamesById.get('char-a')).toBe('Madeline');
    expect(args.characterNamesById.has('char-broken')).toBe(false);
  });

  it('threads the user name and chat-settings timestamp config into the builder', async () => {
    const { ctx } = makeCtx({
      user: { id: 'user-1', name: 'Bertie' },
      chatSettings: { defaultTimestampConfig: { mode: 'relative' }, timezone: 'Europe/London' },
    });

    await handleExportMarkdown('chat-1', ctx);

    expect(buildTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        userName: 'Bertie',
        defaultTimestampConfig: { mode: 'relative' },
        chatSettingsTimezone: 'Europe/London',
      })
    );
  });

  it('falls back to "User" and null timestamp settings when neither is set', async () => {
    const { ctx } = makeCtx({ user: { id: 'user-1', name: null }, chatSettings: null });

    await handleExportMarkdown('chat-1', ctx);

    expect(buildTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        userName: 'User',
        defaultTimestampConfig: null,
        chatSettingsTimezone: null,
      })
    );
  });

  it('500s when the transcript build throws', async () => {
    buildTranscript.mockImplementation(() => {
      throw new Error('template blew up');
    });
    const { ctx } = makeCtx();

    const res = await handleExportMarkdown('chat-1', ctx);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'Failed to export chat as Markdown',
    });
  });

  it('500s when something throws a non-Error', async () => {
    buildTranscript.mockImplementation(() => {
      throw 'template blew up';
    });
    const { ctx } = makeCtx();

    const res = await handleExportMarkdown('chat-1', ctx);

    expect(res.status).toBe(500);
  });
});
