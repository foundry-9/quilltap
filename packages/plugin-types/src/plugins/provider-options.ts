/**
 * Provider options schema — lets a TextProviderPlugin describe the
 * provider-specific configuration fields the connection-profile editor
 * should render for it.
 *
 * The renderer reads from and writes to a flat `parameters` map that
 * mirrors the JSON blob stored on each ConnectionProfile and handed
 * back to the plugin as `LLMParams.profileParameters` at call time.
 *
 * @module @quilltap/plugin-types/plugins/provider-options
 */

/**
 * Supported field types in a provider options schema.
 */
export type ProviderOptionFieldType =
  | 'boolean'
  | 'enum'
  | 'multi-enum'
  | 'string'
  | 'number';

/**
 * One option in an `enum` or `multi-enum` field.
 */
export interface ProviderOptionEnumValue {
  /** Stored value (also written back into the parameters map) */
  value: string;
  /** Human-readable label displayed in the UI */
  label: string;
  /** Optional secondary description shown under the label */
  description?: string;
}

/**
 * A directive tells the host UI that this field affects something
 * outside the options panel itself. The host can listen for changes
 * to directive fields and adjust other parts of its UI accordingly.
 *
 * Current directives:
 * - `modelInput` — toggles the model input between selector / free-text.
 */
export type ProviderOptionDirective = 'modelInput';

/**
 * Conditional render guard. The field renders only when the named
 * sibling field in the parameters map equals the given value.
 */
export interface ProviderOptionShowIf {
  field: string;
  equals: unknown;
}

/**
 * A single configurable field.
 */
export interface ProviderOptionField {
  /**
   * Storage key inside the connection profile's `parameters` blob.
   * The plugin will read this same key off `LLMParams.profileParameters`
   * at call time, so the key must match the plugin's wire-side expectation.
   */
  key: string;

  /** Label rendered above the input */
  label: string;

  /** Optional help text rendered under the input */
  helpText?: string;

  /** Field type — determines which control the renderer uses */
  type: ProviderOptionFieldType;

  /** Default value used when seeding a new profile */
  default?: unknown;

  /**
   * Choices for `enum` and `multi-enum` fields. Required for `enum`;
   * may be omitted for `multi-enum` if `multiEnumSource` is set.
   */
  enumValues?: ProviderOptionEnumValue[];

  /**
   * Runtime source for `multi-enum` options instead of a fixed list.
   * - `fetchedModels` — choices are the model IDs the host has loaded
   *   for the active provider/profile.
   */
  multiEnumSource?: 'fetchedModels';

  /**
   * Maximum number of selected entries for `multi-enum` fields.
   * Renderer disables further checkboxes once this many are selected.
   */
  max?: number;

  /**
   * Show this field only when another field in the same parameters
   * map equals the given value.
   */
  showIf?: ProviderOptionShowIf;

  /**
   * Mark this field as affecting an external piece of the host UI.
   * The renderer still draws the field; the host listens for changes
   * via its directive callback and updates whatever's affected.
   */
  affects?: ProviderOptionDirective;

  /**
   * Restrict this field to a subset of models: a list of matchers, each an
   * exact model id, a `*` glob (`flux-2-*`), or a family prefix (the longest
   * matching prefix wins, so `flux-lora` also covers `flux-lora/inpainting`).
   * The field renders when *any* matcher hits, and unconditionally when the
   * list is omitted or the host does not know the selected model.
   *
   * Renderers that don't understand this field render unconditionally, so
   * declaring it never breaks an older host.
   */
  appliesToModels?: string[];
}

/**
 * A visually grouped set of fields. Most plugins will declare a single
 * group; multi-group schemas are supported for plugins that want to
 * separate (for example) latency-affecting toggles from routing knobs.
 */
export interface ProviderOptionGroup {
  /** Optional section heading rendered above the group */
  title?: string;
  /** Optional help text rendered under the heading */
  helpText?: string;
  /** Fields in render order */
  fields: ProviderOptionField[];
}

/**
 * The full schema a plugin returns from `getProviderOptionsSchema`.
 */
export interface ProviderOptionsSchema {
  groups: ProviderOptionGroup[];
}

/**
 * Options passed to `getProviderOptionsSchema` and
 * `getImageProviderOptionsSchema`.
 *
 * The text hook's renderer still does not pass `modelName`, so text plugins
 * should treat it as advisory and return the same schema regardless. The
 * *image* hook does pass it, and refetches whenever the selected model
 * changes — image gateways routing to hundreds of models legitimately answer
 * differently per model.
 */
export interface ProviderOptionsSchemaContext {
  modelName?: string;
}
