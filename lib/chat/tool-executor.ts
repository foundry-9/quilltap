/**
 * Tool Execution Handler for Chat
 * Detects and executes LLM tool calls during message processing
 */

import { logger } from '@/lib/logger'
import { providerRegistry } from '@/lib/plugins/provider-registry'
import { toolRegistry } from '@/lib/plugins/tool-registry'
import { getRepositories } from '@/lib/repositories/factory'
import type { ToolExecutionContext as PluginToolContext } from '@/lib/plugins/interfaces/tool-plugin'
import type { MessageEvent } from '@/lib/schemas/types'
import {
  executeImageGenerationTool,
  type ImageToolExecutionContext,
} from '@/lib/tools';
import {
  executeWebSearchTool,
  formatWebSearchResults,
  type WebSearchToolContext,
} from '@/lib/tools/handlers/web-search-handler';
import {
  executeProjectInfoTool,
  formatProjectInfoResults,
  type ProjectInfoToolContext,
} from '@/lib/tools/handlers/project-info-handler';
import {
  executeRequestFullContextTool,
  formatRequestFullContextResults,
  type RequestFullContextToolContext,
} from '@/lib/tools/handlers/request-full-context-handler';
import {
  executeHelpSearchTool,
  formatHelpSearchResults,
  type HelpSearchToolContext,
} from '@/lib/tools/handlers/help-search-handler';
import {
  executeHelpSettingsTool,
  formatHelpSettingsResults,
  type HelpSettingsToolContext,
} from '@/lib/tools/handlers/help-settings-handler';
import {
  executeHelpNavigateTool,
  formatHelpNavigateResults,
  type HelpNavigateToolContext,
} from '@/lib/tools/handlers/help-navigate-handler';
import {
  executeRngTool,
  formatRngResults,
  type RngToolContext,
} from '@/lib/tools/handlers/rng-handler';
import {
  executeStateTool,
  formatStateResults,
  type StateToolContext,
} from '@/lib/tools/handlers/state-handler';
import {
  executeSelfInventoryTool,
  formatSelfInventoryResults,
  type SelfInventoryToolContext,
} from '@/lib/tools/handlers/self-inventory-handler';
import {
  executeSubmitFinalResponseTool,
  formatSubmitFinalResponseResults,
  type SubmitFinalResponseToolContext,
} from '@/lib/tools/handlers/submit-final-response-handler';
import {
  executeWhisperTool,
  formatWhisperResults,
  type WhisperToolContext,
} from '@/lib/tools/handlers/whisper-handler';
import {
  executeDocEditTool,
  formatDocEditResults,
  isDocEditTool,
  DOC_EDIT_TOOL_NAMES,
  type DocEditToolContext,
} from '@/lib/tools/handlers/doc-edit-handler';
import {
  executeWardrobeListTool,
  formatWardrobeListResults,
  type WardrobeListToolContext,
} from '@/lib/tools/handlers/wardrobe-list-handler';
import {
  executeWardrobeReadTool,
  formatWardrobeReadResults,
  type WardrobeReadToolContext,
} from '@/lib/tools/handlers/wardrobe-read-handler';
import {
  executeWardrobeCreateTool,
  formatWardrobeCreateResults,
  type WardrobeCreateToolContext,
} from '@/lib/tools/handlers/wardrobe-create-handler';
import {
  executeWardrobeUpdateTool,
  formatWardrobeUpdateResults,
  type WardrobeUpdateToolContext,
} from '@/lib/tools/handlers/wardrobe-update-handler';
import {
  executeWardrobeArchiveTool,
  formatWardrobeArchiveResults,
  type WardrobeArchiveToolContext,
} from '@/lib/tools/handlers/wardrobe-archive-handler';
import {
  executeWardrobeWearTool,
  formatWardrobeWearResults,
  type WardrobeWearToolContext,
} from '@/lib/tools/handlers/wardrobe-wear-handler';
import {
  executeWardrobeTakeOffTool,
  formatWardrobeTakeOffResults,
  type WardrobeTakeOffToolContext,
} from '@/lib/tools/handlers/wardrobe-take-off-handler';
import {
  executeReadConversationTool,
  formatReadConversationResults,
  type ReadConversationToolContext,
} from '@/lib/tools/handlers/read-conversation-handler';
import {
  executeSearchScriptoriumTool,
  formatSearchScriptoriumResults,
  type SearchScriptoriumToolContext,
} from '@/lib/tools/handlers/search-scriptorium-handler';
import {
  executeRunSqlTool,
} from '@/lib/tools/handlers/run-sql-handler';
import {
  executeUpsertAnnotationTool,
  formatUpsertAnnotationResults,
  type UpsertAnnotationToolContext,
} from '@/lib/tools/handlers/upsert-annotation-handler';
import {
  executeDeleteAnnotationTool,
  formatDeleteAnnotationResults,
  type DeleteAnnotationToolContext,
} from '@/lib/tools/handlers/delete-annotation-handler';
import {
  executeTerminalReadTool,
  executeTerminalListTool,
  formatTerminalReadResults,
  formatTerminalListResults,
  TerminalToolError,
  type TerminalToolError as TerminalToolErrorType,
} from '@/lib/tools/handlers/terminal-handler';

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
  /** Provider-assigned call ID for correlating results to calls */
  callId?: string;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  result: unknown;
  error?: string;
  /** Human-readable error message with more details than the error code */
  message?: string;
  metadata?: {
    provider?: string;
    model?: string;
    /** For image generation, the expanded prompt with {{me}} etc. resolved */
    expandedPrompt?: string;
  };
}

/**
 * Memory items that were loaded into the prompt for this turn. Populated by
 * the orchestrator from the built context so tools like `self_inventory` can
 * report the exact memory slate the LLM saw.
 */
export interface LoadedMemoriesContext {
  /** Semantic-search memories rendered under `## Relevant Memories`. */
  semantic?: Array<{ summary: string; importance: number; score: number; effectiveWeight: number }>;
  /** Inter-character memories rendered under `## Memories About Other Characters`. */
  interCharacter?: Array<{ aboutCharacterName: string; summary: string; importance: number }>;
  /** Memory recap text injected on chat start or character join, if any. */
  recap?: string;
}

/**
 * Extended context for tool execution
 */
export interface ToolExecutionContext {
  chatId: string;
  userId: string;
  imageProfileId?: string;
  characterId?: string;
  /**
   * The calling character's vault mount — a fast path for tools that resolve
   * the tiered mount pool (`run_custom`). Purely an optimisation: `characterId`
   * is what the pool actually requires.
   */
  characterMountPointId?: string | null;
  /**
   * Every character participating in this chat, for tools whose scope includes
   * the peers' vaults (`run_custom`'s 'participant' tier).
   */
  characterIds?: string[];
  embeddingProfileId?: string;
  /** Participant ID of who is calling the tool (for {{me}} resolution in image prompts) */
  callingParticipantId?: string;
  /** Project ID for project_info tool */
  projectId?: string;
  /** Browser User-Agent from the originating request (scrubbed of Electron/Quilltap tokens) */
  browserUserAgent?: string;
  /** Memories loaded into this turn's prompt, for introspection tools. */
  loadedMemories?: LoadedMemoriesContext;
  /**
   * Character IDs whose wardrobe was modified during this turn. Wardrobe tool
   * handlers add to this Set instead of enqueuing Aurora announcements
   * immediately; the orchestrator drains it once at end-of-turn so a single
   * response with N wardrobe edits produces one announcement, not N. When
   * absent (legacy callers without orchestrator threading), handlers fall
   * back to immediate enqueue.
   */
  pendingWardrobeAnnouncements?: Set<string>;
  /**
   * Surface a Carina (`ask_carina`) answer to the Salon the instant it posts,
   * via the turn's live SSE stream. Set by the orchestrator (which holds the
   * stream controller); absent in the autonomous-room/forked-child path, where
   * there is no client stream and the post-turn refresh handles surfacing.
   */
  emitCarinaAnswer?: (message: MessageEvent) => void;
  /**
   * Surface Pascal's `run_custom` outcome to the Salon the instant it posts,
   * via the turn's live SSE stream. Set by the orchestrator (which holds the
   * stream controller); absent in the autonomous-room/forked-child path, where
   * there is no client stream and the post-turn refresh handles surfacing.
   */
  emitPascalResult?: (message: MessageEvent) => void;
  /**
   * Operator surface (the **Brahma Console**): a character-less, memory-free
   * direct line to the LLM. When true:
   *  - the `search` tool runs WITHOUT a character — memories are never searched,
   *    documents/knowledge reach every enabled store, and conversations are
   *    searched operator-wide (all the user's chats);
   *  - the `doc_*` tools resolve against ALL the user's enabled document stores
   *    (the operator "look everywhere" scope), since the console has no character
   *    vault of its own but is the operator's own surface.
   * Character tool handlers never set this, so their per-character sandbox is
   * unchanged.
   */
  operatorSurface?: boolean;
}

/**
 * Execute a tool call with full context
 */
// Built-in tool names that are handled directly by this module
// These should NOT be routed to the plugin registry.
// Doc-edit tools are sourced from DOC_EDIT_TOOL_NAMES (single source of truth).
const BUILT_IN_TOOLS = new Set<string>([
  'generate_image',
  'search_web',
  'project_info',
  'request_full_context',
  'help_search',
  'help_settings',
  'help_navigate',
  'rng',
  'state',
  // Pascal the Croupier — user-authored pseudo-tools
  'run_custom',
  'self_inventory',
  'submit_final_response',
  'whisper',
  // Scriptorium tools
  'read_conversation',
  'upsert_annotation',
  'delete_annotation',
  'search',
  // Brahma Console — read-only SQL access (operator surface only)
  'run_sql',
  // Wardrobe tools
  'wardrobe_list',
  'wardrobe_read',
  'wardrobe_create',
  'wardrobe_update',
  'wardrobe_archive',
  'wardrobe_wear',
  'wardrobe_take_off',
  // Document editing / management / UI tools — Scriptorium Phase 3.3+
  ...DOC_EDIT_TOOL_NAMES,
  // Terminal tools — Prospero Phase 2
  'terminal_read',
  'terminal_list',
  // Carina — inline answerer tool
  'ask_carina',
  // Post Office — inter-character mail
  'send_mail',
  'list_email',
]);

export async function executeToolCallWithContext(
  toolCall: ToolCallRequest,
  context: ToolExecutionContext
): Promise<ToolResult> {
  const { chatId, userId, imageProfileId, characterId, embeddingProfileId } = context;

  try {
    // Check if this is a built-in tool - these are handled later in this function
    const isBuiltInTool = BUILT_IN_TOOLS.has(toolCall.name);

    // Check tool registry for plugin-provided tools (static or multi-tool)
    // Only route to plugins if this is NOT a built-in tool
    // hasPlugin checks if plugin with that name exists, getAllPlugins checks if any plugins exist
    const isStaticTool = !isBuiltInTool && toolRegistry.hasPlugin(toolCall.name);
    const isMultiToolPluginTool = !isBuiltInTool && !isStaticTool && toolRegistry.getAllPlugins().length > 0;

    if (isStaticTool || isMultiToolPluginTool) {
      // Fetch user's tool configuration from database
      let toolConfig: Record<string, unknown> = {};
      try {
        const repos = getRepositories();

        if (isStaticTool) {
          // For static tools, look up config by tool name pattern
          const pluginName = `qtap-plugin-${toolCall.name}`;
          const userConfig = await repos.pluginConfigs.findByUserAndPlugin(userId, pluginName);
          if (userConfig) {
            toolConfig = userConfig.config;
          } else {
            toolConfig = toolRegistry.getDefaultConfig(toolCall.name);
          }
        } else {
          // For multi-tool plugins (like MCP), we need to load configs for all multi-tool plugins
          // The tool registry's executeTool will find the right plugin
          const multiToolPluginNames = toolRegistry.getPluginNames();
          for (const pluginName of multiToolPluginNames) {
            const fullPluginName = `qtap-plugin-${pluginName}`;
            const userConfig = await repos.pluginConfigs.findByUserAndPlugin(userId, fullPluginName);
            if (userConfig) {
              // Pass the config under the plugin name key so executeTool can find it
              toolConfig[pluginName] = userConfig.config;
            }
          }
        }
      } catch (configError) {
        logger.warn('Failed to load tool config, using defaults', {
          context: 'tool-executor',
          toolName: toolCall.name,
          error: configError instanceof Error ? configError.message : String(configError),
        });
        if (isStaticTool) {
          toolConfig = toolRegistry.getDefaultConfig(toolCall.name);
        }
      }

      // Build context for plugin tool execution
      const pluginContext: PluginToolContext = {
        userId,
        chatId,
        projectId: context.projectId,
        characterId,
        callingParticipantId: context.callingParticipantId,
        toolConfig,
        browserUserAgent: context.browserUserAgent,
      };

      const result = await toolRegistry.executeTool(
        toolCall.name,
        toolCall.arguments,
        pluginContext
      );

      // Format results for LLM
      const formattedResult = toolRegistry.formatToolResults(toolCall.name, result);

      // Build result object - only spread if result.result is a plain object
      const resultData = result.success ? {
        formattedText: formattedResult,
        ...(result.result && typeof result.result === 'object' && !Array.isArray(result.result)
          ? result.result as object
          : { rawResult: result.result }),
      } : null;

      return {
        toolName: toolCall.name,
        success: result.success,
        result: resultData,
        error: result.success ? undefined : result.error,
        metadata: result.metadata,
      };
    }

    // Handle image generation (built-in tool)
    if (toolCall.name === 'generate_image') {
      // If no image profile is configured, return error
      if (!imageProfileId) {
        return {
          toolName: 'generate_image',
          success: false,
          result: null,
          error: 'Image generation is not enabled for this chat',
        };
      }

      // Execute image generation tool
      // Pass callingParticipantId so {{me}} resolves to the character (who's calling the tool)
      const imageContext: ImageToolExecutionContext = {
        userId,
        profileId: imageProfileId,
        chatId,
        callingParticipantId: context.callingParticipantId,
      };

      const result = await executeImageGenerationTool(toolCall.arguments, imageContext);

      return {
        toolName: 'generate_image',
        success: result.success,
        result: result.success ? result.images : null,
        error: result.success ? undefined : result.error,
        message: result.success ? undefined : result.message,
        metadata: {
          provider: result.provider,
          model: result.model,
          expandedPrompt: result.expandedPrompt,
        },
      };
    }


    // Handle web search
    if (toolCall.name === 'search_web') {
      // Execute web search tool
      const webSearchContext: WebSearchToolContext = {
        userId,
      };

      const result = await executeWebSearchTool(toolCall.arguments, webSearchContext);

      // Format results for LLM consumption
      const formattedResult = result.success && result.results
        ? formatWebSearchResults(result.results)
        : result.error || 'No search results found';

      return {
        toolName: 'search_web',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          results: result.results,
          totalFound: result.totalFound,
          query: result.query,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle project info
    if (toolCall.name === 'project_info') {
      // If no project is configured, return error
      if (!context.projectId) {
        return {
          toolName: 'project_info',
          success: false,
          result: null,
          error: 'Project info requires a project context',
        };
      }

      // Execute project info tool
      const projectContext: ProjectInfoToolContext = {
        userId,
        projectId: context.projectId,
        embeddingProfileId,
      };

      const result = await executeProjectInfoTool(toolCall.arguments, projectContext);

      // Format results for LLM consumption
      const formattedResult = formatProjectInfoResults(result);

      return {
        toolName: 'project_info',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          action: result.action,
          data: result.data,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle request_full_context (context compression bypass)
    if (toolCall.name === 'request_full_context') {
      // Execute request full context tool
      const requestContext: RequestFullContextToolContext = {
        chatId,
      };

      const result = await executeRequestFullContextTool(toolCall.arguments, requestContext);

      // Format results for LLM consumption
      const formattedResult = formatRequestFullContextResults(result);

      return {
        toolName: 'request_full_context',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
        } : null,
        error: result.success ? undefined : result.message,
      };
    }

    // Handle help_search (help documentation search)
    if (toolCall.name === 'help_search') {
      // Execute help search tool
      const helpContext: HelpSearchToolContext = {
        userId,
      };

      const result = await executeHelpSearchTool(toolCall.arguments, helpContext);

      // Format results for LLM consumption
      const formattedResult = result.success && result.results
        ? formatHelpSearchResults(result.results)
        : result.error || 'No help documentation found';

      return {
        toolName: 'help_search',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          results: result.results,
          totalFound: result.totalFound,
          query: result.query,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle help_settings (settings reader for help characters)
    if (toolCall.name === 'help_settings') {
      const helpSettingsContext: HelpSettingsToolContext = {
        userId,
      };

      const result = await executeHelpSettingsTool(toolCall.arguments, helpSettingsContext);

      const formattedResult = result.success && result.data
        ? formatHelpSettingsResults(result)
        : result.error || 'Failed to read settings';

      return {
        toolName: 'help_settings',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          category: result.category,
          data: result.data,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle help_navigate (navigate user's browser to a Quilltap page)
    if (toolCall.name === 'help_navigate') {
      const helpNavContext: HelpNavigateToolContext = {
        userId,
      };

      const result = await executeHelpNavigateTool(toolCall.arguments, helpNavContext);

      const formattedResult = result.success
        ? formatHelpNavigateResults(result)
        : result.error || 'Failed to navigate';

      return {
        toolName: 'help_navigate',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          navigationUrl: result.url,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle rng (random number generator)
    if (toolCall.name === 'rng') {
      // Execute RNG tool
      const rngContext: RngToolContext = {
        userId,
        chatId,
      };

      const result = await executeRngTool(toolCall.arguments, rngContext);

      // Format results for LLM consumption
      const formattedResult = formatRngResults(result);

      return {
        toolName: 'rng',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          type: result.type,
          rollCount: result.rollCount,
          results: result.results,
          sum: result.sum,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle run_custom (Pascal the Croupier — user-authored pseudo-tools)
    if (toolCall.name === 'run_custom') {
      const { executeRunCustomTool, formatRunCustomResults } = await import('@/lib/tools/handlers/run-custom-handler');

      // The handler posts Pascal's bubble itself — that message is the run's
      // single visible artifact, so the TOOL row this returns renders nothing
      // (see `delegatedDisplay` in saveToolMessages). The row still persists so
      // tool-call threading keeps its tool_call_id linkage intact.
      const out = await executeRunCustomTool(toolCall.arguments, {
        userId,
        chatId,
        characterId,
        characterMountPointId: context.characterMountPointId,
        characterIds: context.characterIds,
        projectId: context.projectId,
        callerParticipantId: context.callingParticipantId,
        onPosted: context.emitPascalResult,
      });

      return {
        toolName: 'run_custom',
        success: out.success,
        result: out.success ? {
          formattedText: formatRunCustomResults(out),
          tool: out.tool,
          value: out.value,
          state: out.state,
          whispered: out.whispered,
        } : null,
        error: out.success ? undefined : out.error,
      };
    }

    // Handle self_inventory (character introspection)
    if (toolCall.name === 'self_inventory') {
      if (!characterId) {
        return {
          toolName: 'self_inventory',
          success: false,
          result: null,
          error: 'self_inventory requires a character context',
        };
      }

      const selfInventoryContext: SelfInventoryToolContext = {
        userId,
        chatId,
        characterId,
        projectId: context.projectId,
        callingParticipantId: context.callingParticipantId,
        loadedMemories: context.loadedMemories,
      };

      const result = await executeSelfInventoryTool(toolCall.arguments, selfInventoryContext);
      const formattedResult = formatSelfInventoryResults(result);

      const structuredResult: Record<string, unknown> = {
        formattedText: formattedResult,
        quilltapVersion: result.quilltapVersion,
        characterId: result.characterId,
        characterName: result.characterName,
      };
      if (result.vault) structuredResult.vault = result.vault;
      if (result.vaultAccess) structuredResult.vaultAccess = result.vaultAccess;
      if (result.memory) structuredResult.memory = result.memory;
      if (result.loadedMemories) structuredResult.loadedMemories = result.loadedMemories;
      if (result.chats) structuredResult.chats = result.chats;
      if (result.prompt) structuredResult.prompt = result.prompt;
      if (result.lastTurn) structuredResult.lastTurn = result.lastTurn;
      if (result.quilltap) structuredResult.quilltap = result.quilltap;
      if (result.context) structuredResult.context = result.context;

      return {
        toolName: 'self_inventory',
        success: result.success,
        result: result.success ? structuredResult : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle state (persistent state management)
    if (toolCall.name === 'state') {
      // Execute state tool
      const stateContext: StateToolContext = {
        userId,
        chatId,
        projectId: context.projectId,
        characterId,
      };

      const result = await executeStateTool(toolCall.arguments, stateContext);

      // Format results for LLM consumption
      const formattedResult = formatStateResults(result);

      return {
        toolName: 'state',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          operation: result.operation,
          context: result.context,
          path: result.path,
          value: result.value,
          previousValue: result.previousValue,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle wardrobe_list
    if (toolCall.name === 'wardrobe_list') {
      const wardrobeContext: WardrobeListToolContext = {
        userId,
        chatId,
        characterId: characterId || '',
      };

      const result = await executeWardrobeListTool(toolCall.arguments, wardrobeContext);
      const formattedResult = formatWardrobeListResults(result);

      return {
        toolName: 'wardrobe_list',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          items: result.items,
          total_count: result.total_count,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle wardrobe_read
    if (toolCall.name === 'wardrobe_read') {
      const wardrobeContext: WardrobeReadToolContext = {
        userId,
        chatId,
        characterId: characterId || '',
      };

      const result = await executeWardrobeReadTool(toolCall.arguments, wardrobeContext);
      const formattedResult = formatWardrobeReadResults(result);

      return {
        toolName: 'wardrobe_read',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          ...result,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle wardrobe_create
    if (toolCall.name === 'wardrobe_create') {
      const wardrobeContext: WardrobeCreateToolContext = {
        userId,
        chatId,
        characterId: characterId || '',
      };

      const result = await executeWardrobeCreateTool(toolCall.arguments, wardrobeContext);
      const formattedResult = formatWardrobeCreateResults(result);

      return {
        toolName: 'wardrobe_create',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          item_id: result.item_id,
          title: result.title,
          equipped: result.equipped,
          recipient_name: result.recipient_name,
          current_state: result.current_state,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle wardrobe_update
    if (toolCall.name === 'wardrobe_update') {
      const wardrobeContext: WardrobeUpdateToolContext = {
        userId,
        chatId,
        characterId: characterId || '',
      };

      const result = await executeWardrobeUpdateTool(toolCall.arguments, wardrobeContext);
      const formattedResult = formatWardrobeUpdateResults(result);

      return {
        toolName: 'wardrobe_update',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          ...result,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle wardrobe_archive (soft retire)
    if (toolCall.name === 'wardrobe_archive') {
      const wardrobeContext: WardrobeArchiveToolContext = {
        userId,
        chatId,
        characterId: characterId || '',
        pendingWardrobeAnnouncements: context.pendingWardrobeAnnouncements,
      };

      const result = await executeWardrobeArchiveTool(toolCall.arguments, wardrobeContext);
      const formattedResult = formatWardrobeArchiveResults(result);

      return {
        toolName: 'wardrobe_archive',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          item_id: result.item_id,
          title: result.title,
          action: result.action,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle wardrobe_wear (put on / layer — array of operations)
    if (toolCall.name === 'wardrobe_wear') {
      const wardrobeContext: WardrobeWearToolContext = {
        userId,
        chatId,
        characterId: characterId || '',
        pendingWardrobeAnnouncements: context.pendingWardrobeAnnouncements,
      };

      const result = await executeWardrobeWearTool(toolCall.arguments, wardrobeContext);
      const formattedResult = formatWardrobeWearResults(result);

      return {
        toolName: 'wardrobe_wear',
        success: result.success,
        result: {
          formattedText: formattedResult,
          operations: result.operations,
          current_state: result.current_state,
          coverage_summary: result.coverage_summary,
        },
        error: result.success ? undefined : result.error,
      };
    }

    // Handle wardrobe_take_off (remove / clear — array of operations)
    if (toolCall.name === 'wardrobe_take_off') {
      const wardrobeContext: WardrobeTakeOffToolContext = {
        userId,
        chatId,
        characterId: characterId || '',
        pendingWardrobeAnnouncements: context.pendingWardrobeAnnouncements,
      };

      const result = await executeWardrobeTakeOffTool(toolCall.arguments, wardrobeContext);
      const formattedResult = formatWardrobeTakeOffResults(result);

      return {
        toolName: 'wardrobe_take_off',
        success: result.success,
        result: {
          formattedText: formattedResult,
          operations: result.operations,
          current_state: result.current_state,
          coverage_summary: result.coverage_summary,
        },
        error: result.success ? undefined : result.error,
      };
    }

    // Handle read_conversation (Scriptorium)
    if (toolCall.name === 'read_conversation') {
      const readContext: ReadConversationToolContext = {
        userId,
        chatId,
        characterId,
      };

      const result = await executeReadConversationTool(toolCall.arguments, readContext);
      const formattedResult = formatReadConversationResults(result);

      return {
        toolName: 'read_conversation',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          messageCount: result.messageCount,
          interchangeCount: result.interchangeCount,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle upsert_annotation (Scriptorium)
    if (toolCall.name === 'upsert_annotation') {
      // Resolve character name from calling participant
      let characterName = 'Unknown';
      if (context.callingParticipantId) {
        const repos = getRepositories();
        const chat = await repos.chats.findById(chatId);
        if (chat) {
          const participant = chat.participants.find(p => p.id === context.callingParticipantId);
          if (participant?.characterId) {
            const character = await repos.characters.findById(participant.characterId);
            if (character) {
              characterName = character.name;
            }
          }
        }
      }

      const annotationContext: UpsertAnnotationToolContext = {
        userId,
        chatId,
        characterName,
      };

      const result = await executeUpsertAnnotationTool(toolCall.arguments, annotationContext);
      const formattedResult = formatUpsertAnnotationResults(result);

      return {
        toolName: 'upsert_annotation',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          message_index: result.message_index,
          character_name: result.character_name,
          action: result.action,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle delete_annotation (Scriptorium)
    if (toolCall.name === 'delete_annotation') {
      // Resolve character name from calling participant (same as upsert)
      let characterName = 'Unknown';
      if (context.callingParticipantId) {
        const repos = getRepositories();
        const chat = await repos.chats.findById(chatId);
        if (chat) {
          const participant = chat.participants.find(p => p.id === context.callingParticipantId);
          if (participant?.characterId) {
            const character = await repos.characters.findById(participant.characterId);
            if (character) {
              characterName = character.name;
            }
          }
        }
      }

      const deleteContext: DeleteAnnotationToolContext = {
        userId,
        chatId,
        characterName,
      };

      const result = await executeDeleteAnnotationTool(toolCall.arguments, deleteContext);
      const formattedResult = formatDeleteAnnotationResults(result);

      return {
        toolName: 'delete_annotation',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          message_index: result.message_index,
          character_name: result.character_name,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle search (Scriptorium unified search)
    if (toolCall.name === 'search') {
      // Character surfaces require a character (memories/conversations are
      // per-character). The operator surface (Brahma Console) is character-less:
      // it searches operator-wide and never touches memories.
      if (!characterId && !context.operatorSurface) {
        return {
          toolName: 'search',
          success: false,
          result: null,
          error: 'Search requires a character context',
        };
      }

      const searchContext: SearchScriptoriumToolContext = {
        userId,
        characterId,
        embeddingProfileId,
        projectId: context.projectId,
        operatorSurface: context.operatorSurface,
      };

      const result = await executeSearchScriptoriumTool(toolCall.arguments, searchContext);

      const formattedResult = result.success && result.results
        ? formatSearchScriptoriumResults(result.results)
        : result.error || 'No results found';

      return {
        toolName: 'search',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          results: result.results,
          totalFound: result.totalFound,
          query: result.query,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle run_sql (Brahma Console — read-only SQL access). Gated on the
    // operator surface: the tool is only ever OFFERED to the console, and even
    // if a tool name leaked into history, a character surface can never EXECUTE
    // it. Both gates are independent (see brahma-sql-access spec §8).
    if (toolCall.name === 'run_sql') {
      if (!context.operatorSurface) {
        return {
          toolName: 'run_sql',
          success: false,
          result: null,
          error: 'run_sql is only available in the Brahma Console.',
        };
      }

      const result = await executeRunSqlTool(toolCall.arguments, { userId });

      return {
        toolName: 'run_sql',
        success: result.success,
        result: result.success ? result : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle submit_final_response (agent mode completion)
    if (toolCall.name === 'submit_final_response') {
      // Execute submit final response tool
      const submitContext: SubmitFinalResponseToolContext = {
        chatId,
      };

      const result = await executeSubmitFinalResponseTool(toolCall.arguments, submitContext);

      // Format results for LLM consumption
      const formattedResult = formatSubmitFinalResponseResults(result);

      return {
        toolName: 'submit_final_response',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          finalResponse: result.finalResponse,
          summary: result.summary,
          confidence: result.confidence,
        } : null,
        error: result.success ? undefined : result.message,
      };
    }

    // Handle whisper (private message in multi-character chats)
    if (toolCall.name === 'whisper') {
      if (!context.callingParticipantId) {
        return {
          toolName: 'whisper',
          success: false,
          result: null,
          error: 'Whisper requires a multi-character chat context',
        };
      }

      const whisperContext: WhisperToolContext = {
        userId,
        chatId,
        callingParticipantId: context.callingParticipantId,
      };

      const result = await executeWhisperTool(toolCall.arguments, whisperContext);
      const formattedResult = formatWhisperResults(result);

      return {
        toolName: 'whisper',
        success: result.success,
        result: result.success ? {
          formattedText: formattedResult,
          targetName: result.targetName,
          targetParticipantId: result.targetParticipantId,
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle document editing tools (Scriptorium Phase 3.3)
    if (isDocEditTool(toolCall.name)) {
      const docEditContext: DocEditToolContext = {
        userId,
        chatId,
        projectId: context.projectId,
        characterId,
        // Operator surface (Brahma Console): resolve against every enabled store.
        operatorOverride: context.operatorSurface,
      };

      const result = await executeDocEditTool(toolCall.name, toolCall.arguments, docEditContext);

      // attach_image returns an array of image descriptors (mirroring
      // generate_image) so processToolCalls' generated-image collector
      // picks them up. Pass the array through unchanged rather than
      // spreading it into a Record like the rest of the doc-edit tools.
      if (toolCall.name === 'attach_image') {
        return {
          toolName: toolCall.name,
          success: result.success,
          result: result.success ? (result.result ?? null) : null,
          error: result.success ? undefined : result.error,
        };
      }

      return {
        toolName: toolCall.name,
        success: result.success,
        result: result.success ? {
          formattedText: formatDocEditResults(toolCall.name, result),
          ...(result.result && typeof result.result === 'object' ? result.result as Record<string, unknown> : {}),
        } : null,
        error: result.success ? undefined : result.error,
      };
    }

    // Handle ask_carina (inline Carina answerer)
    if (toolCall.name === 'ask_carina') {
      const { executeAskCarinaTool } = await import('@/lib/tools/handlers/ask-carina-handler');
      const out = await executeAskCarinaTool(toolCall.arguments, {
        userId,
        chatId,
        callingParticipantId: context.callingParticipantId,
        emitCarinaAnswer: context.emitCarinaAnswer,
      });
      return {
        toolName: 'ask_carina',
        success: out.success,
        result: out.success ? { answer: out.answer } : null,
        error: out.success ? undefined : out.error,
      };
    }

    // Handle send_mail (Post Office — deliver a letter to another character)
    if (toolCall.name === 'send_mail') {
      const { executeSendMailTool, formatSendMailResults } = await import('@/lib/tools/handlers/send-mail-handler');
      const out = await executeSendMailTool(toolCall.arguments, {
        userId,
        chatId,
        characterId,
        callingParticipantId: context.callingParticipantId,
      });
      return {
        toolName: 'send_mail',
        success: out.success,
        result: { formattedText: formatSendMailResults(out), path: out.path },
        error: out.success ? undefined : out.error,
      };
    }

    // Handle list_email (Post Office — list the caller's own mailbox)
    if (toolCall.name === 'list_email') {
      const { executeListEmailTool, formatListEmailResults } = await import('@/lib/tools/handlers/list-email-handler');
      const out = await executeListEmailTool(toolCall.arguments, {
        userId,
        chatId,
        characterId,
      });
      return {
        toolName: 'list_email',
        success: out.success,
        result: { formattedText: formatListEmailResults(out), count: out.count },
        error: out.success ? undefined : out.error,
      };
    }

    // Handle terminal_read (read terminal scrollback)
    if (toolCall.name === 'terminal_read') {
      const terminalReadContext = {
        userId,
        chatId,
        config: {},
      };

      try {
        // Import validators at the point of use to avoid circular imports
        const { validateTerminalReadInput } = await import('@/lib/tools/terminal-read-tool');

        const parsedTerminalRead = validateTerminalReadInput(toolCall.arguments);
        if (!parsedTerminalRead) {
          return {
            toolName: 'terminal_read',
            success: false,
            result: null,
            error: 'Invalid arguments for terminal_read: sessionId is required',
          };
        }

        const result = await executeTerminalReadTool(parsedTerminalRead, terminalReadContext);
        const formattedResult = formatTerminalReadResults(result);

        return {
          toolName: 'terminal_read',
          success: true,
          result: {
            formattedText: formattedResult,
            sessionId: result.sessionId,
            shell: result.shell,
            cwd: result.cwd,
            status: result.status,
            exitCode: result.exitCode,
            lines: result.lines,
            totalLines: result.totalLines,
            startLine: result.startLine,
            endLine: result.endLine,
            truncated: result.truncated,
            scrollback: result.scrollback,
            ...(result.rawScrollback !== undefined ? { rawScrollback: result.rawScrollback } : {}),
          },
          error: undefined,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error reading terminal';
        return {
          toolName: 'terminal_read',
          success: false,
          result: null,
          error: errorMsg,
        };
      }
    }

    // Handle terminal_list (list terminal sessions)
    if (toolCall.name === 'terminal_list') {
      const terminalListContext = {
        userId,
        chatId,
        config: {},
      };

      try {
        // Import validator at the point of use to avoid circular imports
        const { validateTerminalListInput } = await import('@/lib/tools/terminal-list-tool');

        const parsedTerminalList = validateTerminalListInput(toolCall.arguments);
        if (!parsedTerminalList) {
          return {
            toolName: 'terminal_list',
            success: false,
            result: null,
            error: 'Invalid arguments for terminal_list',
          };
        }

        const result = await executeTerminalListTool(parsedTerminalList, terminalListContext);
        const formattedResult = formatTerminalListResults(result);

        return {
          toolName: 'terminal_list',
          success: true,
          result: {
            formattedText: formattedResult,
            sessions: result.sessions,
          },
          error: undefined,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error listing terminals';
        return {
          toolName: 'terminal_list',
          success: false,
          result: null,
          error: errorMsg,
        };
      }
    }

    // Unknown tool
    return {
      toolName: toolCall.name,
      success: false,
      result: null,
      error: `Unknown tool: ${toolCall.name}`,
    };
  } catch (error) {
    return {
      toolName: toolCall.name,
      success: false,
      result: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Detect tool calls in LLM response
 * Delegates to the provider plugin's parseToolCalls method
 */
export function detectToolCalls(
  response: unknown,
  provider: string
): ToolCallRequest[] {
  try {
    const plugin = providerRegistry.getProvider(provider)
    if (plugin?.parseToolCalls) {
      return plugin.parseToolCalls(response)
    }

    logger.warn('No provider plugin found for tool call parsing', { context: 'tool-executor', provider })
    return []
  } catch (error) {
    logger.error('Error detecting tool calls', { context: 'tool-executor', provider }, error instanceof Error ? error : undefined);
    return [];
  }
}
