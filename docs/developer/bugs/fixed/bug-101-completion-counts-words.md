# Bug 101 — shell completion looked its verb up by counting words, so any flag on the line silenced it

| | |
|---|---|
| **Status** | Fixed in v4 (2026-08-25) |
| **Found** | 2026-08-25 |
| **Fixed** | 2026-08-25 |
| **Severity** | Medium (zsh: total loss of completion for a subcommand once a flag is typed; bash: the verb list replaced by a flag list) |
| **Who it bites** | anyone who installed `quilltap completion zsh` and addresses a non-default instance — i.e. exactly the users the `--instance` flag exists for |
| **Provenance** | Reported by the user while looking for `docs list`: "once you've entered an `--instance Friday` you can't do anything else with completion" |
| **Fix site** | `packages/quilltap/lib/completion/zsh.template` (every subcommand function) and `bash.template` (the word scanner) |
| **v5 status** | Not investigated — the completion scripts are v4 CLI artefacts. Any port that hand-rolls positional lookup by index inherits the shape |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-08-25)** — the zsh template now hands every subcommand's
options *and* its positionals to one `_arguments -C` call and branches on the
parsed `$state`; the top-level positionals carry `(-)` so a flag typed after
the subcommand is left to that subcommand's own parse. The bash scanner learned
which flags take a value, per subcommand. Both shells gained live document-store
names on every `<mount>` positional, looked up against the instance the command
line is actually addressing.

## Symptom

In zsh, with the shipped completion installed:

```
quilltap docs <TAB>                        → the docs verbs, correctly
quilltap docs --instance Friday <TAB>      → nothing at all
quilltap docs --instance Friday l<TAB>     → nothing (no `list`)
quilltap db characters --instance F <TAB>  → nothing
```

Not "the wrong candidates" — no candidates, and no flags either, so the line
looked to the user like completion had simply stopped working for that
subcommand. Putting the flag *before* the subcommand
(`quilltap --instance Friday docs <TAB>`) worked, which is what made it look
arbitrary.

In bash the same class of bug was milder and better hidden:

```
quilltap docs --limit 5 <TAB>    → the docs flag list, not the verb list
quilltap docs --mount notes <TAB> → same
quilltap memories -i <TAB>        → instance names, though -i is --ignore-case here
```

## Root cause

Two independent faults, one per shell.

**zsh — position by counting.** Each subcommand function found its verb with a
literal word-index test, e.g. `_quilltap_docs` at
`lib/completion/zsh.template`:

```zsh
  if (( CURRENT == 2 )); then
    _describe 'docs subcommand' subverbs
  fi
  _arguments $docs_opts
```

`CURRENT == 2` only holds when the verb sits immediately after the subcommand.
`--instance Friday` pushes it to 4 and the `_describe` never runs. The trailing
`_arguments $docs_opts` had no positional specs at all, so with a non-option
word position to fill and nothing declared for it, `_arguments` produced no
matches either — which is why not even the flags came back.

**zsh — the outer parse ate the flag.** Worse, the dispatch never reached
`_quilltap_docs`. The top-level call was

```zsh
  _arguments -C '1: :->subcommand' "${global_options[@]}" '*::arg:->args'
```

and `global_options` contains `-i`/`--instance`. `_arguments` matched `docs`
against the `1:` positional and then claimed `--instance Friday` as its own
global option even though it came *after* `docs`, leaving the rest-argument
array empty. Instrumenting the dispatcher showed `words=[]  CURRENT=1`, so
`_quilltap_subcommand`'s `$words[1]` was empty and its `case` matched nothing.

**bash — a flat value-flag list.** `_quilltap_complete` walks the line looking
for the first two non-option words, and skipped a following word only for the
*global* value-taking flags:

```bash
      -d|--data-dir|-i|--instance|-p|--port|--passphrase)
        ((i += 2))
```

Every subcommand flag fell through to the `-*` arm, which advances by one — so
`--limit 5` left `5` looking like a positional, and `5` was recorded as the
verb. The same flat treatment made `-i` mean `--instance` under `memories`,
where `memories-commands.js:127` reserves it for `--ignore-case`.

## Why it survived

`completion-coverage.test.js` guards the completion *surface* — that every
subcommand in `bin/quilltap.js`'s `SUBCOMMANDS` set appears in all three
templates and has its own dispatch arm. It is a static substring and regex
check over the template text, and every assertion in it passed throughout: the
verbs were all present in the file, the arms were all there, the bug was purely
in *when* the arm gets reached. Nothing in the suite had ever executed a
completion.

The three shells also fail differently, and the two the maintainer did not use
mask the one they did: fish scans tokens for the subcommand and was never
affected, and bash degraded to a flag list rather than to silence.

## The fix

**zsh** — every subcommand function now looks like

```zsh
  _arguments -C $docs_opts \
    '1: :->verb' \
    '2: :->pos2' \
    '3: :->pos3' \
    '4: :->pos4' \
    '*: :'

  case "$state" in
    verb) _describe -t commands 'docs subcommand' subverbs ;;
    pos2|pos3|pos4) _quilltap_docs_positional ${state#pos} ;;
  esac
```

so `_arguments` decides which positional is being typed and flags may appear
anywhere the CLI itself accepts them. The top-level dispatch gained `(-)` on
both positionals —

```zsh
  _arguments -C \
    "${global_options[@]}" \
    '(-): :->subcommand' \
    '(-)*::arg:->args'
```

— which stops the outer parse consuming a flag typed after the subcommand and
hands the whole tail to the subcommand's own `_arguments`. `db characters` and
`themes registry` nest the same way, each with its own `_arguments` so its
narrower flag list still applies.

**bash** — the scanner keeps per-subcommand lists of value-taking flags and
picks the right one as it walks, which also settles the two collisions a flat
list cannot express: `-o` is the valueless global `--open` but themes' valued
`--output`, and `memories` reserves `-i` for `--ignore-case`.

**Both** — wherever a verb takes a `<mount>` (`docs ls`, `docs read`, both ends
of `docs move`/`copy`/`link`, and the `--mount` flag) the completion now offers
live store names from `quilltap docs list --names-only`, re-using the
`-i`/`-d`/`--passphrase` already on the line so the lookup reads the instance
being addressed. Names are added with `compadd -a` (zsh) and `printf '%q'`
(bash) rather than `_values`/`compgen -W`, which would chop
`Project Files: The Estate` at its space and colon. fish, which never had the
bug, gained store names on `--mount` only — its positional scanner would have
had to be written untested, as fish is not installed on the development host.

`quilltap docs list` itself was not the bug and needed no change: it has listed
mount points with their IDs all along. It was unreachable by tab-completion for
anyone who had typed `--instance` first, which is how it came to look missing.

## Verifying

`packages/quilltap/lib/__tests__/completion-behavior.test.js` drives the bash
script for real — sourcing it, setting `COMP_WORDS`/`COMP_CWORD`, and reading
`COMPREPLY` back with a stub `quilltap` on `PATH` — across the flag positions
that used to break it, and checks the zsh template structurally (no
`(( CURRENT == n ))`, both `(-)` prefixes present, `zsh -n` clean). zsh's
completion system can only be driven from inside a completion widget, so the
zsh half was verified by hand through a `zsh/zpty` harness rather than in the
suite:

```
quilltap docs --instance Friday <TAB>   → the 23 docs verbs
quilltap docs --limit 5 <TAB>           → the 23 docs verbs
quilltap docs -i V4test ls <TAB>        → V4test's 12 stores, spaces quoted
quilltap docs ls -i V4test <TAB>        → the same 12
quilltap memories -i <TAB>              → the memories verbs, not instance names
```
