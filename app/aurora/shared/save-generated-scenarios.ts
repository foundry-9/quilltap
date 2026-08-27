/**
 * Persist AI-generated scenarios (from the AI Wizard) to a character, one
 * POST per scenario, surviving individual failures. Returns the rows the
 * server minted so the edit view can splice them into form state; the
 * new-character view ignores the return. Shared by both views.
 */

import type { CharacterScenario } from '@/lib/schemas/character.types'

export async function saveGeneratedScenarios(
  characterId: string,
  scenarios: Array<{ title: string; content: string }>
): Promise<{ saved: number; scenarios: CharacterScenario[] }> {
  let saved = 0
  const savedScenarios: CharacterScenario[] = []

  for (const scenario of scenarios) {
    try {
      const res = await fetch(`/api/v1/characters/${characterId}/scenarios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: scenario.title, content: scenario.content }),
      })
      if (res.ok) {
        const resData = await res.json()
        saved++
        // Collect saved scenario with its server-assigned ID
        if (resData.scenario) {
          savedScenarios.push({
            id: resData.scenario.id,
            title: resData.scenario.title,
            content: resData.scenario.content,
            createdAt: resData.scenario.createdAt,
            updatedAt: resData.scenario.updatedAt,
          })
        }
      }
    } catch (err) {
      console.error('Failed to create scenario', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { saved, scenarios: savedScenarios }
}
