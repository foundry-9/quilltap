/**
 * Guard test: the shell-completion templates and the top-level `--help` must
 * stay in sync with the real subcommand dispatch table in bin/quilltap.js.
 *
 * This is the check that was missing when the docs/completions drifted behind
 * the CLI (e.g. the `maintenance` subcommand shipped without ever being added
 * to any completion script or to `quilltap --help`). If you add a top-level
 * subcommand to SUBCOMMANDS, this test fails until you also teach the three
 * completion templates and printHelp() about it.
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BIN = path.join(__dirname, '..', '..', 'bin', 'quilltap.js');
const COMPLETION_DIR = path.join(__dirname, '..', 'completion');

function readBin() {
  return fs.readFileSync(BIN, 'utf8');
}

/** Parse the authoritative `const SUBCOMMANDS = new Set([...])` literal. */
function readSubcommands(src) {
  const m = src.match(/const SUBCOMMANDS = new Set\(\[([\s\S]*?)\]\)/);
  if (!m) throw new Error('Could not locate SUBCOMMANDS set in bin/quilltap.js');
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

const SRC = readBin();
const SUBCOMMANDS = readSubcommands(SRC);

describe('CLI subcommand surface stays documented', () => {
  it('parses a non-trivial subcommand set from bin/quilltap.js', () => {
    expect(SUBCOMMANDS).toContain('db');
    expect(SUBCOMMANDS).toContain('maintenance');
    expect(SUBCOMMANDS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(['bash', 'zsh', 'fish'])(
    '%s completion template lists every top-level subcommand',
    (shell) => {
      const tpl = fs.readFileSync(path.join(COMPLETION_DIR, `${shell}.template`), 'utf8');
      const missing = SUBCOMMANDS.filter((sub) => !tpl.includes(sub));
      expect(missing).toEqual([]);
    }
  );

  it('top-level --help lists every subcommand', () => {
    const help = SRC.match(/function printHelp\(\) \{([\s\S]*?)\n\}/);
    expect(help).toBeTruthy();
    const missing = SUBCOMMANDS.filter((sub) => !help[1].includes(sub));
    expect(missing).toEqual([]);
  });
});

/**
 * A bare substring match is too weak: a subcommand named only in a shared
 * `case` list still tab-completes its own flags as nothing. These check that
 * each shell actually has a per-subcommand completion arm — the gap that let
 * `file-verify` (all three shells) and `recall-replay` (fish) ship with the
 * verb completing but none of its flags.
 */
describe('every subcommand has its own completion arm', () => {
  function template(shell) {
    return fs.readFileSync(path.join(COMPLETION_DIR, `${shell}.template`), 'utf8');
  }

  it('bash has a case arm per subcommand', () => {
    const tpl = template('bash');
    const missing = SUBCOMMANDS.filter((sub) => !new RegExp(`^\\s*${sub}\\)\\s*$`, 'm').test(tpl));
    expect(missing).toEqual([]);
  });

  it('zsh dispatches every subcommand from _quilltap_subcommand', () => {
    const tpl = template('zsh');
    const body = tpl.match(/_quilltap_subcommand\(\) \{([\s\S]*?)\n\}/);
    expect(body).toBeTruthy();
    const missing = SUBCOMMANDS.filter((sub) => !new RegExp(`^\\s*${sub}\\)\\s*$`, 'm').test(body[1]));
    expect(missing).toEqual([]);
  });

  it('fish offers every subcommand at top level and completes inside it', () => {
    const tpl = template('fish');
    const notOffered = SUBCOMMANDS.filter((sub) => !tpl.includes(`-a '${sub}'`));
    expect(notOffered).toEqual([]);
    const noFlags = SUBCOMMANDS.filter((sub) => !tpl.includes(`__quilltap_using_subcommand ${sub}'`));
    expect(noFlags).toEqual([]);
  });
});

/**
 * The arm-per-subcommand check above is still too coarse: `docs docker-mounts`
 * had its own arm in all three shells while `--format`, its only flag, was
 * offered by none of them. A flag documented in a subcommand's own `--help` is
 * the contract the user reads, so that text is the source of truth here —
 * whatever `--help` advertises, the three templates must offer.
 *
 * Each entry names the single function whose template literal prints that
 * subcommand's help.
 */
const HELP_SOURCES = {
  db: ['bin/quilltap.js', 'printDbHelp'],
  docs: ['lib/docs-commands.js', 'printDocsHelp'],
  memories: ['lib/memories-commands.js', 'printMemoriesHelp'],
  themes: ['lib/theme-commands.js', 'printHelp'],
  instances: ['lib/instances-commands.js', 'printHelp'],
  logs: ['lib/logs-commands.js', 'printLogsHelp'],
  migrations: ['lib/migrations-commands.js', 'printHelp'],
  maintenance: ['lib/maintenance-commands.js', 'printHelp'],
  'file-verify': ['lib/file-verify-commands.js', 'printHelp'],
  'memory-diff': ['lib/memory-diff-command.js', 'printMemoryDiffHelp'],
  'recall-replay': ['lib/recall-replay-command.js', 'printRecallReplayHelp'],
  completion: ['lib/completion-commands.js', 'printCompletionHelp'],
};

const PKG_ROOT = path.join(__dirname, '..', '..');

/**
 * Long flags named anywhere in one subcommand's help text. The declaration
 * pattern tolerates arbitrary whitespace and an `async`/parameter list, so
 * reformatting a help function does not fail a test about its content.
 */
function flagsInHelp(relPath, fnName) {
  const src = fs.readFileSync(path.join(PKG_ROOT, relPath), 'utf8');
  const decl = String.raw`(?:async\s+)?function\s+${fnName}\s*\([^)]*\)\s*\{`;
  const body = src.match(new RegExp(`${decl}([\\s\\S]*?)\\n\\}`));
  if (!body) throw new Error(`Could not locate ${fnName}() in ${relPath}`);
  return [...new Set(body[1].match(/--[a-z0-9][a-z0-9-]+/g) || [])].sort();
}

/**
 * `--max` is a prefix of `--max-nodes`, so a plain substring test passes for a
 * flag that is not actually there. Require the match to end at a non-flag
 * character.
 */
function mentionsFlag(haystack, flag) {
  return new RegExp(`${flag}(?![a-z0-9-])`).test(haystack);
}

describe('completions offer every flag the help text advertises', () => {
  it('covers every subcommand in the dispatch table', () => {
    // A new subcommand needs a help source here, or its flags go unchecked.
    expect(Object.keys(HELP_SOURCES).sort()).toEqual([...SUBCOMMANDS].sort());
  });

  const cases = Object.entries(HELP_SOURCES).flatMap(([sub, [file, fn]]) =>
    ['bash', 'zsh', 'fish'].map((shell) => [sub, shell, file, fn])
  );

  it.each(cases)('%s: %s template offers every documented flag', (sub, shell, file, fn) => {
    const tpl = fs.readFileSync(path.join(COMPLETION_DIR, `${shell}.template`), 'utf8');
    // fish spells the flag `-l 'name'`, already an exact quoted token.
    const present = (flag) =>
      shell === 'fish' ? tpl.includes(`-l '${flag.slice(2)}'`) : mentionsFlag(tpl, flag);
    const missing = flagsInHelp(file, fn).filter((flag) => !present(flag));
    expect(missing).toEqual([]);
  });
});

/**
 * bash cannot infer which flags swallow the next word, so it carries explicit
 * `vf_*` lists. A valued flag missing from its list makes the flag's value look
 * like the subcommand's verb — the bug 101 failure mode. zsh and fish take the
 * value from the flag's own spec, so only bash needs guarding.
 */
describe('bash knows which docs flags take a value', () => {
  it('lists every valued docs flag in vf_docs', () => {
    const tpl = fs.readFileSync(path.join(COMPLETION_DIR, 'bash.template'), 'utf8');
    // The scanner reads `$vf_global$vf_docs`, so a flag in either list counts.
    const vfGlobal = tpl.match(/local vf_global="([^"]*)"/);
    const vfDocs = tpl.match(/local vf_docs="([^"]*)"/);
    expect(vfGlobal).toBeTruthy();
    expect(vfDocs).toBeTruthy();
    const scanned = new Set(`${vfGlobal[1]} ${vfDocs[1]}`.trim().split(/\s+/));
    // A docs flag zsh declares with a `:value:` spec is by definition valued.
    const zsh = fs.readFileSync(path.join(COMPLETION_DIR, 'zsh.template'), 'utf8');
    const docsOpts = zsh.match(/docs_opts=\(([\s\S]*?)\n  \)/);
    expect(docsOpts).toBeTruthy();
    const valued = [...docsOpts[1].matchAll(/'(--[a-z0-9-]+)\[[^\]]*\]:[^']*'/g)].map((m) => m[1]);
    expect(valued.length).toBeGreaterThan(5);
    const missing = valued.filter((flag) => !scanned.has(flag));
    expect(missing).toEqual([]);
  });
});
