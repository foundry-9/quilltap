/**
 * Character Avatar Generation Handler
 *
 * Generates a portrait avatar for a character based on their equipped wardrobe
 * items and physical descriptions. Triggered when outfits change in a chat
 * with avatar generation enabled.
 *
 * Follows the story-background handler pattern but generates portrait-oriented
 * character avatars instead of landscape backgrounds.
 */

import { BackgroundJob } from '@/lib/schemas/types';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
import {
  getCharacterVaultStore,
  writeCharacterAvatarToVault,
} from '@/lib/file-storage/character-vault-bridge';
import { createImageProvider } from '@/lib/llm/plugin-factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { CharacterAvatarGenerationPayload } from '../queue-service';
import type { FileCategory, FileSource } from '@/lib/schemas/types';
import { convertToWebP } from '@/lib/files/webp-conversion';
import { sha256OfBuffer } from '@/lib/utils/sha256';
import {
  resolveDangerousContentSettings,
} from '@/lib/services/dangerous-content/resolver.service';
import {
  classifyContent as classifyDangerousContent,
} from '@/lib/services/dangerous-content/gatekeeper.service';
import {
  resolveImageProviderForDangerousContent,
  isImageModerationError,
  resolveUncensoredImageProfileForReroute,
} from '@/lib/services/dangerous-content/provider-routing.service';
import { getCheapLLMProvider, DEFAULT_CHEAP_LLM_CONFIG, type CheapLLMConfig, type CheapLLMSelection } from '@/lib/llm/cheap-llm';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import { buildCharacterAvatarPrompt } from '@/lib/wardrobe/avatar-prompt';
import { resolveProjectMountPointIds } from '@/lib/mount-index/tiered-mount-pool';
import { resolveAesthetic, getProjectOfficialMountPointId } from '@/lib/image-gen/aesthetic';
import { buildImageGenParams } from '@/lib/image-gen/params-builder';
import { postLanternImageNotification } from '@/lib/services/lantern-notifications/writer';

/**
 * Handle CHARACTER_AVATAR_GENERATION job.
 *
 * 1. Load character + equipped wardrobe items
 * 2. Build appearance description from physical descriptions + equipped items
 * 3. Run prompt through Concierge (dangerous content classification + provider rerouting)
 * 4. Generate portrait image
 * 5. Store image and update chat.characterAvatars
 */
export async function handleCharacterAvatarGeneration(job: BackgroundJob): Promise<void> {
  const payload = job.payload as unknown as CharacterAvatarGenerationPayload;
  const repos = getRepositories();

  logger.info('[CharacterAvatar] Starting avatar generation', {
    context: 'background-jobs.character-avatar',
    jobId: job.id,
    chatId: payload.chatId,
    characterId: payload.characterId,
  });

  // 1. Load chat
  const chat = await repos.chats.findById(payload.chatId);
  if (!chat) {
    throw new Error(`Chat not found: ${payload.chatId}`);
  }

  // 2. Load character
  const character = await repos.characters.findById(payload.characterId);
  if (!character) {
    throw new Error(`Character not found: ${payload.characterId}`);
  }

  // 3. Get image profile
  const imageProfile = await repos.imageProfiles.findById(payload.imageProfileId);
  if (!imageProfile) {
    throw new Error(`Image profile not found: ${payload.imageProfileId}`);
  }

  if (!imageProfile.apiKeyId) {
    logger.warn('[CharacterAvatar] Image profile has no API key, skipping', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      profileId: imageProfile.id,
    });
    return;
  }

  const apiKey = await repos.connections.findApiKeyByIdAndUserId(imageProfile.apiKeyId, job.userId);
  if (!apiKey?.key_value) {
    logger.warn('[CharacterAvatar] API key not found or invalid, skipping', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
    });
    return;
  }

  // 4. Build portrait prompt — 3/4 head-and-shoulders crop, no scenario context.
  // Scenario text is deliberately excluded: it often mentions other characters
  // or narrative elements that cause image models to depict multiple people.
  // The fitting-room override (when present) takes priority over the chat's
  // stored equipped state — the operator may be previewing an outfit that
  // hasn't been committed to the chat.
  const equippedSlots = payload.equippedSlotsOverride
    ?? await repos.chats.getEquippedOutfitForCharacter(payload.chatId, payload.characterId);
  const avatarProjectMountPointIds = await resolveProjectMountPointIds(chat.projectId);
  // Aurora character aesthetic (people/outfit look), project-over-global. The
  // Ariel Clause (depiction-guidelines.md) deliberately does NOT apply to avatars.
  const characterAesthetic = await resolveAesthetic({
    kind: 'aurora',
    projectOfficialMountPointId: await getProjectOfficialMountPointId(chat.projectId),
  });
  const { prompt, hasAppearance, leafCounts } = await buildCharacterAvatarPrompt(repos, character, {
    equippedSlots,
    projectMountPointIds: avatarProjectMountPointIds,
    characterAesthetic,
  });

  if (!hasAppearance) {
    logger.warn('[CharacterAvatar] No appearance data available, skipping', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      characterId: payload.characterId,
    });
    return;
  }

  // 6. Concierge check — classify the prompt for dangerous content (Off-duty chats skip everything)
  const chatSettings = await repos.chatSettings.findByUserId(job.userId) ?? undefined;
  const dangerousContentResolved = resolveDangerousContentSettings(chatSettings ?? null, chat);
  const dangerSettings = dangerousContentResolved.settings;

  let effectiveImageProfile = imageProfile;
  let effectiveApiKey = apiKey.key_value;

  if (dangerSettings.mode !== 'OFF' && dangerSettings.scanImagePrompts) {
    let cheapLLMSelection: CheapLLMSelection | null = null;
    try {
      const allProfiles = await repos.connections.findByUserId(job.userId);
      const cheapLLMConfig: CheapLLMConfig = chatSettings?.cheapLLMSettings ? {
        strategy: chatSettings.cheapLLMSettings.strategy,
        userDefinedProfileId: chatSettings.cheapLLMSettings.userDefinedProfileId ?? undefined,
        defaultCheapProfileId: chatSettings.cheapLLMSettings.defaultCheapProfileId ?? undefined,
        fallbackToLocal: chatSettings.cheapLLMSettings.fallbackToLocal,
      } : DEFAULT_CHEAP_LLM_CONFIG;

      const defaultProfile = allProfiles.find(p => p.isDefault) || allProfiles[0];
      if (defaultProfile) {
        cheapLLMSelection = getCheapLLMProvider(
          defaultProfile,
          cheapLLMConfig,
          allProfiles,
          false
        );
      }
    } catch (error) {
      logger.warn('[CharacterAvatar] Failed to build cheap LLM selection for danger classification', {
        context: 'background-jobs.character-avatar',
        jobId: job.id,
        error: getErrorMessage(error),
      });
    }

    if (cheapLLMSelection) {
      try {
        const classification = await classifyDangerousContent(
          prompt,
          cheapLLMSelection,
          job.userId,
          dangerSettings,
          payload.chatId
        );

        if (classification.isDangerous) {
          logger.info('[CharacterAvatar] Avatar prompt classified as dangerous', {
            context: 'background-jobs.character-avatar',
            jobId: job.id,
            score: classification.score,
            categories: classification.categories.map(c => c.category),
            mode: dangerSettings.mode,
          });

          if (dangerSettings.mode === 'AUTO_ROUTE') {
            const routeResult = await resolveImageProviderForDangerousContent(
              imageProfile,
              apiKey.key_value,
              dangerSettings,
              job.userId
            );

            if (routeResult.rerouted) {
              effectiveImageProfile = routeResult.imageProfile;
              effectiveApiKey = routeResult.apiKey;
              logger.info('[CharacterAvatar] Rerouted to uncensored image provider', {
                context: 'background-jobs.character-avatar',
                jobId: job.id,
                originalProfile: imageProfile.name,
                uncensoredProfile: routeResult.imageProfile.name,
                reason: routeResult.reason,
              });
            } else {
              logger.warn('[CharacterAvatar] No uncensored image provider available, using original', {
                context: 'background-jobs.character-avatar',
                jobId: job.id,
                reason: routeResult.reason,
              });
            }
          }
        }
      } catch (error) {
        // Fail safe — never block avatar generation on classification errors
        logger.error('[CharacterAvatar] Prompt classification failed, continuing normally', {
          context: 'background-jobs.character-avatar',
          jobId: job.id,
          error: getErrorMessage(error),
        });
      }
    }
  }

  // 7. Generate portrait image
  let generationResponse;
  const genStartTime = Date.now();
  try {
    const provider = createImageProvider(effectiveImageProfile.provider);
    // Avatars default to portrait; the shared builder maps that onto the
    // provider's own size / aspect ratio / prompt wording and attaches the
    // profile's LoRAs and residual options — the same params the Salon's
    // `generate_image` gets, so a LoRA configured for a profile does not work
    // in chat and quietly vanish here.
    const { params: avatarParams } = buildImageGenParams({
      profile: effectiveImageProfile,
      prompt,
      overrides: { n: 1, style: 'natural' },
      orientation: 'portrait',
      logContext: { context: 'background-jobs.character-avatar', jobId: job.id },
    });
    generationResponse = await provider.generateImage(avatarParams, effectiveApiKey);

    const genDurationMs = Date.now() - genStartTime;
    const revisedPrompt = generationResponse.images?.[0]?.revisedPrompt || '';

    await logLLMCall({
      userId: job.userId,
      type: 'IMAGE_GENERATION',
      chatId: payload.chatId,
      characterId: payload.characterId,
      provider: effectiveImageProfile.provider,
      modelName: effectiveImageProfile.modelName,
      imageProfileId: effectiveImageProfile.id,
      request: {
        messages: [{ role: 'user', content: prompt }],
      },
      response: {
        content: revisedPrompt || `Generated ${generationResponse.images?.length ?? 0} image(s)`,
      },
      durationMs: genDurationMs,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const genDurationMs = Date.now() - genStartTime;

    await logLLMCall({
      userId: job.userId,
      type: 'IMAGE_GENERATION',
      chatId: payload.chatId,
      characterId: payload.characterId,
      provider: effectiveImageProfile.provider,
      modelName: effectiveImageProfile.modelName,
      imageProfileId: effectiveImageProfile.id,
      request: {
        messages: [{ role: 'user', content: prompt }],
      },
      response: {
        content: '',
        error: errorMessage,
      },
      durationMs: genDurationMs,
    });

    // Post-hoc Concierge reroute: if the provider rejected for content
    // moderation and the user has AUTO_ROUTE on with a configured uncensored
    // profile, take the second door. Mirrors the story-background handler.
    const reroute = isImageModerationError(error)
      ? await resolveUncensoredImageProfileForReroute(effectiveImageProfile.id, dangerSettings, job.userId)
      : null;

    if (!reroute) {
      logger.error('[CharacterAvatar] Image generation failed', {
        context: 'background-jobs.character-avatar',
        jobId: job.id,
        error: errorMessage,
        moderationRejection: isImageModerationError(error),
      }, error as Error);
      throw new Error(`Avatar image generation failed: ${errorMessage}`);
    }

    logger.info('[CharacterAvatar] Image provider rejected for content moderation, rerouting through Concierge uncensored profile', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      originalProfileId: effectiveImageProfile.id,
      originalProvider: effectiveImageProfile.provider,
      fallbackProfileId: reroute.profile.id,
      fallbackProvider: reroute.profile.provider,
      originalError: errorMessage,
    });

    const rerouteProvider = createImageProvider(reroute.profile.provider);
    const rerouteStartTime = Date.now();
    // Rebuild for the reroute provider/model — its shape mechanism, its LoRA
    // support, and its stored options are all its own.
    const { params: rerouteParams } = buildImageGenParams({
      profile: reroute.profile,
      prompt,
      overrides: { n: 1, style: 'natural' },
      orientation: 'portrait',
      logContext: {
        context: 'background-jobs.character-avatar.concierge-reroute',
        jobId: job.id,
      },
    });
    try {
      generationResponse = await rerouteProvider.generateImage(rerouteParams, reroute.apiKey);

      const rerouteDurationMs = Date.now() - rerouteStartTime;
      const rerouteRevisedPrompt = generationResponse.images?.[0]?.revisedPrompt || '';

      await logLLMCall({
        userId: job.userId,
        type: 'IMAGE_GENERATION',
        chatId: payload.chatId,
        characterId: payload.characterId,
        provider: reroute.profile.provider,
        modelName: reroute.profile.modelName,
        imageProfileId: reroute.profile.id,
        request: {
          messages: [{ role: 'user', content: prompt }],
        },
        response: {
          content: rerouteRevisedPrompt || `Generated ${generationResponse.images?.length ?? 0} image(s) (Concierge reroute)`,
        },
        durationMs: rerouteDurationMs,
      });

      // Swap in the rerouted profile so downstream file metadata records
      // the provider that actually produced the image.
      effectiveImageProfile = reroute.profile;
      effectiveApiKey = reroute.apiKey;

      logger.info('[CharacterAvatar] Concierge uncensored reroute succeeded', {
        context: 'background-jobs.character-avatar',
        jobId: job.id,
        fallbackProvider: reroute.profile.provider,
        fallbackModel: reroute.profile.modelName,
        rerouteDurationMs,
      });
    } catch (rerouteError) {
      const rerouteErrorMessage = getErrorMessage(rerouteError);
      const rerouteDurationMs = Date.now() - rerouteStartTime;

      await logLLMCall({
        userId: job.userId,
        type: 'IMAGE_GENERATION',
        chatId: payload.chatId,
        characterId: payload.characterId,
        provider: reroute.profile.provider,
        modelName: reroute.profile.modelName,
        imageProfileId: reroute.profile.id,
        request: {
          messages: [{ role: 'user', content: prompt }],
        },
        response: {
          content: '',
          error: rerouteErrorMessage,
        },
        durationMs: rerouteDurationMs,
      });

      logger.error('[CharacterAvatar] Image generation failed (Concierge reroute also failed)', {
        context: 'background-jobs.character-avatar',
        jobId: job.id,
        originalError: errorMessage,
        rerouteError: rerouteErrorMessage,
      }, rerouteError as Error);
      throw new Error(`Avatar image generation failed after Concierge reroute: ${rerouteErrorMessage}`);
    }
  }

  if (!generationResponse.images || generationResponse.images.length === 0) {
    logger.warn('[CharacterAvatar] No images returned from provider', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
    });
    return;
  }

  // 8. Save generated image
  const imageData = generationResponse.images[0];
  const rawData = imageData.data || imageData.b64Json;
  if (!rawData) {
    logger.warn('[CharacterAvatar] Generated image has no data', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
    });
    return;
  }

  const rawBuffer = Buffer.from(rawData, 'base64');
  const providerMimeType = imageData.mimeType || 'image/png';
  const providerExt = providerMimeType.split('/')[1] || 'png';
  const providerFilename = `avatar_${character.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.${providerExt}`;

  // Convert to WebP for consistent storage
  const converted = await convertToWebP(rawBuffer, providerMimeType, providerFilename);
  const buffer = converted.buffer;
  const mimeType = converted.mimeType;
  const originalFilename = converted.filename;

  const sha256 = sha256OfBuffer(buffer);
  const fileId = crypto.randomUUID();

  const category: FileCategory = 'IMAGE';
  const source: FileSource = 'GENERATED';

  const folderProjectId = chat.projectId ?? null;

  try {
    // Route history avatars into the character vault when there's no project
    // context to route them through. The vault is provisioned at character
    // creation and re-asserted by startup backfill; if it is somehow missing
    // we refuse to write rather than leak bytes into the catch-all _general/.
    //
    // The handler runs in the forked job child whose DB connection is readonly
    // and whose writes are buffered (no read-your-writes), so we cannot
    // ensureCharacterVault() inline here — the parent's character-create flow
    // (or the startup backfill) is responsible for provisioning.
    let storageKey: string;
    let fileProjectId: string | null;
    let fileFolderPath: string | null;
    let usedVault = false;
    // The storage bridges transcode bitmap uploads to WebP; the FileEntry
    // must record the post-transcode mime/size or vision providers reject
    // the bytes ("media_type X but image is Y").
    let storedMimeType: string;
    let storedSize: number;

    if (!folderProjectId) {
      const vault = await getCharacterVaultStore(payload.characterId);
      if (!vault) {
        throw new Error(
          `Character ${payload.characterId} has no linked database-backed vault; cannot persist wardrobe avatar.`,
        );
      }
      const written = await writeCharacterAvatarToVault({
        characterId: payload.characterId,
        kind: 'history',
        filename: originalFilename,
        content: buffer,
        contentType: mimeType,
        description: `${character.name} — wardrobe portrait`,
      });
      storageKey = written.storageKey;
      storedMimeType = written.storedMimeType;
      storedSize = written.sizeBytes;
      fileProjectId = null;
      fileFolderPath = null;
      usedVault = true;
    } else {
      const uploadResult = await fileStorageManager.uploadFile({
        filename: originalFilename,
        content: buffer,
        contentType: mimeType,
        projectId: folderProjectId,
        folderPath: '/character-avatars/',
      });
      storageKey = uploadResult.storageKey;
      storedMimeType = uploadResult.storedMimeType;
      storedSize = uploadResult.sizeBytes;
      fileProjectId = folderProjectId;
      fileFolderPath = '/character-avatars/';
    }

    // The legacy `folders` table backs the pre-Scriptorium file tree UI. It's
    // only meaningful for disk-backed (or project-mount-backed) writes; vault
    // writes own their folder structure inside doc_mount_folders.
    // find-or-create at the repository chokepoint: this runs in the forked
    // child, where the call is buffered whole and replayed on the parent's RW
    // connection, so the return value is the synthetic `undefined` (bug 114).
    if (!usedVault) {
      await repos.folders.ensureByPath({
        userId: job.userId,
        path: '/character-avatars/',
        name: 'character-avatars',
        parentFolderId: null,
        projectId: fileProjectId,
      });
    }

    await repos.files.create({
      userId: job.userId,
      sha256,
      originalFilename,
      mimeType: storedMimeType,
      size: storedSize,
      // Actual dimensions measured from the stored bytes — providers often
      // return a different shape than requested (see image-orientation-gating).
      width: converted.width ?? null,
      height: converted.height ?? null,
      linkedTo: [payload.chatId, payload.characterId],
      source,
      category,
      generationPrompt: prompt,
      generationModel: effectiveImageProfile.modelName,
      generationRevisedPrompt: imageData.revisedPrompt || null,
      description: `${character.name} — wardrobe portrait`,
      tags: [payload.characterId],
      storageKey,
      projectId: fileProjectId,
      folderPath: fileFolderPath,
    }, { id: fileId });

    logger.info('[CharacterAvatar] Avatar image saved', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
      fileId,
    });
  } catch (error) {
    logger.error('[CharacterAvatar] Failed to save avatar image', {
      context: 'background-jobs.character-avatar',
      jobId: job.id,
    }, error as Error);
    throw new Error(`Failed to save avatar image: ${getErrorMessage(error)}`);
  }

  // 9. Update chat.characterAvatars with the new avatar
  const existingAvatars = (chat.characterAvatars && typeof chat.characterAvatars === 'object')
    ? chat.characterAvatars as Record<string, unknown>
    : {};

  const updatedAvatars = {
    ...existingAvatars,
    [payload.characterId]: {
      imageId: fileId,
      generatedAt: new Date().toISOString(),
      afterMessageCount: chat.messageCount ?? 0,
    },
  };

  await repos.chats.update(payload.chatId, {
    characterAvatars: updatedAvatars,
  });

  // 10. Also update character.avatarOverrides for this chat
  const existingOverrides = character.avatarOverrides || [];
  const filteredOverrides = existingOverrides.filter(o => o.chatId !== payload.chatId);
  filteredOverrides.push({ chatId: payload.chatId, imageId: fileId });

  await repos.characters.update(payload.characterId, {
    avatarOverrides: filteredOverrides,
  });

  logger.info('[CharacterAvatar] Avatar generation completed', {
    context: 'background-jobs.character-avatar',
    jobId: job.id,
    chatId: payload.chatId,
    characterId: payload.characterId,
    fileId,
  });

  await postLanternImageNotification({
    chatId: payload.chatId,
    fileId,
    kind: { kind: 'avatar', characterName: character.name },
    prompt,
  });
}
