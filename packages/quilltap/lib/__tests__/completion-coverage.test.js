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
