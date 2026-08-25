/**
 * Behavioural guard for the shell-completion templates.
 *
 * The static coverage test next door proves every subcommand is *mentioned*.
 * This one proves the completions still fire once flags are on the line — the
 * failure the templates actually shipped with: `quilltap docs --instance
 * Friday <TAB>` offered nothing, because the verb was looked up by counting
 * words rather than by parsing them.
 *
 * Bash is driven for real (source the script, set COMP_WORDS/COMP_CWORD, read
 * COMPREPLY back). Zsh's completion system can only be driven from inside a
 * completion widget, so its template is checked structurally instead.
 *
 * The one zsh assertion that needs a real `zsh` — the parse check — skips
 * where the shell isn't installed. Bash is on every machine that runs this
 * suite; zsh is not (GitHub's ubuntu runners ship without it, which is why
 * CI's test job installs it before calling jest).
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const COMPLETION_DIR = path.join(__dirname, '..', 'completion');

/** A `quilltap` on PATH that answers the completion lookups deterministically. */
function makeStubBin() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quilltap-completion-'));
  const stub = path.join(dir, 'quilltap');
  fs.writeFileSync(
    stub,
    [
      '#!/bin/sh',
      'case "$*" in',
      '  *"instances list --names-only"*) printf "StubInstance\\n" ;;',
      '  *"docs list --names-only"*) printf "Stub Store\\nOther Store\\n" ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 }
  );
  return dir;
}

const STUB_BIN = makeStubBin();
afterAll(() => fs.rmSync(STUB_BIN, { recursive: true, force: true }));

/** Whether a real `zsh` exists to hand a script to. */
const HAS_ZSH = (() => {
  try {
    execFileSync('zsh', ['-c', ':'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/**
 * Complete `line` with the bash template and return the candidate list.
 * A trailing space means "start a new word", exactly as at a real prompt.
 */
function bashComplete(line) {
  const script = `
    source ${JSON.stringify(path.join(COMPLETION_DIR, 'bash.template'))}
    COMP_LINE=${JSON.stringify(line)}
    COMP_POINT=\${#COMP_LINE}
    eval "COMP_WORDS=(\$COMP_LINE)"
    [[ "\$COMP_LINE" =~ [[:space:]]$ ]] && COMP_WORDS+=("")
    COMP_CWORD=\$(( \${#COMP_WORDS[@]} - 1 ))
    _quilltap_complete
    printf '%s\\n' "\${COMPREPLY[@]}"
  `;
  return execFileSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${STUB_BIN}:${process.env.PATH}` },
  })
    .split('\n')
    .filter(Boolean);
}

describe('bash completion survives flags on the line', () => {
  it('offers docs verbs with no flags', () => {
    expect(bashComplete('quilltap docs ')).toContain('list');
  });

  it.each([
    ['an instance flag', 'quilltap docs --instance Friday '],
    ['a short instance flag', 'quilltap docs -i Friday '],
    ['a subcommand flag that takes a value', 'quilltap docs --limit 5 '],
    ['a valueless flag', 'quilltap docs --json '],
    ['flags on both sides', 'quilltap --instance Friday docs --json '],
  ])('still offers docs verbs after %s', (_label, line) => {
    expect(bashComplete(line)).toContain('list');
  });

  it('still offers db verbs after a flag', () => {
    expect(bashComplete('quilltap db --limit 5 ')).toContain('characters');
  });

  it('still offers db characters verbs after a flag', () => {
    expect(bashComplete('quilltap db characters --instance Friday ')).toContain('status');
  });

  it('treats -i as --ignore-case under memories, not --instance', () => {
    const got = bashComplete('quilltap memories -i ');
    expect(got).toContain('ls');
    expect(got).not.toContain('StubInstance');
  });
});

describe('bash completion looks up names against the addressed instance', () => {
  it('completes --mount from the document stores', () => {
    expect(bashComplete('quilltap docs --mount ')).toContain('Stub\\ Store');
  });

  it('completes a store positional for verbs that take one', () => {
    expect(bashComplete('quilltap docs ls ')).toContain('Stub\\ Store');
  });

  it('completes the destination store of a move', () => {
    expect(bashComplete('quilltap docs move Src a.md ')).toContain('Stub\\ Store');
  });

  it('does not offer stores where the verb takes none', () => {
    expect(bashComplete('quilltap docs find ')).not.toContain('Stub\\ Store');
  });
});

describe('zsh completion parses positions instead of counting words', () => {
  const tpl = fs.readFileSync(path.join(COMPLETION_DIR, 'zsh.template'), 'utf8');

  it('has no hard-coded word-index tests', () => {
    // `(( CURRENT == 2 ))` is the bug: it only holds when the verb sits
    // immediately after the subcommand, so any preceding flag hides it.
    expect(tpl).not.toMatch(/\(\(\s*CURRENT\s*==/);
  });

  it('stops the top-level _arguments swallowing flags typed after the subcommand', () => {
    // Without the (-) prefixes the rest-argument array comes back empty and
    // _quilltap_subcommand has nothing to dispatch on.
    expect(tpl).toContain("'(-): :->subcommand'");
    expect(tpl).toContain("'(-)*::arg:->args'");
  });

  it('hands every subcommand verb to _arguments as a positional', () => {
    const dispatchers = tpl.match(/'\(?-?\)?1: :->\w+'/g) || [];
    expect(dispatchers.length).toBeGreaterThanOrEqual(6);
  });

  // Needs the shell itself; skipped rather than failed where it is absent.
  (HAS_ZSH ? it : it.skip)('is syntactically valid', () => {
    const file = path.join(STUB_BIN, '_quilltap');
    fs.writeFileSync(file, tpl);
    expect(() => execFileSync('zsh', ['-n', file], { stdio: 'pipe' })).not.toThrow();
  });
});
