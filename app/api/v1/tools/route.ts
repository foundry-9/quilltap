/**
 * Tools API v1
 *
 * GET /api/v1/tools - List all available LLM tools for per-chat settings
 * GET /api/v1/tools?chatId=xxx - List tools with availability info for a specific chat
 *
 * Returns both built-in tools and plugin-provided tools.
 * Excludes request_full_context which is never user-toggleable.
 *
 * When chatId is provided, includes availability status for context-dependent tools:
 * - generate_image: requires image profile on character participant
 * - project_info: requires chat to be in a project
 * - search_web: requires connection profile to allow web search
 */

import { NextRequest } from 'next/server';
import { createContextHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { successResponse, serverError } from '@/lib/api/responses';
import { toolRegistry } from '@/lib/plugins/tool-registry';
import type { UniversalTool } from '@/lib/plugins/interfaces/tool-plugin';
import { isWebSearchConfigured } from '@/lib/tools/handlers/web-search-handler';
import {
  askCarinaToolDefinition,
  imageGenerationToolDefinition,
  webSearchToolDefinition,
  projectInfoToolDefinition,
  helpSearchToolDefinition,
  helpSettingsToolDefinition,
  helpNavigateToolDefinition,
  rngToolDefinition,
  runCustomToolDefinition,
  stateToolDefinition,
  selfInventoryToolDefinition,
  whisperToolDefinition,
  wardrobeListToolDefinition,
  wardrobeReadToolDefinition,
  wardrobeCreateToolDefinition,
  wardrobeUpdateToolDefinition,
  wardrobeArchiveToolDefinition,
  wardrobeWearToolDefinition,
  wardrobeTakeOffToolDefinition,
  sendMailToolDefinition,
  listEmailToolDefinition,
} from '@/lib/tools';
import {
  searchScriptoriumToolDefinition,
} from '@/lib/tools/search-scriptorium-tool';
import {
  docReadFileTool,
  docWriteFileTool,
  docStrReplaceTool,
  docInsertTextTool,
  docGrepTool,
  docListFilesTool,
  docReadFrontmatterTool,
  docUpdateFrontmatterTool,
  docReadHeadingTool,
  docUpdateHeadingTool,
  docMoveFileTool,
  docCopyFileTool,
  docDeleteFileTool,
  docCreateFolderTool,
  docDeleteFolderTool,
} from '@/lib/tools';

/**
 * Map from built-in tool IDs to their OpenAI-format definitions (for schema inclusion)
 */
const BUILT_IN_TOOL_SCHEMAS: Record<string, { function: { parameters: Record<string, unknown> } }> = {
  ask_carina: askCarinaToolDefinition,
  send_mail: sendMailToolDefinition,
  list_email: listEmailToolDefinition,
  generate_image: imageGenerationToolDefinition,
  search: searchScriptoriumToolDefinition,
  search_web: webSearchToolDefinition,
  project_info: projectInfoToolDefinition,
  help_search: helpSearchToolDefinition,
  help_settings: helpSettingsToolDefinition,
  help_navigate: helpNavigateToolDefinition,
  rng: rngToolDefinition,
  run_custom: runCustomToolDefinition,
  state: stateToolDefinition,
  self_inventory: selfInventoryToolDefinition,
  whisper: whisperToolDefinition,
  wardrobe_list: wardrobeListToolDefinition,
  wardrobe_read: wardrobeReadToolDefinition,
  wardrobe_create: wardrobeCreateToolDefinition,
  wardrobe_update: wardrobeUpdateToolDefinition,
  wardrobe_archive: wardrobeArchiveToolDefinition,
  wardrobe_wear: wardrobeWearToolDefinition,
  wardrobe_take_off: wardrobeTakeOffToolDefinition,
  doc_read_file: docReadFileTool,
  doc_write_file: docWriteFileTool,
  doc_str_replace: docStrReplaceTool,
  doc_insert_text: docInsertTextTool,
  doc_grep: docGrepTool,
  doc_list_files: docListFilesTool,
  doc_read_frontmatter: docReadFrontmatterTool,
  doc_update_frontmatter: docUpdateFrontmatterTool,
  doc_read_heading: docReadHeadingTool,
  doc_update_heading: docUpdateHeadingTool,
  doc_move_file: docMoveFileTool,
  doc_copy_file: docCopyFileTool,
  doc_delete_file: docDeleteFileTool,
  doc_create_folder: docCreateFolderTool,
  doc_delete_folder: docDeleteFolderTool,
};

/**
 * Built-in tool definitions (these are always available)
 */
const BUILT_IN_TOOLS = [
  {
    id: 'ask_carina',
    name: 'Ask Carina',
    description: 'Ask a designated answerer character a quick standalone question without joining the conversation',
    source: 'built-in' as const,
    category: 'utility',
  },
  {
    id: 'send_mail',
    name: 'Send Mail',
    description: 'Post a Markdown letter to another character, delivered by Suparṇā into their vault mailbox',
    source: 'built-in' as const,
    category: 'utility',
  },
  {
    id: 'list_email',
    name: 'List Email',
    description: 'List the letters in your own mailbox, with the exact way to read, answer, or discard each',
    source: 'built-in' as const,
    category: 'utility',
  },
  {
    id: 'generate_image',
    name: 'Generate Image',
    description: 'Generate images using AI image generation providers',
    source: 'built-in' as const,
    category: 'media',
  },
  {
    id: 'search',
    name: 'Search',
    description: 'Search through the Scriptorium (character memories, past conversations, and story backgrounds)',
    source: 'built-in' as const,
    category: 'search',
  },
  {
    id: 'search_web',
    name: 'Search Web',
    description: 'Search the web for current information',
    source: 'built-in' as const,
    category: 'search',
  },
  {
    id: 'project_info',
    name: 'Project Info',
    description: 'Access project information and files',
    source: 'built-in' as const,
    category: 'project',
  },
  {
    id: 'help_search',
    name: 'Help Search',
    description: 'Search Quilltap help documentation for features, settings, and usage guidance',
    source: 'built-in' as const,
    category: 'help',
  },
  {
    id: 'help_settings',
    name: 'Help Settings',
    description: 'Read instance settings to understand current configuration (API keys are never shown)',
    source: 'built-in' as const,
    category: 'help',
  },
  {
    id: 'help_navigate',
    name: 'Help Navigate',
    description: 'Navigate the user\'s browser to a specific Quilltap page or settings section',
    source: 'built-in' as const,
    category: 'help',
  },
  {
    id: 'rng',
    name: 'Random Number Generator',
    description: 'Roll dice, flip coins, or randomly select a chat participant (spin the bottle)',
    source: 'built-in' as const,
    category: 'utility',
  },
  {
    id: 'run_custom',
    name: 'Custom Tools',
    description: "Run one of this scene's user-authored custom tools (Tools/*.tool.json) — Pascal rolls it server-side and announces the outcome. Only offered when the chat can actually see at least one valid definition.",
    source: 'built-in' as const,
    category: 'utility',
  },
  {
    id: 'state',
    name: 'State Manager',
    description: 'Get, set, or delete persistent key-value state for the chat',
    source: 'built-in' as const,
    category: 'utility',
  },
  {
    id: 'self_inventory',
    name: 'Self-Inventory',
    description: 'Return an introspection report for the calling character: vault files, memory and chat stats, assembled system prompt, and last-turn LLM token usage',
    source: 'built-in' as const,
    category: 'utility',
  },
  {
    id: 'whisper',
    name: 'Whisper',
    description: 'Send a private message to a specific character in a multi-character chat',
    source: 'built-in' as const,
    category: 'utility',
  },
  {
    id: 'wardrobe_list',
    name: 'List Wardrobe',
    description: 'Browse wardrobe items (own plus shared project / Quilltap General items) for the current character',
    source: 'built-in' as const,
    category: 'wardrobe',
  },
  {
    id: 'wardrobe_read',
    name: 'Read Wardrobe Item',
    description: 'Read the full detail of one wardrobe item, including its Portrait Cue',
    source: 'built-in' as const,
    category: 'wardrobe',
  },
  {
    id: 'wardrobe_create',
    name: 'Create Wardrobe Item',
    description: 'Create a new wardrobe item, optionally equip it, or gift it to another character',
    source: 'built-in' as const,
    category: 'wardrobe',
  },
  {
    id: 'wardrobe_update',
    name: 'Update Wardrobe Item',
    description: 'Edit the stored fields of an existing wardrobe item (own items only)',
    source: 'built-in' as const,
    category: 'wardrobe',
  },
  {
    id: 'wardrobe_archive',
    name: 'Archive Wardrobe Item',
    description: 'Retire a wardrobe item (own items only; restorable by a human)',
    source: 'built-in' as const,
    category: 'wardrobe',
  },
  {
    id: 'wardrobe_wear',
    name: 'Wear Wardrobe Items',
    description: 'Put on one or more wardrobe items (single garments or composite outfits)',
    source: 'built-in' as const,
    category: 'wardrobe',
  },
  {
    id: 'wardrobe_take_off',
    name: 'Take Off Wardrobe Items',
    description: 'Take off worn wardrobe items or empty slots',
    source: 'built-in' as const,
    category: 'wardrobe',
  },
  // Document editing tools (Scriptorium Phase 3.3)
  {
    id: 'doc_read_file',
    name: 'Read Document',
    description: 'Read file contents from document stores or project files',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_write_file',
    name: 'Write Document',
    description: 'Write or create a file in document stores or project files',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_str_replace',
    name: 'Find & Replace in Document',
    description: 'Find and replace exact text in a file (unique match required)',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_insert_text',
    name: 'Insert Text in Document',
    description: 'Insert text at a specific position in a file',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_grep',
    name: 'Search Documents',
    description: 'Search for text across files in document stores and project files',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_list_files',
    name: 'List Documents',
    description: 'List files available in document stores and project files',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_read_frontmatter',
    name: 'Read Frontmatter',
    description: 'Read YAML frontmatter from a markdown file',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_update_frontmatter',
    name: 'Update Frontmatter',
    description: 'Update YAML frontmatter properties in a markdown file',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_read_heading',
    name: 'Read Heading Section',
    description: 'Read all content under a specific heading in a markdown file',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_update_heading',
    name: 'Update Heading Section',
    description: 'Replace content under a specific heading in a markdown file',
    source: 'built-in' as const,
    category: 'documents',
  },
  // Document file management tools (Scriptorium Phase 3.4)
  {
    id: 'doc_move_file',
    name: 'Move/Rename Document',
    description: 'Move or rename a file in document stores or project files',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_copy_file',
    name: 'Copy Document',
    description: 'Copy a file from one document store to a different document store',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_delete_file',
    name: 'Delete Document',
    description: 'Permanently delete a file from document stores or project files',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_create_folder',
    name: 'Create Folder',
    description: 'Create a new folder in document stores or project files',
    source: 'built-in' as const,
    category: 'documents',
  },
  {
    id: 'doc_delete_folder',
    name: 'Delete Folder',
    description: 'Delete an empty folder from document stores or project files',
    source: 'built-in' as const,
    category: 'documents',
  },
  // Photo album tools — keep, list, and re-attach images saved to a
  // character's vault under photos/. Same gate as the doc-edit family.
  {
    id: 'keep_image',
    name: 'Keep Image',
    description: "Save a generated image to the character's photo album with optional caption and tags",
    source: 'built-in' as const,
    category: 'photos',
  },
  {
    id: 'list_images',
    name: 'List Kept Images',
    description: 'Search or list images previously saved to the photo album',
    source: 'built-in' as const,
    category: 'photos',
  },
  {
    id: 'attach_image',
    name: 'Attach Kept Image',
    description: 'Re-attach a previously kept image to the current chat message',
    source: 'built-in' as const,
    category: 'photos',
  },
  {
    id: 'describe_image',
    name: 'Describe Image',
    description: 'Look at an image and report what it depicts',
    source: 'built-in' as const,
    category: 'photos',
  },
  // Note: request_full_context and submit_final_response are intentionally excluded
  // - request_full_context is a safety valve that should always be available
  // - submit_final_response is an agent-mode internal tool
];

export interface AvailableTool {
  id: string;
  name: string;
  description: string;
  source: 'built-in' | 'plugin';
  category?: string;
  pluginName?: string;
  /** Subgroup identifier within the plugin (e.g., MCP server name) */
  subgroupId?: string;
  /** Human-readable subgroup name */
  subgroupDisplayName?: string;
  /** Whether the tool is actually available in the current context (only set when chatId provided) */
  available?: boolean;
  /** Reason why the tool is unavailable (only set when available is false) */
  unavailableReason?: string;
  /** Whether the tool can be invoked directly by the user (false for internal-only tools) */
  userInvocable?: boolean;
  /** JSON Schema for the tool's parameters (only included when includeSchemas=true) */
  parameters?: Record<string, unknown>;
}

/**
 * GET /api/v1/tools
 * GET /api/v1/tools?chatId=xxx
 * List all available LLM tools that can be enabled/disabled per chat
 */
export const GET = createContextHandler(async (req: NextRequest, { user, repos }) => {
  try {
    const chatId = req.nextUrl.searchParams.get('chatId');
    const includeSchemas = req.nextUrl.searchParams.get('includeSchemas') === 'true';
    const tools: AvailableTool[] = BUILT_IN_TOOLS.map(t => ({
      ...t,
      userInvocable: true,
      ...(includeSchemas && BUILT_IN_TOOL_SCHEMAS[t.id]
        ? { parameters: BUILT_IN_TOOL_SCHEMAS[t.id].function.parameters }
        : {}),
    }));

    // If chatId provided, get chat context for availability checks
    let chatContext: {
      hasImageProfile: boolean;
      hasProject: boolean;
      hasDocumentStores: boolean;
      allowsWebSearch: boolean;
      isMultiCharacter: boolean;
      canDressThemselves: boolean;
      canCreateOutfits: boolean;
    } | null = null;

    if (chatId) {
      try {
        const chat = await repos.chats.findById(chatId);
        if (chat && chat.userId === user.id) {
          // Check for image profile on character participant
          const characterParticipant = chat.participants.find(
            p => p.type === 'CHARACTER' && p.isActive
          );
          const hasImageProfile = !!chat.imageProfileId || !!characterParticipant?.imageProfileId;

          // Check if chat is in a project
          const hasProject = !!chat.projectId;

          // Check if connection profile allows web search
          let allowsWebSearch = false;
          if (characterParticipant?.connectionProfileId) {
            const connectionProfile = await repos.connections.findById(
              characterParticipant.connectionProfileId
            );
            allowsWebSearch = !!connectionProfile?.allowWebSearch;
          }

          // Check if chat has multiple active character participants (for whisper)
          const activeCharacterCount = chat.participants.filter(
            p => p.type === 'CHARACTER' && p.isActive
          ).length;
          const isMultiCharacter = activeCharacterCount > 1;

          // Check wardrobe capability flags from character (default: enabled when null)
          let canDressThemselves = true;
          let canCreateOutfits = true;
          if (characterParticipant?.characterId) {
            try {
              const character = await repos.characters.findById(characterParticipant.characterId);
              if (character) {
                canDressThemselves = character.canDressThemselves !== false;
                canCreateOutfits = character.canCreateOutfits !== false;
              }
            } catch (charError) {
              logger.warn('[Tools v1] Failed to load character for wardrobe check', {
                characterId: characterParticipant.characterId,
                error: charError instanceof Error ? charError.message : String(charError),
              });
            }
          }

          // Check if project has linked document stores
          let hasDocumentStores = false;
          if (hasProject && chat.projectId) {
            try {
              const mountLinks = await repos.projectDocMountLinks.findByProjectId(chat.projectId);
              hasDocumentStores = mountLinks.length > 0;
            } catch {
              // Non-critical, default to false
            }
          }

          chatContext = { hasImageProfile, hasProject, hasDocumentStores, allowsWebSearch, isMultiCharacter, canDressThemselves, canCreateOutfits };
        }
      } catch (chatError) {
        logger.warn('[Tools v1] Failed to load chat for availability check', {
          chatId,
          error: chatError instanceof Error ? chatError.message : String(chatError),
        });
      }
    }

    // Add plugin tools from the tool registry
    const pluginToolConfigs = new Map<string, Record<string, unknown>>();

    // Load user's plugin configurations to get properly configured tools
    try {
      const userPluginConfigs = await repos.pluginConfigs.findByUserId(user.id);
      for (const config of userPluginConfigs) {
        const toolName = config.pluginName.replace(/^qtap-plugin-/, '');
        pluginToolConfigs.set(toolName, config.config);
      }
    } catch (configError) {
      logger.warn('[Tools v1] Failed to load user plugin configs', {
        userId: user.id,
        error: configError instanceof Error ? configError.message : String(configError),
      });
    }

    // Iterate plugins individually to track which plugin each tool comes from
    // (Previously used getConfiguredToolDefinitions which lost the plugin→tool mapping,
    // causing multi-tool plugins to have tools without pluginName, which were then
    // silently dropped by the UI hierarchy builder)
    const allPlugins = toolRegistry.getAllPlugins();
    const pluginMetadataMap = new Map<string, { displayName?: string; description?: string; category?: string }>();

    for (const plugin of allPlugins) {
      const pluginName = plugin.metadata.toolName;
      const config = pluginToolConfigs.get(pluginName) || {};

      // Check if plugin is configured (if it requires configuration)
      if (plugin.isConfigured && !plugin.isConfigured(config)) {
        continue;
      }

      // Store metadata for later enhancement
      pluginMetadataMap.set(pluginName, {
        displayName: plugin.metadata.displayName,
        description: plugin.metadata.description,
        category: plugin.metadata.category,
      });

      try {
        // Get tool definitions using the same method the registry uses internally
        let pluginToolDefs: UniversalTool[] = [];
        if (typeof plugin.getToolDefinitions === 'function') {
          pluginToolDefs = await plugin.getToolDefinitions(config);
        } else if (typeof plugin.getMultipleToolDefinitions === 'function') {
          pluginToolDefs = await plugin.getMultipleToolDefinitions(config);
        } else if (typeof plugin.getToolDefinition === 'function') {
          pluginToolDefs = [plugin.getToolDefinition()];
        }

        for (const toolDef of pluginToolDefs) {
          const toolName = toolDef.function.name;

          // Skip internal-only tools
          if (toolName === 'request_full_context' || toolName === 'submit_final_response') {
            continue;
          }

          // Skip if this tool is already in built-in tools
          if (BUILT_IN_TOOLS.some(t => t.id === toolName)) {
            continue;
          }

          tools.push({
            id: toolName,
            name: toolDef.function.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            description: toolDef.function.description || 'Plugin-provided tool',
            source: 'plugin',
            category: 'plugin',
            pluginName,
            userInvocable: true,
            ...(includeSchemas && toolDef.function.parameters
              ? { parameters: toolDef.function.parameters as Record<string, unknown> }
              : {}),
          });
        }
      } catch (error) {
        logger.error('[Tools v1] Error getting tools from plugin', {
          pluginName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Enhance single-tool plugins with better metadata from plugin registration
    for (const [pluginName, metadata] of pluginMetadataMap) {
      const existingTool = tools.find(t => t.source === 'plugin' && t.id === pluginName);
      if (existingTool) {
        existingTool.name = metadata.displayName || existingTool.name;
        existingTool.description = metadata.description || existingTool.description;
        existingTool.category = metadata.category || existingTool.category;
      }
    }

    // Get tool hierarchy info from plugins that support it
    // This allows grouping tools by subgroup (e.g., MCP server)
    for (const plugin of allPlugins) {
      if (typeof plugin.getToolHierarchy === 'function') {
        try {
          const pluginName = plugin.metadata.toolName;
          const config = pluginToolConfigs.get(pluginName) || {};
          const hierarchy = await plugin.getToolHierarchy(config);

          // Merge hierarchy info into the corresponding tools
          for (const hierarchyInfo of hierarchy) {
            const tool = tools.find(t => t.id === hierarchyInfo.toolId);
            if (tool) {
              tool.pluginName = pluginName;
              tool.subgroupId = hierarchyInfo.subgroupId;
              tool.subgroupDisplayName = hierarchyInfo.subgroupDisplayName;
            }
          }
        } catch (hierarchyError) {
          logger.warn('[Tools v1] Failed to get tool hierarchy from plugin', {
            pluginName: plugin.metadata.toolName,
            error: hierarchyError instanceof Error ? hierarchyError.message : String(hierarchyError),
          });
        }
      }
    }

    // Set availability status for context-dependent tools
    if (chatContext) {
      for (const tool of tools) {
        // Default to available
        tool.available = true;

        // Check specific tool requirements
        switch (tool.id) {
          case 'generate_image':
            if (!chatContext.hasImageProfile) {
              tool.available = false;
              tool.unavailableReason = 'Requires an image generation profile to be configured for the character';
            }
            break;
          case 'project_info':
            if (!chatContext.hasProject) {
              tool.available = false;
              tool.unavailableReason = 'Chat must be associated with a project';
            }
            break;
          case 'search_web':
            if (!chatContext.allowsWebSearch) {
              tool.available = false;
              tool.unavailableReason = 'Web search must be enabled in the connection profile';
            } else if (!isWebSearchConfigured()) {
              tool.available = false;
              tool.unavailableReason = 'No search provider configured. Please add a search provider API key in Settings > API Keys.';
            }
            break;
          case 'whisper':
            if (!chatContext.isMultiCharacter) {
              tool.available = false;
              tool.unavailableReason = 'Whisper requires a multi-character chat with more than one active character';
            }
            break;
          case 'wardrobe_list':
          case 'wardrobe_read':
          case 'wardrobe_wear':
          case 'wardrobe_take_off':
            if (!chatContext.canDressThemselves) {
              tool.available = false;
              tool.unavailableReason = 'Character does not have wardrobe self-dressing enabled';
            }
            break;
          case 'wardrobe_create':
          case 'wardrobe_update':
          case 'wardrobe_archive':
            if (!chatContext.canCreateOutfits) {
              tool.available = false;
              tool.unavailableReason = 'Character does not have wardrobe item creation enabled';
            }
            break;
          case 'doc_read_file':
          case 'doc_write_file':
          case 'doc_str_replace':
          case 'doc_insert_text':
          case 'doc_grep':
          case 'doc_list_files':
          case 'doc_read_frontmatter':
          case 'doc_update_frontmatter':
          case 'doc_read_heading':
          case 'doc_update_heading':
          case 'doc_move_file':
          case 'doc_delete_file':
          case 'doc_create_folder':
          case 'doc_delete_folder':
            if (!chatContext.hasProject) {
              tool.available = false;
              tool.unavailableReason = 'Chat must be associated with a project';
            } else if (!chatContext.hasDocumentStores) {
              tool.available = false;
              tool.unavailableReason = 'Project must have linked document stores (configure in Project > The Scriptorium)';
            }
            break;
        }
      }
    }

    return successResponse({
      tools,
      count: tools.length,
    });
  } catch (error) {
    logger.error('[Tools v1] Error listing tools', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to list available tools');
  }
});
