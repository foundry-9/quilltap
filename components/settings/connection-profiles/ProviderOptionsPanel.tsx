/**
 * Generic renderer for the provider-options schema exported by each LLM
 * plugin's `getProviderOptionsSchema()` hook.
 *
 * Reads values from a flat `parameters` record (the same JSON blob stored
 * on a ConnectionProfile and handed back to the plugin as
 * `LLMParams.profileParameters`) and writes back through `onSetParameter`.
 * Fields tagged with an `affects` directive also fire `onDirective` so the
 * host modal can react to UI-affecting toggles (e.g. OpenRouter's
 * `useCustomModel`, which swaps the model input).
 */

'use client'

import { useState } from 'react'
import type {
  ProviderOptionField,
  ProviderOptionsSchema,
  ProviderOptionDirective,
} from '@quilltap/plugin-types'
import { fieldAppliesToModel } from '@/lib/plugins/model-matchers'

interface ProviderOptionsPanelProps {
  schema: ProviderOptionsSchema | null | undefined
  parameters: Record<string, unknown>
  fetchedModels: string[]
  /** Model the profile is currently bound to (used to filter multi-enum lists). */
  modelName?: string
  onSetParameter: (key: string, value: unknown) => void
  onDirective?: (
    directive: ProviderOptionDirective,
    field: ProviderOptionField,
    value: unknown
  ) => void
}

function shouldRenderField(
  field: ProviderOptionField,
  parameters: Record<string, unknown>,
  modelName: string | undefined
): boolean {
  // Model gating first: a field this model has no use for is not offered at
  // all, whatever its sibling fields say. `appliesToModels` is advisory in the
  // sense that a field without it renders everywhere — but once a plugin has
  // named the models, an unnamed one is a deliberate no.
  if (!fieldAppliesToModel(field.appliesToModels, modelName)) return false
  if (!field.showIf) return true
  return parameters[field.showIf.field] === field.showIf.equals
}

function fieldValue(field: ProviderOptionField, parameters: Record<string, unknown>): unknown {
  const stored = parameters[field.key]
  if (stored !== undefined) return stored
  // A number field renders its default as a PLACEHOLDER rather than a value, so
  // an unset option reads as unset — otherwise "absent" and "explicitly the
  // default" look identical and *"leave blank for the default"* is a state the
  // user can never see themselves reach (Bug 72). Every other control needs the
  // fallback as a real value: `EnumField` relies on it to preselect.
  if (field.type === 'number') return undefined
  return field.default
}

/** A stored value (or a schema default) as the string an `<input>` displays. */
function toInputString(value: unknown): string {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return ''
}

export function ProviderOptionsPanel({
  schema,
  parameters,
  fetchedModels,
  modelName,
  onSetParameter,
  onDirective,
}: ProviderOptionsPanelProps) {
  if (!schema || schema.groups.length === 0) return null

  const handleChange = (field: ProviderOptionField, value: unknown) => {
    onSetParameter(field.key, value)
    if (field.affects && onDirective) {
      onDirective(field.affects, field, value)
    }
  }

  return (
    <div className="space-y-4">
      {schema.groups.map((group, groupIndex) => (
        <div
          key={groupIndex}
          className="qt-settings-shell"
        >
          {group.title && (
            <h4 className="qt-settings-section-heading mb-3">{group.title}</h4>
          )}
          <div className="space-y-3">
            {group.fields
              .filter((field) => shouldRenderField(field, parameters, modelName))
              .map((field) => (
                <FieldRenderer
                  key={field.key}
                  field={field}
                  value={fieldValue(field, parameters)}
                  parameters={parameters}
                  fetchedModels={fetchedModels}
                  modelName={modelName}
                  onChange={(value) => handleChange(field, value)}
                />
              ))}
          </div>
          {group.helpText && (
            <p className="qt-text-xs mt-3">{group.helpText}</p>
          )}
        </div>
      ))}
    </div>
  )
}

interface FieldRendererProps {
  field: ProviderOptionField
  value: unknown
  parameters: Record<string, unknown>
  fetchedModels: string[]
  modelName?: string
  onChange: (value: unknown) => void
}

function FieldRenderer({
  field,
  value,
  fetchedModels,
  modelName,
  onChange,
}: FieldRendererProps) {
  switch (field.type) {
    case 'boolean':
      return <BooleanField field={field} value={value} onChange={onChange} />
    case 'enum':
      return <EnumField field={field} value={value} onChange={onChange} />
    case 'multi-enum':
      return (
        <MultiEnumField
          field={field}
          value={value}
          fetchedModels={fetchedModels}
          modelName={modelName}
          onChange={onChange}
        />
      )
    case 'number':
      return <NumberField field={field} value={value} onChange={onChange} />
    case 'string':
      return <StringField field={field} value={value} onChange={onChange} />
    default:
      return null
  }
}

function BooleanField({
  field,
  value,
  onChange,
}: {
  field: ProviderOptionField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const checked = value === true
  const id = `pof-${field.key}`
  return (
    <div className="flex items-start gap-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="qt-checkbox mt-0.5"
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm">
          {field.label}
        </label>
        {field.helpText && <p className="qt-text-xs">{field.helpText}</p>}
      </div>
    </div>
  )
}

function EnumField({
  field,
  value,
  onChange,
}: {
  field: ProviderOptionField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const id = `pof-${field.key}`
  const stringValue = typeof value === 'string' ? value : ''
  return (
    <div>
      <label htmlFor={id} className="qt-text-label-xs">
        {field.label}
      </label>
      <select
        id={id}
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        className="qt-select text-sm"
      >
        {(field.enumValues ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {field.helpText && <p className="qt-text-xs mt-1">{field.helpText}</p>}
    </div>
  )
}

function MultiEnumField({
  field,
  value,
  fetchedModels,
  modelName,
  onChange,
}: {
  field: ProviderOptionField
  value: unknown
  fetchedModels: string[]
  modelName?: string
  onChange: (value: unknown) => void
}) {
  const selected: string[] = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  const max = field.max ?? Infinity

  let choices: { value: string; label: string }[]
  if (field.multiEnumSource === 'fetchedModels') {
    choices = fetchedModels
      .filter((m) => m !== modelName)
      .slice(0, 50)
      .map((m) => ({ value: m, label: m }))
  } else {
    choices = (field.enumValues ?? []).map((option) => ({
      value: option.value,
      label: option.label,
    }))
  }

  if (choices.length === 0) return null

  return (
    <div>
      <label className="block qt-text-label">{field.label}</label>
      <div className="space-y-1 max-h-32 overflow-y-auto border qt-border-default rounded p-2 bg-background mt-1">
        {choices.map((choice) => {
          const isSelected = selected.includes(choice.value)
          const isDisabled = !isSelected && selected.length >= max
          return (
            <label
              key={choice.value}
              className={`flex items-center gap-2 p-1 rounded ${
                isDisabled
                  ? 'cursor-not-allowed opacity-50'
                  : 'cursor-pointer hover:qt-bg-muted'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={isDisabled}
                onChange={(e) => {
                  if (e.target.checked && selected.length < max) {
                    onChange([...selected, choice.value])
                  } else if (!e.target.checked) {
                    onChange(selected.filter((v) => v !== choice.value))
                  }
                }}
                className="qt-checkbox"
              />
              <span className="qt-text-xs text-foreground truncate">
                {choice.label}
              </span>
            </label>
          )
        })}
      </div>
      {field.helpText && <p className="qt-text-xs mt-1">{field.helpText}</p>}
    </div>
  )
}

function NumberField({
  field,
  value,
  onChange,
}: {
  field: ProviderOptionField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const id = `pof-${field.key}`
  const incoming = toInputString(value)

  // The box owns its own string while it is being edited, rather than reading
  // straight off the value prop. A half-typed number is not a value the bag can
  // hold — `1.` and `-` both arrive as `''` — and an input that re-derives its
  // display from what the host stored will fight the person typing (Bug 72).
  //
  // `syncedFrom` is the prop value the draft was last reconciled against.
  // Writing through sets it to the value the host will hand back, so our own
  // echo is never mistaken for the parameter changing underneath us. Anything
  // else moving the prop (a different profile, a schema swap) re-seeds it.
  const [draft, setDraft] = useState(incoming)
  const [syncedFrom, setSyncedFrom] = useState(incoming)
  if (incoming !== syncedFrom) {
    setSyncedFrom(incoming)
    setDraft(incoming)
  }

  const emit = (next: unknown) => {
    setSyncedFrom(toInputString(next))
    onChange(next)
  }

  return (
    <div>
      <label htmlFor={id} className="qt-text-label-xs">
        {field.label}
      </label>
      <input
        id={id}
        type="number"
        value={draft}
        // An empty box means "unset", so the default shows through as the
        // placeholder — the only way the user can see they have reached the
        // state the help text calls "leave blank for the default".
        placeholder={field.default === undefined ? undefined : toInputString(field.default)}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          if (raw === '') {
            emit(undefined)
          } else {
            const parsed = Number(raw)
            emit(Number.isNaN(parsed) ? raw : parsed)
          }
        }}
        className="qt-input text-sm"
      />
      {field.helpText && <p className="qt-text-xs mt-1">{field.helpText}</p>}
    </div>
  )
}

function StringField({
  field,
  value,
  onChange,
}: {
  field: ProviderOptionField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const id = `pof-${field.key}`
  const stringValue = typeof value === 'string' ? value : ''
  return (
    <div>
      <label htmlFor={id} className="qt-text-label-xs">
        {field.label}
      </label>
      <input
        id={id}
        type="text"
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        className="qt-input text-sm"
      />
      {field.helpText && <p className="qt-text-xs mt-1">{field.helpText}</p>}
    </div>
  )
}

export default ProviderOptionsPanel
