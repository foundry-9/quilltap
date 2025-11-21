// Grok Provider Implementation
// Based on OpenAI-Compatible Provider
// Grok API is OpenAI-compatible and uses base URL: https://api.x.ai/v1
// Grok supports file uploads (images, PDFs, documents) as of November 2025

import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { LLMProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage } from './base'

// Grok supports images and documents (as of Nov 2025)
const GROK_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
]

type GrokMessageContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }>

interface GrokMessage {
  role: 'system' | 'user' | 'assistant'
  content: GrokMessageContent
}

export class GrokProvider extends LLMProvider {
  private readonly baseUrl = 'https://api.x.ai/v1'
  readonly supportsFileAttachments = true
  readonly supportedMimeTypes = GROK_SUPPORTED_MIME_TYPES

  private formatMessagesWithAttachments(
    messages: LLMMessage[]
  ): { messages: GrokMessage[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } } {
    const sent: string[] = []
    const failed: { id: string; error: string }[] = []

    const formattedMessages: GrokMessage[] = messages.map((msg) => {
      // If no attachments, return simple string content
      if (!msg.attachments || msg.attachments.length === 0) {
        return {
          role: msg.role,
          content: msg.content,
        }
      }

      // Build multimodal content array
      const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }> = []

      // Add text content first
      if (msg.content) {
        content.push({ type: 'text', text: msg.content })
      }

      // Add file attachments (Grok uses OpenAI-compatible format for images)
      for (const attachment of msg.attachments) {
        if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
          failed.push({
            id: attachment.id,
            error: `Unsupported file type: ${attachment.mimeType}. Grok supports: ${this.supportedMimeTypes.join(', ')}`,
          })
          continue
        }

        if (!attachment.data) {
          failed.push({
            id: attachment.id,
            error: 'File data not loaded',
          })
          continue
        }

        // For images, use image_url format
        if (attachment.mimeType.startsWith('image/')) {
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${attachment.mimeType};base64,${attachment.data}`,
              detail: 'auto',
            },
          })
          sent.push(attachment.id)
        } else {
          // For documents (PDF, text, etc.), embed as text content
          // Note: Grok's Files API may require different handling for documents
          // For now, we'll include text-based files as text content
          if (attachment.mimeType.startsWith('text/')) {
            try {
              const textContent = Buffer.from(attachment.data, 'base64').toString('utf-8')
              content.push({
                type: 'text',
                text: `[File: ${attachment.filename}]\n${textContent}`,
              })
              sent.push(attachment.id)
            } catch {
              failed.push({
                id: attachment.id,
                error: 'Failed to decode text file',
              })
            }
          } else {
            // PDFs and other binary documents - mark as failed for now
            // Full support would require using Grok's Files API
            failed.push({
              id: attachment.id,
              error: 'PDF and binary document support requires Grok Files API (not yet implemented)',
            })
          }
        }
      }

      return {
        role: msg.role,
        content: content.length > 0 ? content : msg.content,
      }
    })

    return { messages: formattedMessages, attachmentResults: { sent, failed } }
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key')
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    })

    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages)

    const response = await client.chat.completions.create({
      model: params.model,
      messages: messages as ChatCompletionMessageParam[],
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1000,
      top_p: params.topP ?? 1,
      stop: params.stop,
    })

    const choice = response.choices[0]

    return {
      content: choice.message.content ?? '',
      finishReason: choice.finish_reason,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      raw: response,
      attachmentResults,
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    if (!apiKey) {
      throw new Error('Grok provider requires an API key')
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.baseUrl,
    })

    const { messages, attachmentResults } = this.formatMessagesWithAttachments(params.messages)

    const stream = await client.chat.completions.create({
      model: params.model,
      messages: messages as ChatCompletionMessageParam[],
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 1000,
      top_p: params.topP ?? 1,
      stream: true,
      stream_options: { include_usage: true },
    })

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      const finishReason = chunk.choices[0]?.finish_reason
      const hasUsage = chunk.usage

      // Yield content unless this is the final chunk with usage info
      if (content && !(finishReason && hasUsage)) {
        yield {
          content,
          done: false,
        }
      }

      // Final chunk with usage info
      if (finishReason && hasUsage) {
        yield {
          content: '',
          done: true,
          usage: {
            promptTokens: chunk.usage?.prompt_tokens ?? 0,
            completionTokens: chunk.usage?.completion_tokens ?? 0,
            totalTokens: chunk.usage?.total_tokens ?? 0,
          },
          attachmentResults,
        }
      }
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    if (!apiKey) {
      return false
    }

    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      })
      await client.models.list()
      return true
    } catch (error) {
      console.error('Grok API validation failed:', error)
      return false
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    if (!apiKey) {
      console.error('Grok provider requires an API key to fetch models')
      return []
    }

    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      })
      const models = await client.models.list()
      return models.data.map(m => m.id).sort()
    } catch (error) {
      console.error('Failed to fetch Grok models:', error)
      return []
    }
  }
}
