/**
 * Persist an AI-generated physical description (from the AI Wizard) to a
 * character. The cutover collapsed the multi-record array to a single record
 * on the character row; PUT the character directly and the repository's write
 * overlay routes it into the vault. Shared by the new-character and
 * edit-character views.
 */

import { showSuccessToast, showErrorToast } from '@/lib/toast'
import type { GeneratedPhysicalDescription } from '@/components/characters/ai-wizard'

export async function saveGeneratedPhysicalDescription(
  characterId: string,
  pd: GeneratedPhysicalDescription,
  opts: {
    /**
     * Error-toast text when the save fails and the server sent no `error`;
     * the two views word it differently.
     */
    failureMessage: string
  }
): Promise<void> {
  try {
    const res = await fetch(`/api/v1/characters/${characterId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        physicalDescription: {
          name: pd.name,
          headAndShouldersPrompt: pd.headAndShouldersPrompt,
          shortPrompt: pd.shortPrompt,
          mediumPrompt: pd.mediumPrompt,
          longPrompt: pd.longPrompt,
          completePrompt: pd.completePrompt,
          fullDescription: pd.fullDescription,
        },
      }),
    })

    if (res.ok) {
      showSuccessToast('Physical description saved')
    } else {
      const errorData = await res.json().catch(() => ({}))
      console.error('Failed to save physical description', errorData.error || 'Unknown error')
      showErrorToast(errorData.error || opts.failureMessage)
    }
  } catch (err) {
    console.error('Failed to save physical description', {
      error: err instanceof Error ? err.message : String(err),
    })
    showErrorToast(opts.failureMessage)
  }
}
