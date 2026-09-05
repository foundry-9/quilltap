# Bug 98 — creating a project with a blank description has been impossible since 4.0.0

| | |
|---|---|
| **Status** | **Fixed in v4** |
| **Found** | 2026-08-24 (dogfooding, Friday under the Electron shell — "I tried to make a new project and got an error") |
| **Fixed** | 2026-08-24 |
| **Severity** | Medium (a whole affordance refused for the default input; the refusal is a generic toast in Prospero and *nothing at all* on the homepage quick action, and the server logs no trace either way) |
| **Who it bites** | anyone who creates a project and leaves the optional description field empty — the natural first gesture |
| **Provenance** | Structural. The v1 API migration (`fb614b62`, 2026-01-14) wrote `description: z.string().max(2000).optional()`; the 4.0.0 project-pages refactor (`ffd836bd`) gave the create dialog its `onSubmit(name, description \|\| null)`. Each half is defensible alone — together, a blank field sends `null` at a schema that accepts only *string or absent* |
| **Defect site** | `app/api/v1/projects/route.ts` (`createProjectSchema`) |
| **v5 status** | Not investigated — any v5 create path that validates a dialog's `null`-for-blank convention with a non-nullable optional inherits this exactly |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-24).** `createProjectSchema` moved to
`app/api/v1/projects/schemas.ts` (the collection-route twin of the
`[id]/schemas.ts` convention, and exportable where a route file is not) and its
four blank-able fields — `description`, `instructions`, `color`, `icon` — are
now `.nullable().optional()`, the shape `updateProjectSchema` has had all
along. The handler already coerced with `validatedData.description || null`,
so `null` flows through unchanged.
`__tests__/unit/app/api/v1/projects/create-project-schema.test.ts` pins the
contract: `null` passes for every blank-able field, absence passes, a missing
or empty `name` still refuses. The homepage `QuickActionsRow` also gained the
success/error toasts it never had, so its copy of the dialog can no longer
fail in perfect silence.

---

### Symptom

Open **New Project** — from Prospero or from the homepage quick action — type
a name, leave the description blank, submit. In Prospero: a toast reading
"Failed to create project" and a dialog that stays open. On the homepage: the
dialog stays open and *nothing else happens at all* — the handler logged to
the console and returned. Type anything into the description field and the
same submit succeeds, which is why the defect reads as flaky rather than
structural.

Nothing reaches the server log in either case: the middleware treats a
`ZodError` as handled (`validationError` → 400, no log line), so
`embedded-server.log` for a whole evening of failed attempts shows no
`[Projects v1]` entry and no unhandled-route error. Diagnosed by replaying the
POST against the live instance:

```
HTTP 400 — {"error":"Validation error","details":[{"expected":"string",
  "code":"invalid_type","path":["description"],
  "message":"Invalid input: expected string, received null"}]}
```

### Root cause

Two conventions that never met. The client side's convention for "the user
left it blank" is `null`: `CreateProjectDialog.tsx:28` submits
`onSubmit(name, description || null)`, and both callers
(`useProjects.createProject`, `QuickActionsRow.handleProjectCreate`) forward
it verbatim in the POST body. The server side's convention was Zod's
`.optional()` — which accepts *undefined*, and rejects `null` by design.

The update path got this right: `[id]/schemas.ts` declares
`description: z.string().max(2000).nullable().optional()` — which is why
editing a project's description to empty always worked while creating one
that way never did. The create schema was simply the outlier, written in the
v1 migration before the dialog existed and never revisited when the dialog's
`|| null` arrived three months later.

### Why it survived

Three silencers stacked. The validation 400 is *handled* as far as the
middleware is concerned, so the server logs nothing. The Prospero client
collapses every non-OK response into the same generic toast, so the user sees
no field name. And the homepage caller had no error surface at all. Meanwhile
the failure needs the description left blank — anyone who types one never
sees it, and every project already in the database was created with one (or
predates the v1 route), so the sample of successes looked like proof the
path worked.

### The fix

Make the create schema accept what the create dialogs send: `.nullable()`
on the four blank-able fields, mirroring `updateProjectSchema`. Move the
schema into `app/api/v1/projects/schemas.ts` so a test can import it (Next
route files admit no extra exports), and pin the null/absent/string matrix in
a regression test. Give `QuickActionsRow` the toasts its Prospero twin
already had — a dialog that can fail must be able to say so.

### How to verify

`npx jest __tests__/unit/app/api/v1/projects/create-project-schema.test.ts`,
or the live gesture: New Project, name only, submit — the project appears
and the success toast fires from either entry point.
