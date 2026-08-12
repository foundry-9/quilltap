/**
 * Google Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Google's Generative AI API
 * Uses the new @google/genai SDK (replacing deprecated @google/generative-ai)
 * Supports Gemini models with multimodal capabilities (text + images)
 */

import { GoogleGenAI } from '@google/genai';
import type { TextProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, ModelMetadata } from './types';
import { createPluginLogger, getQuilltapUserAgent, resolveRequestTimeoutMs } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-google');

// Google Gemini supports image analysis
const GOOGLE_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

// Safety setting categories
const SAFETY_CATEGORIES = [
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
  'HARM_CATEGORY_HARASSMENT',
];

// Fields that Google's function calling API doesn't support
// These are valid JSON Schema fields but not accepted by Google
const UNSUPPORTED_SCHEMA_FIELDS = [
  'propertyNames',
  'additionalItems',
  'contains',
  'patternProperties',
  'dependencies',
  'if',
  'then',
  'else',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  '$schema',
  '$id',
  '$ref',
  '$comment',
  'definitions',
  '$defs',
  'examples',
  'default',
  'const',
  'contentMediaType',
  'contentEncoding',
];

/**
 * Recursively sanitize a JSON Schema object for Google's function calling API
 * Removes unsupported fields that would cause API errors
 */
function sanitizeSchemaForGoogle(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(sanitizeSchemaForGoogle);
  }

  const sanitized: any = {};
  for (const [key, value] of Object.entries(schema)) {
    // Skip unsupported fields
    if (UNSUPPORTED_SCHEMA_FIELDS.includes(key)) {
      continue;
    }

    // Google API requires uppercase Type strings
    if (key === 'type') {
      if (typeof value === 'string') {
        sanitized[key] = value.toUpperCase();
        continue;
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map(v => typeof v === 'string' ? v.toUpperCase() : v);
        continue;
      }
    }

    // Recursively sanitize nested objects
    if (value && typeof value === 'object') {
      sanitized[key] = sanitizeSchemaForGoogle(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// TODO(per-character-caching): Wire `params.cacheKey` to a managed
// `cachedContents` resource keyed by characterId. See
// docs/developer/features/per-character-prompt-caching.md and
// https://ai.google.dev/api/caching. Today this plugin only surfaces
// `cachedContentTokenCount` on responses; it does not yet create or refresh
// cached content on the request side.
export class GoogleProvider implements TextProvider {
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes = GOOGLE_SUPPORTED_MIME_TYPES;
  readonly supportsWebSearch = true;

  /**
   * Check if a model is a Gemini thinking model that requires special response handling
   * These models may return content in 'thought' parts that need to be extracted differently
   * They also require thought signatures on ALL model responses when tools are enabled
   */
  private isThinkingModel(modelName: string): boolean {
    const lowerName = modelName.toLowerCase();

    // Gemini 3.x models are thinking models
    if (lowerName.includes('gemini-3') || lowerName.includes('gemini-3.')) {
      return true;
    }

    // 2.5-series thinking models. Substring matches, so 'gemini-2.5-flash'
    // also covers '-flash-lite', '-flash-preview-*', and '-flash-thinking'.
    const thinkingModels = [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      // Rolling aliases that currently resolve to Gemini 3 (thinking) models.
      // Without these, `gemini-pro-latest` / `gemini-flash-latest` slip through
      // the substring checks above, so thinking is never requested.
      'gemini-pro-latest',
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
    ];
    return thinkingModels.some(m => lowerName.includes(m.toLowerCase()));
  }

  /**
   * Whether a model belongs to the Gemini 3 family, which configures thinking
   * via `thinkingLevel` (string) rather than the legacy `thinkingBudget`
   * (numeric token ceiling). Sending `thinkingBudget` to a Gemini 3 model is
   * accepted for backward-compat but treats the value as a ceiling, so the
   * model can (and does, on simple turns) spend zero thinking tokens and return
   * no thought summary. The rolling `-latest` aliases currently resolve to
   * Gemini 3 (e.g. `gemini-pro-latest` → `gemini-3.1-pro-preview`).
   */
  private isGemini3Model(modelName: string): boolean {
    const lowerName = modelName.toLowerCase();
    if (lowerName.includes('gemini-3')) {
      return true;
    }
    return (
      lowerName.includes('gemini-pro-latest') ||
      lowerName.includes('gemini-flash-latest') ||
      lowerName.includes('gemini-flash-lite-latest')
    );
  }

  /**
   * Check if a model supports function calling (tools)
   * Some models like image-specialized models do not support function calling
   */
  private supportsToolCalling(modelName: string): boolean {
    // Models that explicitly do NOT support function calling
    const noToolsModels = [
      'gemini-2.5-flash-image', // Image generation model, no function calling
      'gemini-2.0-flash-exp-image-generation', // Experimental image model
      'imagen', // Imagen models don't support function calling
    ];
    const lowerName = modelName.toLowerCase();
    // Check explicit no-tools list
    if (noToolsModels.some(m => lowerName.includes(m.toLowerCase()))) {
      return false;
    }
    // Also disable for any model with "image" in the name that's not a vision model
    // Vision models (for analyzing images) do support tools, but generation models don't
    if (lowerName.includes('-image') && !lowerName.includes('vision')) {
      return false;
    }
    return true;
  }

  /**
   * Extract thought signature from Google Gemini response
   * Gemini 3 thinking models return thoughtSignature in the first part of the response
   * This must be stored and passed back for multi-turn function calling conversations
   */
  private extractThoughtSignature(response: any): string | undefined {
    try {
      const candidates = response?.candidates;
      if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        return undefined;
      }

      const parts = candidates[0]?.content?.parts;
      if (!parts || !Array.isArray(parts) || parts.length === 0) {
        return undefined;
      }

      // The thoughtSignature is typically on the first part
      const firstPart = parts[0];
      if (firstPart?.thoughtSignature) {
        return firstPart.thoughtSignature;
      }

      // Also check for functionCall parts which may have signatures
      for (const part of parts) {
        if (part?.functionCall?.thoughtSignature) {
          return part.functionCall.thoughtSignature;
        }
      }

      return undefined;
    } catch (error) {
      logger.warn('Error extracting thought signature', {
        context: 'GoogleProvider.extractThoughtSignature',
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Extract text content from Gemini response
   * For thinking models, we need to filter out thought parts and get actual response text
   */
  private extractTextFromResponse(response: any, modelName: string): string {
    try {
      // Try the SDK's text property first (new SDK provides this directly)
      if (response?.text) {
        return response.text;
      }

      // Fall back to extracting from candidates/parts
      const candidates = response?.candidates;
      if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        logger.warn('No candidates found in Google response', {
          context: 'GoogleProvider.extractTextFromResponse',
          modelName,
          blockReason: response?.promptFeedback?.blockReason,
        });
        return '';
      }

      const firstCandidate = candidates[0];
      const parts = firstCandidate?.content?.parts;
      if (!parts || !Array.isArray(parts) || parts.length === 0) {
        const content = firstCandidate?.content;
        logger.warn('No parts found in Google response candidate', {
          context: 'GoogleProvider.extractTextFromResponse',
          modelName,
          finishReason: firstCandidate?.finishReason,
        });

        // Try to extract text if it's directly on content (SDK variation)
        if (content?.text) {
          return content.text;
        }

        return '';
      }

      // Collect all text from non-thought parts
      const textParts: string[] = [];
      for (const part of parts) {
        // Skip functionCall parts and thought parts (internal reasoning)
        if (part.functionCall || part.thought === true) {
          continue;
        }

        if (part.text) {
          textParts.push(part.text);
        }
      }

      return textParts.join('');
    } catch (error) {
      logger.warn('Error extracting text from response', {
        context: 'GoogleProvider.extractTextFromResponse',
        modelName,
        error: error instanceof Error ? error.message : String(error),
      });
      return '';
    }
  }

  /**
   * Format messages for the Google Gemini API
   * Converts from Quilltap's message format to Google's content format
   */
  private formatMessagesForGoogle(
    messages: LLMMessage[],
    modelName: string,
    hasTools: boolean
  ): { contents: any[]; systemInstruction?: string; shouldDisableTools: boolean; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];

    const isThinking = this.isThinkingModel(modelName);

    // Extract system message to use as systemInstruction
    let systemInstruction: string | undefined;
    let nonSystemMessages = messages;

    const systemMessages = messages.filter(m => m.role === 'system');
    if (systemMessages.length > 0) {
      systemInstruction = systemMessages.map(m => m.content).join('\n\n');
      nonSystemMessages = messages.filter(m => m.role !== 'system');
    }

    // Check if this model supports function calling at all
    let shouldDisableTools = false;

    if (hasTools && !this.supportsToolCalling(modelName)) {
      shouldDisableTools = true;
      logger.info('Disabling tools - model does not support function calling', {
        context: 'GoogleProvider.formatMessagesForGoogle',
        modelName,
      });
    }

    // For thinking models with tools, check for legacy messages without thought signatures
    // Gemini 3 requires thought signatures on ALL model responses when tools are enabled
    if (!shouldDisableTools && isThinking && hasTools) {
      const assistantMessages = nonSystemMessages.filter(m => m.role === 'assistant');
      const assistantWithoutSig = assistantMessages.filter(m => !m.thoughtSignature);

      if (assistantWithoutSig.length > 0) {
        shouldDisableTools = true;
        logger.warn('Disabling tools for thinking model due to legacy messages without thought signatures', {
          context: 'GoogleProvider.formatMessagesForGoogle',
          legacyMessageCount: assistantWithoutSig.length,
          totalAssistantMessages: assistantMessages.length,
          modelName,
        });
      }
    }

    // Google API requires alternating user/model roles - merge consecutive user messages
    // But DON'T merge tool result messages - they need special handling
    const mergedMessages: LLMMessage[] = [];
    for (const msg of nonSystemMessages) {
      const lastMsg = mergedMessages[mergedMessages.length - 1];
      // Only merge regular user messages (not tool results)
      if (lastMsg && lastMsg.role === 'user' && msg.role === 'user' && !msg.toolCallId) {
        // Merge consecutive user messages
        lastMsg.content = lastMsg.content + '\n\n' + msg.content;
        // Merge attachments if any
        if (msg.attachments) {
          lastMsg.attachments = [...(lastMsg.attachments || []), ...msg.attachments];
        }
      } else {
        mergedMessages.push({ ...msg });
      }
    }

    // Format messages for Google API
    const contents: any[] = [];

    // Track consecutive tool results to batch them into a single user message
    let pendingToolResponses: any[] = [];

    const flushToolResponses = () => {
      if (pendingToolResponses.length > 0) {
        contents.push({
          role: 'user',
          parts: pendingToolResponses,
        });
        pendingToolResponses = [];
      }
    };

    for (const msg of mergedMessages) {
      // Handle tool result messages (role: 'tool' or messages with toolCallId)
      if (msg.role === 'tool' || msg.toolCallId) {
        // Parse the content - it might be JSON or plain text
        let responseData: any;
        try {
          responseData = JSON.parse(msg.content);
        } catch {
          // If not JSON, wrap as text response
          responseData = { result: msg.content };
        }

        // Google uses function name (not call ID) for correlation
        const functionName = msg.name || msg.toolCallId || 'unknown_function';

        pendingToolResponses.push({
          functionResponse: {
            name: functionName,
            response: responseData,
          },
        });
        continue;
      }

      // Flush any pending tool responses before non-tool messages
      flushToolResponses();

      const parts: any[] = [];

      // Handle assistant messages with tool calls
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        // Add text content first if present
        if (msg.content) {
          const textPart: any = { text: msg.content };
          if (msg.thoughtSignature) {
            textPart.thoughtSignature = msg.thoughtSignature;
          }
          parts.push(textPart);
        }

        // Add function calls
        for (const toolCall of msg.toolCalls) {
          let args: Record<string, unknown>;
          try {
            args = typeof toolCall.function.arguments === 'string'
              ? JSON.parse(toolCall.function.arguments)
              : toolCall.function.arguments;
          } catch {
            args = {};
          }

          parts.push({
            functionCall: {
              name: toolCall.function.name,
              args,
            },
          });
        }

        contents.push({
          role: 'model',
          parts,
        });
        continue;
      }

      // Add text content for regular messages
      if (msg.content) {
        const textPart: any = { text: msg.content };
        // Add thought signature for assistant messages (required for Gemini 3 thinking models)
        if (msg.role === 'assistant' && msg.thoughtSignature) {
          textPart.thoughtSignature = msg.thoughtSignature;
        }
        parts.push(textPart);
      }

      // Add image attachments
      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
            logger.warn('Unsupported attachment type', {
              context: 'GoogleProvider.formatMessagesForGoogle',
              mimeType: attachment.mimeType,
            });
            failed.push({
              id: attachment.id,
              error: `Unsupported file type: ${attachment.mimeType}. Google supports: ${this.supportedMimeTypes.join(', ')}`,
            });
            continue;
          }

          if (!attachment.data) {
            logger.warn('Attachment data not loaded', {
              context: 'GoogleProvider.formatMessagesForGoogle',
              attachmentId: attachment.id,
            });
            failed.push({
              id: attachment.id,
              error: 'File data not loaded',
            });
            continue;
          }

          parts.push({
            inlineData: {
              mimeType: attachment.mimeType,
              data: attachment.data,
            },
          });
          sent.push(attachment.id);
        }
      }

      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts,
      });
    }

    // Flush any remaining tool responses
    flushToolResponses();

    return { contents, systemInstruction, shouldDisableTools, attachmentResults: { sent, failed } };
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    // A caller-supplied budget is a ceiling; without one the SDK default would
    // let a silent endpoint hold a turn open indefinitely.
    const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': getQuilltapUserAgent() }, timeout: resolveRequestTimeoutMs(params) } });

    // Build tools configuration
    const tools: any[] = [];

    // Add function declarations if provided
    if (params.tools && params.tools.length > 0) {
      tools.push({
        functionDeclarations: params.tools.map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'OBJECT',
            // Sanitize properties to remove unsupported JSON Schema fields
            properties: sanitizeSchemaForGoogle(tool.parameters?.properties || {}),
            required: tool.parameters?.required || [],
          },
        })),
      });
    }

    // Add Google Search grounding if web search is enabled
    if (params.webSearchEnabled) {
      tools.push({ googleSearch: {} });
    }

    const hasTools = tools.length > 0;
    const { contents, systemInstruction, shouldDisableTools, attachmentResults } = this.formatMessagesForGoogle(params.messages, params.model, hasTools);

    // Build config object
    const config: any = {
      // Safety settings - set to minimum blocking
      safetySettings: SAFETY_CATEGORIES.map(category => ({
        category,
        threshold: 'BLOCK_NONE',
      })),
      // Generation config
      temperature: params.temperature ?? 0.7,
      maxOutputTokens: params.maxTokens ?? 4096,
      topP: params.topP ?? 1,
    };

    // Add system instruction if we extracted one from system messages
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    // Add tools if we have them AND we shouldn't disable them
    if (hasTools && !shouldDisableTools) {
      config.tools = tools;
    } else if (shouldDisableTools) {
      logger.info('Tools disabled for this request due to model limitations or legacy messages', {
        context: 'GoogleProvider.sendMessage',
        toolCount: tools.length,
      });
    }

    // Normalize stop sequences to array format
    if (params.stop) {
      config.stopSequences = Array.isArray(params.stop) ? params.stop : [params.stop];
    }

    // Configure thinking for thinking models. Gemini 3 configures thinking via
    // `thinkingLevel`; the legacy numeric `thinkingBudget` is only a ceiling on
    // Gemini 3, so the model can spend zero thinking tokens and return no
    // summary. Gemini 2.5 still uses `thinkingBudget`.
    if (this.isThinkingModel(params.model)) {
      const isG3 = this.isGemini3Model(params.model);
      if (!params.strictMaxTokens) {
        config.thinkingConfig = isG3
          ? { thinkingLevel: 'high', includeThoughts: true }
          : { thinkingBudget: 4096, includeThoughts: true };
        config.maxOutputTokens = Math.max(config.maxOutputTokens, 8192);
      } else {
        // Strict mode: minimal thinking for background tasks.
        config.thinkingConfig = isG3
          ? { thinkingLevel: 'low', includeThoughts: true }
          : { thinkingBudget: 1024, includeThoughts: true };
      }
    }

    try {
      const response = await ai.models.generateContent({
        model: params.model,
        contents,
        config,
      });

      // Extract text using our helper that handles thinking models correctly
      const text = this.extractTextFromResponse(response, params.model);
      const finishReason = response.candidates?.[0]?.finishReason ?? 'STOP';
      const usage = response.usageMetadata;

      // Extract thought signature for Gemini 3 thinking models
      const thoughtSignature = this.extractThoughtSignature(response);

      // Extract reasoning from thought parts (parts where thought === true)
      let sendReasoningContent = '';
      try {
        const parts = response?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (part.thought === true && part.text) {
              sendReasoningContent += part.text;
            }
          }
        }
      } catch {
        // Ignore extraction errors
      }

      const cachedTokens = usage?.cachedContentTokenCount
      const cacheUsage = cachedTokens !== undefined && cachedTokens > 0
        ? { cacheReadInputTokens: cachedTokens, cachedTokens }
        : undefined

      return {
        content: text,
        finishReason,
        usage: {
          // Exclude cache-read tokens from prompt/total so cached input is not
          // charged against budgets or cost; cacheUsage still reports them for
          // display. (Gemini folds cachedContentTokenCount into promptTokenCount.)
          promptTokens: Math.max(0, (usage?.promptTokenCount ?? 0) - (cachedTokens ?? 0)),
          completionTokens: usage?.candidatesTokenCount ?? 0,
          totalTokens: Math.max(0, (usage?.totalTokenCount ?? 0) - (cachedTokens ?? 0)),
        },
        // Convert SDK response class to plain object for Zod validation
        raw: {
          ...JSON.parse(JSON.stringify(response)),
          functionCalls: response.functionCalls ? response.functionCalls.map((fc: any) => ({ name: fc.name, args: fc.args })) : undefined,
        },
        attachmentResults,
        thoughtSignature,
        ...(cacheUsage ? { cacheUsage } : {}),
        ...(sendReasoningContent ? { reasoningContent: sendReasoningContent } : {}),
      };
    } catch (error) {
      logger.error('Error calling Google Gemini API', {
        context: 'GoogleProvider.sendMessage',
        model: params.model,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    // Only an explicit caller budget is honored on the streaming path. Unlike
    // the OpenAI SDK, whose timeout stops at the response headers, this one is
    // documented as "timeout for the request" — imposing a default here could
    // cut off a long generation mid-answer. Background work, which is what the
    // budget exists for, never streams.
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { 'User-Agent': getQuilltapUserAgent() },
        ...(params.requestTimeoutMs ? { timeout: params.requestTimeoutMs } : {}),
      },
    });

    // Build tools configuration
    const tools: any[] = [];

    // Add function declarations if provided
    if (params.tools && params.tools.length > 0) {
      tools.push({
        functionDeclarations: params.tools.map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'OBJECT',
            // Sanitize properties to remove unsupported JSON Schema fields
            properties: sanitizeSchemaForGoogle(tool.parameters?.properties || {}),
            required: tool.parameters?.required || [],
          },
        })),
      });
    }

    // Add Google Search grounding if web search is enabled
    if (params.webSearchEnabled) {
      tools.push({ googleSearch: {} });
    }

    const hasTools = tools.length > 0;
    const { contents, systemInstruction, shouldDisableTools, attachmentResults } = this.formatMessagesForGoogle(params.messages, params.model, hasTools);

    // Build config object
    const config: any = {
      // Safety settings - set to minimum blocking
      safetySettings: SAFETY_CATEGORIES.map(category => ({
        category,
        threshold: 'BLOCK_NONE',
      })),
      // Generation config
      temperature: params.temperature ?? 0.7,
      maxOutputTokens: params.maxTokens ?? 4096,
      topP: params.topP ?? 1,
    };

    // Add system instruction
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }

    // Add tools if appropriate
    if (hasTools && !shouldDisableTools) {
      config.tools = tools;
    } else if (shouldDisableTools) {
      logger.info('Tools disabled for this stream request due to model limitations or legacy messages', {
        context: 'GoogleProvider.streamMessage',
        toolCount: tools.length,
      });
    }

    // Normalize stop sequences
    if (params.stop) {
      config.stopSequences = Array.isArray(params.stop) ? params.stop : [params.stop];
    }

    // Configure thinking for thinking models (same as sendMessage).
    if (this.isThinkingModel(params.model)) {
      const isG3 = this.isGemini3Model(params.model);
      if (!params.strictMaxTokens) {
        config.thinkingConfig = isG3
          ? { thinkingLevel: 'high', includeThoughts: true }
          : { thinkingBudget: 4096, includeThoughts: true };
        config.maxOutputTokens = Math.max(config.maxOutputTokens, 8192);
      } else {
        // Strict mode: minimal thinking for background tasks.
        config.thinkingConfig = isG3
          ? { thinkingLevel: 'low', includeThoughts: true }
          : { thinkingBudget: 1024, includeThoughts: true };
      }
    }

    try {
      const response = await ai.models.generateContentStream({
        model: params.model,
        contents,
        config,
      });

      let totalStreamedContent = '';
      const isThinking = this.isThinkingModel(params.model);
      let lastResponse: any = null;
      let streamReasoning = '';
      // Diagnostics: distinguish "model never thought" from "model thought but
      // returned no summary text" (signature-only) when reasoning fails to show.
      let partsSeen = 0;
      let thoughtPartsWithText = 0;
      let thoughtPartsNoText = 0;
      let textParts = 0;

      for await (const chunk of response) {
        lastResponse = chunk;

        // Extract text from chunk, routing thought parts to reasoning accumulator
        const candidates = chunk.candidates;
        if (candidates && candidates.length > 0) {
          const parts = candidates[0]?.content?.parts || [];
          for (const part of parts) {
            partsSeen++;
            // Skip function calls
            if (part.functionCall) {
              continue;
            }
            // Capture thought parts as reasoning (do NOT add to content)
            if (part.thought === true && part.text) {
              thoughtPartsWithText++;
              streamReasoning += part.text;
              yield { content: '', done: false, reasoningContent: streamReasoning };
              continue;
            }
            if (part.thought === true) {
              // Thought part carrying only a signature (no summary text).
              thoughtPartsNoText++;
              continue;
            }
            if (part.text) {
              textParts++;
              totalStreamedContent += part.text;
              yield {
                content: part.text,
                done: false,
              };
            }
          }
        }
      }

      // Extract usage and thought signature from last chunk
      const usage = lastResponse?.usageMetadata;
      const thoughtSignature = this.extractThoughtSignature(lastResponse);


      // For thinking models, if we didn't get any content during streaming,
      // extract the full text from the final response
      let finalContent = '';
      if (isThinking && !totalStreamedContent && lastResponse) {
        finalContent = this.extractTextFromResponse(lastResponse, params.model);
      }

      const cachedTokens = usage?.cachedContentTokenCount
      const cacheUsage = cachedTokens !== undefined && cachedTokens > 0
        ? { cacheReadInputTokens: cachedTokens, cachedTokens }
        : undefined

      yield {
        content: finalContent,
        done: true,
        usage: {
          // Cache-read tokens excluded from prompt/total (see sendMessage).
          promptTokens: Math.max(0, (usage?.promptTokenCount ?? 0) - (cachedTokens ?? 0)),
          completionTokens: usage?.candidatesTokenCount ?? 0,
          totalTokens: Math.max(0, (usage?.totalTokenCount ?? 0) - (cachedTokens ?? 0)),
        },
        attachmentResults,
        // Convert SDK response class to plain object for Zod validation
        rawResponse: lastResponse ? JSON.parse(JSON.stringify(lastResponse)) : undefined,
        // usage lives in usageMetadata on the Google SDK response — preserve the
        // full provider-shape sub-object (incl. cachedContentTokenCount) for
        // cache-instrumentation diagnostics.
        rawProviderUsage: usage ? JSON.parse(JSON.stringify(usage)) as Record<string, unknown> : null,
        thoughtSignature,
        ...(cacheUsage ? { cacheUsage } : {}),
        ...(streamReasoning ? { reasoningContent: streamReasoning } : {}),
      };
    } catch (error) {
      logger.error('Error streaming from Google Gemini API', {
        context: 'GoogleProvider.streamMessage',
        model: params.model,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': getQuilltapUserAgent() } } });
      // Try to generate simple content to validate the API key
      await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: 'test',
      });
      return true;
    } catch (error) {
      logger.error('Google API key validation failed', { context: 'GoogleProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': getQuilltapUserAgent() } } });

      // Use the models.list() API to get available models dynamically
      const modelList: string[] = [];
      const pager = await ai.models.list();

      for await (const model of pager) {
        // Filter for models that support generateContent
        if (model.supportedActions?.includes('generateContent')) {
          // Extract model ID from the full name (e.g., "models/gemini-2.5-flash" -> "gemini-2.5-flash")
          const modelId = model.name?.replace('models/', '') || model.name;
          if (modelId) {
            modelList.push(modelId);
          }
        }
      }

      logger.info('Fetched available Google models', {
        context: 'GoogleProvider.getAvailableModels',
        count: modelList.length,
      });

      // If API returns empty list, fall back to known models
      if (modelList.length === 0) {
        logger.warn('No models returned from API, using fallback list', {
          context: 'GoogleProvider.getAvailableModels',
        });
        return [
          'gemini-3-flash-preview',
          'gemini-3-pro-preview',
          'gemini-3-pro-image-preview',
          'gemini-2.5-flash',
          'gemini-2.5-pro',
          'gemini-2.5-flash-image',
          'imagen-4',
          'imagen-4-fast',
        ];
      }

      return modelList;
    } catch (error) {
      logger.error('Failed to fetch Google models', { context: 'GoogleProvider.getAvailableModels' }, error instanceof Error ? error : undefined);
      // Return fallback list on error
      return [
        'gemini-3-flash-preview',
        'gemini-3-pro-preview',
        'gemini-3-pro-image-preview',
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.5-flash-image',
        'imagen-4',
        'imagen-4-fast',
      ];
    }
  }

  /**
   * Get metadata for a specific model, including warnings and recommendations.
   * Returns warnings for models with known issues or limitations.
   */
  getModelMetadata(modelId: string): ModelMetadata | undefined {
    const lowerModelId = modelId.toLowerCase();

    // Gemini 3 thinking models
    if (lowerModelId.includes('gemini-3-pro') && !lowerModelId.includes('image')) {
      return {
        id: modelId,
        displayName: 'Gemini 3 Pro',
        experimental: true,
        warnings: [
          {
            level: 'info',
            message: 'This is a thinking/reasoning model. Responses may take longer as the model reasons through complex problems.',
          },
        ],
      };
    }

    // Gemini 3 image models
    if (lowerModelId.includes('gemini-3') && lowerModelId.includes('image')) {
      return {
        id: modelId,
        displayName: 'Gemini 3 Pro Image',
        experimental: true,
        warnings: [
          {
            level: 'info',
            message: 'This model supports high-quality image generation with reasoning capabilities.',
          },
        ],
        missingCapabilities: ['function-calling'],
      };
    }

    // Image generation models that don't support function calling
    if (lowerModelId.includes('-image') && !lowerModelId.includes('vision')) {
      return {
        id: modelId,
        displayName: modelId.includes('2.5') ? 'Gemini 2.5 Flash Image' : 'Image Model',
        warnings: [
          {
            level: 'info',
            message: 'This model is optimized for image generation and does not support function calling (tools like memory search will be disabled).',
          },
        ],
        missingCapabilities: ['function-calling', 'tools'],
      };
    }

    // Imagen models
    if (lowerModelId.includes('imagen')) {
      return {
        id: modelId,
        displayName: modelId.includes('4-fast') ? 'Imagen 4 Fast' : 'Imagen 4',
        warnings: [
          {
            level: 'info',
            message: 'Imagen models are specialized for image generation only and do not support chat or function calling.',
          },
        ],
        missingCapabilities: ['chat', 'function-calling', 'tools'],
      };
    }

    // Gemini 2.0 deprecation warning
    if (lowerModelId.includes('gemini-2.0')) {
      return {
        id: modelId,
        displayName: 'Gemini 2.0',
        warnings: [
          {
            level: 'warning',
            message: 'Gemini 2.0 models are being deprecated on March 3, 2026. Consider switching to Gemini 2.5 or newer.',
          },
        ],
      };
    }

    // gemini-pro-latest resolves to Gemini 3 - it's a thinking model
    if (lowerModelId === 'gemini-pro-latest') {
      return {
        id: modelId,
        displayName: 'Gemini 3 Pro (Latest)',
        experimental: true,
        warnings: [
          {
            level: 'info',
            message: 'This is Gemini 3 Pro, a thinking/reasoning model. Responses may take longer as the model reasons through complex problems.',
          },
        ],
      };
    }

    // Gemini 1.5 models - older generation
    if (lowerModelId.includes('gemini-1.5')) {
      return {
        id: modelId,
        displayName: modelId.includes('pro') ? 'Gemini 1.5 Pro' : 'Gemini 1.5 Flash',
        warnings: [
          {
            level: 'info',
            message: 'Gemini 1.5 models are an older generation. For best results, consider using Gemini 2.5 or 3 models.',
          },
        ],
      };
    }

    return undefined;
  }

  /**
   * Get metadata for all models with special warnings or recommendations.
   */
  async getModelsWithMetadata(_apiKey: string): Promise<ModelMetadata[]> {
    // Return metadata for all models that have warnings
    const modelsWithWarnings = [
      'gemini-3-pro-preview',
      'gemini-3-pro-image-preview',
      'gemini-2.5-flash-image',
      'gemini-2.0-flash',
      'gemini-pro-latest',
      'imagen-4',
      'imagen-4-fast',
    ];

    return modelsWithWarnings
      .map(modelId => this.getModelMetadata(modelId))
      .filter((m): m is ModelMetadata => m !== undefined);
  }
}
