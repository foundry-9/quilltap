// Initial Greeting Helper
// Generates a first message for a chat when no scripted greeting exists

import { createLLMProvider } from '@/lib/llm'

export type GreetingRequest = {
  systemPrompt: string
  characterName: string
  provider: string
  modelName: string
  apiKey?: string
  baseUrl?: string | null
  temperature?: number
  maxTokens?: number
  topP?: number
}

/**
 * Ask the configured LLM to produce a short greeting that fits the character.
 */
export async function generateGreetingMessage({
  systemPrompt,
  characterName,
  provider,
  modelName,
  apiKey,
  baseUrl,
  temperature,
  maxTokens,
  topP,
}: GreetingRequest): Promise<string> {
  const providerClient = await createLLMProvider(provider, baseUrl || undefined)

  const augmentedSystemPrompt = `${systemPrompt}\n\nYou are starting a brand new conversation. Before the user says anything, open with a concise greeting that fits ${characterName}'s established voice. Keep it to one or two sentences.`

  const response = await providerClient.sendMessage(
    {
      messages: [
        { role: 'system', content: augmentedSystemPrompt },
        {
          role: 'user',
          content: 'The chat is beginning now. Greet the user immediately in-character and invite them to engage.',
        },
      ],
      model: modelName,
      temperature,
      maxTokens: maxTokens ?? 160,
      topP,
    },
    apiKey ?? ''
  )

  return (response.content || '').trim()
}
