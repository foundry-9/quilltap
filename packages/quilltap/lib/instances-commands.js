'use strict';

// CLI entry-point for `quilltap instances <verb> [...]`.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const {
  getInstancesPath,
  listInstances,
  readInstances,
  resolveInstance,
  upsertInstance,
  removeInstance,
  setInstancePassphrase,
  setDefaultInstance,
  clearDefaultInstance,
  getDefaultInstance,
  renameInstance,
  verifyPassphrase,
  expandPath,
} = require('./instances');
const { promptPassphrase } = require('./db-helpers');

function printHelp() {
  console.log(`
Quilltap Instance Registry

Usage: quilltap instances <verb> [args]

Verbs:
  list [--json]                 List registered instances (default)
  show <name>                   Show one instance (passphrase status only)
  path                          Print the path to instances.json
  add <name> [<path>]           Register an instance (prompts for missing path / passphrase)
  remove <name>                 Forget an instance (alias: rm, delete)
  set-passphrase <name>         Change or clear the stored passphrase
  default [<name>]              Set/show/clear default instance
  rename <old> <new>            Rename an instance (preserves passphrase)
  restore-key <name>            Rebuild a lost/locked .dbkey from the pepper
  -h, --help                    This help

Storage: ~/Library/Application Support/Quilltap/instances.json on macOS,
~/.quilltap/instances.json on Linux, %APPDATA%\\Quilltap\\instances.json on
Windows. The file is created with mode 0600 and refused to load if group or
other permissions are set.

Once an instance is registered, every CLI subcommand that accepts --data-dir
will also accept --instance <name>:

  quilltap --instance Friday                # start the server pointed at Friday
  quilltap db --instance Ignite schema characters
  quilltap docs --instance Lebanon list

Default Instance:
  When no --instance or --data-dir is specified, the CLI uses the registered
  default (if one is set), then QUILLTAP_DATA_DIR (if set), then the OS platform
  default. Marked with * in list output.

  quilltap instances default Friday          # set Friday as the default
  quilltap instances default --clear         # clear the default
  quilltap instances default                 # show the current default

Rebuilding a .dbkey:
  The .dbkey file only WRAPS the pepper — the pepper itself is the database
  key. So if the file is lost, or its passphrase is forgotten, an operator who
  still has the pepper can rebuild it:

  quilltap instances restore-key Friday          # pepper from the environment,
                                                 #   or a hidden prompt
  quilltap instances restore-key Friday --no-passphrase --yes

  The pepper is read from ENCRYPTION_MASTER_PEPPER or prompted for, never
  passed as a flag (a command line lands in shell history and in ps output). It is
  proved against the encrypted databases on disk before anything is written,
  and the command refuses while the instance lock is held, so run it with the
  server down. Flags: --passphrase <pass>, --no-passphrase, --data-dir <path>,
  --force (no encrypted database to prove against), --yes.

Examples:
  quilltap instances add Friday ~/iCloud/Quilltap/Friday
  quilltap instances add Ignite ~/iCloud/Quilltap/Ignite     # prompts for passphrase
  quilltap instances set-passphrase Ignite                    # prompts hidden
  quilltap instances remove Friday-External
  quilltap instances rename Friday FridayDev
  quilltap instances default Friday
  quilltap instances list
`);
}

function promptLine(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function promptHiddenWithConfirm(label) {
  const first = await promptPassphrase(`${label}: `);
  if (!first) return '';
  const second = await promptPassphrase(`${label} (confirm): `);
  if (first !== second) {
    throw new Error('Passphrases did not match.');
  }
  return first;
}

function formatRow(name, instancePath, hasPassphrase, isDefault) {
  const tag = hasPassphrase ? '[passphrase set]' : '[no passphrase]';
  const marker = isDefault ? '*' : ' ';
  return `${marker} ${name.padEnd(20)}  ${tag.padEnd(18)}  ${instancePath}`;
}

function cmdList(opts = {}) {
  const entries = listInstances();
  if (opts.namesOnly) {
    // Hidden flag for completion: print one name per line
    for (const entry of entries) {
      console.log(entry.name);
    }
    return;
  }
  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  console.log(`Instances file: ${getInstancesPath()}`);
  if (entries.length === 0) {
    console.log('No instances registered. Add one with `quilltap instances add <name>`.');
    return;
  }
  console.log('');
  console.log(`* ${'NAME'.padEnd(20)}  ${'PASSPHRASE'.padEnd(18)}  PATH`);
  for (const entry of entries) {
    console.log(formatRow(entry.name, entry.path, entry.hasPassphrase, entry.isDefault));
  }
}

function cmdShow(name) {
  if (!name) {
    console.error('Usage: quilltap instances show <name>');
    process.exit(1);
  }
  const inst = resolveInstance(name);
  console.log(`Name:        ${inst.name}`);
  console.log(`Path:        ${inst.path}`);
  console.log(`Passphrase:  ${inst.passphrase ? 'set' : 'not set'}`);

  const dataDir = path.join(inst.path, 'data');
  const dbkey = path.join(dataDir, 'quilltap.dbkey');
  const mainDb = path.join(dataDir, 'quilltap.db');
  console.log(`Data dir:    ${dataDir}${fs.existsSync(dataDir) ? '' : ' (missing)'}`);
  console.log(`.dbkey:      ${fs.existsSync(dbkey) ? 'present' : 'missing'}`);
  console.log(`quilltap.db: ${fs.existsSync(mainDb) ? 'present' : 'missing'}`);
}

function cmdPath() {
  console.log(getInstancesPath());
}

async function cmdAdd(args) {
  const [rawName, rawPath] = args;
  let name = rawName;
  let instancePath = rawPath;

  if (!name) {
    name = (await promptLine('Instance name: ')).trim();
    if (!name) {
      console.error('Aborted: no name provided.');
      process.exit(1);
    }
  }
  if (!instancePath) {
    instancePath = (await promptLine(`Path for "${name}" (instance root, contains data/files/logs): `)).trim();
    if (!instancePath) {
      console.error('Aborted: no path provided.');
      process.exit(1);
    }
  }

  const expanded = expandPath(instancePath);
  if (!fs.existsSync(expanded)) {
    const proceed = (await promptLine(`Path "${expanded}" does not exist. Save anyway? [y/N] `)).trim().toLowerCase();
    if (proceed !== 'y' && proceed !== 'yes') {
      console.error('Aborted.');
      process.exit(1);
    }
  }

  const wantPass = (await promptLine('Record a passphrase for this instance? [y/N] ')).trim().toLowerCase();
  let passphrase = '';
  if (wantPass === 'y' || wantPass === 'yes') {
    passphrase = await promptHiddenWithConfirm('Passphrase');
    if (!passphrase) {
      console.log('Empty passphrase — not recording one.');
    } else {
      const state = await verifyPassphrase(expanded, passphrase);
      if (state === 'valid') {
        console.log('Passphrase verified against .dbkey.');
      } else if (state === 'wrong') {
        console.error('Passphrase does not unlock this instance\'s .dbkey. Not saving.');
        process.exit(1);
      } else if (state === 'no-encryption') {
        console.error('This instance\'s .dbkey does not require a passphrase. Not saving.');
        process.exit(1);
      } else if (state === 'no-dbkey') {
        console.log('No .dbkey on disk yet — passphrase will be saved without verification.');
      }
    }
  }

  const key = upsertInstance(name, { instancePath, passphrase });
  console.log(`Saved instance "${key}" → ${getInstancesPath()}`);
}

function cmdRemove(args) {
  const [name] = args;
  if (!name) {
    console.error('Usage: quilltap instances remove <name>');
    process.exit(1);
  }
  const key = removeInstance(name);
  console.log(`Removed instance "${key}".`);
}

async function cmdSetPassphrase(args) {
  const [name] = args;
  if (!name) {
    console.error('Usage: quilltap instances set-passphrase <name>');
    process.exit(1);
  }
  const inst = resolveInstance(name);

  const wantClear = (await promptLine('Clear stored passphrase? [y/N] ')).trim().toLowerCase();
  if (wantClear === 'y' || wantClear === 'yes') {
    setInstancePassphrase(inst.name, '');
    console.log(`Cleared passphrase for "${inst.name}".`);
    return;
  }

  const passphrase = await promptHiddenWithConfirm('New passphrase');
  if (!passphrase) {
    console.log('Empty passphrase — not changing the existing entry. Use the "clear" prompt above to remove it.');
    return;
  }

  const state = await verifyPassphrase(inst.path, passphrase);
  if (state === 'valid') {
    console.log('Passphrase verified against .dbkey.');
  } else if (state === 'wrong') {
    console.error('Passphrase does not unlock this instance\'s .dbkey. Not saving.');
    process.exit(1);
  } else if (state === 'no-encryption') {
    console.error('This instance\'s .dbkey does not require a passphrase. Not saving.');
    process.exit(1);
  } else if (state === 'no-dbkey') {
    console.log('No .dbkey on disk yet — passphrase will be saved without verification.');
  }

  setInstancePassphrase(inst.name, passphrase);
  console.log(`Updated passphrase for "${inst.name}".`);
}

function cmdDefault(args, opts = {}) {
  if (args.length === 0) {
    const current = getDefaultInstance();
    if (opts.json) {
      console.log(JSON.stringify({ defaultInstance: current }));
    } else if (current) {
      console.log(current);
    } else {
      console.log('(none)');
    }
    return;
  }
  const [name] = args;
  if (name === '--clear') {
    clearDefaultInstance();
    console.log('Cleared default instance.');
    return;
  }
  const key = setDefaultInstance(name);
  console.log(`Set default instance to "${key}".`);
}

function cmdRename(args) {
  if (args.length < 2) {
    console.error('Usage: quilltap instances rename <old> <new>');
    process.exit(1);
  }
  const [oldName, newName] = args;
  const { oldKey, newKey } = renameInstance(oldName, newName);
  console.log(`Renamed instance "${oldKey}" → "${newKey}".`);
}

// Rebuild the instance's .dbkey from the pepper — see lib/dbkey-restore.js
// for why the pepper never arrives as a flag and why the write is proved first.
async function cmdRestoreKey(args) {
  const opts = { name: '', dataDir: '', passphrase: undefined, noPassphrase: false, force: false, yes: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '-d': case '--data-dir': opts.dataDir = args[++i]; break;
      case '--passphrase': opts.passphrase = args[++i]; break;
      case '--no-passphrase': opts.noPassphrase = true; break;
      case '--force': opts.force = true; break;
      case '-y': case '--yes': opts.yes = true; break;
      default:
        if (a.startsWith('-')) throw new Error(`Unknown flag: ${a}`);
        if (opts.name) throw new Error('Specify one instance.');
        opts.name = a;
        break;
    }
  }
  if (!opts.name && !opts.dataDir) {
    console.error('Usage: quilltap instances restore-key <name> | --data-dir <instance-root>');
    process.exit(1);
  }
  const { restoreKey } = require('./dbkey-restore');
  await restoreKey(opts);
}

async function instancesCommand(args) {
  if (args.length === 0) {
    cmdList();
    return;
  }
  const verb = args[0];
  const rest = args.slice(1);

  try {
    switch (verb) {
      case '-h':
      case '--help':
      case 'help':
        printHelp();
        return;
      case 'list':
      case 'ls': {
        const namesOnly = rest.includes('--names-only');
        const json = rest.includes('--json');
        cmdList({ namesOnly, json });
        return;
      }
      case 'show':
        cmdShow(rest[0]);
        return;
      case 'path':
      case 'where':
        cmdPath();
        return;
      case 'add':
      case 'create':
        await cmdAdd(rest);
        return;
      case 'remove':
      case 'rm':
      case 'delete':
        cmdRemove(rest);
        return;
      case 'set-passphrase':
      case 'passphrase':
        await cmdSetPassphrase(rest);
        return;
      case 'default': {
        // `--json` has to be lifted out of the positionals as well as read:
        // cmdDefault treats args[0] as the instance name to set, so leaving the
        // flag in place made `instances default --json` try to set an instance
        // literally named "--json" and left cmdDefault's json branch unreachable.
        const json = rest.includes('--json');
        cmdDefault(rest.filter((a) => a !== '--json'), { json });
        return;
      }
      case 'rename':
        cmdRename(rest);
        return;
      case 'restore-key':
      case 'rebuild-key':
        await cmdRestoreKey(rest);
        return;
      default:
        console.error(`Unknown instances verb: ${verb}`);
        console.error('Run "quilltap instances --help" for usage.');
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { instancesCommand };
