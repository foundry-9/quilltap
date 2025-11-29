# Physical Descriptions Feature Implementation Plan

## Overview

Add physical description records to characters and personas for image generation prompts. Each character/persona can have multiple named descriptions with varying detail levels (short/medium/long/complete) plus a freeform Markdown field. The UI will be reorganized with tabs.

## Data Model

### New PhysicalDescription Schema

```typescript
PhysicalDescriptionSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1),                              // Required: e.g., "Base Appearance", "Formal Attire"
  shortPrompt: z.string().max(350).nullable().optional(),   // 350 char max
  mediumPrompt: z.string().max(500).nullable().optional(),  // 500 char max
  longPrompt: z.string().max(750).nullable().optional(),    // 750 char max
  completePrompt: z.string().max(1000).nullable().optional(), // 1000 char max
  fullDescription: z.string().nullable().optional(),    // Freeform Markdown, no limit
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})
```

### Storage Approach

Physical descriptions will be stored **embedded within each character/persona JSON file** as an array field `physicalDescriptions: PhysicalDescription[]`. This follows the existing pattern for `personaLinks`, `tags`, and `avatarOverrides`.

**Rationale:**

- Descriptions are tightly coupled to their parent entity
- No need for cross-entity queries
- Simpler CRUD operations (no separate repository needed)
- Consistent with existing embedded arrays in the schema

### Schema Updates

**CharacterSchema additions:**

```typescript
physicalDescriptions: z.array(PhysicalDescriptionSchema).default([]),
```

**PersonaSchema additions:**

```typescript
physicalDescriptions: z.array(PhysicalDescriptionSchema).default([]),
```

## API Endpoints

### Characters

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/characters/[id]/descriptions` | List all descriptions for character |
| POST | `/api/characters/[id]/descriptions` | Create new description |
| GET | `/api/characters/[id]/descriptions/[descId]` | Get single description |
| PUT | `/api/characters/[id]/descriptions/[descId]` | Update description |
| DELETE | `/api/characters/[id]/descriptions/[descId]` | Delete description |

### Personas

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/personas/[id]/descriptions` | List all descriptions for persona |
| POST | `/api/personas/[id]/descriptions` | Create new description |
| GET | `/api/personas/[id]/descriptions/[descId]` | Get single description |
| PUT | `/api/personas/[id]/descriptions/[descId]` | Update description |
| DELETE | `/api/personas/[id]/descriptions/[descId]` | Delete description |

## UI Changes

### Tab Structure for Character View/Edit Pages

**Tab 1: Character Details** (current content)

- Name, title, description, personality, scenario
- First message, example dialogues, system prompt
- Default persona selector
- Tags

**Tab 2: Associated Profiles**

- Default Connection Profile selector
- (Future: Default Image Profile, Embedding Profile)

**Tab 3: Photo Gallery**

- PhotoGalleryModal embedded as tab content
- Character-tagged images grid

**Tab 4: Physical Descriptions**

- List of existing descriptions with cards
- Add new description button
- Edit/delete actions on each card
- Inline editor or modal for create/edit

### Tab Structure for Persona Pages

**Tab 1: Persona Details** (current content)

- Name, title, description
- Personality traits
- Tags

**Tab 2: Photo Gallery**

- PhotoGalleryModal embedded as tab content

**Tab 3: Physical Descriptions**

- Same structure as character descriptions

## Components to Create

### 1. PhysicalDescriptionList

- Displays all descriptions for an entity
- Grid of cards showing name + prompt previews
- Add button triggers editor
- Click card to view full description

### 2. PhysicalDescriptionEditor

- Modal or inline form for create/edit
- Fields: name (required), short/medium/long/complete prompts (with char counters)
- Freeform Markdown textarea with preview toggle
- Save/Cancel buttons

### 3. PhysicalDescriptionCard

- Card display of single description
- Shows name, truncated prompts
- Edit/Delete action buttons
- Expand to view full freeform description (rendered Markdown)

### 4. CharacterTabs / PersonaTabs

- Tab navigation component
- Manages active tab state
- Renders appropriate content per tab

## Implementation Steps

### Phase 1: Schema & Data Layer

1. Add `PhysicalDescriptionSchema` to `lib/json-store/schemas/types.ts`
2. Add `physicalDescriptions` field to `CharacterSchema`
3. Add `physicalDescriptions` field to `PersonaSchema`
4. Add helper methods to `characters.repository.ts`:
   - `addDescription(characterId, description)`
   - `updateDescription(characterId, descriptionId, updates)`
   - `removeDescription(characterId, descriptionId)`
5. Add same helper methods to `personas.repository.ts`

### Phase 2: API Endpoints

1. Create `/api/characters/[id]/descriptions/route.ts` (GET, POST)
2. Create `/api/characters/[id]/descriptions/[descId]/route.ts` (GET, PUT, DELETE)
3. Create `/api/personas/[id]/descriptions/route.ts` (GET, POST)
4. Create `/api/personas/[id]/descriptions/[descId]/route.ts` (GET, PUT, DELETE)

### Phase 3: UI Components

1. Create `components/physical-descriptions/physical-description-card.tsx`
2. Create `components/physical-descriptions/physical-description-editor.tsx`
3. Create `components/physical-descriptions/physical-description-list.tsx`
4. Create `components/tabs/entity-tabs.tsx` (reusable tab component)

### Phase 4: Character Pages Refactor

1. Refactor `/characters/[id]/view/page.tsx` to use tabs
2. Refactor `/characters/[id]/edit/page.tsx` to use tabs
3. Integrate PhotoGalleryModal as tab content
4. Integrate PhysicalDescriptionList in Descriptions tab

### Phase 5: Persona Pages Refactor

1. Refactor `/personas/[id]/page.tsx` to use tabs
2. Integrate PhotoGalleryModal as tab content
3. Integrate PhysicalDescriptionList in Descriptions tab

## File Changes Summary

### New Files

- `lib/json-store/schemas/types.ts` (modify - add PhysicalDescriptionSchema)
- `app/api/characters/[id]/descriptions/route.ts`
- `app/api/characters/[id]/descriptions/[descId]/route.ts`
- `app/api/personas/[id]/descriptions/route.ts`
- `app/api/personas/[id]/descriptions/[descId]/route.ts`
- `components/physical-descriptions/physical-description-card.tsx`
- `components/physical-descriptions/physical-description-editor.tsx`
- `components/physical-descriptions/physical-description-list.tsx`
- `components/tabs/entity-tabs.tsx`

### Modified Files

- `lib/json-store/schemas/types.ts` - Add schemas
- `lib/json-store/repositories/characters.repository.ts` - Add description methods
- `lib/json-store/repositories/personas.repository.ts` - Add description methods
- `app/(authenticated)/characters/[id]/view/page.tsx` - Add tabs
- `app/(authenticated)/characters/[id]/edit/page.tsx` - Add tabs
- `app/(authenticated)/personas/[id]/page.tsx` - Add tabs

## Notes

- All prompts have character limits enforced at both validation and UI level
- The `fullDescription` field is unlimited Markdown, rendered in view mode
- Descriptions can be combined programmatically for image generation (future feature)
- Tab state can be persisted via URL query params for bookmarkability
