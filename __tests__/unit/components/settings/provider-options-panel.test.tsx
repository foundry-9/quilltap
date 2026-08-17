/**
 * Unit tests for ProviderOptionsPanel — the generic renderer that consumes
 * a provider plugin's getProviderOptionsSchema output.
 */

import { describe, it, expect, jest } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { ProviderOptionsSchema } from '@quilltap/plugin-types'
import { ProviderOptionsPanel } from '@/components/settings/connection-profiles/ProviderOptionsPanel'

const SCHEMA: ProviderOptionsSchema = {
  groups: [
    {
      title: 'Test Options',
      helpText: 'Test help.',
      fields: [
        {
          key: 'aBool',
          label: 'A Boolean',
          type: 'boolean',
          default: false,
        },
        {
          key: 'anEnum',
          label: 'An Enum',
          type: 'enum',
          default: '',
          enumValues: [
            { value: '', label: '(default)' },
            { value: 'low', label: 'Low' },
            { value: 'high', label: 'High' },
          ],
        },
        {
          key: 'nestedEnum',
          label: 'Nested Enum',
          type: 'enum',
          default: 'x',
          enumValues: [
            { value: 'x', label: 'X' },
            { value: 'y', label: 'Y' },
          ],
          showIf: { field: 'aBool', equals: true },
        },
        {
          key: 'fallbacks',
          label: 'Fallbacks',
          type: 'multi-enum',
          multiEnumSource: 'fetchedModels',
          max: 2,
          default: [],
        },
        {
          key: 'directiveBool',
          label: 'Directive',
          type: 'boolean',
          default: false,
          affects: 'modelInput',
        },
        {
          key: 'request_timeout_seconds',
          label: 'Request Timeout (seconds)',
          type: 'number',
          default: 300,
          helpText: 'Leave blank for the default.',
        },
      ],
    },
  ],
}

/**
 * The panel's real host: `ProfileModal`'s `setParameter`, which deletes the
 * key on `undefined`. Bug 72 only exists in the round trip between the two.
 */
function ParameterHost({
  initial = {},
  onBag,
}: {
  initial?: Record<string, unknown>
  onBag?: (bag: Record<string, unknown>) => void
}) {
  const [parameters, setParameters] = React.useState<Record<string, unknown>>(initial)
  React.useEffect(() => {
    onBag?.(parameters)
  }, [parameters, onBag])
  return (
    <ProviderOptionsPanel
      schema={SCHEMA}
      parameters={parameters}
      fetchedModels={[]}
      onSetParameter={(key, value) => {
        setParameters((prev) => {
          const next = { ...prev }
          if (value === undefined) {
            delete next[key]
          } else {
            next[key] = value
          }
          return next
        })
      }}
    />
  )
}

describe('ProviderOptionsPanel', () => {
  it('renders nothing when no schema is provided', () => {
    const { container } = render(
      <ProviderOptionsPanel
        schema={null}
        parameters={{}}
        fetchedModels={[]}
        onSetParameter={jest.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders boolean and enum fields', () => {
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{}}
        fetchedModels={[]}
        onSetParameter={jest.fn()}
      />
    )
    expect(screen.getByLabelText('A Boolean')).toBeInTheDocument()
    expect(screen.getByLabelText('An Enum')).toBeInTheDocument()
  })

  it('hides showIf-guarded fields when the gate is false', () => {
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{ aBool: false }}
        fetchedModels={[]}
        onSetParameter={jest.fn()}
      />
    )
    expect(screen.queryByLabelText('Nested Enum')).not.toBeInTheDocument()
  })

  it('shows showIf-guarded fields when the gate is true', () => {
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{ aBool: true }}
        fetchedModels={[]}
        onSetParameter={jest.fn()}
      />
    )
    expect(screen.getByLabelText('Nested Enum')).toBeInTheDocument()
  })

  it('invokes onSetParameter when a boolean toggles', () => {
    const onSet = jest.fn()
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{}}
        fetchedModels={[]}
        onSetParameter={onSet}
      />
    )
    fireEvent.click(screen.getByLabelText('A Boolean'))
    expect(onSet).toHaveBeenCalledWith('aBool', true)
  })

  it('emits a directive callback for fields tagged with affects', () => {
    const onSet = jest.fn()
    const onDirective = jest.fn()
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{}}
        fetchedModels={[]}
        onSetParameter={onSet}
        onDirective={onDirective}
      />
    )
    fireEvent.click(screen.getByLabelText('Directive'))
    expect(onSet).toHaveBeenCalledWith('directiveBool', true)
    expect(onDirective).toHaveBeenCalledWith(
      'modelInput',
      expect.objectContaining({ key: 'directiveBool' }),
      true
    )
  })

  it('renders multi-enum entries from fetched models, capped at max', () => {
    const onSet = jest.fn()
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{ fallbacks: ['model-a', 'model-b'] }}
        fetchedModels={['model-a', 'model-b', 'model-c']}
        modelName="model-current"
        onSetParameter={onSet}
      />
    )
    const checkboxC = screen.getByRole('checkbox', { name: /model-c/i })
    expect(checkboxC).toBeDisabled()
    const checkboxA = screen.getByRole('checkbox', { name: /model-a/i })
    fireEvent.click(checkboxA)
    expect(onSet).toHaveBeenCalledWith('fallbacks', ['model-b'])
  })

  // Bug 72 — clearing a numeric option used to repaint the schema default with
  // the caret after it, so the next keystroke appended to it (300 → 3005).
  describe('number fields (Bug 72)', () => {
    it('stays empty when cleared, and the key leaves the bag', async () => {
      const user = userEvent.setup()
      let bag: Record<string, unknown> = {}
      render(<ParameterHost initial={{ request_timeout_seconds: 300 }} onBag={(b) => (bag = b)} />)

      const input = screen.getByLabelText('Request Timeout (seconds)') as HTMLInputElement
      expect(input.value).toBe('300')

      await user.clear(input)
      expect(input.value).toBe('')
      expect(bag).not.toHaveProperty('request_timeout_seconds')
    })

    it('does not prepend the default to the value typed after a clear', async () => {
      const user = userEvent.setup()
      let bag: Record<string, unknown> = {}
      render(<ParameterHost initial={{ request_timeout_seconds: 300 }} onBag={(b) => (bag = b)} />)

      const input = screen.getByLabelText('Request Timeout (seconds)') as HTMLInputElement
      expect(input.value).toBe('300')

      await user.clear(input)
      await user.type(input, '5')

      expect(input.value).toBe('5')
      expect(bag.request_timeout_seconds).toBe(5)
    })

    it('renders an unset number as blank with the default as placeholder', () => {
      // Absent and explicitly-default must not look identical, or the field's
      // own "leave blank for the default" is unreachable and unverifiable.
      render(<ParameterHost />)
      const input = screen.getByLabelText('Request Timeout (seconds)') as HTMLInputElement
      expect(input.value).toBe('')
      expect(input).toHaveAttribute('placeholder', '300')
    })

    it('keeps a blank field absent across a reopen rather than writing the default', async () => {
      const user = userEvent.setup()
      let bag: Record<string, unknown> = {}
      const { unmount } = render(
        <ParameterHost initial={{ request_timeout_seconds: 300 }} onBag={(b) => (bag = b)} />
      )
      await user.clear(screen.getByLabelText('Request Timeout (seconds)'))
      expect(bag).not.toHaveProperty('request_timeout_seconds')
      unmount()

      // Reopening must not resurrect the default as a stored-looking value —
      // otherwise a later change to the plugin's default never reaches the
      // profiles that deliberately never set one.
      render(<ParameterHost initial={bag} />)
      expect((screen.getByLabelText('Request Timeout (seconds)') as HTMLInputElement).value).toBe(
        ''
      )
    })

    it('re-seeds the box when the parameter moves for some other reason', () => {
      const { rerender } = render(
        <ProviderOptionsPanel
          schema={SCHEMA}
          parameters={{ request_timeout_seconds: 300 }}
          fetchedModels={[]}
          onSetParameter={jest.fn()}
        />
      )
      rerender(
        <ProviderOptionsPanel
          schema={SCHEMA}
          parameters={{ request_timeout_seconds: 900 }}
          fetchedModels={[]}
          onSetParameter={jest.fn()}
        />
      )
      expect((screen.getByLabelText('Request Timeout (seconds)') as HTMLInputElement).value).toBe(
        '900'
      )
    })
  })

  it('skips multi-enum choice equal to the active modelName', () => {
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{}}
        fetchedModels={['model-a', 'model-b']}
        modelName="model-a"
        onSetParameter={jest.fn()}
      />
    )
    expect(screen.queryByRole('checkbox', { name: /model-a/i })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /model-b/i })).toBeInTheDocument()
  })
})
