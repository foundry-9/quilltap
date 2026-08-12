/**
 * API Keys API v1 - Collection Endpoint
 *
 * GET /api/v1/api-keys - List all API keys for current user
 * POST /api/v1/api-keys - Create a new API key
 * POST /api/v1/api-keys?action=auto-associate - Trigger auto-association
 * POST /api/v1/api-keys?action=export - Export keys encrypted with passphrase
 * POST /api/v1/api-keys?action=import - Import keys from export file
 * POST /api/v1/api-keys?action=import-preview - Preview import file
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { withCollectionActionDispatch, getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { getUserRepositories } from '@/lib/repositories/factory';
import { maskApiKey, encryptWithPassphrase, decryptWithPassphrase, signWithPassphrase, verifyWithPassphrase } from '@/lib/encryption';
import { Provider } from '@/lib/schemas/types';
import { getAllAvailableProviders } from '@/lib/llm';
import { logger } from '@/lib/logger';
import { autoAssociateApiKeys, autoAssociateAllKeys, type ProfileAssociation } from '@/lib/api-keys/auto-associate';
import { badRequest, serverError } from '@/lib/api/responses';

// Constants for export/import
const EXPORT_FORMAT = 'quilltap-apikeys';
const EXPORT_VERSION = 1;
const SUPPORTED_VERSIONS = [1];
const MIN_PASSPHRASE_LENGTH = 8;

// Types for export/import
interface ExportPayload {
  keys: Array<{
    provider: string;
    label: string;
    apiKey: string;
  }>;
}

interface ImportFile {
  format: string;
  version: number;
  exportedAt: string;
  keyCount: number;
  encryption: {
    algorithm: string;
    kdf: string;
    kdfIterations: number;
    salt: string;
  };
  payload: {
    ciphertext: string;
    iv: string;
    authTag: string;
  };
  signature: string;
}

type DuplicateHandling = 'skip' | 'replace' | 'rename';

const API_KEYS_POST_ACTIONS = ['auto-associate', 'export', 'import', 'import-preview'] as const;
type ApiKeysPostAction = typeof API_KEYS_POST_ACTIONS[number];

/**
 * GET /api/v1/api-keys
 * List all API keys for the authenticated user (masked)
 */
export const GET = createContextHandler(async (req, { user }) => {
  try {

    const repos = getUserRepositories(user.id);
    const apiKeys = await repos.connections.getAllApiKeys();

    // Sort by creation date (newest first)
    const sortedKeys = apiKeys.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Mask the encrypted keys for security
    const maskedKeys = sortedKeys.map((key) => ({
      id: key.id,
      provider: key.provider,
      label: key.label,
      isActive: key.isActive,
      lastUsed: key.lastUsed,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      keyPreview: maskApiKey(key.key_value.substring(0, 32)),
    }));

    const response = NextResponse.json({
      apiKeys: maskedKeys,
      count: maskedKeys.length,
    });
    response.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    return response;
  } catch (error) {
    logger.error('[API Keys v1] Error listing keys', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch API keys');
  }
});

/**
 * POST /api/v1/api-keys - Create a new API key (default action)
 */
async function handleCreate(req: NextRequest, user: { id: string }) {
  try {
    const body = await req.json();
    const { provider, label, apiKey } = body;

    // Validation
    if (!provider || typeof provider !== 'string' || provider.trim().length === 0) {
      return badRequest('Invalid provider');
    }

    // Check if provider is registered (warn but allow for future plugins)
    const availableProviders = getAllAvailableProviders();
    if (!availableProviders.includes(provider)) {
      logger.warn('[API Keys v1] Key created for unregistered provider', { provider });
    }

    if (!label || typeof label !== 'string' || label.trim().length === 0) {
      return badRequest('Label is required');
    }

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return badRequest('API key is required');
    }

    const repos = getUserRepositories(user.id);

    // Store in database
    const newKey = await repos.connections.createApiKey({
      provider: provider as Provider,
      label: label.trim(),
      key_value: apiKey,
      isActive: true,
    });

    // Auto-associate the new key with profiles that need it
    const associationResult = await autoAssociateApiKeys(user.id, [newKey.id]);

    logger.info('[API Keys v1] Key created', {
      keyId: newKey.id,
      provider: newKey.provider,
      associations: associationResult.associations.length,
    });

    return NextResponse.json(
      {
        apiKey: {
          id: newKey.id,
          provider: newKey.provider,
          label: newKey.label,
          isActive: newKey.isActive,
          createdAt: newKey.createdAt,
          updatedAt: newKey.updatedAt,
          associations: associationResult.associations,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('[API Keys v1] Error creating key', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to create API key');
  }
}

/**
 * POST /api/v1/api-keys?action=auto-associate
 * Trigger auto-association of API keys with profiles
 */
async function handleAutoAssociate(req: NextRequest, user: { id: string }) {
  try {

    const result = await autoAssociateAllKeys(user.id);

    logger.info('[API Keys v1] Auto-association completed', {
      userId: user.id,
      associations: result.associations.length,
      errors: result.errors.length,
    });

    return NextResponse.json({
      success: true,
      associations: result.associations,
      errors: result.errors,
    });
  } catch (error) {
    logger.error('[API Keys v1] Error in auto-association', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to run auto-association');
  }
}

/**
 * POST /api/v1/api-keys?action=export
 * Export all API keys encrypted with a user-provided passphrase
 */
async function handleExport(req: NextRequest, user: { id: string }) {
  try {
    const body = await req.json();
    const { passphrase } = body;

    // Validate passphrase
    if (!passphrase || typeof passphrase !== 'string') {
      return badRequest('Passphrase is required');
    }

    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      return badRequest(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
    }


    const repos = getUserRepositories(user.id);
    const apiKeys = await repos.connections.getAllApiKeys();

    if (apiKeys.length === 0) {
      return badRequest('No API keys to export');
    }

    // Build the payload from plaintext keys
    const decryptedKeys: ExportPayload['keys'] = apiKeys.map((key) => ({
      provider: key.provider,
      label: key.label,
      apiKey: key.key_value,
    }));

    const payload: ExportPayload = { keys: decryptedKeys };

    // Encrypt the payload with the passphrase
    const encrypted = encryptWithPassphrase(payload, passphrase);

    // Sign the encrypted payload for integrity verification
    const payloadJson = JSON.stringify({
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });
    const signature = signWithPassphrase(payloadJson, passphrase);

    // Build the export file
    const exportFile = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      keyCount: decryptedKeys.length,
      encryption: {
        algorithm: 'aes-256-gcm',
        kdf: 'pbkdf2',
        kdfIterations: 100000,
        salt: encrypted.salt,
      },
      payload: {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
      signature,
    };

    logger.info('[API Keys v1] Export completed', {
      userId: user.id,
      keyCount: decryptedKeys.length,
    });

    return NextResponse.json(exportFile);
  } catch (error) {
    logger.error('[API Keys v1] Error exporting keys', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to export API keys');
  }
}

/**
 * POST /api/v1/api-keys?action=import
 * Import API keys from export file
 */
async function handleImport(req: NextRequest, user: { id: string }) {
  try {
    const body = await req.json();
    const { file, passphrase, duplicateHandling = 'skip' } = body;

    // Validate inputs
    if (!file || typeof file !== 'object') {
      return badRequest('Import file is required');
    }

    if (!passphrase || typeof passphrase !== 'string') {
      return badRequest('Passphrase is required');
    }

    if (!['skip', 'replace', 'rename'].includes(duplicateHandling)) {
      return badRequest('Invalid duplicate handling option');
    }

    const importFile = file as ImportFile;
    const handling = duplicateHandling as DuplicateHandling;

    // Validate file format
    if (importFile.format !== EXPORT_FORMAT) {
      return badRequest('Invalid file format');
    }

    if (!SUPPORTED_VERSIONS.includes(importFile.version)) {
      return badRequest(`Unsupported file version: ${importFile.version}`);
    }// Decrypt the payload
    let payload: ExportPayload;
    try {
      payload = decryptWithPassphrase<ExportPayload>(
        {
          salt: importFile.encryption.salt,
          iv: importFile.payload.iv,
          ciphertext: importFile.payload.ciphertext,
          authTag: importFile.payload.authTag,
        },
        passphrase
      );
    } catch (error) {return badRequest('Invalid passphrase or corrupted file');
    }

    // Validate payload
    if (!payload.keys || !Array.isArray(payload.keys)) {
      return badRequest('Invalid payload structure');
    }

    const repos = getUserRepositories(user.id);
    const existingKeys = await repos.connections.getAllApiKeys();

    const result = {
      imported: 0,
      skipped: 0,
      replaced: 0,
      errors: [] as string[],
      associations: [] as ProfileAssociation[],
    };

    // Track IDs of newly imported/replaced keys for auto-association
    const newKeyIds: string[] = [];

    for (const key of payload.keys) {
      try {
        // Validate key data
        if (!key.provider || !key.label || !key.apiKey) {
          result.errors.push('Invalid key data: missing required fields');
          continue;
        }

        // Find duplicate by provider + label
        const existing = existingKeys.find(
          (e) => e.provider === key.provider && e.label === key.label
        );

        if (existing) {
          if (handling === 'skip') {
            result.skipped++;
            continue;
          } else if (handling === 'replace') {
            // Update existing key
            await repos.connections.updateApiKey(existing.id, {
              key_value: key.apiKey,
            });
            newKeyIds.push(existing.id);
            result.replaced++;
            continue;
          }
          // For 'rename', fall through to create with modified label
        }

        // Determine label (may be modified for rename)
        let label = key.label;
        if (existing && handling === 'rename') {
          let counter = 1;
          let newLabel = `${key.label} (imported)`;
          while (
            existingKeys.some((e) => e.label === newLabel) ||
            payload.keys.some((k) => k !== key && k.label === newLabel)
          ) {
            counter++;
            newLabel = `${key.label} (imported ${counter})`;
          }
          label = newLabel;
        }

        // Create the new key
        const newKey = await repos.connections.createApiKey({
          provider: key.provider as Provider,
          label,
          key_value: key.apiKey,
          isActive: true,
        });

        newKeyIds.push(newKey.id);
        result.imported++;
      } catch (error) {
        logger.error('[API Keys v1] Failed to import key', {
          provider: key.provider,
          label: key.label,
        }, error instanceof Error ? error : undefined);
        result.errors.push(
          `Failed to import key "${key.label}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    // Auto-associate new keys with profiles that need them
    if (newKeyIds.length > 0) {const associationResult = await autoAssociateApiKeys(user.id, newKeyIds);
      result.associations = associationResult.associations;

      if (associationResult.errors.length > 0) {
        result.errors.push(...associationResult.errors);
      }
    }

    logger.info('[API Keys v1] Import completed', {
      userId: user.id,
      imported: result.imported,
      skipped: result.skipped,
      replaced: result.replaced,
      associations: result.associations.length,
      errors: result.errors.length,
    });

    return NextResponse.json(result);
  } catch (error) {
    logger.error('[API Keys v1] Error importing keys', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to import API keys');
  }
}

/**
 * POST /api/v1/api-keys?action=import-preview
 * Preview keys in an import file
 */
async function handleImportPreview(req: NextRequest, user: { id: string }) {
  try {
    const body = await req.json();
    const { file, passphrase } = body;

    // Validate inputs
    if (!file || typeof file !== 'object') {
      return NextResponse.json({ valid: false, error: 'Import file is required' }, { status: 400 });
    }

    if (!passphrase || typeof passphrase !== 'string') {
      return NextResponse.json({ valid: false, error: 'Passphrase is required' }, { status: 400 });
    }

    const importFile = file as ImportFile;

    // Validate file format
    if (importFile.format !== EXPORT_FORMAT) {
      return NextResponse.json({ valid: false, error: 'Invalid file format' }, { status: 400 });
    }

    if (!SUPPORTED_VERSIONS.includes(importFile.version)) {
      return NextResponse.json(
        { valid: false, error: `Unsupported file version: ${importFile.version}` },
        { status: 400 }
      );
    }

    // Validate required fields
    if (
      !importFile.encryption?.salt ||
      !importFile.payload?.ciphertext ||
      !importFile.payload?.iv ||
      !importFile.payload?.authTag
    ) {
      return NextResponse.json({ valid: false, error: 'Invalid file structure' }, { status: 400 });
    }// Verify signature (warn but don't block if invalid)
    const payloadJson = JSON.stringify({
      ciphertext: importFile.payload.ciphertext,
      iv: importFile.payload.iv,
      authTag: importFile.payload.authTag,
    });
    const signatureValid = verifyWithPassphrase(payloadJson, importFile.signature, passphrase);

    if (!signatureValid) {
      logger.warn('[API Keys v1] Import file signature verification failed', { userId: user.id });
    }

    // Attempt to decrypt the payload
    let payload: ExportPayload;
    try {
      payload = decryptWithPassphrase<ExportPayload>(
        {
          salt: importFile.encryption.salt,
          iv: importFile.payload.iv,
          ciphertext: importFile.payload.ciphertext,
          authTag: importFile.payload.authTag,
        },
        passphrase
      );
    } catch (error) {return NextResponse.json(
        { valid: false, error: 'Invalid passphrase or corrupted file' },
        { status: 400 }
      );
    }

    // Validate payload structure
    if (!payload.keys || !Array.isArray(payload.keys)) {
      return NextResponse.json({ valid: false, error: 'Invalid payload structure' }, { status: 400 });
    }

    // Get existing keys to check for duplicates
    const repos = getUserRepositories(user.id);
    const existingKeys = await repos.connections.getAllApiKeys();

    // Build preview response
    const previewKeys: Array<{
      provider: string;
      label: string;
      keyPreview: string;
      isDuplicate: boolean;
      existingId?: string;
    }> = [];
    let duplicateCount = 0;

    for (const key of payload.keys) {
      const existing = existingKeys.find(
        (e) => e.provider === key.provider && e.label === key.label
      );

      if (existing) {
        duplicateCount++;
      }

      previewKeys.push({
        provider: key.provider,
        label: key.label,
        keyPreview: maskApiKey(key.apiKey),
        isDuplicate: !!existing,
        existingId: existing?.id,
      });
    }

    logger.info('[API Keys v1] Import preview completed', {
      userId: user.id,
      keyCount: previewKeys.length,
      duplicateCount,
      signatureValid,
    });

    return NextResponse.json({
      valid: true,
      signatureValid,
      keyCount: previewKeys.length,
      keys: previewKeys,
      duplicateCount,
    });
  } catch (error) {
    logger.error('[API Keys v1] Error previewing import file', {}, error instanceof Error ? error : undefined);
    return NextResponse.json({ valid: false, error: 'Failed to preview import file' }, { status: 500 });
  }
}

/**
 * POST /api/v1/api-keys - Action dispatch or create
 */
export const POST = createContextHandler(async (req, { user }) => {
  const action = getActionParam(req);

  // No action or unknown action = create new key (existing behavior)
  if (!action || !isValidAction(action, API_KEYS_POST_ACTIONS)) {
    return handleCreate(req, user);
  }

  const actionHandlers: Record<ApiKeysPostAction, () => Promise<NextResponse>> = {
    'auto-associate': () => handleAutoAssociate(req, user),
    export: () => handleExport(req, user),
    import: () => handleImport(req, user),
    'import-preview': () => handleImportPreview(req, user),
  };

  return actionHandlers[action]();
});
