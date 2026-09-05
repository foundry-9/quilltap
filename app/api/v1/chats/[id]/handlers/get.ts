/**
 * Chats API v1 - GET Handler
 *
 * GET /api/v1/chats/[id] - Get a specific chat
 * GET /api/v1/chats/[id]?action=export - Export chat (SillyTavern JSONL)
 * GET /api/v1/chats/[id]?action=export-markdown - Export chat as a Markdown transcript
 * GET /api/v1/chats/[id]?action=cost - Get cost breakdown
 * GET /api/v1/chats/[id]?action=get-avatars - Get avatar overrides for chat
 * GET /api/v1/chats/[id]?action=get-background - Get story background URL
 * GET /api/v1/chats/[id]?action=outfit - Get equipped outfit state
 */

import { NextRequest, NextResponse } from 'next/server';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { getActionParam } from '@/lib/api/middleware/actions';
import { exportSTChatAsJSONL } from '@/lib/sillytavern/chat';
import { getChatCostBreakdown, getDetailedChatCostBreakdown } from '@/lib/services/cost-estimation.service';
import { enrichParticipantDetail, getCharacterDetail } from '@/lib/services/chat-enrichment.service';
import { renderMarkdownToHtml, canPreRenderMessage } from '@/lib/services/markdown-renderer.service';
import { logger } from '@/lib/logger';
import { notFound, forbidden, serverError } from '@/lib/api/responses';
import { resolveAgentModeSetting } from '@/lib/services/chat-message/agent-mode-resolver.service';
import { reconcileTerminalSessionsForChat } from '@/lib/terminal/reconcile';
import { surfaceOperatorMailForChat } from '@/lib/post-office/surface-operator-mail';
import { maybeEnqueueColdChunkReembed } from '@/lib/scriptorium/cold-chunk-reembed';
import { BRAHMA_CARINA_ANSWERER_ID } from '@/lib/services/carina/brahma-answerer';
import { handleGetAvatars, handleGetState, handleGetOutfit, handleGetOutfitSummary, handleGetPhotoAlbums, handleGetGroupStores, handleAccessibleStores, handleGetMailbox, handleExportMarkdown } from '../actions';
import {
  getPhotoLinkSummaryBySha256,
  type PhotoLinkSummary,
} from '@/lib/photos/photo-link-summary';
import type { RequestContext } from '@/lib/api/middleware';
import type { RenderingPattern, DialogueDetection } from '@/lib/schemas/template.types';

/**
 * GET handler for individual chat
 */
export async function handleGet(
  req: NextRequest,
  ctx: RequestContext,
  chatId: string
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const action = getActionParam(req);

  // Handle export action
  if (action === 'export') {
    try {
      const chat = await repos.chats.findById(chatId);
      if (!chat) {
        return notFound('Chat');
      }

      const allEvents = await repos.chats.getMessages(chatId);
      const messages = allEvents.filter((event) => event.type === 'message');

      const characterParticipants = chat.participants.filter(
        (p) => p.type === 'CHARACTER' && p.characterId
      );
      const primaryParticipant = characterParticipants[0];
      if (!primaryParticipant?.characterId) {
        return notFound('No character in chat');
      }

      // Load every character participant so each message can be attributed to
      // its real author. The map is keyed by participant id (what messages
      // carry in `participantId`); broken-vault characters are dropped by
      // findByIds and simply fall back to the primary name in the export.
      const characters = await repos.characters.findByIds(
        characterParticipants
          .map((p) => p.characterId)
          .filter((id): id is string => typeof id === 'string')
      );
      const charactersById = new Map(characters.map((c) => [c.id, c]));
      const participantNames = new Map<string, string>();
      for (const p of characterParticipants) {
        const name = p.characterId ? charactersById.get(p.characterId)?.name : undefined;
        if (name) participantNames.set(p.id, name);
      }

      const primaryCharacter = charactersById.get(primaryParticipant.characterId);
      if (!primaryCharacter) {
        return notFound('Character');
      }

      const userName = user.name || 'User';

      const formattedMessages = messages.map((msg) => ({
        id: msg.id,
        chatId,
        role: msg.role,
        content: msg.content,
        createdAt: new Date(msg.createdAt),
        updatedAt: new Date(msg.createdAt),
        swipeGroupId: msg.swipeGroupId || null,
        swipeIndex: msg.swipeIndex || null,
        tokenCount: msg.tokenCount || null,
        rawResponse: msg.rawResponse || null,
        participantId: msg.participantId || null,
      }));

      const chatForExport = {
        ...chat,
        createdAt: new Date(chat.createdAt),
        updatedAt: new Date(chat.updatedAt),
      };

      const jsonlContent = exportSTChatAsJSONL(
        chatForExport,
        formattedMessages,
        primaryCharacter.name,
        userName,
        participantNames
      );
      const chatCreatedTime = new Date(chat.createdAt).getTime();
      const filename = `${primaryCharacter.name}_chat_${chatCreatedTime}.jsonl`;

      return new NextResponse(jsonlContent, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    } catch (error) {
      logger.error('[Chats v1] Error exporting chat', { chatId }, error instanceof Error ? error : undefined);
      return serverError('Failed to export chat');
    }
  }

  // Handle export-markdown action
  if (action === 'export-markdown') {
    return handleExportMarkdown(chatId, ctx);
  }

  // Handle get-avatars action
  if (action === 'get-avatars') {
    return handleGetAvatars(chatId, ctx);
  }

  // Handle get-state action
  if (action === 'get-state') {
    return handleGetState(chatId, ctx);
  }

  // Handle outfit action - return equipped outfit state
  if (action === 'outfit') {
    return handleGetOutfit(chatId, ctx);
  }

  // Handle outfit-summary action - equipped outfit with resolved item titles
  if (action === 'outfit-summary') {
    return handleGetOutfitSummary(chatId, ctx);
  }

  // Handle photo-albums action - resolve candidate save targets for an image
  if (action === 'photo-albums') {
    return handleGetPhotoAlbums(chatId, ctx);
  }

  // Handle group-stores action - document stores of groups the user persona belongs to
  if (action === 'group-stores') {
    return handleGetGroupStores(chatId, ctx);
  }

  // Handle mailbox action - letters in a player-character's Mail/ folder, for the
  // Compose Mail modal's "In reply to" dropdown.
  if (action === 'mailbox') {
    return handleGetMailbox(req, chatId, ctx);
  }

  // Handle accessible-stores action - document stores for the Open-Document
  // picker's right-column accordions. `?all=true` is the picker's "look
  // everywhere" mode (every enabled store, not just this chat's reach).
  if (action === 'accessible-stores') {
    const all = req.nextUrl.searchParams.get('all') === 'true';
    return handleAccessibleStores(chatId, ctx, { all });
  }

  // Handle get-background action - returns story background URL for the chat
  if (action === 'get-background') {
    try {
      const chat = await repos.chats.findById(chatId);
      if (!chat) {
        return notFound('Chat');
      }

      // Check if the chat has a story background image
      if (!chat.storyBackgroundImageId) {
        return NextResponse.json({ backgroundUrl: null, fileId: null, filename: null, sha256: null, linkSummary: null });
      }

      // Get the file info to build the URL
      const file = await repos.files.findById(chat.storyBackgroundImageId);
      if (!file) {
        logger.warn('[Chats v1] Story background file not found', {
          chatId,
          storyBackgroundImageId: chat.storyBackgroundImageId,
        });
        return NextResponse.json({ backgroundUrl: null, fileId: null, filename: null, sha256: null, linkSummary: null });
      }

      const backgroundUrl = getFilePath(file);
      const linkSummary = file.sha256
        ? await getPhotoLinkSummaryBySha256(file.sha256, repos)
        : null;
      return NextResponse.json({
        backgroundUrl,
        fileId: file.id,
        filename: file.originalFilename,
        sha256: file.sha256,
        linkSummary,
      });
    } catch (error) {
      logger.error('[Chats v1] Failed to get story background', { chatId }, error instanceof Error ? error : undefined);
      return serverError('Failed to get story background');
    }
  }

  // Handle cost action
  if (action === 'cost') {
    try {
      const chat = await repos.chats.findById(chatId);
      if (!chat) {
        return notFound('Chat');
      }

      const searchParams = req.nextUrl.searchParams;
      const detailed = searchParams.get('detailed') === 'true';

      const breakdown = detailed
        ? await getDetailedChatCostBreakdown(chatId, user.id)
        : await getChatCostBreakdown(chatId, user.id);return NextResponse.json(breakdown);
    } catch (error) {
      logger.error('[Chats v1] Failed to get cost breakdown', { chatId }, error instanceof Error ? error : undefined);
      return serverError('Failed to get cost breakdown');
    }
  }

  // Default: get chat
  try {

    const chatMetadata = await repos.chats.findById(chatId);
    if (!chatMetadata) {
      return notFound('Chat');
    }

    // Cold-tier re-warm: if the maintenance sweep cold-tiered this chat's
    // conversation-chunk embeddings, opening it re-enqueues them through the
    // standard embedding pipeline. Fire-and-forget (debounced + deduped
    // inside) — never allowed to slow or break the chat load.
    maybeEnqueueColdChunkReembed(user.id, chatId).catch((error) => {
      logger.warn('[Chats v1] Cold-chunk re-embed check failed — continuing', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    // Sweep terminal sessions whose PTYs were lost across a server restart
    // (DB row says "live" but ptyManager doesn't have it) and post the close
    // announcements before we read the message history below.
    await reconcileTerminalSessionsForChat(chatId);

    // The Post Office: announce any letters addressed to the operator's own
    // character(s) before we read the history below. A user-controlled
    // participant never takes an LLM turn, so the per-turn mail check never
    // covers it; without this, mail to the operator's character would sit
    // unannounced in an idle room. Idempotent and warn-only inside.
    await surfaceOperatorMailForChat(chatId, chatMetadata.participants);

    const enrichedParticipants = await Promise.all(
      chatMetadata.participants.map((p) => enrichParticipantDetail(p, repos, chatId))
    );

    // Get roleplay template for rendering patterns
    let renderingPatterns: RenderingPattern[] | undefined;
    let dialogueDetection: DialogueDetection | null | undefined;

    if (chatMetadata.roleplayTemplateId) {
      const template = await repos.roleplayTemplates.findById(chatMetadata.roleplayTemplateId);
      if (template) {
        renderingPatterns = template.renderingPatterns;
        dialogueDetection = template.dialogueDetection;
      }
    }

    // Smart typography, Part A: whether pre-rendered HTML gets curly quotes.
    // Display only — `event.content` below is still the writer's straight-quoted
    // text, which is what goes to the model, the embeddings and every export.
    // The client renderer (MessageContent) reads the same setting for messages
    // it renders itself, so streaming and settled output agree.
    const preRenderSettings = await repos.chatSettings.findByUserId(user.id);
    const displayQuotes = preRenderSettings?.smartTypographySettings?.displayQuotes ?? false;

    const chatEvents = await repos.chats.getMessages(chatId);

    // Check for TOOL messages to identify which messages have embedded tools
    const toolMessages = chatEvents.filter((event) => event.type === 'message' && event.role === 'TOOL');
    const messagesWithEmbeddedTools = new Set<string>();

    // Tool messages initiated by character get embedded in the preceding ASSISTANT message
    // Tool messages initiated by user get embedded in the following USER message
    // For simplicity, we'll skip pre-rendering for messages adjacent to TOOL messages
    const messageEvents = chatEvents.filter((event) => event.type === 'message');
    for (let i = 0; i < messageEvents.length; i++) {
      const event = messageEvents[i];
      if (event.type === 'message' && event.role === 'TOOL') {
        // Mark adjacent messages as having embedded tools
        if (i > 0) {
          const prevEvent = messageEvents[i - 1];
          if (prevEvent.type === 'message') {
            messagesWithEmbeddedTools.add(prevEvent.id);
          }
        }
        if (i < messageEvents.length - 1) {
          const nextEvent = messageEvents[i + 1];
          if (nextEvent.type === 'message') {
            messagesWithEmbeddedTools.add(nextEvent.id);
          }
        }
      }
    }

    const messages = await Promise.all(
      chatEvents
        .filter((event) => event.type === 'message')
        .map(async (event) => {
          if (event.type !== 'message') return null;

          const linkedFiles = await repos.files.findByLinkedTo(event.id);
          // Surface sha256 + linkSummary for every image attachment so the
          // Salon UI can offer "save to my gallery" affordances and show
          // a count of where the bytes are hard-linked elsewhere. Non-image
          // attachments skip the summary lookup to keep the response light.
          const attachments: Array<{
            id: string;
            filename: string;
            filepath: string;
            mimeType: string;
            sha256?: string;
            linkSummary?: PhotoLinkSummary;
          }> = await Promise.all(
            linkedFiles.map(async (file) => {
              const base = {
                id: file.id,
                filename: file.originalFilename,
                filepath: getFilePath(file),
                mimeType: file.mimeType,
              };
              if (!file.mimeType.startsWith('image/')) return base;
              return {
                ...base,
                sha256: file.sha256,
                linkSummary: await getPhotoLinkSummaryBySha256(file.sha256, repos),
              };
            })
          );

          // Mount-file attachments (Scriptorium documents pinned to a chat
          // via a Librarian announcement) live entirely in event.attachments
          // — there's no linkedTo entry for them. Resolve any ids that the
          // legacy lookup didn't cover by probing doc_mount_files.
          const eventAttachmentIds = Array.isArray(event.attachments) ? event.attachments : [];
          const alreadyResolved = new Set(attachments.map((a) => a.id));
          for (const attachmentId of eventAttachmentIds) {
            if (alreadyResolved.has(attachmentId)) continue;
            try {
              let mountLink = await repos.docMountFileLinks.findByIdWithContent(attachmentId);
              if (!mountLink) {
                const links = await repos.docMountFileLinks.findByFileId(attachmentId);
                mountLink = links[0] ?? null;
              }
              if (!mountLink) continue;
              const blob = await repos.docMountBlobs.findByFileId(mountLink.fileId);
              if (!blob) continue;
              const url = `/api/v1/mount-points/${mountLink.mountPointId}/blobs/${encodeURI(mountLink.relativePath)}`;
              const isImage = blob.storedMimeType.startsWith('image/');
              attachments.push({
                id: mountLink.id,
                filename: mountLink.originalFileName ?? mountLink.fileName,
                filepath: url,
                mimeType: blob.storedMimeType,
                ...(isImage && mountLink.sha256
                  ? {
                      sha256: mountLink.sha256,
                      linkSummary: await getPhotoLinkSummaryBySha256(mountLink.sha256, repos),
                    }
                  : {}),
              });
              alreadyResolved.add(mountLink.id);
            } catch (err) {
              logger.warn('[Chats v1] Failed to resolve mount-file attachment', {
                messageId: event.id,
                attachmentId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          // Determine if this message can be pre-rendered
          const hasAttachments = attachments.length > 0;
          const hasEmbeddedTool = messagesWithEmbeddedTools.has(event.id);
          const canPreRender = canPreRenderMessage(event.role, hasAttachments, hasEmbeddedTool);

          // Pre-render simple messages to HTML
          let renderedHtml: string | null = null;
          if (canPreRender) {
            try {
              renderedHtml = await renderMarkdownToHtml(event.content, {
                renderingPatterns,
                dialogueDetection,
                displayQuotes,
              });
            } catch (err) {
              // Log but don't fail - client can still render
              logger.warn('[Chats v1] Failed to pre-render message', {
                messageId: event.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          return {
            id: event.id,
            role: event.role,
            content: event.content,
            tokenCount: event.tokenCount || null,
            promptTokens: event.promptTokens || null,
            completionTokens: event.completionTokens || null,
            createdAt: event.createdAt,
            swipeGroupId: event.swipeGroupId || null,
            swipeIndex: event.swipeIndex || null,
            participantId: event.participantId || null,
            attachments,
            debugMemoryLogs: event.debugMemoryLogs || undefined,
            renderedHtml,
            provider: event.provider || null,
            modelName: event.modelName || null,
            targetParticipantIds: event.targetParticipantIds || null,
            isSilentMessage: event.isSilentMessage || null,
            systemSender: event.systemSender || null,
            systemKind: event.systemKind || null,
            // Host structured payload — projected so the client can reconstruct
            // turn-pass records (hostEvent.participantId) for the Skip-button guard.
            hostEvent: event.hostEvent || null,
            customAnnouncer: event.customAnnouncer || null,
            carinaMeta: event.carinaMeta || null,
            pascalMeta: event.pascalMeta || null,
            pendingExternalPrompt: event.pendingExternalPrompt || null,
            pendingExternalPromptFull: event.pendingExternalPromptFull || null,
            pendingExternalAttachments: event.pendingExternalAttachments || null,
            // Reasoning ("thinking") for DISPLAY ONLY — surfaced so the Salon can
            // render the collapsible thinking block on reload. Never re-fed to a model.
            reasoningContent: event.reasoningContent || null,
            reasoningSegments: event.reasoningSegments || null,
            // Answer-confirmation verdict — drives the badge on reload. `confirmed`
            // may be false/null (both meaningful), so preserve the tri-state
            // explicitly instead of `|| null`; undefined = no check ran.
            confirmed: event.confirmed ?? undefined,
            confirmationChecked: event.confirmationChecked ?? undefined,
            confirmationRevised: event.confirmationRevised ?? undefined,
            confirmationNotes: event.confirmationNotes ?? null,
            confirmationOriginalContent: event.confirmationOriginalContent ?? null,
          };
        })
    ).then((results) => results.filter(Boolean));

    // Resolve off-scene character cards referenced by ad-hoc announcement
    // bubbles (customAnnouncer.kind === 'character'). The Salon renderer looks
    // these up by id to render the bubble's avatar/name; the chat's
    // `participants` array doesn't include them since they aren't participants.
    const offSceneCharacterIds = new Set<string>();
    const participantCharacterIds = new Set(
      chatMetadata.participants
        .map((p) => p.characterId)
        .filter((id): id is string => typeof id === 'string'),
    );
    for (const m of messages) {
      const id = m?.customAnnouncer?.characterId;
      if (typeof id === 'string' && !participantCharacterIds.has(id)) {
        offSceneCharacterIds.add(id);
      }
      // Carina (inline LLM queries): a reference answer renders with the
      // answerer character's own avatar. When the answerer isn't a participant,
      // collect them here so the Salon can resolve their avatar/name. The Brahma
      // Console pseudocharacter (reserved sentinel id) has no character record —
      // skip it so we don't fire a guaranteed-miss lookup per Brahma message.
      const carinaAnswererId = m?.carinaMeta?.answererId;
      if (
        typeof carinaAnswererId === 'string' &&
        carinaAnswererId !== BRAHMA_CARINA_ANSWERER_ID &&
        !participantCharacterIds.has(carinaAnswererId)
      ) {
        offSceneCharacterIds.add(carinaAnswererId);
      }
    }
    const offSceneCharacters: Array<{ id: string; name: string; title: string | null; avatarUrl: string | null }> = [];
    for (const charId of offSceneCharacterIds) {
      try {
        // Use getCharacterDetail so avatarUrl resolves through avatarOverrides /
        // defaultImageId — characters whose avatar is stored as a defaultImage
        // (not a raw avatarUrl) still render correctly in announcement bubbles.
        const detail = await getCharacterDetail(charId, repos, chatId);
        if (detail) {
          offSceneCharacters.push({
            id: detail.id,
            name: detail.name,
            title: detail.title,
            avatarUrl: detail.avatarUrl,
          });
        }
      } catch {
        // Character may have been deleted; skip and let the renderer fall back.
      }
    }

    let projectName: string | null = null;
    let project = null;
    if (chatMetadata.projectId) {
      try {
        project = await repos.projects.findById(chatMetadata.projectId);
        if (project) {
          projectName = project.name;
        }
      } catch {
        // Project might have been deleted
      }
    }

    // Resolve agent mode through the cascade: Global → Character → Project → Chat
    let primaryCharacter = null;
    const characterParticipant = chatMetadata.participants.find(
      (p) => p.type === 'CHARACTER' && p.characterId
    );
    if (characterParticipant?.characterId) {
      try {
        primaryCharacter = await repos.characters.findById(characterParticipant.characterId);
      } catch {
        // Character might have been deleted
      }
    }

    const chatSettings = await repos.chatSettings.findByUserId(user.id);
    const resolvedAgentMode = resolveAgentModeSetting(chatMetadata, project, primaryCharacter, chatSettings);

    const chat = {
      id: chatMetadata.id,
      title: chatMetadata.title,
      // Surfaced so the Salon sidebar can gate the "Edit Enclave" control to
      // autonomous rooms. Defaults to 'salon' for legacy rows without the column.
      chatType: chatMetadata.chatType ?? 'salon',
      contextSummary: chatMetadata.contextSummary,
      roleplayTemplateId: chatMetadata.roleplayTemplateId,
      imageProfileId: chatMetadata.imageProfileId ?? null,
      lastTurnParticipantId: chatMetadata.lastTurnParticipantId ?? null,
      // Impersonation overlay state — projected so a reload (or a mid-session
      // server restart) restores the "speaking as" selection and the impersonated
      // seats instead of snapping every seat back to LLM-controlled. Without these
      // the client's useImpersonation sync reads `undefined` and shows an
      // impersonated character as not impersonated.
      impersonatingParticipantIds: chatMetadata.impersonatingParticipantIds ?? [],
      activeTypingParticipantId: chatMetadata.activeTypingParticipantId ?? null,
      isPaused: chatMetadata.isPaused ?? false,
      // All-LLM-pause bookkeeping — surfaced so the client can explain a silent
      // pause (opens AllLLMPauseModal on load / mid-session).
      allLLMPauseTurnCount: chatMetadata.allLLMPauseTurnCount ?? 0,
      isManuallyRenamed: chatMetadata.isManuallyRenamed ?? false,
      updatedAt: chatMetadata.updatedAt,
      createdAt: chatMetadata.createdAt,
      participants: enrichedParticipants,
      user: { id: user.id, name: user.name, image: user.image },
      messages,
      projectId: chatMetadata.projectId || null,
      projectName,
      // The scene in force. Projected so the sidebar's scenario picker can open
      // on what the chat actually has rather than always on "Custom…".
      scenarioText: chatMetadata.scenarioText ?? null,
      disabledTools: chatMetadata.disabledTools || [],
      disabledToolGroups: chatMetadata.disabledToolGroups || [],
      allowCrossCharacterVaultReads: chatMetadata.allowCrossCharacterVaultReads ?? false,
      coreWhisperEnabled: chatMetadata.coreWhisperEnabled ?? null,
      coreWhisperInterval: chatMetadata.coreWhisperInterval ?? null,
      turnSkippingEnabled: chatMetadata.turnSkippingEnabled ?? null,
      // Controlled selects in chat settings — projected so the UI reflects the
      // saved value on reload instead of snapping back to its default.
      timelineMode: chatMetadata.timelineMode ?? null,
      alertCharactersOfLanternImages: chatMetadata.alertCharactersOfLanternImages ?? null,
      showThinking: chatMetadata.showThinking ?? null,
      answerConfirmationOverride: chatMetadata.answerConfirmationOverride ?? null,
      agentModeEnabled: chatMetadata.agentModeEnabled ?? false,
      resolvedAgentModeEnabled: resolvedAgentMode.enabled,
      agentModeSource: resolvedAgentMode.enabledSource,
      avatarGenerationEnabled: chatMetadata.avatarGenerationEnabled ?? null,
      isDangerousChat: chatMetadata.isDangerousChat ?? null,
      dangerCategories: chatMetadata.dangerCategories || [],
      conciergeOverride: chatMetadata.conciergeOverride ?? null,
      documentEditingMode: chatMetadata.documentEditingMode ?? false,
      documentMode: chatMetadata.documentMode || 'normal',
      dividerPosition: chatMetadata.dividerPosition ?? 45,
      terminalMode: chatMetadata.terminalMode || 'normal',
      activeTerminalSessionId: chatMetadata.activeTerminalSessionId ?? null,
      rightPaneVerticalSplit: chatMetadata.rightPaneVerticalSplit ?? 50,
      offSceneCharacters,
    };

    return NextResponse.json({ chat });
  } catch (error) {
    logger.error('[Chats v1] Error fetching chat', { chatId }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch chat');
  }
}
