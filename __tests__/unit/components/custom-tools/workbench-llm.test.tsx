/**
 * Pascal's Workbench — the LLM-consult surfaces.
 *
 * Render-level coverage for the oracle's three homes: the BuilderForm section
 * (enable toggle, prompt, error line), the OutcomesSection condition chips
 * (consult answer / consult succeeded appear only while the consult is on),
 * and the ProvingBench oracle card (scripted / silence / live, with the
 * scripted answer riding the preview body).
 */

import { describe, it, expect, jest as jestGlobal } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import BuilderForm from '@/components/custom-tools/BuilderForm'
import OutcomesSection from '@/components/custom-tools/OutcomesSection'
import ProvingBench from '@/components/custom-tools/ProvingBench'
import { draftFromDefinition, validateDraft, type ToolDraft } from '@/lib/pascal/tool-draft'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

const ORACLE_TOOL = {
  name: 'augury',
  description: 'Consult the oracle.',
  llm: { prompt: 'YES or NO about {{value}}?', errorMessage: 'The wire went dead.' },
  outcomes: [
    { when: { llm: { ok: false } }, message: 'Silence: {{llm}}', state: 'failure' },
    { when: { llm: { eq: 'YES' } }, message: 'Assent.', state: 'success' },
    { when: true, message: 'Demurral.', state: 'info' },
  ],
}

const PLAIN_TOOL = {
  name: 'plain',
  description: 'No oracle here.',
  outcomes: [{ when: true, message: 'Done.', state: 'info' }],
}

function oracleDraft(): ToolDraft {
  const draft = draftFromDefinition(ORACLE_TOOL)
  if (!draft) throw new Error('fixture failed to load')
  return draft
}

function plainDraft(): ToolDraft {
  const draft = draftFromDefinition(PLAIN_TOOL)
  if (!draft) throw new Error('fixture failed to load')
  return draft
}

describe('BuilderForm — the consulted oracle section', () => {
  it('shows the prompt and error fields while the consult is enabled', () => {
    render(<BuilderForm draft={oracleDraft()} issues={[]} onChange={() => {}} />)
    expect(screen.getByLabelText('Consult an LLM')).toBeChecked()
    expect(screen.getByLabelText('The question')).toHaveValue('YES or NO about {{value}}?')
    expect(screen.getByLabelText('When the oracle is silent')).toHaveValue('The wire went dead.')
  })

  it('hides the fields and explains itself while disabled', () => {
    render(<BuilderForm draft={plainDraft()} issues={[]} onChange={() => {}} />)
    expect(screen.getByLabelText('Consult an LLM')).not.toBeChecked()
    expect(screen.queryByLabelText('The question')).toBeNull()
  })

  it('toggling the switch flips llmEnabled', () => {
    const onChange = jestGlobal.fn()
    render(<BuilderForm draft={plainDraft()} issues={[]} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Consult an LLM'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ llmEnabled: true }))
  })

  it('surfaces validateDraft issues inline', () => {
    const draft = oracleDraft()
    draft.llmPrompt = ''
    render(<BuilderForm draft={draft} issues={validateDraft(draft)} onChange={() => {}} />)
    expect(screen.getByText('the consult needs a prompt')).toBeInTheDocument()
  })
})

describe('OutcomesSection — consult condition chips', () => {
  it('renders the llm chips of a loaded definition', () => {
    render(<OutcomesSection draft={oracleDraft()} issues={[]} onChange={() => {}} />)
    // Row 1 tests ok; row 2 tests the answer.
    const subjects = screen.getAllByLabelText('Condition subject') as HTMLSelectElement[]
    expect(subjects.map((s) => s.value)).toEqual(expect.arrayContaining(['llm-ok', 'llm']))
  })

  it('offers the consult subjects only while the consult is enabled', () => {
    const { unmount } = render(<OutcomesSection draft={oracleDraft()} issues={[]} onChange={() => {}} />)
    let subject = screen.getAllByLabelText('Condition subject')[0]
    expect(Array.from((subject as HTMLSelectElement).options).map((o) => o.value)).toEqual(
      expect.arrayContaining(['llm', 'llm-ok'])
    )
    unmount()

    const withoutOracle = oracleDraft()
    withoutOracle.llmEnabled = false
    // Keep only the catch-all so no llm chips linger in the render.
    withoutOracle.outcomes = [withoutOracle.outcomes[withoutOracle.outcomes.length - 1]]
    render(<OutcomesSection draft={withoutOracle} issues={[]} onChange={() => {}} />)
    expect(screen.queryByLabelText('Condition subject')).toBeNull()
  })
})

describe('ProvingBench — the oracle card', () => {
  it('offers scripted / silence / live modes when the tool consults', () => {
    renderWithQuery(<ProvingBench draft={oracleDraft()} valid />)
    expect(screen.getByRole('radio', { name: 'Scripted answer' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Silence' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Ask it live' })).toBeInTheDocument()
  })

  it('shows no oracle card for a tool without a consult', () => {
    renderWithQuery(<ProvingBench draft={plainDraft()} valid />)
    expect(screen.queryByRole('radio', { name: 'Scripted answer' })).toBeNull()
  })

  it('sends the scripted answer with a preview roll', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        tool: 'augury',
        params: {},
        rollForm: 'range',
        raw: 0.5,
        value: 0.5,
        state: 'success',
        outcomeIndex: 1,
        message: 'Assent.',
        diceBreakdown: '',
        visibility: 'public',
        llm: { ok: true, output: 'YES', prompt: 'YES or NO about 0.5?' },
      }),
    } as unknown as Response)

    try {
      renderWithQuery(<ProvingBench draft={oracleDraft()} valid />)
      fireEvent.change(screen.getByLabelText('Scripted oracle answer'), { target: { value: 'YES' } })
      fireEvent.click(screen.getByRole('button', { name: /Roll/ }))

      await screen.findByText(/consult answered/)
      const [url, init] = fetchSpy.mock.calls[0]
      expect(String(url)).toContain('action=preview')
      expect(JSON.parse(String(init?.body))).toMatchObject({ llm: { output: 'YES' } })
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
