# Custom-Tool Run Presets

Status: **implemented** (alongside the `{{state.path}}` describe fix in the consult-prompt schema).

## Problem

The Salon's custom-tool run dialog (`components/chat/CustomToolRunDialog.tsx`) seeds each tool's parameter fields from the definition's defaults once, and remembers the operator's last-typed values only while the composer stays mounted. There is no way to keep a named set of parameter values around — a "loadout" for a tool the operator runs the same few ways over and over.

## Design

### Where presets live

A preset is an ordinary JSON document in the **running character's vault**, next to the tool definitions:

```
Tools/{toolname}.{preset}.settings.json
```

- `{toolname}` is the tool's identity (`definition.name`), which matches `IDENTIFIER_PATTERN` (`/^[a-z][a-z0-9_-]{0,63}$/`, `lib/pascal/custom-tool.types.ts`) and therefore never contains a dot.
- `{preset}` is the operator's chosen name, constrained to `/^[a-z0-9][a-z0-9_-]{0,63}$/` — no spaces, dots, or path delimiters — so the filename parses unambiguously and is safe on every filesystem shape a vault can take.
- The file body is a **flat JSON object** of parameter name → value, exactly what `coerceParamValues` produced at save time. Hand-editable on purpose.

Roster discovery only reads `Tools/*.tool.json` (`isRootToolFile`, `lib/pascal/custom-tools.ts`), so `.settings.json` files can never leak into the roster. Because presets are ordinary vault documents they ride along in vault export/backup with no schema changes, and can be deleted or renamed through any existing file surface.

### Loose binding

Loading a preset is deliberately **not** schema-bound: for each parameter the tool currently declares, if the preset object has a key of that name holding a primitive, that value lands in the form (`boolean` params get `Boolean(v)`, everything else `String(v)` — the `initialParamValues` convention); every other key is ignored, and parameters the preset doesn't mention keep their current values. A preset saved against an older revision of a tool therefore degrades gracefully instead of erroring.

### Pieces

- **`lib/pascal/tool-presets.ts`** — pure, client-safe helpers: `PRESET_NAME_PATTERN`, `sanitizePresetNameInput` (the input's keystroke filter: lowercase, strip anything outside `[a-z0-9_-]`, cap at 64), `presetSettingsPath`, `parsePresetFromPath`. Unit-tested in `lib/pascal/__tests__/tool-presets.test.ts`.
- **Roster listing** (`app/api/v1/chats/[id]/custom-tools/route.ts`) — `CustomToolListing` gains `vaultMountPointId: string | null`, the running character's vault (`Perspective.characterMountPointId`). This is the only server change; all file IO goes through the canonical mount-points routes (`GET/PUT /api/v1/mount-points/{id}/files/{relPath}`), never a second write path.
- **Run dialog** (`components/chat/CustomToolRunDialog.tsx`) — a "Presets" section in the tool's form phase, rendered only when the row runs as a character with a vault **and** the tool declares parameters:
  - a dropdown of existing presets (mount file list filtered through `parsePresetFromPath`, query key `queryKeys.customTools.presets(vaultMountPointId, toolName)`);
  - selecting one fetches and applies it (and copies its name into the name input, so re-saving updates it);
  - a name input (locked to the preset charset as typed) plus a **Save** button (PUT, overwrite semantics);
  - a **Reset to defaults** button re-seeding the form from `initialParamValues`.

### Out of scope

- Pascal's Workbench proving bench (different form-state model; possible follow-up).
- Preset deletion UI — the files are ordinary vault documents, deletable via existing file surfaces.
- Roster rows with no character (`vaultMountPointId` null): the section is simply hidden.
