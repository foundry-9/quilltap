/**
 * Roleplay Template Plugin Interface types for Quilltap plugin development
 *
 * @deprecated The ROLEPLAY_TEMPLATE plugin capability was removed in Quilltap v4.2.0.
 * Roleplay templates are now native first-class entities managed through the Settings UI.
 * These types are preserved for backward compatibility with existing third-party plugins
 * but will be removed in a future major version.
 *
 * @module @quilltap/plugin-types/plugins/roleplay-template
 */

// ============================================================================
// ANNOTATION BUTTONS
// ============================================================================

/**
 * Configuration for an annotation button in the formatting toolbar.
 *
 * Annotation buttons allow users to insert roleplay formatting
 * (e.g., narration brackets, OOC markers) with a single click.
 */
export interface AnnotationButton {
  /** Full name displayed in tooltip (e.g., "Narration", "Internal Monologue") */
  label: string;

  /** Abbreviated label displayed on button (e.g., "Nar", "Int", "OOC") */
  abbrev: string;

  /** Opening delimiter (e.g., "[", "*", "{{") */
  prefix: string;

  /** Closing delimiter (e.g., "]", "*", "}}") - empty string for line-end delimiters */
  suffix: string;
}

// ============================================================================
// RENDERING PATTERNS
// ============================================================================

/**
 * A pattern for styling roleplay text in message content.
 *
 * Rendering patterns define how to match and style specific text patterns
 * in AI responses (e.g., narration, OOC comments, internal monologue).
 *
 * @example
 * ```typescript
 * // Match *narration* with single asterisks
 * { pattern: '(?<!\\*)\\*[^*]+\\*(?!\\*)', className: 'qt-chat-narration' }
 *
 * // Match ((OOC comments)) with double parentheses
 * { pattern: '\\(\\([^)]+\\)\\)', className: 'qt-chat-ooc' }
 *
 * // Match // OOC at start of line (multiline mode)
 * { pattern: '^// .+$', className: 'qt-chat-ooc', flags: 'm' }
 * ```
 */
export interface RenderingPattern {
  /** Regex pattern as a string (converted to RegExp at runtime) */
  pattern: string;

  /**
   * CSS class to apply to matched text.
   * Standard classes: qt-chat-dialogue, qt-chat-narration, qt-chat-ooc, qt-chat-inner-monologue
   */
  className: string;

  /** Optional regex flags (e.g., 'm' for multiline). Default: none */
  flags?: string;
}

/**
 * Configuration for detecting dialogue at the paragraph level.
 *
 * When dialogue contains markdown formatting (like **bold**), the text gets split
 * into multiple children and inline regex patterns can't match. Paragraph-level
 * detection checks if the entire paragraph starts and ends with quote characters.
 *
 * @example
 * ```typescript
 * // Standard dialogue with straight and curly quotes
 * {
 *   openingChars: ['"', '\u201c'],
 *   closingChars: ['"', '\u201d'],
 *   className: 'qt-chat-dialogue'
 * }
 * ```
 */
export interface DialogueDetection {
  /** Opening quote characters to detect (e.g., ['"', '\u201c']) */
  openingChars: string[];

  /** Closing quote characters to detect (e.g., ['"', '\u201d']) */
  closingChars: string[];

  /** CSS class to apply to dialogue paragraphs */
  className: string;
}

// ============================================================================
// NARRATION DELIMITERS
// ============================================================================

/**
 * Narration delimiters define how narration/action text is marked in roleplay output.
 * Required for all roleplay templates.
 *
 * - A single string means the same character is used for opening and closing (e.g., '*')
 * - A tuple of two strings means different opening and closing delimiters (e.g., ['[', ']'])
 *
 * @example
 * ```typescript
 * // Single asterisk for both open and close
 * narrationDelimiters: '*'
 *
 * // Square brackets with different open/close
 * narrationDelimiters: ['[', ']']
 * ```
 */
export type NarrationDelimiters = string | [string, string];

// ============================================================================
// ROLEPLAY TEMPLATE CONFIGURATION
// ============================================================================

/**
 * Configuration for a single roleplay template
 *
 * A roleplay template defines a formatting protocol for AI responses,
 * such as how dialogue, actions, thoughts, and OOC comments should be formatted.
 */
export interface RoleplayTemplateConfig {
  /** Display name for the template */
  name: string;

  /** Optional description explaining the template's formatting style */
  description?: string;

  /**
   * The system prompt that defines the formatting rules.
   * This is prepended to character system prompts when the template is active.
   */
  systemPrompt: string;

  /** Tags for categorization and searchability */
  tags?: string[];

  /**
   * Annotation buttons for the formatting toolbar.
   * Defines which formatting options are available when document editing mode is enabled.
   *
   * @example
   * ```typescript
   * annotationButtons: [
   *   { label: 'Narration', abbrev: 'Nar', prefix: '[', suffix: ']' },
   *   { label: 'Internal Monologue', abbrev: 'Int', prefix: '{', suffix: '}' },
   *   { label: 'Out of Character', abbrev: 'OOC', prefix: '// ', suffix: '' },
   * ]
   * ```
   */
  annotationButtons?: AnnotationButton[];

  /**
   * Patterns for styling roleplay text in message content.
   * These patterns are matched against text nodes and wrapped in styled spans.
   *
   * @example
   * ```typescript
   * renderingPatterns: [
   *   // Match *narration* with single asterisks
   *   { pattern: '(?<!\\*)\\*[^*]+\\*(?!\\*)', className: 'qt-chat-narration' },
   *   // Match ((OOC)) with double parentheses
   *   { pattern: '\\(\\([^)]+\\)\\)', className: 'qt-chat-ooc' },
   * ]
   * ```
   */
  renderingPatterns?: RenderingPattern[];

  /**
   * Optional dialogue detection for paragraph-level styling.
   * When dialogue contains markdown formatting, inline patterns can't match.
   * This detects paragraphs that start/end with quote characters.
   *
   * @example
   * ```typescript
   * dialogueDetection: {
   *   openingChars: ['"', '\u201c'],
   *   closingChars: ['"', '\u201d'],
   *   className: 'qt-chat-dialogue'
   * }
   * ```
   */
  dialogueDetection?: DialogueDetection;

  /**
   * Narration delimiters — required for all templates.
   * Defines how narration/action text is delimited in the template's formatting.
   *
   * A single string means the same delimiter is used for opening and closing (e.g., '*').
   * A tuple of two strings means different opening and closing delimiters (e.g., ['[', ']']).
   *
   * @example
   * ```typescript
   * // Standard: *narration*
   * narrationDelimiters: '*'
   *
   * // Quilltap RP: [narration]
   * narrationDelimiters: ['[', ']']
   * ```
   */
  narrationDelimiters: NarrationDelimiters;
}

// ============================================================================
// ROLEPLAY TEMPLATE METADATA
// ============================================================================

/**
 * Metadata for a roleplay template plugin
 */
export interface RoleplayTemplateMetadata {
  /**
   * Unique template identifier (lowercase, hyphens allowed)
   * This is typically derived from the plugin name
   */
  templateId: string;

  /** Human-readable display name */
  displayName: string;

  /** Template description */
  description?: string;

  /** Template author */
  author?: string | {
    name: string;
    email?: string;
    url?: string;
  };

  /** Template tags for categorization */
  tags?: string[];

  /** Template version */
  version?: string;
}

// ============================================================================
// ROLEPLAY TEMPLATE PLUGIN INTERFACE
// ============================================================================

/**
 * Main Roleplay Template Plugin Interface
 *
 * Plugins implementing this interface can be dynamically loaded
 * by Quilltap to provide custom roleplay formatting templates.
 *
 * A plugin can provide one or more templates. Each template defines
 * a unique formatting protocol for AI responses.
 *
 * @example
 * ```typescript
 * import type { RoleplayTemplatePlugin } from '@quilltap/plugin-types';
 *
 * export const plugin: RoleplayTemplatePlugin = {
 *   metadata: {
 *     templateId: 'my-rp-format',
 *     displayName: 'My RP Format',
 *     description: 'A custom roleplay formatting style',
 *     tags: ['custom', 'roleplay'],
 *   },
 *   templates: [
 *     {
 *       name: 'My RP Format',
 *       description: 'Custom formatting with specific syntax',
 *       systemPrompt: `[FORMATTING INSTRUCTIONS]
 * 1. Dialogue: Use quotation marks
 * 2. Actions: Use asterisks *like this*
 * ...`,
 *       tags: ['custom'],
 *     },
 *   ],
 * };
 * ```
 *
 * @example
 * ```typescript
 * // Plugin with multiple templates
 * import type { RoleplayTemplatePlugin } from '@quilltap/plugin-types';
 *
 * export const plugin: RoleplayTemplatePlugin = {
 *   metadata: {
 *     templateId: 'format-pack',
 *     displayName: 'RP Format Pack',
 *     description: 'A collection of roleplay formats',
 *   },
 *   templates: [
 *     {
 *       name: 'Screenplay',
 *       systemPrompt: '...',
 *     },
 *     {
 *       name: 'Novel',
 *       systemPrompt: '...',
 *     },
 *   ],
 * };
 * ```
 */
export interface RoleplayTemplatePlugin {
  /** Plugin metadata for UI display and identification */
  metadata: RoleplayTemplateMetadata;

  /**
   * One or more roleplay templates provided by this plugin.
   * Each template has its own name, description, and system prompt.
   */
  templates: RoleplayTemplateConfig[];

  /**
   * Optional initialization function
   * Called when the plugin is loaded
   */
  initialize?: () => void | Promise<void>;
}

/**
 * Standard export type for roleplay template plugins
 */
export interface RoleplayTemplatePluginExport {
  /** The roleplay template plugin instance */
  plugin: RoleplayTemplatePlugin;
}
