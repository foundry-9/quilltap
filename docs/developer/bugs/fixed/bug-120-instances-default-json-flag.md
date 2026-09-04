# Bug 120 — `instances default --json` is read as an instance name, so the flag its own help documents can never fire

| | |
|---|---|
| **Status** | FIXED in v4 (2026-09-04) |
| **Found** | 2026-09-04 |
| **Fixed** | 2026-09-04 |
| **Severity** | **Low** (read-only command, nothing is written and no data is at risk — but the documented invocation fails with a misleading "Unknown instance" error naming the flag, and a script that trusted `help/cli-instances.md` gets a non-JSON error line on stdout where it expected an object) |
| **Who it bites** | anyone scripting against the CLI who read `help/cli-instances.md`'s promise that "`--json` on `list` or `default` emits JSON output instead of a human-readable table" — and, on an instance registry that is not empty, anyone who runs it interactively and is told their default is an instance called `--json` |
| **Provenance** | Found by the v4.9 release checklist (item 12 — CLI docs, completions and tooling), auditing the flags the CLI accepts against the flags it documents |
| **Fix site** | `packages/quilltap/lib/instances-commands.js` (the `default` arm of `instancesCommand`) |
| **v5 status** | **Applies.** Any hand-rolled arg parser that mixes an option into a positional slot must strip the option before reading the positional; a flag read but not removed is a flag that changes what "the first argument" means. |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-04).** The `default` arm now reads `--json` and removes
it from the positionals before dispatching:

```js
case 'default': {
  const json = rest.includes('--json');
  cmdDefault(rest.filter((a) => a !== '--json'), { json });
  return;
}
```

## Symptom

```
$ quilltap instances default --json
Error: Unknown instance "--json". No instances are registered yet — use `quilltap instances add <name>`.
```

On a registry that *does* hold instances the error instead reads
`Unknown instance "--json"` against the registered names — the command is
trying to *set* the default to an instance by that name, not report it.

## Root cause

`cmdDefault` (`instances-commands.js:268`) has always taken an options object
and branched on it:

```js
function cmdDefault(args, opts = {}) {
  if (args.length === 0) {
    const current = getDefaultInstance();
    if (opts.json) {
      console.log(JSON.stringify({ defaultInstance: current }));
    } else if (current) { ... }
```

The dispatcher called it as `cmdDefault(rest)` — one argument. So `opts`
defaulted to `{}` and `opts.json` was never true: the JSON branch was
unreachable code. Worse, because the flag was left in `rest`, `args.length`
was `1` rather than `0`, so control never reached that branch at all; it fell
through to `const [name] = args`, and `--json` became the name to set.

Two mistakes compound: the flag is not *read* (so the branch is dead), and it
is not *removed* (so it is misread as a positional). Either alone would have
produced a quieter failure — reading without removing still sets an instance
named `--json`; removing without reading just prints the plain output.

## Why it survived

`cmdList`'s sibling arm does it correctly, and does it inline:

```js
case 'list':
case 'ls': {
  const namesOnly = rest.includes('--names-only');
  const json = rest.includes('--json');
  cmdList({ namesOnly, json });
  return;
}
```

`cmdList` takes *only* an options object — it has no positionals — so there is
nothing to filter and the pattern is complete as written. `cmdDefault` takes
both, and the shape was copied without the extra step that the second
parameter demands. The `opts = {}` default made the incomplete call site
type-check and run, rather than failing loudly on a missing argument.

It went unnoticed because:

- **Nothing exercised it.** The completion templates offer `--json` for
  `instances` as a subcommand-level flag (bash `inst_flags`, zsh `inst_opts`),
  so a tab-completing user is *offered* the broken invocation, but no test ran
  it. `completion-coverage.test.js` checks that documented flags appear in the
  templates — the help-text-to-template direction — and cannot see that a flag
  the templates offer does not work.
- **`instances --help` never mentioned `--json` at all** (fixed in the same
  change), so the CLI's own reference gave no reason to try it. The only place
  it was documented was `help/cli-instances.md`, which is user documentation
  read in-app rather than beside the code.
- The error is plausible. "Unknown instance" against a flag looks like a
  fumbled command line, not like the parser mistaking a flag for a name.

## The fix

The `default` arm filters and reads in one place, with a comment naming the
positional hazard so the next person copying `cmdList`'s shape onto a command
that takes positionals sees why the extra step is there.

`instances --help` now names `--json` on the `list` line, and
`docs/developer/CLI.md` documents `instances list --json` as the scripting
output (and records that `--names-only` is deliberately undocumented plumbing
for the completion scripts). The fish completion, which offered neither, now
offers `--json` on `list`/`ls`.

`help/cli-instances.md` already documented the flag on both verbs; its claim is
now true rather than aspirational.

## How to verify

```bash
quilltap instances default --json          # {"defaultInstance":"Friday"} or {"defaultInstance":null}
quilltap instances default                 # unchanged: Friday, or (none)
quilltap instances default Friday          # unchanged: Set default instance to "Friday".
quilltap instances default Friday --json   # still sets; the flag is inert on the set path
quilltap instances list --json             # unchanged
```

Regression coverage lives in
`packages/quilltap/lib/__tests__/instances-default-json.test.js`.
