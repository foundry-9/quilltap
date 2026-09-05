/**
 * Characters API v1 - GET Handler
 *
 * GET /api/v1/characters/[id] - Get a specific character
 * GET /api/v1/characters/[id]?action=export - Export character (JSON or PNG)
 * GET /api/v1/characters/[id]?action=chats - List recent chats with this character
 * GET /api/v1/characters/[id]?action=cascade-preview - Get cascade delete preview
 * GET /api/v1/characters/[id]?action=default-partner - Get default partner
 * GET /api/v1/characters/[id]?action=get-tags - Get character tags
 */

import { NextRequest, NextResponse } from 'next/server';
import { exists, enrichWithDefaultImage, getFilePath, resolveEditorTags } from '@/lib/api/middleware';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { getCascadeDeletePreview } from '@/lib/cascade-delete';
import { exportSTCharacter, createSTCharacterPNG } from '@/lib/sillytavern/character';
import { readCharacterAvatarBuffer } from '@/lib/photos/resolve-character-avatar';
import { isPhotosRelativePath } from '@/lib/photos/photos-paths';
import { SINGLE_FILE_OVERLAY_PATHS } from '@/lib/database/repositories/vault-overlay/schema';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import type { RequestContext } from '@/lib/api/middleware';
import { readStoreFile, DEPICTION_GUIDELINES_FILENAME } from '@/lib/image-gen/aesthetic';
import { chatActivityAt, byChatActivityDesc } from '@/lib/chat/chat-activity';
import { getConciergeState } from '@/lib/services/dangerous-content/chat-override';

const CHARACTER_GET_ACTIONS = ['export', 'chats', 'cascade-preview', 'default-partner', 'get-tags', 'stats', 'depiction-guidelines'] as const;
type CharacterGetAction = typeof CHARACTER_GET_ACTIONS[number];

export async function handleGet(
  req: NextRequest,
  ctx: RequestContext,
  id: string
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const action = getActionParam(req);

  // First verify ownership for all actions
  const character = await repos.characters.findById(id);
  if (!exists(character)) {
    return notFound('Character');
  }

  if (!action || !isValidAction(action, CHARACTER_GET_ACTIONS)) {
    try {
      const defaultImage = await enrichWithDefaultImage(character.defaultImageId, repos);
      const chats = await repos.chats.findByCharacterId(id);

      const enrichedCharacter = {
        ...character,
        defaultImage,
        _count: {
          chats: chats.length,
        },
      };

      return NextResponse.json({ character: enrichedCharacter });
    } catch (error) {
      logger.error('[Characters v1] Error fetching character', { characterId: id }, error instanceof Error ? error : undefined);
      return serverError('Failed to fetch character');
    }
  }

  const actionHandlers: Record<CharacterGetAction, () => Promise<NextResponse>> = {
    export: async () => {
      try {
        // A tombstone export would be a pruned shell, and the full bundle
        // already sits in the library as an ARCHIVE file (spec §4.1).
        if (character.archivedAt) {
          return badRequest('This character is archived; rehydrate them to export, or use their archive bundle.');
        }

        const { searchParams } = req.nextUrl;
        const format = searchParams.get('format') || 'json';

        if (format === 'png') {
          let avatarBuffer: Buffer | undefined;
          if (character.defaultImageId) {
            const bytes = await readCharacterAvatarBuffer(character.defaultImageId, repos);
            if (bytes) {
              avatarBuffer = bytes;
            } else {
              logger.warn('[Characters v1] Could not read avatar for PNG export, using placeholder', {
                characterId: id,
                imageId: character.defaultImageId,
              });
            }
          }

          const pngBuffer = await createSTCharacterPNG(character, avatarBuffer);

          return new NextResponse(new Uint8Array(pngBuffer), {
            headers: {
              'Content-Type': 'image/png',
              'Content-Disposition': `attachment; filename="${character.name}.png"`,
            },
          });
        }

        const stCharacter = exportSTCharacter(character);
        return new NextResponse(JSON.stringify(stCharacter, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${character.name}.json"`,
          },
        });
      } catch (error) {
        logger.error('[Characters v1] Error exporting character', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to export character');
      }
    },

    chats: async () => {
      try {
        const { searchParams } = req.nextUrl;
        const search = searchParams.get('search')?.toLowerCase() || '';
        const limit = parseInt(searchParams.get('limit') || '10', 10);
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        const allChats = await repos.chats.findByCharacterId(id);
        const userChats = allChats.filter((chat) => chat.userId === user.id);

        // Activity is the stored `lastMessageAt` — when a character last posted
        // — not "the newest row of any kind". This used to re-derive it from
        // `msg.type === 'message'`, which counted every Staff announcement and
        // floated dead conversations to the top. See `lib/chat/chat-activity.ts`.
        const chatsWithMessages = await Promise.all(
          userChats.map(async (chat) => {
            const allMessages = await repos.chats.getMessages(chat.id);
            return { chat, messages: allMessages, lastMessageAt: chatActivityAt(chat) };
          })
        );

        chatsWithMessages.sort((a, b) => byChatActivityDesc(a.chat, b.chat));

        let filteredChats = chatsWithMessages;
        if (search) {
          filteredChats = chatsWithMessages.filter(({ chat, messages }) => {
            if (chat.title?.toLowerCase().includes(search)) {
              return true;
            }
            return messages.some(msg => msg.type === 'message' && msg.content.toLowerCase().includes(search));
          });
        }

        const paginatedChats = filteredChats.slice(offset, offset + limit);

        const projectIds = new Set<string>();
        for (const { chat } of paginatedChats) {
          if (chat.projectId) {
            projectIds.add(chat.projectId);
          }
        }

        const projectMap = new Map<string, { id: string; name: string }>();
        for (const projectId of projectIds) {
          const project = await repos.projects.findById(projectId);
          if (project) {
            projectMap.set(projectId, { id: project.id, name: project.name });
          }
        }

        const enrichedChats = await Promise.all(
          paginatedChats.map(async ({ chat, messages, lastMessageAt }) => {
            const tagData = await Promise.all(
              (chat.tags || []).map(async (tagId) => {
                const tag = await repos.tags.findById(tagId);
                return tag ? { tag: { id: tag.id, name: tag.name } } : null;
              })
            );

            const messageCount = messages.filter((msg) => msg.type === 'message' && msg.role !== 'SYSTEM' && msg.role !== 'TOOL').length;
            const memoryCount = await repos.memories.countByChatId(chat.id);

            // Scriptorium status: check rendered markdown and embedded chunks
            const hasRenderedMarkdown = !!chat.renderedMarkdown;
            let embeddedChunkCount = 0;
            let totalChunkCount = 0;
            if (hasRenderedMarkdown) {
              const chunks = await repos.conversationChunks.findByChatId(chat.id);
              totalChunkCount = chunks.length;
              embeddedChunkCount = chunks.filter(c => c.embedding !== null && c.embedding !== undefined).length;
            }

            const recentMessages = messages
              .filter((msg) => msg.type === 'message')
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .slice(0, 3)
              .map((msg) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                createdAt: msg.createdAt,
              }));

            const project = chat.projectId ? projectMap.get(chat.projectId) || null : null;

            let storyBackground = null;
            if (chat.storyBackgroundImageId) {
              const bgFile = await repos.files.findById(chat.storyBackgroundImageId);
              if (bgFile) {
                storyBackground = {
                  id: bgFile.id,
                  filepath: getFilePath(bgFile),
                };
              }
            }

            return {
              id: chat.id,
              title: chat.title,
              createdAt: chat.createdAt,
              updatedAt: chat.updatedAt,
              lastMessageAt,
              character: {
                id: character.id,
                name: character.name,
              },
              project,
              storyBackground,
              messages: recentMessages,
              tags: tagData.filter((tag): tag is { tag: { id: string; name: string } } => tag !== null),
              conciergeState: getConciergeState(chat),
              dangerCategories: chat.dangerCategories ?? [],
              _count: {
                messages: messageCount,
                memories: memoryCount,
              },
              scriptoriumStatus: hasRenderedMarkdown
                ? (embeddedChunkCount >= totalChunkCount && totalChunkCount > 0 ? 'embedded' : 'rendered')
                : 'none',
            };
          })
        );

        return NextResponse.json({ chats: enrichedChats, total: filteredChats.length });
      } catch (error) {
        logger.error('[Characters v1] Error fetching character chats', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to fetch chats');
      }
    },

    'cascade-preview': async () => {
      try {
        const preview = await getCascadeDeletePreview(id);

        if (!preview) {
          return serverError('Failed to generate preview');
        }

        return NextResponse.json({
          characterId: preview.characterId,
          characterName: preview.characterName,
          exclusiveChats: preview.exclusiveChats.map(c => ({
            id: c.chat.id,
            title: c.chat.title,
            messageCount: c.messageCount,
            lastMessageAt: c.chat.lastMessageAt,
          })),
          exclusiveCharacterImageCount: preview.exclusiveCharacterImages.length,
          exclusiveChatImageCount: preview.exclusiveChatImages.length,
          totalExclusiveImageCount:
            preview.exclusiveCharacterImages.length + preview.exclusiveChatImages.length,
          memoryCount: preview.memoryCount,
        });
      } catch (error) {
        logger.error('[Characters v1] Error generating cascade delete preview', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to generate preview');
      }
    },

    'default-partner': async () => {
      try {
        return NextResponse.json({
          partnerId: character.defaultPartnerId || null,
        });
      } catch (error) {
        logger.error('[Characters v1] Error fetching default partner', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to fetch default partner');
      }
    },

    'get-tags': async () => {
      try {
        // Shared with the connection-profile route so the two answers TagEditor
        // consumes cannot drift apart again (Bug 74).
        const validTags = await resolveEditorTags(character.tags, repos);
        return NextResponse.json({ tags: validTags });
      } catch (error) {
        logger.error('[Characters v1] Error fetching character tags', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to fetch character tags');
      }
    },

    stats: async () => {
      try {
        const mountPointId = character.characterDocumentMountPointId || null;

        // Fan out the independent counts. The vault file links are fetched once
        // and reused for photos, knowledge, and core so we don't re-query the
        // mount-index three times for the same mount point.
        const [memoryCount, chats, wardrobeItems, fileLinks, memberships] = await Promise.all([
          repos.memories.countByCharacterId(id),
          repos.chats.findByCharacterId(id),
          repos.wardrobe.findByCharacterId(id),
          mountPointId ? repos.docMountFileLinks.findByMountPointId(mountPointId) : Promise.resolve([]),
          repos.groupCharacterMembers.findByCharacterId(id),
        ]);

        // Photos mirrors the Photo Gallery tab's predicate (Phase-3 `photos/`
        // plus the legacy `images/avatar.webp` + `images/history/` portraits).
        // Knowledge = files under the `Knowledge/` folder; Core = files under
        // the `Core/` packet folder (the periodically re-offered core whisper).
        // All three count link rows.
        const presentPaths = new Set<string>();
        let photos = 0;
        let knowledge = 0;
        let core = 0;
        for (const link of fileLinks) {
          const rel = link.relativePath.toLowerCase();
          presentPaths.add(rel);
          if (isPhotosRelativePath(link.relativePath) || rel === 'images/avatar.webp' || rel.startsWith('images/history/')) {
            photos++;
          }
          if (rel.startsWith('knowledge/')) knowledge++;
          if (rel.startsWith('core/')) core++;
        }

        // Character Files = how many of the canonical managed vault files are
        // present (the `N/8` health figure). Counted per distinct canonical
        // path so historic case-variant duplicate rows (`Manifesto.md` +
        // `manifesto.md`) can't push the figure past the canonical set size.
        let characterFiles = 0;
        for (const corePath of SINGLE_FILE_OVERLAY_PATHS) {
          if (presentPaths.has(corePath.toLowerCase())) characterFiles++;
        }

        // Hydrate the character's groups (membership lives in the mount-index;
        // color/icon come from each group's document store via findByIds).
        const groupIds = [...new Set(memberships.map((m) => m.groupId))];
        const groupRecords = groupIds.length > 0 ? await repos.groups.findByIds(groupIds) : [];
        const groups = groupRecords.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description ?? null,
          color: g.color ?? null,
          icon: g.icon ?? null,
        }));

        const stats = {
          memories: memoryCount,
          conversations: chats.length,
          wardrobeItems: wardrobeItems.length,
          photos,
          scenarios: character.scenarios?.length ?? 0,
          knowledge,
          core,
          characterFiles,
          characterFilesTotal: SINGLE_FILE_OVERLAY_PATHS.length,
        };

        return NextResponse.json({ stats, groups });
      } catch (error) {
        logger.error('[Characters v1] Error computing character stats', { characterId: id }, error instanceof Error ? error : undefined);
        return serverError('Failed to compute character stats');
      }
    },

    'depiction-guidelines': async () => {
      // The Ariel Clause file from this character's own vault root. Single-tier,
      // raw (no fallback) — the editor shows exactly what's on disk.
      const mountId = character.characterDocumentMountPointId;
      if (!mountId) {
        return successResponse({ content: '' });
      }
      const content = await readStoreFile(mountId, DEPICTION_GUIDELINES_FILENAME);
      return successResponse({ content: content ?? '' });
    },
  };

  return actionHandlers[action]();
}
