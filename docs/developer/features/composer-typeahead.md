# Composer Typeahead — Layer 2 Spec

**Status:** Proposal / Not Implemented
**Scope:** quilltap-server (renderer + server); minor or no shell impact
**Phase:** 2 of an open-ended series. Layer 1 (spellcheck) and Layer 1.5 (text replacements) are shipped.

## Summary

Add three Lexical typeahead plugins to the Salon ChatComposer and Document Mode rich editor: `@` for character / participant mentions, `#` for Scriptorium document references, and `/` for slash-command launchers. The first two insert custom decorator nodes that serialize as ID-bearing markdown links (`@[Name](character:id)`, `#[path](doc:mount/path)`); the third is a plain command launcher and does not produce a node. All three reuse the existing `LexicalTypeaheadMenuPlugin` from `@lexical/react`.

Picked items insert with a trailing space.

## Goals

- Type `@`, get a popover of characters/participants prefix-matching the query; pick one to insert a chip.
- Type `#`, get a popover of mount-point documents prefix/substring-matching the query; pick one to insert a chip.
- Type `/`, get a popover of named commands; pick one to invoke an action (gutter-button equivalent or a pre-filtered `RunToolModal`).
- `@` mentions populate the existing `targetParticipantIds` field on send, driving addressing.
- `#` references inject the document into the LLM context — as a synthetic system whisper when the model is tool-capable, or as a transparent file attachment when it is not.
- One master "Smart suggestions in composer" toggle on the Chat settings tab. Default on.

## Non-goals

- LLM-driven ghost-text completion (Layer 3 / deferred).
- Live re-resolution of mention chips when characters are renamed *after* a message is sent (the stored display name in the markdown is fine for v1; the chip renderer may show the *current* name fetched by ID, but message history is not rewritten).
- A separate per-trigger settings panel — one master toggle for v1; granular toggles are a v2.1 follow-on if usage data justifies them.
- Plugin-defined slash commands. The registry is statically declared in v1; plugin extensibility is a v2.2 follow-on.

## Known State (verified 2026-05-22)

### Codebase findings

- **No custom Lexical decorator nodes anywhere.** All three Lexical configs (`LexicalComposerWrapper.tsx:161`, `DocumentPane.tsx:261`, `MarkdownLexicalEditor.tsx:164–175`) register only standard nodes from `@lexical/rich-text`, `@lexical/list`, `@lexical/link`, `@lexical/code`, `@lexical/table`. MentionNode and DocumentReferenceNode are greenfield.
- **No LexicalTypeaheadMenuPlugin usage exists.** No imports of `@lexical/react/LexicalTypeaheadMenuPlugin`. Confirm the package is installed in `package.json` before starting; add if missing (it ships as part of `@lexical/react`, which is already a dep).
- **`COMPOSER_TRANSFORMERS`** (`components/chat/lexical/plugins/MarkdownBridgePlugin.tsx`) is a custom list — Lexical built-ins plus `TABLE_TRANSFORMER` and `CASE_INSENSITIVE_CHECK_LIST`, with `ITALIC_STAR` and `BOLD_ITALIC_STAR` deliberately excluded (asterisks are roleplay narration). New transformers extend this array.
- **Local transformer reference:** `components/chat/lexical/transformers/table-transformer.ts` is the only example of a custom transformer in the repo. Follow its shape (`dependencies`, `type`, `regExp*`, `handleImport*`, `export`, `replace`).
- **Salon addressing already has the integration point:** `targetParticipantIds: string[] | null` on the message schema (`lib/services/chat-message/types.ts:90`). When populated, the first ID becomes the responder, bypassing talkativeness-weighted selection (`lib/services/chat-message/orchestrator.service.ts:255`). `@mention` chips flow into this field on send.
- **Existing text-based character detection:** `findMentionedCharacterIds()` in `lib/chat/context/mentioned-characters.ts` exists for *informational* off-scene context only — does **not** drive responder selection. Out of our way.
- **Chat-send pipeline:** Route `app/api/v1/chats/[id]/messages/route.ts` (POST) → `lib/services/chat-message/orchestrator.service.ts:handleSendMessage()` → `lib/services/chat-message/context-builder.service.ts:buildMessageContext()` → `lib/chat/context-manager.ts:buildContext()`. Reference parsing lands in `context-builder.service.ts`, before `buildContext()` is invoked.
- **Tool-capability detection:** `checkModelSupportsTools(provider, modelName, userId): Promise<boolean>` in `lib/tools/pseudo-tool-support.ts`. This is the branch point for `#` attach mode.
- **Scriptorium APIs:** `GET /api/v1/mount-points` (lists mount points), `GET /api/v1/mount-points/[id]/files` (lists files in one mount), `POST /api/v1/mount-points?action=semantic-search` (embedding-backed). No cross-mount filename-substring endpoint exists. This spec adds one.
- **ComposerGutterTools handlers:** `onAttachFileClick`, `onLibraryFileClick`, `onStandaloneGenerateImageClick`, `onInsertAnnouncementClick`, plus the `<RngDropdown>` component. Slash commands invoke these via props passed down to `ChatComposer` already.
- **RunToolModal API** (`components/chat/RunToolModal.tsx`): currently accepts `isOpen`, `onClose`, `chatId`, `participants`, `onToolExecuted`. Does **not** accept a pre-selected tool. This spec adds optional `initialToolId: string | null`.
- **Tool registry:** `lib/tools/index.ts` exports ~60 tools, each with a `userInvocable` flag and a category (`media`, `memory`, `search`, `project`, `files`, `help`, `utility`, `shell`, `plugin`, etc.). Slash commands consume only `userInvocable !== false` entries.

### Tactical reminders from CLAUDE.md

- Tools register their Zod schema as the source of truth; OpenAI-shape `parameters` is derived. We are not adding new tools, only launching existing ones.
- Quilltap conventions: feature lives at `/settings?tab=chat&section=suggestions` (or similar deep-link); help docs in steampunk-Wodehouse voice; changelog entry in direct American English.
- All user-visible changes require help-file entries. The `url` frontmatter must point to the actual settings section, and the "In-Chat Navigation" section must contain a matching `help_navigate(url: "...")` call.

## Architecture

### Reference markdown syntax

Both reference nodes extend the standard markdown link syntax with a scheme prefix:

- **Mention:** `@[Display Name](character:abc-123)`
- **Document reference:** `#[scenes/01-opening.md](doc:novel-mount-id/scenes/01-opening.md)`

The `[Display Name]` portion is what the user sees rendered as plain text in non-Quilltap markdown viewers (so message history copy-pasted elsewhere is still readable). The `(scheme:id)` portion carries the structured data Quilltap needs to resolve at send time.

Older messages without these constructs are unaffected. Plain `@Aristarchus` typed into a chat continues to behave as before (subject to `findMentionedCharacterIds()` informational detection).

### Decorator node shapes

Both nodes are `DecoratorNode`s that render a styled React chip. JSON serialization:

```ts
// MentionNode
{
  type: 'mention',
  version: 1,
  characterId: string,
  displayName: string,
}

// DocumentReferenceNode
{
  type: 'doc-ref',
  version: 1,
  mountPointId: string,
  path: string,
  displayName: string,
}
```

Both nodes are inline, non-editable, and selectable (caret can pass through them with arrow keys; backspace deletes the whole chip).

The chip components fetch the *current* display name by ID at render time. If the live name differs from the stored `displayName`, the chip renders with the live name and a tiny tooltip indicating the original. This keeps old messages legible after renames without rewriting history.

### Send-time resolution

In `lib/services/chat-message/context-builder.service.ts`, before `buildContext()` is called, parse the user's `content` markdown for the two custom link patterns:

- **Mentions** (`@\[([^\]]+)\]\(character:([a-f0-9-]+)\)`): collect `characterId`s in order. The first becomes (or supplements — see below) `targetParticipantIds`. Log every parsed mention at debug level.
- **Document references** (`#\[([^\]]+)\]\(doc:([^/]+)/(.+)\)`): collect `{ mountPointId, path }` pairs. For each, branch on `checkModelSupportsTools(provider, modelName, userId)`:
  - **Tool-capable:** inject a system whisper into the context with the path and a hint that the LLM may read it with `doc_read`. Do **not** inline the content; let the LLM pull it on demand.
  - **Not tool-capable:** load the file's content (via the same loader the Library Files attachment uses) and inject as a synthetic file attachment, reusing the existing fileIds plumbing in `loadAndProcessFiles()`.

**`targetParticipantIds` interaction:** if the message already has a non-empty `targetParticipantIds` (set explicitly by the UI for whispers or the Salon's existing addressing UI), do **not** overwrite it. Mentions then function as informational only. If it's null/empty and one or more mentions are present, populate it with the first mention's `characterId`. If multiple, add the rest as well — the orchestrator's "first is the responder" semantics still apply, but the others are recorded as addressed.

### Typeahead foundation

`@lexical/react/LexicalTypeaheadMenuPlugin` does the heavy lifting: trigger detection, query string maintenance, anchor positioning, keyboard navigation (arrows/Enter/Escape), and the menu lifecycle. We provide:

- A trigger function (`(text: string) => QueryMatch | null`) per plugin.
- A query callback that returns the candidate list (sync or async).
- A renderer for the menu and each menu option.
- A selection handler that performs the insertion.

A thin shared module at `components/chat/lexical/typeahead/useTypeaheadShell.tsx` handles the common bits: popover container styling (matches `qt-*` semantic classes), empty-state rendering ("No matches"), loading skeleton, and the "insert and add trailing space" helper. Each of the three plugins consumes this shell.

### Trailing space behavior

After a chip is inserted (or a slash command is invoked), a single space is inserted after the insertion point and the caret moves past it. Implementation: in the selection handler, after `selection.insertNodes([node])`, call `selection.insertText(' ')`. Document this in the typeahead shell's `insertWithTrailingSpace()` helper so all three plugins share the same behavior.

### Settings

Add one boolean to the Chat-tab settings module: `composerSuggestions` (default `true`). Both the ChatComposer's three typeahead plugins and Document Mode's plugins gate on this single flag. If the existing settings tab lives under `lib/foundry/subsystem-defaults.ts` per the Layer 1 spec, add the field there alongside `composerSpellcheck`.

### Failure modes

- **Network failure on `/api/v1/characters` or the new document-search endpoint:** show "Couldn't load suggestions" in the popover; do not block typing. Errors logged via existing renderer logger at warn level.
- **Reference to deleted character:** chip renders with a strike-through and a tooltip ("Character no longer exists"). On send, the reference is parsed but the `characterId` resolution fails — log a warning, drop the ID from `targetParticipantIds`, leave the literal display name in the message text so the LLM still sees something useful.
- **Reference to deleted/moved document:** similar — chip renders with a "Missing document" indicator; on send, log a warning and either skip injection (tool-capable case) or skip the attachment (non-tool-capable case), letting the literal path appear in the message text.

## Phase 1 — Typeahead foundation

> ### ✅ SHIPPED (2026-08-13) — built by Layer 2.0e
>
> [composer-emoji](complete/composer-emoji.md) built this shell, because emoji was
> its cheapest possible consumer. Everything in this phase exists; the `@` / `#` /
> `/` plugins consume it unchanged. **Two deltas from what is written below**,
> recorded here as that spec promised:
>
> 1. **`insertWithTrailingSpace()` gained a sibling.** The shell exports
>    `$insertWithTrailingSpace()` (chips — a chip is a word) *and*
>    `$insertWithoutTrailingSpace()` (emoji — punctuation-adjacent; writers want
>    `word😄` and `😄😄`). Both delegate to `$insertTypeaheadText(node, text,
>    { trailingSpace })`. Layer 2 wants the **trailing-space** one.
> 2. **The shell does NOT own trigger detection.** A consumer passes a
>    *precomputed* match and `toMenuTextMatch(textBefore, match)` converts it to
>    Lexical's `MenuTextMatch`. That keeps the "where does the trigger start and
>    end" decision in framework-free logic a v5 port can copy. `triggerFn` is a
>    thin adapter — for emoji, `(text) => findTrigger(text, EMOJI_PROFILE.trigger)`.
>
> Also landed beyond the description below: the shell owns the
> `aria-activedescendant` / `aria-controls` / `aria-expanded` wiring on the
> composer's contenteditable (focus never leaves the editor, so the menu must
> announce itself), and `qt-typeahead-option-glyph` / `-label` / `-detail` exist
> alongside the four classes listed.
>
> **Three traps, all paid for already — do not rediscover them.**
>
> - **Pass `commandPriority={COMMAND_PRIORITY_CRITICAL}` to
>   `LexicalTypeaheadMenuPlugin`.** `KeyboardPlugin` owns `KEY_ENTER_COMMAND` at
>   `COMMAND_PRIORITY_HIGH` to send the message, so a menu at `NORMAL` never sees
>   Enter — picking with the keyboard silently **sends the draft** instead. Safe
>   because the menu's key handlers are mounted only while it is open.
> - **Register your own `KEY_DOWN` handler above `TextReplacementPlugin`**
>   (`COMMAND_PRIORITY_NORMAL` vs its `LOW`) and return `true` only when you
>   actually commit — see the emoji spec's *Interaction with Layer 1.5*.
> - **Use the shared `$isInCodeContext(selection)` guard**
>   (`components/chat/lexical/utils/code-context.ts`) rather than writing a fresh
>   bail list. That helper exists because two plugins keeping separate lists *was*
>   bug 63.
>
> `MenuPortal` already flips itself above the caret when the viewport has no room
> below — which in the Salon, whose composer sits at the bottom of the window, is
> essentially always. You inherit that for free; don't re-solve it.

### Files

**New:**
- `components/chat/lexical/typeahead/useTypeaheadShell.tsx` — shared hook providing menu rendering, empty/loading states, and the `insertWithTrailingSpace()` helper.
- `components/chat/lexical/typeahead/MenuPortal.tsx` — popover container with `qt-typeahead-menu` styling.
- `components/chat/lexical/typeahead/types.ts` — shared types: `TypeaheadOption`, `TypeaheadQueryResult`.

**Modified:**
- `app/globals.css` (or wherever `qt-*` utility classes live) — new classes: `qt-typeahead-menu`, `qt-typeahead-option`, `qt-typeahead-option-active`, `qt-typeahead-empty`.

### Acceptance

Empty wrapper that does nothing on its own. Verifiable by mounting in a Storybook story or a temporary playground; no chat behavior changes yet.

## Phase 2 — `@` mentions

### Files

**New:**
- `components/chat/lexical/nodes/MentionNode.tsx` — `DecoratorNode` definition, `MentionChip` React renderer.
- `components/chat/lexical/plugins/MentionsPlugin.tsx` — wires up `LexicalTypeaheadMenuPlugin` for `@`.
- `components/chat/lexical/transformers/mention-transformer.ts` — exports `MENTION_TRANSFORMER` (a `Transformer` extending the markdown bridge).
- `lib/chat/parse-mentions.ts` — server-side parser exported for use by the context builder.

**Modified:**
- `components/chat/lexical/LexicalComposerWrapper.tsx` — register `MentionNode` in the `nodes:` array; mount `<MentionsPlugin />`.
- `app/salon/[id]/components/DocumentPane.tsx` — same (the `DocumentEditorPlugins` block).
- `components/chat/lexical/plugins/MarkdownBridgePlugin.tsx` — extend `COMPOSER_TRANSFORMERS` with `MENTION_TRANSFORMER`.
- `lib/services/chat-message/context-builder.service.ts` — call `parseMentions(content)` before building context; merge results into the message's `targetParticipantIds`.

### Data source

`useSWR<{ characters: Character[] }>('/api/v1/characters')` — already paid for by Layer 1's dictionary feed. The plugin reuses this hook to avoid duplicate fetches.

### Query / filtering

- Active participants in the current chat float to the top.
- Inactive characters are below, separated by a header row.
- Filter is case-insensitive prefix match on `name`, falling back to substring on `name`, falling back to substring on `alias[]` if the schema has aliases.
- Cap visible options at 8; "+ N more — keep typing to narrow" footer if exceeded.

### MentionNode renderer

Renders `<span class="qt-mention-chip">@<resolved-display-name></span>`. On click, opens the character's Aurora page in a new tab (target `/aurora/[id]`). Tooltip shows the character's identity field if present.

### Markdown transformer

Single-line regex transformer following the table-transformer pattern but simpler (no multiline state machine):

```ts
const MENTION_RE = /@\[([^\]]+)\]\(character:([a-f0-9-]+)\)/;

export const MENTION_TRANSFORMER: TextMatchTransformer = {
  dependencies: [MentionNode],
  export: (node) => {
    if (!$isMentionNode(node)) return null;
    return `@[${node.getDisplayName()}](character:${node.getCharacterId()})`;
  },
  importRegExp: MENTION_RE,
  regExp: MENTION_RE,
  replace: (textNode, match) => {
    const [, displayName, characterId] = match;
    const mention = $createMentionNode({ characterId, displayName });
    textNode.replace(mention);
  },
  trigger: ')',
  type: 'text-match',
};
```

### Server-side resolution

`lib/chat/parse-mentions.ts`:

```ts
const MENTION_RE = /@\[([^\]]+)\]\(character:([a-f0-9-]+)\)/g;

export interface ParsedMention {
  characterId: string;
  displayName: string;
}

export function parseMentions(content: string): ParsedMention[] {
  return Array.from(content.matchAll(MENTION_RE)).map(([, displayName, characterId]) => ({
    characterId,
    displayName,
  }));
}
```

In `context-builder.service.ts`, before `buildContext()`:

```ts
const mentions = parseMentions(newUserMessage.content);
const mentionIds = mentions.map(m => m.characterId);

// Validate IDs against active participants and characters table
const validIds = await filterToValidCharacterIds(mentionIds, chatId, repos);

if (validIds.length > 0 && (!targetParticipantIds || targetParticipantIds.length === 0)) {
  newUserMessage.targetParticipantIds = validIds;
  logger.debug(`[Mentions] Set targetParticipantIds from mentions: ${validIds.join(', ')}`);
}
```

### Acceptance

- Typing `@aris` in a chat with a character named "Aristarchus" pops the menu, shows the character, and Enter inserts a chip. A space is added after the chip.
- Sending the message results in Aristarchus being the next responder (verified by inspecting the chat-send response or by which character actually responds).
- The chip serializes round-trip: paste markdown `@[X](character:id)` into source mode, switch back to rich, see a chip. Edit in rich mode, switch to source, see the markdown.

## Phase 3 — `#` document references

### Files

**New:**
- `components/chat/lexical/nodes/DocumentReferenceNode.tsx`
- `components/chat/lexical/plugins/DocumentReferencesPlugin.tsx`
- `components/chat/lexical/transformers/doc-reference-transformer.ts`
- `app/api/v1/mount-points/search/route.ts` — new lightweight filename-substring endpoint.
- `lib/chat/parse-doc-references.ts` — server-side parser.
- `lib/services/chat-message/inject-document-references.ts` — branches on tool capability; injects whisper or attaches file.

**Modified:**
- `components/chat/lexical/LexicalComposerWrapper.tsx` — register `DocumentReferenceNode`; mount `<DocumentReferencesPlugin />`.
- `app/salon/[id]/components/DocumentPane.tsx` — same.
- `components/chat/lexical/plugins/MarkdownBridgePlugin.tsx` — extend `COMPOSER_TRANSFORMERS` with `DOCUMENT_REFERENCE_TRANSFORMER`.
- `lib/services/chat-message/context-builder.service.ts` — call `parseDocumentReferences()`; call `injectDocumentReferences()` with provider, model, userId to handle the tool-capability branch.

### New endpoint: `GET /api/v1/mount-points/search`

Query params:

- `q: string` (required, min 1 char)
- `limit: number` (optional, default 20, max 50)
- `mountPointIds: string` (optional, comma-separated; if absent, search across all)

Response:

```ts
{
  results: Array<{
    mountPointId: string;
    mountPointName: string;
    fileId: string;
    fileName: string;
    relativePath: string;
  }>;
}
```

Implementation: case-insensitive substring match on `fileName` and `relativePath` across the mount-points file index. SQL: a `LIKE '%q%' COLLATE NOCASE` query against the mount-index DB (see CLAUDE.md — `npx quilltap db --mount-points --tables` confirms the mount-index lives in its own DB). Order by: exact filename match → filename prefix match → filename substring → path substring. Limit applied post-ordering.

Use the existing `createAuthenticatedHandler` middleware and `successResponse`/`errorResponse` helpers per CLAUDE.md's `/api/v1/` conventions.

### DocumentReferenceNode renderer

Renders `<span class="qt-doc-ref-chip"><svg-doc-icon /> <resolved-or-stored-path></span>`. On click, opens the document in Document Mode (calls `onOpenDocumentClick` if available, with the document's path).

### Markdown transformer

Same pattern as MENTION_TRANSFORMER but matching `#\[([^\]]+)\]\(doc:([^/]+)/(.+)\)`.

### Server-side resolution and injection

`lib/services/chat-message/inject-document-references.ts`:

```ts
export async function injectDocumentReferences(
  references: ParsedDocumentReference[],
  provider: Provider,
  modelName: string,
  userId: string,
  repos: Repositories,
  context: BuildableContext,
): Promise<void> {
  if (references.length === 0) return;

  const toolCapable = await checkModelSupportsTools(provider, modelName, userId);
  logger.debug(`[DocRefs] Tool-capable=${toolCapable}, references=${references.length}`);

  if (toolCapable) {
    // Append a system whisper listing the references; LLM can fetch with doc_read if needed.
    for (const ref of references) {
      const exists = await mountPoints.fileExists(ref.mountPointId, ref.path);
      if (!exists) {
        logger.warn(`[DocRefs] Referenced document not found: ${ref.mountPointId}/${ref.path}`);
        continue;
      }
      context.whispers.push({
        sender: 'librarian',
        text: `The user referenced this document in their message: \`${ref.path}\` (mount: ${ref.mountPointId}). You may read its contents with \`doc_read\` if needed.`,
      });
    }
  } else {
    // Load each doc and attach as a transparent file (reuse existing file plumbing).
    for (const ref of references) {
      try {
        const fileData = await mountPoints.readFileAsAttachment(ref.mountPointId, ref.path);
        context.attachedFiles.push(fileData);
      } catch (err) {
        logger.warn(`[DocRefs] Failed to attach referenced document ${ref.path}:`, err);
      }
    }
  }
}
```

The exact shape of `BuildableContext`, `whispers`, and `attachedFiles` is governed by the existing `buildMessageContext()` and `buildContext()` signatures. Match local convention; the pseudocode above conveys intent.

### Acceptance

- Typing `#scen` in a chat with a `scenes/01-opening.md` file pops the menu, picks it on Enter, inserts a chip.
- On send with a tool-capable model (e.g. Anthropic), the LLM sees a librarian whisper naming the path; no content is inlined.
- On send with a non-tool-capable model, the file content is loaded and attached as if the user had used the Library File button.
- The chip serializes round-trip the same way mentions do.

## Phase 4 — `/` slash commands

### Files

**New:**
- `components/chat/lexical/plugins/SlashCommandsPlugin.tsx`
- `components/chat/lexical/slash-commands/registry.ts` — exports `SLASH_COMMANDS: SlashCommand[]`.
- `components/chat/lexical/slash-commands/types.ts` — `SlashCommand`, `SlashCommandContext`.

**Modified:**
- `components/chat/lexical/LexicalComposerWrapper.tsx` — mount `<SlashCommandsPlugin />` with a context object containing the necessary handler refs.
- `components/chat/RunToolModal.tsx` — accept optional `initialToolId: string | null`; on open with this prop, pre-select the tool. Update the open-call sites (`ChatComposer` and wherever else) to thread the prop through (default `null`).
- `app/salon/[id]/components/ChatComposer.tsx` — pass `onOpenRunToolModal: (toolId?: string) => void` down to the SlashCommandsPlugin context. Wire the existing Run Tool modal open path to accept a tool id.

### Slash command model

```ts
interface SlashCommand {
  id: string;             // 'attach', 'image', 'roll', etc.
  label: string;          // 'Attach file'
  description: string;    // 'Attach an image, PDF, or text file'
  keywords: string[];     // ['attach', 'file', 'upload', 'paperclip']
  category: 'gutter' | 'tool' | 'utility';
  icon: ReactElement;     // <svg .../>
  handler: (ctx: SlashCommandContext) => void;
}

interface SlashCommandContext {
  openRunToolModal: (toolId?: string) => void;
  onAttachFileClick: () => void;
  onLibraryFileClick: () => void;
  onStandaloneGenerateImageClick: () => void;
  onInsertAnnouncementClick: () => void;
  onOpenDocumentClick?: () => void;
  onOpenTerminalClick?: () => void;
  // Quick-action shortcuts that don't go through the modal:
  doRng: (formula: string) => void;
}
```

### Registry contents (v1)

| Command   | Category | Action                                                          |
| --------- | -------- | --------------------------------------------------------------- |
| `/attach` | gutter   | `ctx.onAttachFileClick()`                                       |
| `/library`| gutter   | `ctx.onLibraryFileClick()`                                      |
| `/generate` | gutter | `ctx.onStandaloneGenerateImageClick()`                          |
| `/announce` | gutter | `ctx.onInsertAnnouncementClick()`                               |
| `/doc`    | gutter   | `ctx.onOpenDocumentClick?.()` (if defined; hidden otherwise)    |
| `/terminal` | gutter | `ctx.onOpenTerminalClick?.()` (if defined; hidden otherwise)    |
| `/tool`   | tool     | `ctx.openRunToolModal()` (no pre-selection)                     |
| `/roll <formula>` | utility | `ctx.doRng(formula)` — invokes the same path as the RNG button |
| Per-tool entries | tool | `ctx.openRunToolModal(toolId)` for each `userInvocable` tool   |

The per-tool entries are generated from the same `/api/v1/tools?chatId=...` response the `RunToolModal` already fetches. Generation rule: command id = tool id (kebab-cased); label = tool's `displayName` from the registry; description = tool's short description. Category = the tool's existing category.

### Plugin behavior

- Trigger: `/` at the start of the composer, *or* after whitespace. Not in the middle of a word.
- Query: text after the `/` up to the next whitespace.
- For commands with argument syntax (e.g. `/roll 2d6`), the plugin commits the command when the user presses Enter on the popover *or* presses Space — the argument is whatever's typed after the command identifier.
- On selection, the chosen command's `handler` is invoked with the context. The plugin then deletes the literal `/command` text from the composer (since the action happens elsewhere — modal opens, file picker opens, etc., and the user's composer text shouldn't carry a stale `/foo`). For commands that insert content into the composer (e.g. `/roll` inserts the result chip directly), the registry function is responsible for any composer-side insertion via the existing `pendingToolResults` mechanism.

### Acceptance

- Typing `/imag` shows "Generate Image" near the top; Enter opens the standalone image generation flow.
- Typing `/tool` shows the launcher; Enter opens RunToolModal with no pre-selection.
- Typing `/memory-search` (a tool id) opens RunToolModal with memory-search pre-selected.
- Typing `/roll 2d6` invokes the RNG with formula `2d6`, inserting the result chip via the existing pending-tool-results path.
- The `/command` text is removed from the composer after the handler fires.

## Cross-cutting

### Settings

In the Chat-tab settings module (same place Layer 1 added `composerSpellcheck`), add:

```ts
composerSuggestions: z.boolean().default(true),
```

UI toggle label: **"Smart suggestions"**, helper: *"Type @ to mention a character, # to reference a document, or / to run a command. Disable to turn off all three."*

All three plugins read this setting and bail out of mounting their typeahead if it's `false`. The decorator nodes still render correctly (so existing messages display chips); only the typeahead trigger is disabled.

### Help docs

Update or create `help/chat.md` (or whichever Chat-tab help file the project uses) with a new section describing the three triggers. Frontmatter `url` points to `/settings?tab=chat&section=suggestions` (or whatever section anchor the settings UI uses). Include the matching `help_navigate(url: "...")` call in the "In-Chat Navigation" section.

Voice: steampunk + Roaring 20s + Wodehouse + Lemony Snicket.

### Changelog

Top entry in `docs/CHANGELOG.md`, direct American English:

```
- Composer typeahead: @ mentions characters and participants (drives addressing via targetParticipantIds), # references Scriptorium documents (system whisper for tool-capable models; file attachment otherwise), / launches commands (gutter actions, RunToolModal, RNG). One master "Smart suggestions" toggle on the Chat settings tab; default on. New endpoint GET /api/v1/mount-points/search for filename substring lookup. RunToolModal gains an optional initialToolId prop.
```

### DDL / schema notes

No schema changes. `targetParticipantIds` already exists on the message row. The mount-index DB is read-only for the new search endpoint. Update `docs/developer/DDL.md` only if a future iteration needs new columns (none in v1).

### Logging

- Renderer: `[mentions]`, `[doc-refs]`, `[slash]` debug-level logs at key transitions (popover open, query, selection, insertion).
- Server: `[Mentions]`, `[DocRefs]` debug/warn lines in the context-builder for parse results, ID validation, and resolution outcomes.

## Verification

### Type checks

`npx tsc` in `quilltap-server`. No shell-side changes.

### Manual verification matrix

| Scenario | Expected |
| --- | --- |
| `@aris` in a chat with one matching character | Popover shows it; Enter inserts chip + space |
| `@aris` with two prefix matches | Both shown; arrow keys navigate; Enter picks |
| `@aris` with no match | "No matches" empty state; Escape dismisses |
| Send a message with `@Aristarchus` chip | Aristarchus responds next (verify in chat log) |
| Send with `@A` and `@B` chips | First (A) responds; both recorded as addressed |
| Send with chip + explicit sidebar whisper target | Sidebar target wins; mention is informational only |
| `#scen` with `scenes/01.md` indexed | Popover shows it; Enter inserts chip |
| Send `#scenes/01.md` with Anthropic model | System whisper appears in LLM logs; no file attached |
| Send `#scenes/01.md` with a non-tool model | File attached to the request payload |
| `/atta` shows "Attach file" | Enter opens file picker; `/attach` text removed from composer |
| `/roll 2d6` | RNG runs, result chip appears, `/roll 2d6` text removed |
| Master toggle off | All three popovers fail to appear; raw text `@`, `#`, `/` is accepted |
| Markdown round-trip | Chip → source mode shows `@[Name](character:id)` → rich mode shows chip again |
| Renamed character | Chip in old message shows new name + tooltip noting original |
| Deleted character | Chip shows strike-through; send drops the ID from targetParticipantIds |

### Automated tests

- `lib/chat/parse-mentions.test.ts` — covers regex correctness, multiple mentions, malformed input.
- `lib/chat/parse-doc-references.test.ts` — same for `#`.
- `lib/services/chat-message/inject-document-references.test.ts` — covers the tool-capable / not-tool-capable branch (mock `checkModelSupportsTools`).
- `components/chat/lexical/transformers/mention-transformer.test.ts` — round-trip test on the Lexical transformer.
- Snapshot test on the slash-command registry against the existing `tool-definitions-snapshot.test.ts` pattern: ensures every `userInvocable` tool has a corresponding generated slash command.

## Open questions

- **Should renaming a character rewrite chip display names retroactively?** Spec says no for v1 — chip renderer fetches the current name and shows it, but the stored markdown isn't rewritten. Cheap; correct enough; flag in user-feedback list to reconsider.
- **Should `/` work inside the middle of a sentence?** Spec says no — only at start of composer or after whitespace. Reduces accidental triggers (e.g. URLs, paths). Worth confirming.
- **Should the `#` filename search index project files in addition to mount-point documents?** Project files are stored separately (`/api/v1/chat-files`). Adding them would mean indexing two sources in the new search endpoint. Deferred to v2.1 unless the developer wants both in v1.
- **Should the registry be plugin-extensible?** Out of scope for v1; the existing `userInvocable !== false` filter already gives plugin-defined tools first-class status in the per-tool entries. Plugin-defined *gutter-style* commands would need a new registration API; not in v1.

## Deferred (for later phases)

- **Layer 3** — LLM ghost-text completion via a decorator node and debounced provider call.
- **Layer 2.1** — per-trigger settings sub-toggles, project files in `#` search, plugin-extensible slash commands.
- **Layer 2.2** — `{{snippet}}` expansion for user-defined templates.

## File-touch summary

**New files (renderer):**
- `components/chat/lexical/typeahead/useTypeaheadShell.tsx`
- `components/chat/lexical/typeahead/MenuPortal.tsx`
- `components/chat/lexical/typeahead/types.ts`
- `components/chat/lexical/nodes/MentionNode.tsx`
- `components/chat/lexical/nodes/DocumentReferenceNode.tsx`
- `components/chat/lexical/plugins/MentionsPlugin.tsx`
- `components/chat/lexical/plugins/DocumentReferencesPlugin.tsx`
- `components/chat/lexical/plugins/SlashCommandsPlugin.tsx`
- `components/chat/lexical/transformers/mention-transformer.ts`
- `components/chat/lexical/transformers/doc-reference-transformer.ts`
- `components/chat/lexical/slash-commands/registry.ts`
- `components/chat/lexical/slash-commands/types.ts`

**New files (server):**
- `app/api/v1/mount-points/search/route.ts`
- `lib/chat/parse-mentions.ts`
- `lib/chat/parse-doc-references.ts`
- `lib/services/chat-message/inject-document-references.ts`

**Modified (renderer):**
- `components/chat/lexical/LexicalComposerWrapper.tsx` — register two new nodes, mount three new plugins.
- `app/salon/[id]/components/DocumentPane.tsx` — same.
- `components/chat/lexical/plugins/MarkdownBridgePlugin.tsx` — extend `COMPOSER_TRANSFORMERS` with two new transformers.
- `components/chat/RunToolModal.tsx` — accept `initialToolId` prop.
- `app/salon/[id]/components/ChatComposer.tsx` — thread `onOpenRunToolModal(toolId?)` into the plugin context.
- `app/globals.css` (or equivalent) — new `qt-*` classes for chips and popover.
- Chat-tab settings module — add `composerSuggestions` boolean (default `true`).

**Modified (server):**
- `lib/services/chat-message/context-builder.service.ts` — parse mentions and doc references; merge into message; call `injectDocumentReferences()`.

**Docs:**
- `help/chat.md` (or equivalent) — new section.
- `docs/CHANGELOG.md` — top entry.

## Completion gate

Do **not** move this spec to `docs/developer/features/complete/` until every item in the file-touch summary above has been written or modified, **and** the manual verification matrix has been walked end-to-end on a running instance. Partial implementation belongs in a follow-up spec referencing this one, not in `complete/`.
