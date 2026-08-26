/**
 * Characters Repository
 *
 * Backend-agnostic repository for Character entities.
 * Works with SQLite through the database abstraction layer.
 * Handles CRUD operations and advanced queries for Character entities.
 */

import { Character, CharacterInput, CharacterSchema, CharacterSystemPrompt, CharacterScenario } from '@/lib/schemas/types';
import { TaggableBaseRepository, CreateOptions } from './base.repository';
import { logger } from '@/lib/logger';
import { TypedQueryFilter, UpdateSpec } from '../interfaces';
import {
  applyDocumentStoreOverlay,
  applyDocumentStoreOverlayOne,
  applyDocumentStoreWriteOverlay,
  MANAGED_FIELDS,
} from './character-properties-overlay';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';

export class CharacterArchivedError extends Error {
  constructor(characterId: string, message = 'this character is archived; rehydrate it to continue') {
    super(message);
    this.name = 'CharacterArchivedError';
    this.message = `Character ${characterId} is archived: ${message}`;
  }
}

/**
 * Guard every write to an archived character.
 *
 * Archiving prunes the vault in place (§4.2a): an archived character keeps a
 * live, writable vault, and this guard — running before the write overlay — is
 * what stands between that vault and an edit arriving through the repository.
 *
 * A tombstone is read-only with exactly one exception: **unarchive**, the
 * single-key patch that clears `archivedAt`. Nothing else is sanctioned — in
 * particular, nulling `characterDocumentMountPointId` (the old
 * archive-finalization patch) is refused, because nothing legitimately nulls
 * the pointer any more: the vault survives the archive.
 */
export function validateCharacterArchivePatch(existing: Partial<Character> | null, data: Partial<Character>): void {
  if (!existing?.archivedAt) {
    return;
  }

  const keys = Object.keys(data);

  const isSanctionedUnarchive = keys.length === 1 && 'archivedAt' in data && data.archivedAt === null;
  if (isSanctionedUnarchive) {
    return;
  }

  throw new CharacterArchivedError(existing.id ?? 'unknown');
}

/**
 * Characters Repository
 * Implements CRUD operations for characters with support for tags, personas, favorites, and physical descriptions.
 */
export class CharactersRepository extends TaggableBaseRepository<Character> {
  constructor() {
    super('characters', CharacterSchema);
  }

  /**
   * Find a character by ID
   * @param id The character ID
   * @returns Promise<Character | null> The character if found, null otherwise
   */
  async findById(id: string): Promise<Character | null> {
    const raw = await this._findById(id);
    return applyDocumentStoreOverlayOne(raw);
  }

  /**
   * Find a character by ID **without applying the vault overlay**. The returned
   * Character has empty / default values for every managed field (identity,
   * description, manifesto, personality, exampleDialogues, title, firstMessage,
   * talkativeness, pronouns, aliases, physicalDescription, systemPrompts,
   * scenarios) because the DB columns for those fields were dropped in the 4.6
   * cutover and now live exclusively in the character vault.
   *
   * **Almost no caller wants this.** Use {@link findById} for any normal
   * read — it overlays the vault and returns the character users see in the
   * UI. The legitimate exceptions are:
   *
   * - The overlay's own bootstrap code (it needs to read the row before it can
   *   apply itself), inside {@link ./character-properties-overlay}.
   * - Startup migrations and backfills that operate on the DB row directly
   *   (e.g. {@link ../../startup/backfill-character-vaults}), where the
   *   overlay either isn't ready or isn't desired.
   *
   * Adding new callers requires a comment justifying why the overlay must be
   * skipped — otherwise you almost certainly want `findById`.
   */
  async findByIdRaw(id: string): Promise<Character | null> {
    return this._findById(id);
  }

  /**
   * Find all characters
   * @returns Promise<Character[]> Array of all characters
   */
  async findAll(): Promise<Character[]> {
    const raw = await this._findAll();
    return applyDocumentStoreOverlay(raw);
  }

  /**
   * Find all characters **without applying the vault overlay**. See the warnings
   * on {@link findByIdRaw}. Reserved for startup migrations / backfills and the
   * overlay's own bootstrap.
   */
  async findAllRaw(): Promise<Character[]> {
    return this._findAll();
  }

  /**
   * Find characters by user ID
   * @param userId The user ID
   * @returns Promise<Character[]> Array of characters belonging to the user
   */
  async findByUserId(userId: string): Promise<Character[]> {
    const raw = await super.findByUserId(userId);
    return applyDocumentStoreOverlay(raw);
  }

  /**
   * Find user-controlled characters by user ID
   * @param userId The user ID
   * @returns Promise<Character[]> Array of user-controlled characters
   */
  async findUserControlled(userId: string): Promise<Character[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter({
          userId,
          controlledBy: 'user',
        });
        return applyDocumentStoreOverlay(results);
      },
      'Error finding user-controlled characters',
      { userId },
      []
    );
  }

  /**
   * Find LLM-controlled characters by user ID
   * @param userId The user ID
   * @returns Promise<Character[]> Array of LLM-controlled characters
   */
  async findLLMControlled(userId: string): Promise<Character[]> {
    return this.safeQuery(
      async () => {
        // Include characters with no controlledBy field (defaults to llm)
        const results = await this.findByFilter({
          userId,
          $or: [
            { controlledBy: 'llm' },
            { controlledBy: { $exists: false } },
          ],
        } as TypedQueryFilter<Character>);
        return applyDocumentStoreOverlay(results);
      },
      'Error finding LLM-controlled characters',
      { userId },
      []
    );
  }

  /**
   * Find multiple characters by their IDs in a single query
   * @param ids Array of character IDs
   * @returns Promise<Character[]> Array of found characters (may be shorter than input if some IDs don't exist)
   */
  async findByIds(ids: string[]): Promise<Character[]> {
    const raw = await super.findByIds(ids);
    return applyDocumentStoreOverlay(raw);
  }

  /**
   * Find characters that use a specific image as their default
   * @param imageId The image file ID
   * @returns Promise<Character[]> Array of characters using this image as default
   */
  async findByDefaultImageId(imageId: string): Promise<Character[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter({
          defaultImageId: imageId,
        });
        return applyDocumentStoreOverlay(results);
      },
      'Error finding characters by default image ID',
      { imageId },
      []
    );
  }

  /**
   * Find characters that use a specific image in their avatar overrides
   * @param imageId The image file ID
   * @returns Promise<Character[]> Array of characters using this image in overrides
   */
  async findByAvatarOverrideImageId(imageId: string): Promise<Character[]> {
    return this.safeQuery(
      async () => {
        const results = await this.findByFilter({
          'avatarOverrides.imageId': imageId,
        } as TypedQueryFilter<Character>);
        return applyDocumentStoreOverlay(results);
      },
      'Error finding characters by avatar override image ID',
      { imageId },
      []
    );
  }

  /**
   * Find characters with a specific tag
   * @param tagId The tag ID
   * @returns Promise<Character[]> Array of characters with the tag
   */
  async findByTag(tagId: string): Promise<Character[]> {
    const raw = await super.findByTag(tagId);
    return applyDocumentStoreOverlay(raw);
  }

  /**
   * Create a new character.
   *
   * Atomic from the caller's perspective: validates input, inserts the DB row,
   * provisions the character's document-store vault, projects every vault-managed
   * field (identity, description, manifesto, personality, exampleDialogues,
   * title, firstMessage, talkativeness, pronouns, aliases, physicalDescription,
   * systemPrompts, scenarios) into the freshly-scaffolded vault, and sets
   * `characterDocumentMountPointId` on the row. Callers should NOT call
   * `ensureCharacterVault` afterwards — `create()` owns the full operation.
   *
   * Any `characterDocumentMountPointId` in `data` is dropped: a freshly-created
   * character always gets a freshly-provisioned vault, since pointing a new
   * row at an existing vault would cross-link unrelated content.
   *
   * @param data The character data (without id, createdAt, updatedAt). Fields with defaults are optional.
   * @param options Optional CreateOptions to specify ID and createdAt (for sync)
   * @returns Promise<Character> The created character with generated id, timestamps, and linked vault
   */
  async create(
    data: Omit<CharacterInput, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Character> {
    return this.safeQuery(
      async () => {
        // Drop any incoming mountPointId — create always provisions a fresh
        // vault. Importers that carry a source mountPointId in the payload
        // shouldn't reuse it; the import-reconciliation pass remaps that
        // pointer to a vault the importer separately created if applicable.
        const { characterDocumentMountPointId: _droppedMountId, ...rest } = data as Record<string, unknown> & {
          characterDocumentMountPointId?: string | null;
        };

        const characterData = {
          ...rest,
          tags: (rest as Partial<Character>).tags ?? [],
          aliases: (rest as Partial<Character>).aliases ?? [],
          pronouns: (rest as Partial<Character>).pronouns ?? null,
          isFavorite: (rest as Partial<Character>).isFavorite ?? false,
          partnerLinks: (rest as Partial<Character>).partnerLinks ?? [],
          avatarOverrides: (rest as Partial<Character>).avatarOverrides ?? [],
          physicalDescription: (rest as Partial<Character>).physicalDescription ?? null,
          systemPrompts: (rest as Partial<Character>).systemPrompts ?? [],
          scenarios: (rest as Partial<Character>).scenarios ?? [],
          characterDocumentMountPointId: null,
        } as Omit<Character, 'id' | 'createdAt' | 'updatedAt'>;

        const created = await this._create(characterData, options);

        // Provision the vault using the in-memory character (which carries the
        // input's managed-field values). ensureCharacterVault scaffolds folders,
        // writes every managed file via writeCharacterVaultManagedFields, and
        // updates the DB row with the new characterDocumentMountPointId.
        await ensureCharacterVault(created);

        logger.info('Character created', {
          characterId: created.id,
          userId: data.userId,
          name: data.name,
        });

        // Reload through the overlay so the returned character reflects the
        // vault-backed state, including the freshly-set mountPointId.
        const finalCharacter = await this.findById(created.id);
        if (!finalCharacter) {
          throw new Error(`Character ${created.id} disappeared immediately after creation`);
        }
        return finalCharacter;
      },
      'Error creating character',
      { userId: data.userId, name: data.name }
    );
  }

  /**
   * Update a character.
   *
   * Managed content fields (identity, description, manifesto, personality,
   * exampleDialogues, title, firstMessage, talkativeness, pronouns, aliases,
   * physicalDescription, systemPrompts, scenarios) in `data` are routed to
   * the character's vault via {@link applyDocumentStoreWriteOverlay}; the
   * remaining DB-only fields are written through `_update`. The returned
   * character is overlaid through {@link applyDocumentStoreOverlayOne} so
   * callers see the vault-backed view just as {@link findById} would.
   *
   * If a character somehow lacks a vault, `applyDocumentStoreWriteOverlay`
   * auto-provisions one (loud `logger.error` so the upstream bug surfaces)
   * before routing the patch — managed fields are never silently dropped.
   */
  async update(id: string, data: Partial<Character>): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        const existing = await this.findByIdRaw(id);
        validateCharacterArchivePatch(existing, data);

        if (existing?.archivedAt && data.archivedAt === null) {
          logger.info('Rehydrating archived character', { characterId: id });
        }

        const dbPatch = await applyDocumentStoreWriteOverlay(id, data);
        const hasDbWork = Object.keys(dbPatch).length > 0;
        const result = hasDbWork ? await this._update(id, dbPatch) : await this._findById(id);
        return applyDocumentStoreOverlayOne(result);
      },
      'Error updating character',
      { characterId: id }
    );
  }

  /**
   * Vault-aware override of the base `_create`. Mirrors `_update`: strips
   * vault-managed keys before INSERT so callers that pass e.g. `title` or
   * `description` to `create()` don't blow up with "no such column" — those
   * fields belong in the character vault, not the DB row.
   */
  protected async _create(
    data: Omit<Character, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<Character> {
    return this.safeQuery(async () => {
      const id = options?.id || crypto.randomUUID();
      const now = this.getCurrentTimestamp();
      const createdAt = options?.createdAt || now;
      const updatedAt = options?.updatedAt || now;

      const entityInput = {
        ...data,
        id,
        createdAt,
        updatedAt,
      };

      const validated = this.validate(entityInput);

      const dbRow = { ...validated } as Record<string, unknown>;
      for (const f of MANAGED_FIELDS) {
        delete dbRow[f as string];
      }

      const collection = await this.getCollection();
      await collection.insertOne(dbRow as Character);

      logger.info('Entity created', {
        collection: 'characters',
        id,
      });

      return validated;
    }, 'Error creating character entity');
  }

  /**
   * Vault-aware override of the base `_update`. The 4.6 cutover dropped DB
   * columns for vault-managed fields (title, identity, description, manifesto,
   * personality, physicalDescription, pronouns, aliases, firstMessage,
   * talkativeness, exampleDialogues, systemPrompts, scenarios) — they live in
   * the character vault now. The base implementation reads existing state
   * through the overlay-aware `findById`, which rehydrates those fields from
   * the vault; spreading them into `$set` produces UPDATE statements SQLite
   * rejects with "no such column". Read raw here, and strip any managed-field
   * keys before writing as a defensive backstop.
   */
  protected async _update(id: string, data: Partial<Character>): Promise<Character | null> {
    return this.safeQuery(async () => {
      const existing = await this.findByIdRaw(id);
      if (!existing) {
        logger.warn('Entity not found for update', {
          collection: 'characters',
          id,
        });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const merged = {
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: ('updatedAt' in data)
          ? (data as Record<string, unknown>).updatedAt as string
          : now,
      } as Character;

      const validated = this.validate(merged);

      const dbRow = { ...validated } as Record<string, unknown>;
      for (const f of MANAGED_FIELDS) {
        delete dbRow[f as string];
      }

      const collection = await this.getCollection();
      await collection.updateOne(
        { id } as TypedQueryFilter<Character>,
        { $set: dbRow } as UpdateSpec<Character>
      );

      return validated;
    }, 'Error updating character entity', { id });
  }

  /**
   * Delete a character
   * @param id The character ID
   * @returns Promise<boolean> True if character was deleted, false if not found
   */
  async delete(id: string): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const result = await this._delete(id);

        if (result) {
          logger.info('Character deleted', { characterId: id });
        }

        return result;
      },
      'Error deleting character',
      { characterId: id }
    );
  }

  // ============================================================================
  // TAG OPERATIONS
  // ============================================================================

  // ============================================================================
  // PARTNER LINK OPERATIONS
  // ============================================================================

  /**
   * Add a partner link to a character
   * @param characterId The character ID
   * @param partnerId The partner character ID
   * @param isDefault Whether this partner should be the default
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async addPartnerLink(characterId: string, partnerId: string, isDefault = false): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for partner link addition', { characterId });
          return null;
        }

        const existing = character.partnerLinks.find((link) => link.partnerId === partnerId);
        if (!existing) {
          character.partnerLinks.push({ partnerId, isDefault });
          return await this.update(characterId, { partnerLinks: character.partnerLinks });
        }
        return character;
      },
      'Error adding partner link to character',
      { characterId, partnerId }
    );
  }

  /**
   * Remove a partner link from a character
   * @param characterId The character ID
   * @param partnerId The partner character ID
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async removePartnerLink(characterId: string, partnerId: string): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for partner link removal', { characterId });
          return null;
        }

        const beforeCount = character.partnerLinks.length;
        character.partnerLinks = character.partnerLinks.filter((link) => link.partnerId !== partnerId);
        const afterCount = character.partnerLinks.length;

        if (beforeCount !== afterCount) {
          return await this.update(characterId, { partnerLinks: character.partnerLinks });
        }
        return character;
      },
      'Error removing partner link from character',
      { characterId, partnerId }
    );
  }

  // ============================================================================
  // FAVORITE OPERATIONS
  // ============================================================================

  /**
   * Set favorite status for a character
   * @param characterId The character ID
   * @param isFavorite Whether the character is marked as favorite
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async setFavorite(characterId: string, isFavorite: boolean): Promise<Character | null> {
    return this.update(characterId, { isFavorite });
  }

  /**
   * Set controlled-by status for a character
   * @param characterId The character ID
   * @param controlledBy Who controls the character: 'llm' or 'user'
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async setControlledBy(characterId: string, controlledBy: 'llm' | 'user'): Promise<Character | null> {
    return this.update(characterId, { controlledBy });
  }

  /**
   * Set Carina (inline @-query answerer) eligibility for a character
   * @param characterId The character ID
   * @param canBeCarina Whether this character may answer inline @-queries
   * @returns Promise<Character | null> The updated character if found, null otherwise
   */
  async setCanBeCarina(characterId: string, canBeCarina: boolean): Promise<Character | null> {
    return this.update(characterId, { canBeCarina });
  }

  // ============================================================================
  // GENERIC SUB-ARRAY HELPERS
  // ============================================================================

  private async addToSubArray<S extends { id: string; createdAt: string; updatedAt: string }>(
    characterId: string,
    getItems: (c: Character) => S[],
    buildItem: (id: string, now: string) => S,
    applyUpdate: (items: S[]) => Partial<Character>,
    errorMsg: string,
    logContext?: Record<string, unknown>,
    onBeforeAdd?: (existingItems: S[], newItem: S) => void
  ): Promise<S | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn(`Character not found: ${errorMsg}`, { characterId });
          return null;
        }
        const id = this.generateId();
        const now = this.getCurrentTimestamp();
        const newItem = buildItem(id, now);
        const items = getItems(character);
        onBeforeAdd?.(items, newItem);
        items.push(newItem);
        await this.update(characterId, applyUpdate(items));
        return newItem;
      },
      errorMsg,
      { characterId, ...logContext }
    );
  }

  private async updateInSubArray<S extends { id: string; createdAt: string; updatedAt: string }>(
    characterId: string,
    itemId: string,
    getItems: (c: Character) => S[],
    buildUpdated: (existing: S, now: string) => S,
    applyUpdate: (items: S[]) => Partial<Character>,
    errorMsg: string,
    logContext?: Record<string, unknown>,
    onAfterBuild?: (items: S[], index: number, updated: S) => void
  ): Promise<S | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn(`Character not found: ${errorMsg}`, { characterId });
          return null;
        }
        const items = getItems(character);
        const index = items.findIndex((i) => i.id === itemId);
        if (index === -1) {
          logger.warn(`Item not found: ${errorMsg}`, { characterId, itemId });
          return null;
        }
        const now = this.getCurrentTimestamp();
        const updated = buildUpdated(items[index], now);
        onAfterBuild?.(items, index, updated);
        items[index] = updated;
        await this.update(characterId, applyUpdate(items));
        return updated;
      },
      errorMsg,
      { characterId, ...logContext }
    );
  }

  private async removeFromSubArray<S extends { id: string }>(
    characterId: string,
    itemId: string,
    getItems: (c: Character) => S[],
    applyUpdate: (items: S[]) => Partial<Character>,
    errorMsg: string,
    onAfterRemove?: (remaining: S[]) => void
  ): Promise<boolean> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn(`Character not found: ${errorMsg}`, { characterId });
          return false;
        }
        const items = getItems(character);
        const filtered = items.filter((i) => i.id !== itemId);
        if (filtered.length === items.length) {
          logger.warn(`Item not found for removal: ${errorMsg}`, { characterId, itemId });
          return false;
        }
        onAfterRemove?.(filtered);
        await this.update(characterId, applyUpdate(filtered));
        return true;
      },
      errorMsg,
      { characterId, itemId }
    );
  }

  private async getFromSubArray<S extends { id: string }>(
    characterId: string,
    itemId: string,
    getItems: (c: Character) => S[],
    errorMsg: string
  ): Promise<S | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn(`Character not found: ${errorMsg}`, { characterId });
          return null;
        }
        return getItems(character).find((i) => i.id === itemId) ?? null;
      },
      errorMsg,
      { characterId, itemId },
      null
    );
  }

  private async getAllFromSubArray<S>(
    characterId: string,
    getItems: (c: Character) => S[],
    errorMsg: string
  ): Promise<S[]> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn(`Character not found: ${errorMsg}`, { characterId });
          return [];
        }
        return getItems(character);
      },
      errorMsg,
      { characterId },
      []
    );
  }

  // ============================================================================
  // PHYSICAL DESCRIPTION OPERATIONS
  // ============================================================================

  // ============================================================================
  // SYSTEM PROMPT OPERATIONS
  // ============================================================================

  /**
   * Add a system prompt to a character
   * @param characterId The character ID
   * @param data The system prompt data (without id, createdAt, updatedAt)
   * @returns Promise<CharacterSystemPrompt | null> The added prompt if successful
   */
  async addSystemPrompt(
    characterId: string,
    data: Omit<CharacterSystemPrompt, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<CharacterSystemPrompt | null> {
    return this.addToSubArray<CharacterSystemPrompt>(
      characterId,
      (c) => c.systemPrompts ?? [],
      (id, now) => ({ ...data, id, createdAt: now, updatedAt: now }),
      (items) => ({ systemPrompts: items }),
      'Error adding system prompt',
      { promptName: data.name },
      (existingItems, newItem) => {
        if (data.isDefault || existingItems.length === 0) {
          existingItems.forEach((p) => { p.isDefault = false; });
          newItem.isDefault = true;
        }
      }
    );
  }

  /**
   * Update a system prompt
   */
  async updateSystemPrompt(
    characterId: string,
    promptId: string,
    data: Partial<Omit<CharacterSystemPrompt, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<CharacterSystemPrompt | null> {
    return this.updateInSubArray<CharacterSystemPrompt>(
      characterId,
      promptId,
      (c) => c.systemPrompts ?? [],
      (existing, now) => ({ ...existing, ...data, id: existing.id, createdAt: existing.createdAt, updatedAt: now }),
      (items) => ({ systemPrompts: items }),
      'Error updating system prompt',
      { promptId },
      (items, _index, updated) => {
        if (data.isDefault) {
          items.forEach((p) => { p.isDefault = false; });
          updated.isDefault = true;
        }
      }
    );
  }

  /**
   * Delete a system prompt from a character
   */
  async deleteSystemPrompt(characterId: string, promptId: string): Promise<boolean> {
    return this.removeFromSubArray<CharacterSystemPrompt>(
      characterId,
      promptId,
      (c) => c.systemPrompts ?? [],
      (items) => ({ systemPrompts: items }),
      'Error deleting system prompt',
      (remaining) => {
        if (remaining.length > 0 && !remaining.some((p) => p.isDefault)) {
          remaining[0].isDefault = true;
        }
      }
    );
  }

  /**
   * Set a system prompt as default
   */
  async setDefaultSystemPrompt(characterId: string, promptId: string): Promise<Character | null> {
    return this.safeQuery(
      async () => {
        const character = await this.findById(characterId);
        if (!character) {
          logger.warn('Character not found for setting default prompt', { characterId });
          return null;
        }

        const prompts = character.systemPrompts ?? [];
        const targetIndex = prompts.findIndex((p) => p.id === promptId);

        if (targetIndex === -1) {
          logger.warn('System prompt not found', { characterId, promptId });
          return null;
        }

        const now = this.getCurrentTimestamp();
        prompts.forEach((p, i) => {
          p.isDefault = i === targetIndex;
          p.updatedAt = now;
        });

        return this.update(characterId, { systemPrompts: prompts });
      },
      'Error setting default system prompt',
      { characterId, promptId }
    );
  }

  /**
   * Get a single system prompt by ID
   */
  async getSystemPrompt(characterId: string, promptId: string): Promise<CharacterSystemPrompt | null> {
    return this.getFromSubArray<CharacterSystemPrompt>(
      characterId,
      promptId,
      (c) => c.systemPrompts ?? [],
      'Error getting system prompt'
    );
  }

  /**
   * Get all system prompts for a character
   */
  async getSystemPrompts(characterId: string): Promise<CharacterSystemPrompt[]> {
    return this.getAllFromSubArray<CharacterSystemPrompt>(
      characterId,
      (c) => c.systemPrompts ?? [],
      'Error getting system prompts'
    );
  }

  // ============================================================================
  // SCENARIO OPERATIONS
  // ============================================================================

  /**
   * Add a scenario to a character
   * @param characterId The character ID
   * @param data The scenario data (title and content)
   * @returns Promise<CharacterScenario | null> The added scenario if successful, null if character not found
   */
  async addScenario(
    characterId: string,
    data: { title: string; content: string; archived?: boolean }
  ): Promise<CharacterScenario | null> {
    return this.addToSubArray<CharacterScenario>(
      characterId,
      (c) => c.scenarios ?? [],
      (id, now) => ({
        id,
        title: data.title,
        content: data.content,
        // Omission means active; never persist an explicit `archived: false`.
        ...(data.archived === true && { archived: true }),
        createdAt: now,
        updatedAt: now,
      }),
      (items) => ({ scenarios: items }),
      'Error adding scenario',
      { title: data.title }
    );
  }

  /**
   * Update a scenario on a character
   * @param characterId The character ID
   * @param scenarioId The scenario ID
   * @param data Partial scenario data to update (title and/or content)
   * @returns Promise<CharacterScenario | null> The updated scenario if found, null otherwise
   */
  async updateScenario(
    characterId: string,
    scenarioId: string,
    data: { title?: string; content?: string; archived?: boolean }
  ): Promise<CharacterScenario | null> {
    return this.updateInSubArray<CharacterScenario>(
      characterId,
      scenarioId,
      (c) => c.scenarios ?? [],
      (existing, now) => {
        const { archived: _dropped, ...rest } = existing;
        const archived = data.archived ?? existing.archived;
        return {
          ...rest,
          ...data,
          // Omission means active; drop the key rather than writing `false`.
          ...(archived === true ? { archived: true } : {}),
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: now,
        };
      },
      (items) => ({ scenarios: items }),
      'Error updating scenario',
      { scenarioId }
    );
  }

  /**
   * Remove a scenario from a character
   * @param characterId The character ID
   * @param scenarioId The scenario ID
   * @returns Promise<boolean> True if scenario was removed, false if not found
   */
  async removeScenario(characterId: string, scenarioId: string): Promise<boolean> {
    return this.removeFromSubArray<CharacterScenario>(
      characterId,
      scenarioId,
      (c) => c.scenarios ?? [],
      (items) => ({ scenarios: items }),
      'Error removing scenario'
    );
  }

  /**
   * Get all scenarios for a character
   * @param characterId The character ID
   * @returns Promise<CharacterScenario[]> Array of all scenarios for the character
   */
  async getScenarios(characterId: string): Promise<CharacterScenario[]> {
    return this.getAllFromSubArray<CharacterScenario>(
      characterId,
      (c) => c.scenarios ?? [],
      'Error getting scenarios'
    );
  }
}
