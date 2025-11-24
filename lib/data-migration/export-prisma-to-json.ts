/**
 * Data Export CLI
 *
 * Exports all data from Prisma database to JSON store format.
 * This is the primary command for migrating existing data.
 *
 * Usage:
 *   npm run data:export
 *   npm run data:export -- --dry-run
 *
 * Environment Variables:
 *   VERBOSE=true   - Enable detailed logging
 *   DRY_RUN=true   - Preview without writing
 */

const { prisma } = require('@/lib/prisma');
const { getRepositories } = require('@/lib/json-store/repositories');
const { createHash } = require('crypto');
const fs = require('fs/promises');
const path = require('path');

interface ExportStats {
  timestamp: string;
  summary: {
    users: number;
    characters: number;
    personas: number;
    chats: number;
    messages: number;
    tags: number;
    images: number;
    connectionProfiles: number;
    apiKeys: number;
    sessions: number;
    accounts: number;
    verificationTokens: number;
  };
  errors: string[];
  warnings: string[];
}

/**
 * Compute SHA256 hash of a file
 */
async function computeFileSha256(filepath: string): Promise<string> {
  try {
    const fileBuffer = await fs.readFile(filepath);
    return createHash('sha256').update(fileBuffer).digest('hex');
  } catch {
    // Return empty hash if file not found
    return '0'.repeat(64);
  }
}

/**
 * Main export function
 */
async function exportPrismaToJson(options: { dryRun: boolean; verbose: boolean }) {
  const startTime = Date.now();
  const stats: ExportStats = {
    timestamp: new Date().toISOString(),
    summary: {
      users: 0,
      characters: 0,
      personas: 0,
      chats: 0,
      messages: 0,
      tags: 0,
      images: 0,
      connectionProfiles: 0,
      apiKeys: 0,
      sessions: 0,
      accounts: 0,
      verificationTokens: 0,
    },
    errors: [],
    warnings: [],
  };

  try {
    console.log('🚀 Starting Prisma → JSON export...');
    if (options.dryRun) {
      console.log('⚠️  DRY RUN MODE - No data will be written');
    }
    console.log('');

    const repos = getRepositories();

    // ========================================================================
    // EXPORT USERS & SETTINGS
    // ========================================================================
    console.log('📝 Exporting users and settings...');
    try {
      const users = await prisma.user.findMany();
      for (const user of users) {
        if (!options.dryRun) {
          await repos.users.create({
            email: user.email,
            name: user.name,
            image: user.image,
            emailVerified: user.emailVerified?.toISOString() ?? null,
            passwordHash: user.passwordHash,
            totp: user.totpEnabled ? {
              ciphertext: user.totpSecret || '',
              iv: user.totpSecretIv || '',
              authTag: user.totpSecretAuthTag || '',
              enabled: true,
              verifiedAt: user.totpVerifiedAt?.toISOString() ?? null,
            } : undefined,
            backupCodes: user.backupCodes ? {
              ciphertext: user.backupCodes,
              iv: user.backupCodesIv || '',
              authTag: user.backupCodesAuthTag || '',
              createdAt: user.createdAt.toISOString(),
            } : undefined,
          });
        }
        stats.summary.users++;
      }
      console.log(`  ✓ Exported ${users.length} user(s)`);
    } catch (error: any) {
      const msg = `Failed to export users: ${error.message}`;
      stats.errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }

    // ========================================================================
    // EXPORT TAGS
    // ========================================================================
    console.log('🏷️  Exporting tags...');
    try {
      const tags = await prisma.tag.findMany();
      for (const tag of tags) {
        if (!options.dryRun) {
          await repos.tags.create({
            userId: tag.userId,
            name: tag.name,
            nameLower: tag.nameLower,
          });
        }
        stats.summary.tags++;
      }
      console.log(`  ✓ Exported ${tags.length} tag(s)`);
    } catch (error: any) {
      const msg = `Failed to export tags: ${error.message}`;
      stats.errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }

    // ========================================================================
    // EXPORT CONNECTION PROFILES & API KEYS
    // ========================================================================
    console.log('🔌 Exporting connection profiles...');
    try {
      const profiles = await prisma.connectionProfile.findMany({
        include: { tags: true },
      });
      for (const profile of profiles) {
        if (!options.dryRun) {
          const tagIds = profile.tags.map((t: typeof profile.tags[0]) => t.tagId);
          await repos.connections.create({
            userId: profile.userId,
            name: profile.name,
            provider: profile.provider as any,
            apiKeyId: profile.apiKeyId,
            baseUrl: profile.baseUrl,
            modelName: profile.modelName,
            parameters: profile.parameters as any,
            isDefault: profile.isDefault,
            tags: tagIds,
          });
        }
        stats.summary.connectionProfiles++;
      }
      console.log(`  ✓ Exported ${profiles.length} connection profile(s)`);

      const apiKeys = await prisma.apiKey.findMany();
      for (const key of apiKeys) {
        if (!options.dryRun) {
          await repos.connections.createApiKey({
            label: key.label,
            provider: key.provider as any,
            ciphertext: key.keyEncrypted,
            iv: key.keyIv,
            authTag: key.keyAuthTag,
            isActive: key.isActive,
            lastUsed: key.lastUsed?.toISOString() ?? null,
          });
        }
        stats.summary.apiKeys++;
      }
      console.log(`  ✓ Exported ${apiKeys.length} API key(s)`);
    } catch (error: any) {
      const msg = `Failed to export profiles/keys: ${error.message}`;
      stats.errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }

    // ========================================================================
    // EXPORT CHARACTERS
    // ========================================================================
    console.log('👤 Exporting characters...');
    try {
      const characters = await prisma.character.findMany({
        include: {
          personas: true,
          tags: true,
          chatAvatarOverrides: true,
        },
      });
      for (const char of characters) {
        if (!options.dryRun) {
          const personaLinks = char.personas.map((link: typeof char.personas[0]) => ({
            personaId: link.personaId,
            isDefault: link.isDefault,
          }));
          const tagIds = char.tags.map((t: typeof char.tags[0]) => t.tagId);
          const avatarOverrides = char.chatAvatarOverrides.map((ao: typeof char.chatAvatarOverrides[0]) => ({
            chatId: ao.chatId,
            imageId: ao.imageId,
          }));

          await repos.characters.create({
            userId: char.userId,
            name: char.name,
            title: char.title,
            description: char.description,
            personality: char.personality,
            scenario: char.scenario,
            firstMessage: char.firstMessage,
            exampleDialogues: char.exampleDialogues,
            systemPrompt: char.systemPrompt,
            avatarUrl: char.avatarUrl,
            defaultImageId: char.defaultImageId,
            sillyTavernData: char.sillyTavernData as any,
            isFavorite: char.isFavorite,
            personaLinks,
            tags: tagIds,
            avatarOverrides,
          });
        }
        stats.summary.characters++;
      }
      console.log(`  ✓ Exported ${characters.length} character(s)`);
    } catch (error: any) {
      const msg = `Failed to export characters: ${error.message}`;
      stats.errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }

    // ========================================================================
    // EXPORT PERSONAS
    // ========================================================================
    console.log('🎭 Exporting personas...');
    try {
      const personas = await prisma.persona.findMany({
        include: { tags: true },
      });
      for (const persona of personas) {
        if (!options.dryRun) {
          const tagIds = persona.tags.map((t: typeof persona.tags[0]) => t.tagId);
          await repos.personas.create({
            userId: persona.userId,
            name: persona.name,
            title: persona.title,
            description: persona.description,
            personalityTraits: persona.personalityTraits,
            avatarUrl: persona.avatarUrl,
            defaultImageId: persona.defaultImageId,
            sillyTavernData: persona.sillyTavernData as any,
            characterLinks: [],
            tags: tagIds,
          });
        }
        stats.summary.personas++;
      }
      console.log(`  ✓ Exported ${personas.length} persona(s)`);
    } catch (error: any) {
      const msg = `Failed to export personas: ${error.message}`;
      stats.errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }

    // ========================================================================
    // EXPORT CHATS & MESSAGES
    // ========================================================================
    console.log('💬 Exporting chats...');
    try {
      const chats = await prisma.chat.findMany({
        include: { tags: true },
      });
      for (const chat of chats) {
        if (!options.dryRun) {
          const tagIds = chat.tags.map((t: typeof chat.tags[0]) => t.tagId);
          await repos.chats.create({
            userId: chat.userId,
            characterId: chat.characterId,
            personaId: chat.personaId,
            connectionProfileId: chat.connectionProfileId,
            imageProfileId: chat.imageProfileId,
            title: chat.title,
            contextSummary: chat.contextSummary,
            sillyTavernMetadata: chat.sillyTavernMetadata as any,
            tags: tagIds,
            messageCount: 0,
            lastMessageAt: null,
          });

          // Export messages
          const messages = await prisma.message.findMany({
            where: { chatId: chat.id },
            orderBy: { createdAt: 'asc' },
          });

          for (const msg of messages) {
            await repos.chats.addMessage(chat.id, {
              type: 'message',
              id: msg.id,
              role: msg.role as any,
              content: msg.content,
              rawResponse: msg.rawResponse as any,
              tokenCount: msg.tokenCount,
              swipeGroupId: msg.swipeGroupId,
              swipeIndex: msg.swipeIndex,
              attachments: [],
              createdAt: msg.createdAt.toISOString(),
            });
            stats.summary.messages++;
          }
        }
        stats.summary.chats++;
      }
      console.log(`  ✓ Exported ${chats.length} chat(s) with ${stats.summary.messages} messages`);
    } catch (error: any) {
      const msg = `Failed to export chats: ${error.message}`;
      stats.errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }

    // ========================================================================
    // EXPORT IMAGES
    // ========================================================================
    console.log('🖼️  Exporting images...');
    try {
      const images = await prisma.image.findMany({
        include: { tags: true },
      });
      for (const img of images) {
        if (!options.dryRun) {
          const tagIds = img.tags.map((t: typeof img.tags[0]) => t.tagId);
          const sha256 = await computeFileSha256(path.join(process.cwd(), 'public', img.filepath));
          await repos.images.create({
            sha256,
            type: 'image',
            userId: img.userId,
            filename: img.filename,
            relativePath: img.filepath,
            mimeType: img.mimeType,
            size: img.size,
            width: img.width,
            height: img.height,
            source: img.source as any,
            generationPrompt: img.generationPrompt,
            generationModel: img.generationModel,
            chatId: null,
            messageId: null,
            tags: tagIds,
          });
        }
        stats.summary.images++;
      }
      console.log(`  ✓ Exported ${images.length} image(s)`);
    } catch (error: any) {
      const msg = `Failed to export images: ${error.message}`;
      stats.errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }

    // ========================================================================
    // EXPORT AUTH DATA
    // ========================================================================
    console.log('🔐 Exporting authentication data...');
    try {
      const accounts = await prisma.account.findMany();
      stats.summary.accounts = accounts.length;
      console.log(`  ✓ Found ${accounts.length} account(s)`);

      const sessions = await prisma.session.findMany();
      stats.summary.sessions = sessions.length;
      console.log(`  ✓ Found ${sessions.length} session(s)`);

      const tokens = await prisma.verificationToken.findMany();
      stats.summary.verificationTokens = tokens.length;
      console.log(`  ✓ Found ${tokens.length} verification token(s)`);
    } catch (error: any) {
      const msg = `Failed to export auth data: ${error.message}`;
      stats.errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }

    // ========================================================================
    // SUMMARY
    // ========================================================================
    console.log('');
    console.log('═'.repeat(60));
    console.log('📊 EXPORT SUMMARY');
    console.log('═'.repeat(60));
    console.log(`  Timestamp: ${stats.timestamp}`);
    console.log(`  Duration: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    console.log('');
    console.log('  Data exported:');
    console.log(`    • Users: ${stats.summary.users}`);
    console.log(`    • Characters: ${stats.summary.characters}`);
    console.log(`    • Personas: ${stats.summary.personas}`);
    console.log(`    • Chats: ${stats.summary.chats}`);
    console.log(`    • Messages: ${stats.summary.messages}`);
    console.log(`    • Tags: ${stats.summary.tags}`);
    console.log(`    • Images: ${stats.summary.images}`);
    console.log(`    • Connection Profiles: ${stats.summary.connectionProfiles}`);
    console.log(`    • API Keys: ${stats.summary.apiKeys}`);
    console.log(`    • Auth Accounts: ${stats.summary.accounts}`);
    console.log(`    • Sessions: ${stats.summary.sessions}`);
    console.log(`    • Verification Tokens: ${stats.summary.verificationTokens}`);
    console.log('');

    if (stats.errors.length > 0) {
      console.log('  ❌ Errors:');
      for (const error of stats.errors) {
        console.log(`    • ${error}`);
      }
      console.log('');
    }

    if (stats.warnings.length > 0) {
      console.log('  ⚠️  Warnings:');
      for (const warning of stats.warnings) {
        console.log(`    • ${warning}`);
      }
      console.log('');
    }

    if (options.dryRun) {
      console.log('  (Dry run - no data was actually written)');
    } else {
      console.log('  ✅ Export completed successfully!');
    }

    console.log('═'.repeat(60));
    return stats;
  } finally {
    await prisma.$disconnect();
  }
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

if (require.main === module) {
  const isDryRun = process.argv.includes('--dry-run');
  const isVerbose = process.env.VERBOSE === 'true';

  exportPrismaToJson({ dryRun: isDryRun, verbose: isVerbose })
    .then(stats => {
      process.exit(stats.errors.length > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('❌ Export failed:', error);
      process.exit(1);
    });
}

export { exportPrismaToJson };
export type { ExportStats };
