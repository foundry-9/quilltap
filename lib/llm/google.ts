// Google Generative AI Provider Implementation
// Phase 2: Image Generation
// Supports both chat and image generation via Google Generative AI API

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai'
import { LLMProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, type ImageGenParams, type ImageGenResponse } from './base'

// Google Gemini supports image analysis (not image input limitations here)
const GOOGLE_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]

export class GoogleProvider extends LLMProvider {
  readonly supportsFileAttachments = true
  readonly supportedMimeTypes = GOOGLE_SUPPORTED_MIME_TYPES
  readonly supportsImageGeneration = true

  private async formatMessagesWithAttachments(
    messages: LLMMessage[]
  ): Promise<{ messages: any[]; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } }> {
    const sent: string[] = []
    const failed: { id: string; error: string }[] = []

    const formattedMessages: any[] = []

    for (const msg of messages) {
      const formattedMessage: any = {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [],
      }

      // Add text content
      if (msg.content) {
        formattedMessage.parts.push({ text: msg.content })
      }

      // Add image attachments
      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
            failed.push({
              id: attachment.id,
              error: `Unsupported file type: ${attachment.mimeType}. Google supports: ${this.supportedMimeTypes.join(', ')}`,
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

          formattedMessage.parts.push({
            inlineData: {
              mimeType: attachment.mimeType,
              data: attachment.data,
            },
          })
          sent.push(attachment.id)
        }
      }

      formattedMessages.push(formattedMessage)
    }

    return { messages: formattedMessages, attachmentResults: { sent, failed } }
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const client = new GoogleGenerativeAI(apiKey)
    const model = client.getGenerativeModel({
      model: params.model,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    })

    const { messages, attachmentResults } = await this.formatMessagesWithAttachments(params.messages)

    const response = (await model.generateContent({
      contents: messages,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 1000,
        topP: params.topP ?? 1,
        stopSequences: params.stop,
      },
    })) as any

    const text = response.text?.() ?? ''
    const finishReason = response.candidates?.[0]?.finishReason ?? 'STOP'
    const usage = response.usageMetadata

    return {
      content: text,
      finishReason,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
      raw: response,
      attachmentResults,
    }
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    const client = new GoogleGenerativeAI(apiKey)
    const model = client.getGenerativeModel({
      model: params.model,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    })

    const { messages, attachmentResults } = await this.formatMessagesWithAttachments(params.messages)

    const stream = await model.generateContentStream({
      contents: messages,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 1000,
        topP: params.topP ?? 1,
        stopSequences: params.stop,
      },
    })

    for await (const chunk of stream.stream) {
      const text = (chunk as any).text?.() ?? ''
      if (text) {
        yield {
          content: text,
          done: false,
        }
      }
    }

    // Final chunk with usage info
    const response = (await stream.response) as any
    const usage = response.usageMetadata
    yield {
      content: '',
      done: true,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
      attachmentResults,
    }
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new GoogleGenerativeAI(apiKey)
      // Try to get a simple model to validate the API key
      const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' })
      await model.generateContent('test')
      return true
    } catch (error) {
      console.error('Google API key validation failed:', error)
      return false
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      // Return known Google models that support image generation
      // Full model list requires a different endpoint
      return [
        'gemini-2.5-flash-image',
        'gemini-3-pro-image-preview',
        'imagen-4',
        'imagen-4-fast',
        'gemini-2.5-flash',
        'gemini-pro-vision',
      ]
    } catch (error) {
      console.error('Failed to fetch Google models:', error)
      return []
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    const client = new GoogleGenerativeAI(apiKey)

    // Use the specified model or default to gemini-2.5-flash-image
    const modelName = params.model ?? 'gemini-2.5-flash-image'
    const model = client.getGenerativeModel({
      model: modelName,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    })

    const config: any = {
      temperature: 0.7,
    }

    if (params.aspectRatio) {
      config.aspectRatio = params.aspectRatio
    }

    const response = (await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: params.prompt }],
        },
      ],
      generationConfig: config,
    })) as any

    const images: Array<{ data: string; mimeType: string; revisedPrompt?: string }> = []

    // Extract images from response - check candidates array
    const candidates = response.candidates ?? []
    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? []
      for (const part of parts) {
        if ('inlineData' in part && part.inlineData) {
          images.push({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png',
          })
        }
      }
    }

    if (images.length === 0) {
      throw new Error('No images generated in response')
    }

    return {
      images,
      raw: response,
    }
  }
}
