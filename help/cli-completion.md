---
url: /settings
---

# Shell Completion for Quilltap

Like a notary stamp on the margin of a ledger, shell completion puts the thing you need at your fingertip — one keystroke, not a gauntlet of flags.

The `quilltap completion` command generates a completion script for your shell. Sourcing it (or placing it in your shell's completion directory) will let you tab through subcommands and mount points without spelling them out.

## Installation

### Bash

Append the generated script to `~/.bashrc`:

```bash
quilltap completion bash >> ~/.bashrc
```

Or drop it into a system completion directory:

```bash
quilltap completion bash > /usr/local/etc/bash_completion.d/quilltap
```

(Or `/etc/bash_completion.d/` on Linux, if you have admin rights.)

Then restart your shell, or `source ~/.bashrc`.

### Zsh

There are two reasonable ways to wire this up. Pick one.

**Option A — one line in `.zshrc`** (simpler; adds noticeable shell-startup latency, because `quilltap` runs every time you open a new shell):

```zsh
# In ~/.zshrc:
source <(quilltap completion zsh)
```

**Option B — canonical `fpath` setup** (faster; what zsh expects):

```zsh
# In ~/.zshrc, before compinit runs:
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit
compinit
```

Then once, from any shell:

```zsh
mkdir -p ~/.zsh/completions
quilltap completion zsh > ~/.zsh/completions/_quilltap
```

The leading underscore on `_quilltap` is the zsh convention — it marks the file as a completion definition rather than a regular autoloaded function.

**Using oh-my-zsh or another framework?** The framework runs `compinit` for you, so either set the `fpath` line *before* the framework loads, or delete the completion cache (`rm -f ~/.zcompdump*`) after dropping the file in, and start a new shell. The more idiomatic location under oh-my-zsh is:

```zsh
mkdir -p ~/.oh-my-zsh/custom/plugins/quilltap
quilltap completion zsh > ~/.oh-my-zsh/custom/plugins/quilltap/_quilltap
# then add `quilltap` to the plugins=(...) line in ~/.zshrc
```

### Fish

```fish
quilltap completion fish > ~/.config/fish/completions/quilltap.fish
```

Fish picks new completion files up automatically — no shell restart needed.

## What Gets Completed

- **Subcommands**: `quilltap d<TAB>` will suggest `db`, `docs`, and so on.
- **Sub-verbs per namespace**: `quilltap db s<TAB>` will suggest `schema`, `show`.
- **Flags for the verb at hand**: `quilltap docs docker-mounts --<TAB>` will suggest only the flags that verb actually entertains.
- **Instance names**: `quilltap --instance Fr<TAB>` will suggest registered instances from `instances.json`.
- **Mount names**: offered both after `--mount` and in the place the verb keeps for one — `quilltap docs ls Qu<TAB>`, and at either end of `docs move`, `docs copy`, and `docs link`.

A flag typed early no longer throws the whole business off. The completions read the line as the CLI itself would, rather than counting words, so `quilltap docs --instance Friday <TAB>` still offers up the `docs` verbs. Better still, bash and zsh notice the `-i`, `-d`, or `--passphrase` you have already typed and consult *that* instance for store names — not whichever one happens to be the default. Fish, more modest in its ambitions, completes `--mount` but not the positional, and always asks the default instance.

Dynamic completions (instance names, mount names, etc.) shell out to quilltap's own subcommands. If your instance is encrypted and quilltap can't open it without a passphrase, the completion will silently return no suggestions — this is by design, to avoid prompting in the middle of a tab press.

## In-Chat Navigation

```help_navigate
help_navigate(url: "/settings")
```
