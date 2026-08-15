/**
 * Pretty-label table for the startup loading screen.
 *
 * Maps raw labels (migration IDs, subsystem milestones) to human-friendly
 * strings in the project's voice (steampunk + Roaring Twenties + Wodehouse).
 * Unknown labels fall back to a humanized form of the raw id.
 *
 * **Every new migration MUST be added here.** The commit skill enforces this.
 * Without an entry, the loading screen renders the raw migration ID, which
 * leaks an internal name to users.
 */

/**
 * Known pretty labels. Keep entries in steampunk/Wodehouse voice — terse,
 * faintly archaic, oriented around what's happening *to the user's data*
 * rather than the implementation detail.
 *
 * Group entries by subsystem:
 *   - subsystem milestones use the prefix `subsystem:`
 *   - migrations use their migration id (e.g. `add-foo-field-v1`)
 */
const PRETTY_LABELS: Record<string, string> = {
  // ------------------------------------------------------------------------
  // Subsystem milestones (emitted by instrumentation.ts and friends)
  // ------------------------------------------------------------------------
  'subsystem:booting': 'Stoking the boilers',
  'subsystem:locked': 'Awaiting your passphrase',
  'subsystem:unlocking': 'Receiving the passphrase',
  'subsystem:migrations:start': 'Bringing the records up to date',
  'subsystem:migrations:complete': 'Records brought up to date',
  'subsystem:seeding': 'Setting out the initial furnishings',
  'subsystem:plugin-updates:start': 'Polishing the plugin brass',
  'subsystem:plugins:start': 'Mustering the plugins',
  'subsystem:plugins:complete': 'Plugins on duty',
  'subsystem:file-storage:start': 'Reconciling the file ledger',
  'subsystem:file-storage:complete': 'File ledger reconciled',
  'subsystem:reconcile:start': 'Surveying the files on disk',
  'subsystem:reconcile:complete': 'Files surveyed and accounted for',
  'subsystem:mount-index:start': 'Re-indexing the document stores',
  'subsystem:mount-index:complete': 'Document stores indexed',
  'subsystem:vault-backfill:start': 'Tidying the character vaults',
  'subsystem:vault-backfill:complete': 'Character vaults in good order',
  'subsystem:embeddings-backfill:start': 'Brewing fresh embeddings',
  'subsystem:embeddings-backfill:complete': 'Embeddings brewed',
  'subsystem:embedding-repair:start': 'Recasting embeddings into their proper form',
  'subsystem:embedding-repair:complete': 'Embeddings recast',
  'subsystem:ready': 'At your service',
  'subsystem:errored': 'A spanner has been thrown in the works',

  // ------------------------------------------------------------------------
  // Migrations — every migration registered in migrations/scripts/ must
  // have an entry here. The commit skill enforces this rule.
  //
  // Voice: present continuous, terse, faintly archaic. Describe what's
  // happening to the user's data, not the implementation.
  // ------------------------------------------------------------------------

  // Initial schemas and bulk infrastructure
  'sqlite-initial-schema-v1': 'Laying the foundation stones',
  'create-mount-points-v1': 'Setting up the document stores',
  'create-folder-entities-v1': 'Filing the folders',
  'create-embedding-tables-v1': 'Preparing the embedding cabinets',
  'create-wardrobe-items-table-v1': 'Hanging the wardrobe racks',
  'create-instance-settings-table-v1': 'Opening the instance ledger',
  'create-conversation-tables-v1': 'Setting up the conversation registry',
  'create-help-docs-table-v1': 'Stocking the help library',
  'create-help-doc-chunks-table-v1': 'Slipping bookmarks between the chapters of the help library',
  'create-character-plugin-data-table-v1': 'Filing per-plugin character notes',
  'create-outfit-presets-and-archive-v1': 'Cataloguing the outfit presets',
  'add-llm-logs-collection-v1': 'Opening the LLM logbook',
  'add-terminal-sessions-table-v1': 'Wiring up the terminal cabinet',

  // Centralized data + plugins
  'migrate-to-centralized-data-dir-v1': 'Consolidating the data dossier',
  'migrate-user-plugins-to-site-v1': 'Relocating user plugins to the site',
  'migrate-site-plugins-to-data-dir-v1': 'Moving plugins into the data dir',
  'remove-auth-tables-v1': 'Dismantling old auth scaffolding',
  'reencrypt-api-keys-v1': 'Re-encrypting the API keys',
  'decrypt-api-key-values-v1': 'Decrypting stray API key values',
  'drop-api-key-encryption-columns-v1': 'Retiring old API-key columns',

  // 4.6 character vault cutover
  'cutover-characters-to-vault-v1': "Settling every character into their vault for keeps",
  // 4.7 project store cutover
  'cutover-projects-to-store-v1': 'Folding each project into its own document store for good',
  'drop-character-scenario-column-v1': 'Sweeping out a disused scenario drawer',
  // Groups
  'create-groups-table-v1': 'Laying out the ledger for your circles of characters',
  'create-group-join-tables-v1': 'Stitching characters and stores into their groups',

  // Per-character fields
  'add-default-image-profile-field-v1': 'Adding default image profile to characters',
  'add-character-aliases-field-v1': 'Adding aliases to characters',
  'add-character-pronouns-field-v1': 'Adding pronouns to characters',
  'add-character-clothing-records-field-v1': 'Recording wardrobe history on characters',
  'add-character-timestamp-config-field-v1': 'Adding timestamp preferences to characters',
  'add-character-default-ids-fields-v1': 'Wiring character defaults for scenarios + system prompts',
  'add-character-document-mount-point-field-v1': 'Pointing characters at their vaults',
  'add-read-properties-from-document-store-field-v1': 'Letting characters read from their vaults',
  'add-character-wardrobe-flags-v1': 'Adding wardrobe permissions to characters',
  'add-character-system-transparency-field-v1': 'Adding system transparency to characters',
  'add-character-identity-field-v1': 'Adding the identity field to characters',
  'add-character-manifesto-field-v1': 'Adding the manifesto field to characters',
  'add-character-archive-fields-v1': 'Preparing archive tombstones for your characters',
  'add-help-tools-field-v1': 'Granting characters help-tool access',
  'add-character-avatars-fields-v1': 'Adding per-character avatar fields to chats',
  'add-project-avatar-generation-default-v1': 'Adding avatar-generation default to projects',

  // Chat fields
  'add-chat-tool-settings-fields-v1': 'Adding tool settings to chats',
  'add-chat-image-profile-field-v1': 'Moving the image profile onto each chat',
  'add-chat-message-missing-columns-v1': 'Filling in missing chat-message columns',
  'add-chat-message-reasoning-columns-v1': "Setting aside room for each thinker's reasoning",
  'add-thinking-display-fields-v1': 'Wiring up the thinking-visibility switches',
  'add-answer-confirmation-columns-v2': "Vetting the cast's claims against the record",
  'add-chat-scenario-text-field-v1': 'Recording scenario text on each chat',
  'add-chat-type-field-v1': 'Adding chat type field',
  'add-chat-danger-classification-fields-v1': "Adding the Concierge's classification fields",
  'add-chat-concierge-override-v1': "Adding the Concierge's per-chat off-duty switch",
  'add-chat-cross-character-vault-reads-field-v1': 'Adding cross-character vault permission to chats',
  'add-whisper-target-field-v1': 'Adding whisper targets to chat messages',
  'add-turn-queue-field-v1': 'Adding the turn queue to chats',
  'add-scene-state-field-v1': 'Adding scene state tracking to chats',
  'add-silent-message-field-v1': 'Adding silent-message marker to messages',
  'add-rendered-markdown-field-v1': 'Adding rendered markdown to chats',
  'add-system-sender-field-v1': 'Adding the system-sender field to messages',
  'add-system-kind-field-v1': 'Adding the system-kind label to messages',
  'add-host-event-field-v1': "Adding the Host's event field to messages",
  'add-custom-announcer-field-v1': "Preparing the announcer's lectern",
  'add-opaque-content-field-v1': 'Translating Staff dispatches for closed company',
  'add-compiled-identity-stacks-field-v1': 'Compiling identity stacks onto chats',
  'add-equipped-outfit-field-v1': 'Adding equipped-outfit tracking to chats',
  'add-pending-outfit-notifications-field-v1': 'Queuing outfit notifications on chats',
  'add-summarization-gate-fields-v1': 'Adding summarization-gate tracking to chats',
  'add-summary-anchor-field-v1': 'Adding summary anchors to messages',
  'add-summary-anchor-message-ids-field-v1': 'Tracking summary anchor IDs on chats',
  'add-terminal-mode-fields-v1': 'Adding terminal mode fields to chats',
  'add-document-mode-fields-v1': 'Adding document mode fields to chats',
  'add-composition-mode-default-field-v1': 'Adding composition-mode default to chat settings',
  'add-composer-spellcheck-field-v1': 'Teaching the composer to flag misspellings',
  'add-composer-emoji-field-v1': 'Cataloguing the little faces',
  'add-composer-unicode-field-v1': 'Teaching the machine its Greek',
  'add-smart-typography-settings-field-v1': 'Teaching the quotation marks to curtsey',
  'add-text-replacement-rules-table-v1': 'Building the autocorrect ledger',
  'add-text-replacements-enabled-field-v1': 'Wiring the autocorrect master switch',
  'add-auto-scroll-on-response-complete-field-v1': 'Deciding whether the Salon should chase each reply to its end',
  'add-autonomous-rooms-fields-v1': 'Preparing the autonomous salon quarters',
  'add-autonomous-run-paused-at-v1': 'Noting when the salon paused for breath',
  'add-autonomous-run-paused-accum-v1': 'Tallying the salon’s quiet interludes',
  'add-autonomous-budget-cache-mode-v1': 'Reckoning which tokens the salon’s purse shall count',
  'add-autonomous-run-milestones-v1': 'Teaching the Host to call the hour as the salon winds down',
  'add-carina-flag-v1': 'Preparing the reference desk…',
  'add-carina-message-meta-v1': "Filing the reference desk's correspondence…",
  'add-pascal-message-meta-v1': 'Chalking the odds at Pascal’s table…',
  'add-spoken-this-cycle-field-v1': 'Tallying who has held forth in this rotation',
  'add-auto-housekeeping-settings-field-v1': 'Adding auto-housekeeping settings to chats',
  'add-auto-lock-settings-field-v1': 'Adding auto-lock settings to chats',
  'add-auto-detect-rng-field-v1': 'Adding auto-detect-RNG flag to chats',
  'add-custom-tools-field-v1': 'Laying your own contrivances out upon Pascal’s baize',
  'add-memory-extraction-limits-field-v1': 'Adding memory-extraction limits to chats',
  'add-memory-extraction-concurrency-field-v1': 'Adding memory-extraction concurrency to chats',
  'add-memory-gate-fields-v1': 'Adding memory gate fields',
  'add-compression-cache-field-v1': 'Adding the compression cache to chats',

  // Project fields
  'add-project-tool-settings-fields-v1': 'Adding tool settings to projects',
  'add-project-default-image-profile-v1': 'Adding default image profile to projects',
  'add-project-official-mount-point-v1': 'Pointing each project at its official store',
  'add-state-fields-v1': 'Adding state fields to chats and projects',
  'add-agent-mode-fields-v1': 'Adding agent-mode fields to chats and projects',
  'add-story-backgrounds-fields-v1': "Adding the Lantern's background fields",
  'add-lantern-image-alert-fields-v1': "Adding the Lantern's image-alert fields",
  'add-dangerous-content-fields-v1': "Adding the Concierge's dangerous-content fields",

  // Connection profiles
  'add-profile-allow-tool-use-field-v1': 'Adding tool-use flag to connection profiles',
  'add-pseudo-tool-mode-field-v1': 'Choosing the proper instrument for tool conversation',
  'add-profile-multi-character-prefill-field-v1': 'Deciding who is announced at the door',
  'add-profile-supports-image-upload-field-v1': 'Adding image-upload support to connection profiles',
  'add-connection-profile-model-class-field-v1': 'Adding model-class to connection profiles',
  'add-connection-profile-max-tokens-field-v1': 'Adding max-tokens to connection profiles',
  'add-connection-profile-sort-index-v1': 'Adding sort order to connection profiles',
  'add-courier-transport-fields-v1': "Dispatching the Courier's carriage",
  'add-courier-delta-fields-v1': "Teaching the Courier to travel light",
  'add-commonplace-scene-cache-v1': "Marking the Commonplace Book's bookmarks",
  'add-core-whisper-fields-v1': "Fitting Aurora's workshop with a plumb line",
  'add-core-whisper-settings-field-v1': "Hanging Aurora's plumb line from the rafters",
  'add-turn-skipping-field-v1': "Granting the company leave to hold their peace",

  // Embedding + vector
  'normalize-vector-storage-v1': 'Normalising vector storage to Float32 BLOBs',
  'fix-text-embeddings-after-update-v1': 'Mending embeddings that were stored as text',
  'normalize-embeddings-unit-vectors-v1': 'Normalising embeddings to unit length',
  'add-embedding-profile-truncation-fields-v1': 'Adding Matryoshka truncation fields to embedding profiles',
  'apply-embedding-profile-truncation-v1': 'Applying Matryoshka truncation to stored vectors',

  // Wardrobe + outfits
  'migrate-clothing-records-to-wardrobe-v1': 'Moving clothing records into the wardrobe',
  'add-wardrobe-component-item-ids-v1': 'Adding composite-component links to wardrobe items',
  'migrate-outfit-presets-to-composites-v1': 'Folding outfit presets into composite items',
  'convert-equipped-outfit-to-arrays-v1': 'Converting equipped-outfit slots to arrays',
  'drop-outfit-presets-table-v1': 'Retiring the outfit-presets table',
  'drop-wardrobe-items-table-v1': 'Clearing out the old wardrobe ledger',

  // Files + storage
  'fix-missing-storage-keys-v1': 'Mending missing storage keys',
  'cleanup-orphan-file-records-v1': 'Sweeping out orphan file records',
  'add-file-status-field-v1': 'Adding file-status to records',
  'restructure-file-storage-v1': 'Restructuring the file storage layout',
  'restructure-file-storage-cleanup-v1': 'Cleaning up after the file-storage restructure',
  'migrate-legacy-jsonl-files-v1': 'Moving legacy JSONL file entries into SQLite',
  'convert-images-to-webp-v1': 'Converting images to WebP',
  'rename-persona-columns-v1': 'Renaming persona columns on memories',

  // Mount points / Scriptorium / project files
  'per-project-mount-points-v1': 'Setting up per-project mount points',
  'drop-mount-points-v1': 'Retiring the old mount-points system',
  'convert-project-files-to-document-stores-v1': "Moving each project's files into a document store",
  'reabsorb-leftover-project-files-v1': "Re-absorbing leftover project files",
  'relink-files-to-mount-blobs-v1': 'Re-linking files to their mount-blob shims',
  'repair-files-mime-and-size-from-mount-blob-v1': "Squaring each file's stated format with the bytes resting on its shelf",
  'repair-mount-blob-sha256-from-bytes-v1': "Reconciling each file's fingerprint with the bytes on record",
  'add-doc-mount-file-links-v1': 'Reorganising the document index so a single file may inhabit several shelves at once',
  'repair-doc-mount-file-link-folderids-v1': 'Restoring each filed document to its proper drawer',
  'add-uncensored-image-description-profile-field-v1': 'Making room for a more candid set of eyes when describing photographs',
  'migrate-character-photos-to-vault-v1': "Hanging each character's photographs in their own vault",
  'provision-lantern-backgrounds-mount-v1': "Provisioning the Lantern's backgrounds mount",
  'migrate-general-story-backgrounds-to-mount-v1': "Moving story backgrounds into the Lantern's gallery",
  'migrate-character-avatars-to-vaults-v1': "Moving character avatars into each character's vault",
  'provision-user-uploads-mount-v1': 'Provisioning the Quilltap Uploads mount',
  'migrate-remaining-general-to-uploads-v1': 'Sweeping leftover uploads into the Quilltap Uploads mount',
  'provision-general-mount-v1': 'Provisioning the Quilltap General mount',

  // Memory backfills
  'fix-memory-timestamps-from-source-v1': 'Mending memory timestamps from their source messages',
  'align-about-character-id-v1': 'Aligning memory authorship by name presence',
  'align-about-character-id-v2': 'Aligning memory authorship with the holder-dominance rule',
  'add-memories-reinforced-importance-index-v1': 'Sharpening the memory ranking so the salient ones float to the top',
  'repair-dangling-related-memory-edges-v1': 'Pruning phantom links from the memory graph',

  // Logs
  'move-llm-logs-to-separate-db-v1': 'Relocating LLM logs to their own dossier',
  'add-llm-logs-request-hashes-column-v1': 'Adding request hashes to the LLM logbook',
  'add-llm-logs-raw-provider-usage-column-v1': 'Snapshotting raw provider usage in the LLM logbook',
  'add-llm-logs-autonomous-run-id-column-v1': 'Tagging the LLM logbook with autonomous-run marks',

  // Templates + dangerous content
  'add-narration-delimiters-field-v1': 'Adding narration delimiters to templates',
  'migrate-plugin-templates-to-native-v1': 'Moving plugin templates into native templates',
  'rp-delimiter-kinds-v1': 'Sorting your formatting marks into their proper kinds',
  'add-console-connection-profile-field-v1': "Wiring the Brahma Console's dial to its chosen engine…",
  'add-connection-profile-unique-name-index-v1': 'Ensuring each connection profile answers to but a single name…',
  'add-doc-mount-file-policy-flags-v1': 'Noting which manuscripts wish to remain unread, unwritten, or unindexed…',
  'add-commonplace-recall-history-v1': 'Teaching the Commonplace Book not to repeat itself…',
  'migrate-extraction-knobs-to-instance-settings-v1': 'Moving extraction knobs into instance settings',
  'quantize-embeddings-v1': 'Compacting the memory-vaults so they take up less room on the shelf…',
  'add-episodic-memory-fields-v1': 'Dating and placing your memories — the when and the where, properly filed…',
  'anchor-fictional-clock-base-v1': 'Winding the story-clocks, which had been standing at one hour rather too long…',
  'add-doc-mount-link-groups-v1': 'Teaching a document kept on two shelves to remember it is one document, and sweeping up the pages nobody claims…',
  'add-llm-logs-profile-columns-v1': 'Noting, against each wire record, precisely which correspondent was engaged to send it…',

  // Misc / fixes
  'add-use-native-web-search-field-v1': 'Adding native-web-search flag',
  'fix-orphan-persona-participants-v1': 'Mending orphan persona participants',
  'fix-chat-message-counts': 'Recomputing chat message counts',
  'fix-chat-updated-at-timestamps-v2': 'Mending stale chat updatedAt stamps',
  'drop-sync-tables-v1': 'Retiring the sync tables',
  'drop-pepper-vault-v1': 'Retiring the pepper-vault table',
  'drop-file-permissions-v1': 'Retiring the file-permissions table',
  'convert-scenario-to-scenarios-v1': "Converting character's scenario into scenarios",
};

/**
 * Look up a raw label in the pretty-label table; fall back to humanize() for
 * unknown ids. Always returns a non-empty string.
 */
export function prettify(rawLabel: string): string {
  if (!rawLabel) return 'Working on something';
  const known = PRETTY_LABELS[rawLabel];
  if (known) return known;
  return humanize(rawLabel);
}

/**
 * Humanize a raw label that we don't have a curated entry for. Strips
 * trailing version suffixes (`-v1`, `-v2`, etc.), splits on hyphens, and
 * title-cases the first word.
 *
 * Examples:
 *   `add-system-kind-field-v1`              → "Add system kind field"
 *   `migrate-extraction-knobs-to-instance`  → "Migrate extraction knobs to instance"
 *   `convert-images-to-webp`                → "Convert images to webp"
 */
export function humanize(rawLabel: string): string {
  // Drop the `subsystem:` prefix if present (caller should have hit the table
  // first, but defend in case).
  const stripped = rawLabel.replace(/^subsystem:/, '').replace(/-v\d+$/i, '');
  const words = stripped.split(/[-_:]/).filter(Boolean);
  if (words.length === 0) return rawLabel;
  return words.map((word, i) =>
    i === 0
      ? word.charAt(0).toUpperCase() + word.slice(1)
      : word
  ).join(' ');
}
