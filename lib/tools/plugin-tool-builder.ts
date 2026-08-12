/**
 * Plugin-Based Tool Builder
 *
 * Constructs provider-specific tools by:
 * 1. Taking provider name and enabled tool options
 * 2. Getting the plugin from the provider registry
 * 3. Building an array of universal tools based on what's enabled
 * 4. Calling the plugin's formatTools() method to convert to provider-specific format
 *
 * All provider plugins are expected to implement formatTools().
 *
 * @module tools/plugin-tool-builder
 */

import { logger } from '@/lib/logger';
import { getProvider, getImageProviderConstraints } from '@/lib/plugins/provider-registry';
import { toolRegistry } from '@/lib/plugins/tool-registry';
import { canonicalizeUniversalTools } from '@/lib/tools/canonicalize';
import {
  imageGenerationToolDefinition,
  webSearchToolDefinition,
  projectInfoToolDefinition,
  requestFullContextToolDefinition,
  submitFinalResponseToolDefinition,
  helpSearchToolDefinition,
  helpSettingsToolDefinition,
  helpNavigateToolDefinition,
  rngToolDefinition,
  runCustomToolDefinition,
  buildRunCustomDescription,
  stateToolDefinition,
  selfInventoryToolDefinition,
  whisperToolDefinition,
} from '@/lib/tools';
import type { DiscoveredCustomTool } from '@/lib/pascal/custom-tools';
import {
  readConversationToolDefinition,
} from '@/lib/tools/read-conversation-tool';
import {
  upsertAnnotationToolDefinition,
} from '@/lib/tools/upsert-annotation-tool';
import {
  deleteAnnotationToolDefinition,
} from '@/lib/tools/delete-annotation-tool';
import {
  searchScriptoriumToolDefinition,
  searchScriptoriumBrahmaToolDefinition,
} from '@/lib/tools/search-scriptorium-tool';
import { runSqlToolDefinition } from '@/lib/tools/run-sql-tool';
import {
  wardrobeListToolDefinition,
} from '@/lib/tools/wardrobe-list-tool';
import {
  wardrobeReadToolDefinition,
} from '@/lib/tools/wardrobe-read-tool';
import {
  wardrobeCreateToolDefinition,
} from '@/lib/tools/wardrobe-create-tool';
import {
  wardrobeUpdateToolDefinition,
} from '@/lib/tools/wardrobe-update-tool';
import {
  wardrobeArchiveToolDefinition,
} from '@/lib/tools/wardrobe-archive-tool';
import {
  wardrobeWearToolDefinition,
} from '@/lib/tools/wardrobe-wear-tool';
import {
  wardrobeTakeOffToolDefinition,
} from '@/lib/tools/wardrobe-take-off-tool';
import { docReadFileToolDefinition as docReadFileTool } from '@/lib/tools/doc-read-file-tool';
import { docWriteFileToolDefinition as docWriteFileTool } from '@/lib/tools/doc-write-file-tool';
import { docStrReplaceToolDefinition as docStrReplaceTool } from '@/lib/tools/doc-str-replace-tool';
import { docInsertTextToolDefinition as docInsertTextTool } from '@/lib/tools/doc-insert-text-tool';
import { docGrepToolDefinition as docGrepTool } from '@/lib/tools/doc-grep-tool';
import { docListFilesToolDefinition as docListFilesTool } from '@/lib/tools/doc-list-files-tool';
import { docReadFrontmatterToolDefinition as docReadFrontmatterTool } from '@/lib/tools/doc-read-frontmatter-tool';
import { docUpdateFrontmatterToolDefinition as docUpdateFrontmatterTool } from '@/lib/tools/doc-update-frontmatter-tool';
import { docReadHeadingToolDefinition as docReadHeadingTool } from '@/lib/tools/doc-read-heading-tool';
import { docUpdateHeadingToolDefinition as docUpdateHeadingTool } from '@/lib/tools/doc-update-heading-tool';
import { docMoveFileToolDefinition as docMoveFileTool } from '@/lib/tools/doc-move-file-tool';
import { docCopyFileToolDefinition as docCopyFileTool } from '@/lib/tools/doc-copy-file-tool';
import { docDeleteFileToolDefinition as docDeleteFileTool } from '@/lib/tools/doc-delete-file-tool';
import { docCreateFolderToolDefinition as docCreateFolderTool } from '@/lib/tools/doc-create-folder-tool';
import { docDeleteFolderToolDefinition as docDeleteFolderTool } from '@/lib/tools/doc-delete-folder-tool';
import { docOpenDocumentToolDefinition as docOpenDocumentTool } from '@/lib/tools/doc-open-document-tool';
import { docCloseDocumentToolDefinition as docCloseDocumentTool } from '@/lib/tools/doc-close-document-tool';
import { docFocusToolDefinition as docFocusTool } from '@/lib/tools/doc-focus-tool';
import { keepImageToolDefinition as keepImageTool } from '@/lib/tools/keep-image-tool';
import { listImagesToolDefinition as listImagesTool } from '@/lib/tools/list-images-tool';
import { attachImageToolDefinition as attachImageTool } from '@/lib/tools/attach-image-tool';
import {
  terminalReadToolDefinition,
} from '@/lib/tools/terminal-read-tool';
import {
  terminalListToolDefinition,
} from '@/lib/tools/terminal-list-tool';
import {
  askCarinaToolDefinition,
} from '@/lib/tools/ask-carina-tool';
import { sendMailToolDefinition } from '@/lib/tools/send-mail-tool';
import { listEmailToolDefinition } from '@/lib/tools/list-email-tool';
import type { UniversalTool, ImageProviderConstraints } from '@/lib/plugins/interfaces';

/**
 * Apply image provider constraints to the image generation tool
 *
 * This function enriches the tool definition with provider-specific information:
 * - promptingGuidance: Added to the main tool description to help the LLM
 *   understand how to write effective prompts for this specific provider
 * - promptConstraintWarning: Added to the prompt parameter description
 *   for length/format warnings
 *
 * @param baseTool The base image generation tool definition
 * @param constraints The image provider constraints to apply
 * @param moduleLogger Logger instance for debug output
 * @returns Modified tool with constraints applied, or original tool if no constraints
 */
function applyImageConstraintsToTool(
  baseTool: UniversalTool,
  constraints: ImageProviderConstraints | null,
  moduleLogger: ReturnType<typeof logger.child>
): UniversalTool {
  // If no constraints at all, return the base tool unchanged
  if (!constraints) {
    return baseTool;
  }

  const hasGuidance = !!constraints.promptingGuidance;
  const hasWarning = !!constraints.promptConstraintWarning;

  // If no relevant constraints, return unchanged
  if (!hasGuidance && !hasWarning) {
    return baseTool;
  }

  moduleLogger.debug('Applying image provider constraints to tool', {
    hasGuidance,
    hasWarning,
  });

  let result = { ...baseTool };
  let functionDef = { ...baseTool.function };

  // Apply prompting guidance to the main tool description
  if (hasGuidance) {
    const existingToolDescription = functionDef.description || '';
    functionDef = {
      ...functionDef,
      description: existingToolDescription +
        '\n\n**Provider-Specific Prompting Guidance:**\n' +
        constraints.promptingGuidance,
    };
  }

  // Apply prompt constraint warning to the prompt parameter
  if (hasWarning) {
    const properties = functionDef.parameters.properties as Record<string, Record<string, string>>;
    const existingPromptDescription = properties.prompt?.description || '';

    functionDef = {
      ...functionDef,
      parameters: {
        ...functionDef.parameters,
        properties: {
          ...functionDef.parameters.properties,
          prompt: {
            ...properties.prompt,
            description: existingPromptDescription + ' ' + constraints.promptConstraintWarning,
          },
        },
      },
    };
  }

  result.function = functionDef;
  return result;
}

/**
 * Options for building tools for a provider
 */
export interface BuildToolsOptions {
  /** Whether to enable image generation tool */
  imageGeneration?: boolean;

  /** The image provider type (e.g., 'GROK', 'OPENAI') */
  imageProviderType?: string;

  /** Whether to enable web search tool */
  webSearch?: boolean;

  /** Whether to enable project info tool */
  projectInfo?: boolean;

  /** Whether to enable request_full_context tool (enabled when context compression is active) */
  requestFullContext?: boolean;

  /** Whether to enable help search tool (gated by character help tools setting) */
  helpSearch?: boolean;

  /** Whether to enable help settings tool (gated by character help tools setting) */
  helpSettings?: boolean;

  /** Whether to enable help navigate tool (gated by character help tools setting) */
  helpNavigate?: boolean;

  /** Whether to enable RNG (random number generator) tool (enabled by default) */
  rng?: boolean;

  /**
   * The resolved custom-tool roster for THIS call (Pascal's table).
   *
   * Pass the caller's freshly-resolved roster to offer `run_custom`; omit it or
   * pass an empty array and the tool is not offered at all. The roster rides in
   * the tool's description, rebuilt every time, so a `.tool.json` added or
   * edited mid-chat takes effect on the very next LLM call — and a brand-new
   * chat gets its full roster on turn one with no initialisation step.
   *
   * Resolve per call and never cache across turns: edits inside a mount don't
   * reliably touch the mount index, so an invalidated cache would miss exactly
   * the changes users most expect to see.
   */
  customTools?: DiscoveredCustomTool[];

  /** Whether to enable state (persistent state management) tool (enabled by default) */
  state?: boolean;

  /** Whether to enable whisper tool (for multi-character private messaging) */
  whisper?: boolean;

  /** Whether to enable wardrobe_list tool (gated by canDressThemselves) */
  wardrobeList?: boolean;

  /** Whether to enable wardrobe_read tool (gated by canDressThemselves) */
  wardrobeRead?: boolean;

  /** Whether to enable wardrobe_wear tool (gated by canDressThemselves) */
  wardrobeWear?: boolean;

  /** Whether to enable wardrobe_take_off tool (gated by canDressThemselves) */
  wardrobeTakeOff?: boolean;

  /** Whether to enable wardrobe_create tool (gated by canCreateOutfits) */
  wardrobeCreate?: boolean;

  /** Whether to enable wardrobe_update tool (gated by canCreateOutfits) */
  wardrobeUpdate?: boolean;

  /** Whether to enable wardrobe_archive tool (gated by canCreateOutfits) */
  wardrobeArchive?: boolean;

  /** Whether to enable submit_final_response tool (for agent mode) */
  agentMode?: boolean;

  /** Whether to enable document editing tools (Scriptorium Phase 3.3) */
  documentEditing?: boolean;

  /** Whether to include tools from the tool registry (plugin tools) */
  includePluginTools?: boolean;

  /** Tool configurations for plugin tools (keyed by tool name) */
  toolConfigs?: Map<string, Record<string, unknown>>;

  /** Whether to enable the ask_carina tool (inline Carina answerer) */
  askCarina?: boolean;

  /**
   * Whether to include the always-on "workspace" tool set: self-inventory,
   * Post Office mail (send_mail/list_email), conversation reading, annotations,
   * terminal inspection, and the RNG/state game tools. Defaults to `true`
   * (every character surface gets them). The **Brahma Console** sets this to
   * `false` — it is a character-less, stripped-down generic-LLM surface that
   * keeps only search, the doc_* family, web/curl, and submit_final_response.
   */
  includeWorkspaceTools?: boolean;

  /**
   * When true, the `search` (scriptorium) tool is built from its **Brahma**
   * variant, whose input schema omits the `memories` source — the Brahma
   * Console has zero memory access. Defaults to `false` (the standard search
   * tool, which can search memories).
   */
  excludeMemorySearch?: boolean;

  /**
   * When true, include the `run_sql` tool — read-only SQL access to the three
   * Quilltap databases. Offered on the **Brahma Console** surface only;
   * execution is additionally gated on `operatorSurface` in the tool executor.
   * Defaults to `false`.
   */
  sqlAccess?: boolean;
}

/**
 * Build tools for a specific provider using plugin-based formatting
 *
 * This function:
 * 1. Builds an array of universal tools based on enabled options
 * 2. Gets the provider plugin from the registry
 * 3. If the plugin has formatTools(), converts tools to provider-specific format
 * 4. If not, falls back to old behavior (returns tools in OpenAI format)
 *
 * @param providerName The provider name (e.g., 'OPENAI', 'ANTHROPIC', 'GOOGLE')
 * @param options Configuration for which tools to include
 * @returns Array of tools formatted for the provider (or empty array if no provider/tools)
 *
 * @example
 * ```typescript
 * const tools = buildToolsForProvider('OPENAI', {
 *   imageGeneration: true,
 *   imageProviderType: 'OPENAI',
 *   webSearch: true,
 * });
 * ```
 */
export async function buildToolsForProvider(
  providerName: string,
  options: BuildToolsOptions
): Promise<unknown[]> {
  const logger_ = logger.child({
    module: 'plugin-tool-builder',
    provider: providerName,
  });

  logger_.debug('buildToolsForProvider called', {
    options: {
      imageGeneration: options.imageGeneration,
      webSearch: options.webSearch,
      projectInfo: options.projectInfo,
      requestFullContext: options.requestFullContext,
      agentMode: options.agentMode,
      helpSearch: options.helpSearch,
      helpSettings: options.helpSettings,
      helpNavigate: options.helpNavigate,
      rng: options.rng,
      customTools: options.customTools?.length ?? 0,
      state: options.state,
      whisper: options.whisper,
      wardrobeList: options.wardrobeList,
      wardrobeRead: options.wardrobeRead,
      wardrobeWear: options.wardrobeWear,
      wardrobeTakeOff: options.wardrobeTakeOff,
      wardrobeCreate: options.wardrobeCreate,
      wardrobeUpdate: options.wardrobeUpdate,
      wardrobeArchive: options.wardrobeArchive,
      documentEditing: options.documentEditing,
      includePluginTools: options.includePluginTools,
      askCarina: options.askCarina,
      sqlAccess: options.sqlAccess,
    },
  });

  // Step 1: Build array of universal tools based on enabled options
  const universalTools: UniversalTool[] = [];

  // Add image generation tool if enabled
  if (options.imageGeneration) {
    const baseTool = imageGenerationToolDefinition as UniversalTool;
    const constraints = options.imageProviderType
      ? getImageProviderConstraints(options.imageProviderType)
      : null;

    const imageTool = applyImageConstraintsToTool(baseTool, constraints, logger_);
    universalTools.push(imageTool);
  }

  // Add web search tool if enabled
  if (options.webSearch) {
    universalTools.push(webSearchToolDefinition as UniversalTool);
  }

  // Add project info tool if enabled
  if (options.projectInfo) {
    universalTools.push(projectInfoToolDefinition as UniversalTool);
  }

  // Add request_full_context tool if enabled (for context compression bypass)
  if (options.requestFullContext) {
    universalTools.push(requestFullContextToolDefinition as UniversalTool);
  }

  // Add help search tool if enabled (gated by character help tools setting)
  if (options.helpSearch) {
    universalTools.push(helpSearchToolDefinition as UniversalTool);
  }

  // Add help settings tool if enabled (gated by character help tools setting)
  if (options.helpSettings) {
    universalTools.push(helpSettingsToolDefinition as UniversalTool);
  }

  // Add help navigate tool if enabled (gated by character help tools setting)
  if (options.helpNavigate) {
    universalTools.push(helpNavigateToolDefinition as UniversalTool);
  }

  // The "workspace" tool set — always on for character surfaces, stripped for
  // the character-less Brahma Console (includeWorkspaceTools === false). This
  // bundle covers RNG/state, self-inventory, Post Office mail, conversation
  // reading, annotations, and terminal inspection.
  const includeWorkspaceTools = options.includeWorkspaceTools !== false;

  // Add RNG tool if enabled (defaults to true when not specified)
  if (includeWorkspaceTools && options.rng !== false) {
    universalTools.push(rngToolDefinition as UniversalTool);
  }

  // Add run_custom only when this scene actually has custom tools. An empty
  // roster would offer the model a tool with nothing to run — worse than not
  // offering it. The description is composed here, per call, from the roster
  // the caller just resolved.
  if (options.customTools && options.customTools.length > 0) {
    universalTools.push({
      ...runCustomToolDefinition,
      function: {
        ...runCustomToolDefinition.function,
        description: buildRunCustomDescription(options.customTools),
      },
    } as UniversalTool);
  }

  // Add state tool if enabled (defaults to true when not specified)
  if (includeWorkspaceTools && options.state !== false) {
    universalTools.push(stateToolDefinition as UniversalTool);
  }

  if (includeWorkspaceTools) {
    // Self-inventory tool is always available to character participants —
    // pure introspection, no side effects.
    universalTools.push(selfInventoryToolDefinition as UniversalTool);

    // Post Office tools are always available — mail is ungated (any character may
    // write to any character, and a character may always list its own postbox).
    universalTools.push(sendMailToolDefinition as UniversalTool);
    universalTools.push(listEmailToolDefinition as UniversalTool);

    // Scriptorium conversation reading + annotations (always enabled for characters)
    universalTools.push(readConversationToolDefinition as UniversalTool);
    universalTools.push(upsertAnnotationToolDefinition as UniversalTool);
    universalTools.push(deleteAnnotationToolDefinition as UniversalTool);
  }

  // Unified search — available on every surface. The Brahma variant drops the
  // `memories` source so the console can never search memories.
  universalTools.push(
    (options.excludeMemorySearch
      ? searchScriptoriumBrahmaToolDefinition
      : searchScriptoriumToolDefinition) as UniversalTool
  );

  // Read-only SQL access — Brahma Console only. Execution is additionally gated
  // on `operatorSurface` in the tool executor, so a leaked tool name can never
  // run from a character surface.
  if (options.sqlAccess) {
    universalTools.push(runSqlToolDefinition as UniversalTool);
  }

  if (includeWorkspaceTools) {
    // Terminal tools (always enabled for Prospero - read-only terminal inspection)
    universalTools.push(terminalListToolDefinition as UniversalTool);
    universalTools.push(terminalReadToolDefinition as UniversalTool);
  }

  // Add whisper tool if enabled (multi-character chats only)
  if (options.whisper) {
    universalTools.push(whisperToolDefinition as UniversalTool);
  }

  // Add ask_carina tool if enabled (inline Carina answerer)
  if (options.askCarina) {
    universalTools.push(askCarinaToolDefinition as UniversalTool);
  }

  // Add wardrobe tools if enabled (gated by character wardrobe flags)
  if (options.wardrobeList) {
    universalTools.push(wardrobeListToolDefinition as UniversalTool);
  }
  if (options.wardrobeRead) {
    universalTools.push(wardrobeReadToolDefinition as UniversalTool);
  }
  if (options.wardrobeWear) {
    universalTools.push(wardrobeWearToolDefinition as UniversalTool);
  }
  if (options.wardrobeTakeOff) {
    universalTools.push(wardrobeTakeOffToolDefinition as UniversalTool);
  }
  if (options.wardrobeCreate) {
    universalTools.push(wardrobeCreateToolDefinition as UniversalTool);
  }
  if (options.wardrobeUpdate) {
    universalTools.push(wardrobeUpdateToolDefinition as UniversalTool);
  }
  if (options.wardrobeArchive) {
    universalTools.push(wardrobeArchiveToolDefinition as UniversalTool);
  }

  // Add submit_final_response tool if agent mode is enabled
  if (options.agentMode) {
    universalTools.push(submitFinalResponseToolDefinition as UniversalTool);
  }

  // Add document editing tools if enabled (Scriptorium Phase 3.3)
  if (options.documentEditing) {
    universalTools.push(docReadFileTool as UniversalTool);
    universalTools.push(docWriteFileTool as UniversalTool);
    universalTools.push(docStrReplaceTool as UniversalTool);
    universalTools.push(docInsertTextTool as UniversalTool);
    universalTools.push(docGrepTool as UniversalTool);
    universalTools.push(docListFilesTool as UniversalTool);
    universalTools.push(docReadFrontmatterTool as UniversalTool);
    universalTools.push(docUpdateFrontmatterTool as UniversalTool);
    universalTools.push(docReadHeadingTool as UniversalTool);
    universalTools.push(docUpdateHeadingTool as UniversalTool);
    universalTools.push(docMoveFileTool as UniversalTool);
    universalTools.push(docCopyFileTool as UniversalTool);
    universalTools.push(docDeleteFileTool as UniversalTool);
    universalTools.push(docCreateFolderTool as UniversalTool);
    universalTools.push(docDeleteFolderTool as UniversalTool);
    universalTools.push(docOpenDocumentTool as UniversalTool);
    universalTools.push(docCloseDocumentTool as UniversalTool);
    universalTools.push(docFocusTool as UniversalTool);
    // Photo album tools — same gate as the doc-edit family; they write into
    // the calling character's vault under photos/.
    universalTools.push(keepImageTool as UniversalTool);
    universalTools.push(listImagesTool as UniversalTool);
    universalTools.push(attachImageTool as UniversalTool);
  }

  // Add plugin tools if enabled (defaults to true when not specified)
  if (options.includePluginTools !== false) {
    // Get configured tool definitions from the tool registry (async for multi-tool plugins)
    const toolConfigs = options.toolConfigs || new Map();
    const pluginToolDefs = await toolRegistry.getConfiguredToolDefinitions(toolConfigs);

    if (pluginToolDefs.length > 0) {
      universalTools.push(...pluginToolDefs);
    }
  }

  // If no tools are enabled, return empty array
  if (universalTools.length === 0) {
    return [];
  }

  // Canonicalize: sort alphabetically by name and stable-key JSON Schema.
  // Required so the cacheable prefix at the front of every provider request
  // is byte-stable across turns regardless of plugin registration order.
  const canonicalTools = canonicalizeUniversalTools(universalTools);

  // Log the tools being built
  logger_.info('Built universal tools', {
    count: canonicalTools.length,
    toolNames: canonicalTools.map(t => t.function.name),
  });

  // Step 2: Get the provider plugin from registry
  const plugin = getProvider(providerName);

  if (!plugin) {
    logger_.warn('Provider not found in registry, returning tools in OpenAI format', {
      provider: providerName,
    });
    // Backwards compatibility: return tools in OpenAI format if provider not found
    return canonicalTools;
  }

  // Step 3 & 4: Check if plugin has formatTools() method
  if (plugin.formatTools && typeof plugin.formatTools === 'function') {
    try {
      // Call plugin's formatTools with the entire array of tools
      const formattedTools = plugin.formatTools(canonicalTools, {
        imageProviderType: options.imageProviderType,
      });
      return formattedTools;
    } catch (error) {
      logger_.error('Error formatting tools with plugin, falling back to universal format', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Step 5: Fallback to old behavior (return tools in OpenAI format)
      return canonicalTools;
    }
  }

  // Step 5: Plugin doesn't have formatTools, return tools in universal (OpenAI) format
  // All plugins should implement formatTools() - if not, log a warning
  logger_.warn('Plugin does not have formatTools(), returning tools in universal format', {
    provider: providerName,
  });

  return canonicalTools;
}
