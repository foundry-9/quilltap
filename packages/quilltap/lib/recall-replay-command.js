'use strict';

/**
 * `quilltap recall-replay <chatId>` — replay a turn's memory recall against
 * the running server and print the candidate table, old path (episodic
 * signals inert) vs. new path (retrospective flip + time window + entity
 * anchors + multi-probe) side by side.
 *
 * Thin wrapper over POST /api/v1/chats/<chatId>?action=recall-replay.
 * Read-only; nothing is persisted server-side.
 */

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function printRecallReplayHelp() {
  console.log(`
Quilltap recall-replay Tool

Usage: quilltap recall-replay <chatId> [options]

Replays the per-turn memory recall for a chat turn against the running
Quilltap server and prints the full candidate table twice — the pre-overhaul
ranking and the episodic (retrospective/time-window/entity) ranking — so the
recall constants can be tuned against real "the character forgot" turns.

Options:
      --turn <number>        1-based interchange to replay at (default: last)
      --char <characterId>   Character whose memories are searched
                             (default: first LLM-controlled participant)
      --limit <number>       Candidate rows per path (default: 25, max: 100)
      --port <number>        Server port for API calls (default: 3000)
      --json                 Print the raw JSON result instead of tables
  -h, --help                 Show this help

Examples:
  quilltap recall-replay <chatId>
  quilltap recall-replay <chatId> --turn 42
  quilltap recall-replay <chatId> --turn 42 --json > replay.json
`);
}

function parseFlags(args) {
  const flags = { turn: undefined, char: undefined, limit: undefined, port: 3000, json: false, help: false };
  const positional = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    switch (a) {
      case '--turn': {
        const n = parseInt(args[++i], 10);
        if (isNaN(n) || n < 1) {
          console.error('Error: --turn must be a positive integer');
          process.exit(1);
        }
        flags.turn = n;
        break;
      }
      case '--char':
        flags.char = args[++i];
        break;
      case '--limit': {
        const n = parseInt(args[++i], 10);
        if (isNaN(n) || n < 1 || n > 100) {
          console.error('Error: --limit must be between 1 and 100');
          process.exit(1);
        }
        flags.limit = n;
        break;
      }
      case '--port': {
        const p = parseInt(args[++i], 10);
        if (isNaN(p) || p < 1 || p > 65535) {
          console.error('Error: --port must be between 1 and 65535');
          process.exit(1);
        }
        flags.port = p;
        break;
      }
      case '--json':
        flags.json = true;
        break;
      case '-h':
      case '--help':
        flags.help = true;
        break;
      default:
        if (a.startsWith('-')) {
          console.error(`Unknown option: ${a}`);
          process.exit(1);
        }
        positional.push(a);
    }
    i++;
  }
  return { flags, positional };
}

function fmt(n, digits = 3) {
  if (n === null || n === undefined) return DIM + '—' + RESET;
  return n.toFixed(digits);
}

function printPath(label, rows) {
  console.log(`\n${BOLD}${label}${RESET} (${rows.length} candidates)`);
  if (rows.length === 0) {
    console.log(`  ${DIM}(none)${RESET}`);
    return;
  }
  const header = ['sel', 'cosine', 'blend', '×mult', 'after', 'kind', 'occurredAt', 'fired', 'summary'];
  console.log(
    `  ${DIM}${header[0].padEnd(4)}${header[1].padEnd(8)}${header[2].padEnd(8)}${header[3].padEnd(7)}${header[4].padEnd(8)}${header[5].padEnd(9)}${header[6].padEnd(12)}${header[7].padEnd(24)}${header[8]}${RESET}`
  );
  for (const row of rows) {
    const sel = row.selected ? `${GREEN}✓${RESET}  ` : '   ';
    const occurred = row.occurredAt ? row.occurredAt.slice(0, 10) : '—';
    const fired = (row.fired || []).join(' ') || '—';
    const summary = (row.summary || '').slice(0, 60);
    console.log(
      `  ${sel} ${fmt(row.cosine).padEnd(8)}${fmt(row.blendedBefore).padEnd(8)}${fmt(row.multiplier, 2).padEnd(7)}${fmt(row.blendedAfter).padEnd(8)}${(row.kind || 'semantic').padEnd(9)}${occurred.padEnd(12)}${fired.padEnd(24).slice(0, 24)}${summary}`
    );
  }
}

async function recallReplayCommand(args) {
  const { flags, positional } = parseFlags(args);

  if (flags.help || positional.length === 0) {
    printRecallReplayHelp();
    process.exit(flags.help ? 0 : 1);
  }
  if (positional.length > 1) {
    console.error('Error: only one chatId may be specified');
    process.exit(1);
  }
  const chatId = positional[0];

  const url = `http://localhost:${flags.port}/api/v1/chats/${encodeURIComponent(chatId)}?action=recall-replay`;
  const body = {};
  if (flags.turn !== undefined) body.turnIndex = flags.turn;
  if (flags.char) body.characterId = flags.char;
  if (flags.limit !== undefined) body.limit = flags.limit;

  process.stderr.write(`${BOLD}Replaying recall${RESET} for chat ${DIM}${chatId}${RESET} via ${DIM}${url}${RESET}\n`);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`${RED}Could not reach Quilltap server at http://localhost:${flags.port}: ${err.message}${RESET}`);
    console.error('Start the server (npm run dev) or pass --port to match a non-default port.');
    process.exit(1);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    console.error(`${RED}Server returned a non-JSON response (status ${res.status})${RESET}`);
    process.exit(1);
  }
  if (!res.ok || payload?.success === false) {
    console.error(`${RED}Replay failed (status ${res.status}): ${payload?.error || payload?.message || 'unknown error'}${RESET}`);
    process.exit(1);
  }

  const result = payload.data ?? payload;
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`\n${BOLD}Chat${RESET}      ${result.chatId}`);
  console.log(`${BOLD}Character${RESET} ${result.characterName} ${DIM}(${result.characterId})${RESET}`);
  console.log(`${BOLD}Turn${RESET}      ${result.turnIndex} of ${result.totalTurns}  ${DIM}(clock ${result.clockIso})${RESET}`);
  console.log(`${BOLD}Query${RESET}     ${result.query}`);
  const s = result.signals;
  if (s) {
    const retro = s.retrospective ? `${GREEN}retrospective${RESET}` : `${DIM}not retrospective${RESET}`;
    const range = s.timeRange ? `${s.timeRange.from.slice(0, 10)} → ${s.timeRange.to.slice(0, 10)}` : '—';
    const entities = (s.entities || []).join(', ') || '—';
    console.log(`${BOLD}Signals${RESET}   ${retro} · timeRange ${CYAN}${range}${RESET} · entities ${CYAN}${entities}${RESET}`);
  } else {
    console.log(`${BOLD}Signals${RESET}   ${YELLOW}distillation failed — new path ran inert${RESET}`);
  }

  printPath('OLD PATH (episodic signals inert)', result.oldPath || []);
  printPath('NEW PATH (retrospective/window/entities live)', result.newPath || []);
  console.log('');
}

module.exports = { recallReplayCommand };
