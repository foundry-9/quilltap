// LLM Provider Base Interface
// Phase 0.5: Single Chat MVP

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
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
}

export interface StreamChunk {
  content: string
  done: boolean
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export abstract class LLMProvider {
  abstract sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse>
  abstract streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk>
  abstract validateApiKey(apiKey: string): Promise<boolean>
  abstract getAvailableModels(apiKey: string): Promise<string[]>
}
