// LLM Provider Base Interface
// Phase 0.5: Single Chat MVP

export interface FileAttachment {
  id: string
  filepath: string
  filename: string
  mimeType: string
  size: number
  // Base64 encoded data (loaded at send time)
  data?: string
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  // File attachments for this message (typically only for user messages)
  attachments?: FileAttachment[]
}

export interface LLMParams {
  messages: LLMMessage[]
  model: string
  temperature?: number
  maxTokens?: number
  topP?: number
  stop?: string[]
}

export interface LLMResponse {
  content: string
  finishReason: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  raw: any // Provider-specific raw response
  // Report which attachments were successfully sent vs failed
  attachmentResults?: {
    sent: string[] // IDs of attachments sent successfully
    failed: { id: string; error: string }[] // IDs of attachments that failed
  }
}

export interface StreamChunk {
  content: string
  done: boolean
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  // On the final chunk, include attachment results
  attachmentResults?: {
    sent: string[]
    failed: { id: string; error: string }[]
  }
}

export abstract class LLMProvider {
  // Whether this provider supports file attachments
  abstract readonly supportsFileAttachments: boolean

  // Supported MIME types for file attachments (empty if no support)
  abstract readonly supportedMimeTypes: string[]

  abstract sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse>
  abstract streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk>
  abstract validateApiKey(apiKey: string): Promise<boolean>
  abstract getAvailableModels(apiKey: string): Promise<string[]>
}
