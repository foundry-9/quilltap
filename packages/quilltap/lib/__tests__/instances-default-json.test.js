/**
 * Bug 120 — `quilltap instances default --json`.
 *
 * `cmdDefault` takes BOTH an options object and a positional instance name, so
 * the dispatcher has to strip `--json` as well as read it. Reading without
 * stripping leaves `args.length === 1`, which sends control past the report
 * branch and into the set branch, where the flag becomes the instance name to
 * set. `cmdList`, whose shape this arm was copied from, has no positionals and
 * so needs no filter — which is exactly why the missing step looked complete.
 *
 * Driven through the real binary so the arg parsing under test is the arg
 * parsing that ships. HOME is redirected per-test, so the registry these cases
 * read and write is a throwaway one and never the developer's own.
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BIN = path.join(__dirname, '..', '..', 'bin', 'quilltap.js');

let home;

function run(...args) {
  return execFileSync(process.execPath, [BIN, 'instances', ...args], {
    encoding: 'utf8',
    input: '',
    env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData') },
  }).trim();
}

/**
 * `instances add` always prompts for a passphrase, so register through stdin.
 * The directory is created first — otherwise a second "save anyway?" prompt
 * consumes the answer meant for the passphrase question.
 */
function addInstance(name) {
  const dir = path.join(home, name.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(process.execPath, [BIN, 'instances', 'add', name, dir], {
    encoding: 'utf8',
    input: 'n\n',
    env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData') },
  });
  return dir;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-inst-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('instances default --json', () => {
  it('reports null on an empty registry instead of hunting for an instance named "--json"', () => {
    const out = run('default', '--json');
    expect(JSON.parse(out)).toEqual({ defaultInstance: null });
    // The bug 120 failure mode, spelled out so a regression is unambiguous.
    expect(out).not.toMatch(/Unknown instance/);
  });

  it('reports the registered default as JSON', () => {
    addInstance('Friday');
    run('default', 'Friday');
    expect(JSON.parse(run('default', '--json'))).toEqual({ defaultInstance: 'Friday' });
  });

  it('leaves the set path alone — a name still sets, with or without the flag', () => {
    addInstance('Friday');
    expect(run('default', 'Friday')).toMatch(/Set default instance to "Friday"/);
    expect(run('default')).toBe('Friday');
    expect(run('default', 'Friday', '--json')).toMatch(/Set default instance to "Friday"/);
  });

  it('still prints the plain report with no flag', () => {
    expect(run('default')).toBe('(none)');
  });
});

describe('instances list --json', () => {
  it('emits the registry as an array', () => {
    expect(JSON.parse(run('list', '--json'))).toEqual([]);
    addInstance('Friday');
    const [entry] = JSON.parse(run('list', '--json'));
    expect(entry).toMatchObject({ name: 'Friday', hasPassphrase: false });
  });
});

describe('the flags the help text advertises actually parse', () => {
  // The completion-coverage suite checks help -> templates. This checks the
  // other direction for the two flags bug 120 was about: that a flag the help
  // names is one the parser honours.
  it('names --json on the list verb in `instances --help`', () => {
    const help = execFileSync(process.execPath, [BIN, 'instances', '--help'], { encoding: 'utf8' });
    expect(help).toMatch(/^\s*list \[--json\]/m);
  });
});
