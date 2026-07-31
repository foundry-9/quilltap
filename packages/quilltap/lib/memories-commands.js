'use strict';

const {
  resolveDataDirAndPassphrase,
  printDefaultInstanceHint,
  loadDbKey,
  openMainDb,
  openMountIndexDb,
  UUID_RE,
  resolveCharacter,
  resolveChat,
  resolveProject,
} = require('./db-helpers');
const { scanDanglingEdges } = require('./graph-integrity');

// ---------- colour & marker helpers ----------

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

function isTty() {
  return Boolean(process.stdout.isTTY);
}

function colorize(text, color) {
  if (!isTty()) return text;
  return `${color}${text}${RESET}`;
}

function importanceColor(v) {
  if (v == null) return DIM;
  if (v >= 0.7) return GREEN;
  if (v >= 0.4) return YELLOW;
  return DIM + RED;
}

function formatImportance(v) {
  if (v == null) return '   -';
  const s = Number(v).toFixed(2);
  return s.padStart(4);
}

// ---------- argument parsing ----------

const SORT_FIELDS = new Set([
  'reinforced', 'importance', 'created', 'accessed', 'reinforcement-count', 'links',
]);

function parseFlags(args) {
  const flags = {
    // globals
    dataDir: '',
    instance: '',
    passphrase: '',
    json: false,
    help: false,
    // shared filters
    character: '',
    about: '',
    source: '',
    chat: '',
    project: '',
    since: '',
    until: '',
    minImportance: null,
    minReinforced: null,
    hasEmbedding: null,        // null = unset, true / false otherwise
    // ls / find / grep
    sort: '',
    reverse: false,
    limit: 0,
    fullTitles: false,
    // find
    findIn: '',
    // grep
    ignoreCase: false,
    pathsOnly: false,
    max: 0,
    context: 0,
    // show / tree
    depth: -1,
    maxNodes: 0,
    noRelated: false,
    // validate
    list: false,
    // semantic search
    semantic: false,
    top: 0,
    threshold: -1,
    port: 3000,
  };
  const positional = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    switch (a) {
      case '-d': case '--data-dir': flags.dataDir = args[++i]; break;
      case '--instance': flags.instance = args[++i]; break;
      case '--passphrase': flags.passphrase = args[++i]; break;
      case '--json': flags.json = true; break;
      case '-h': case '--help': flags.help = true; break;

      case '--character': flags.character = args[++i]; break;
      case '--about': flags.about = args[++i]; break;
      case '--source': flags.source = args[++i]; break;
      case '--chat': flags.chat = args[++i]; break;
      case '--project': flags.project = args[++i]; break;
      case '--since': flags.since = args[++i]; break;
      case '--until': flags.until = args[++i]; break;
      case '--min-importance': flags.minImportance = parseFloat(args[++i]); break;
      case '--min-reinforced': flags.minReinforced = parseFloat(args[++i]); break;
      case '--has-embedding': flags.hasEmbedding = true; break;
      case '--no-embedding': flags.hasEmbedding = false; break;

      case '--sort': flags.sort = args[++i]; break;
      case '-r': case '--reverse': flags.reverse = true; break;
      case '--limit': flags.limit = parseInt(args[++i], 10) || 0; break;
      case '--full-titles': flags.fullTitles = true; break;

      case '--in': flags.findIn = args[++i]; break;

      case '-i': case '--ignore-case': flags.ignoreCase = true; break;
      case '-l': case '--paths-only': flags.pathsOnly = true; break;
      case '--max': flags.max = parseInt(args[++i], 10) || 0; break;
      case '--context': flags.context = parseInt(args[++i], 10) || 0; break;

      case '--depth': flags.depth = parseInt(args[++i], 10); break;
      case '--max-nodes': flags.maxNodes = parseInt(args[++i], 10) || 0; break;
      case '--no-related': flags.noRelated = true; break;

      case '--list': flags.list = true; break;

      case '--semantic': flags.semantic = true; break;
      case '--top': flags.top = parseInt(args[++i], 10) || 0; break;
      case '--threshold': {
        const v = parseFloat(args[++i]);
        if (isNaN(v) || v < 0 || v > 1) {
          console.error('Error: --threshold must be a number between 0 and 1');
          process.exit(1);
        }
        flags.threshold = v;
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

// ---------- db open ----------

async function openDb(flags) {
  const resolved = resolveDataDirAndPassphrase({
    dataDir: flags.dataDir,
    instance: flags.instance,
    passphrase: flags.passphrase,
  });
  printDefaultInstanceHint(resolved);
  const { dataDir, passphrase } = resolved;
  const pepper = await loadDbKey(dataDir, passphrase);
  const db = openMainDb(dataDir, pepper, { readonly: true });
  // Lazy opener for the mount-index DB so `resolveCharacter` can match
  // vault-stored aliases (4.6 cutover moved them out of the `characters` row).
  const openMounts = () => openMountIndexDb(dataDir, pepper, { readonly: true });
  return { db, dataDir, openMounts };
}

// ---------- filter / sort builders ----------

// Build a SQL WHERE clause + parameters from parsed flags. Returns
// `{ where: 'WHERE m.x = ? AND ...', params: [...], meta: { characterId, ... } }`.
// `meta` exposes resolved IDs so callers can decide e.g. whether to show a
// per-row holder column.
function buildWhereClause(db, flags, openMounts = null) {
  const clauses = [];
  const params = [];
  const meta = { characterId: null, aboutId: null, chatId: null, projectId: null, allCharacters: true };

  if (flags.character && flags.character !== 'all') {
    const c = resolveCharacter(db, flags.character, openMounts);
    clauses.push('m.characterId = ?');
    params.push(c.id);
    meta.characterId = c.id;
    meta.allCharacters = false;
  }

  if (flags.about) {
    if (flags.about === 'self') {
      clauses.push('m.aboutCharacterId = m.characterId');
    } else if (flags.about === 'none') {
      clauses.push('m.aboutCharacterId IS NULL');
    } else {
      const a = resolveCharacter(db, flags.about, openMounts);
      clauses.push('m.aboutCharacterId = ?');
      params.push(a.id);
      meta.aboutId = a.id;
    }
  }

  if (flags.source) {
    const s = String(flags.source).toUpperCase();
    if (s !== 'AUTO' && s !== 'MANUAL') {
      throw new Error(`--source must be AUTO or MANUAL (got '${flags.source}')`);
    }
    clauses.push('m.source = ?');
    params.push(s);
  }

  if (flags.chat) {
    if (flags.chat === 'none') {
      clauses.push('m.chatId IS NULL');
    } else {
      const ch = resolveChat(db, flags.chat);
      clauses.push('m.chatId = ?');
      params.push(ch.id);
      meta.chatId = ch.id;
    }
  }

  if (flags.project) {
    const p = resolveProject(db, flags.project);
    clauses.push('m.projectId = ?');
    params.push(p.id);
    meta.projectId = p.id;
  }

  if (flags.since) {
    clauses.push('m.createdAt >= ?');
    params.push(flags.since);
  }
  if (flags.until) {
    clauses.push('m.createdAt <= ?');
    params.push(flags.until);
  }

  if (flags.minImportance != null && !Number.isNaN(flags.minImportance)) {
    clauses.push('m.importance >= ?');
    params.push(flags.minImportance);
  }
  if (flags.minReinforced != null && !Number.isNaN(flags.minReinforced)) {
    clauses.push('m.reinforcedImportance >= ?');
    params.push(flags.minReinforced);
  }

  if (flags.hasEmbedding === true) {
    clauses.push('m.embedding IS NOT NULL');
  } else if (flags.hasEmbedding === false) {
    clauses.push('m.embedding IS NULL');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params, meta };
}

function buildOrderBy(sortFlag, reverse) {
  // SQL ORDER BY fragment + which column the rendered `imp` field reflects.
  // Default is `reinforced`, which is what the recall path uses.
  const field = sortFlag || 'reinforced';
  let order;
  let impField = 'reinforcedImportance';
  switch (field) {
    case 'reinforced':
      order = 'm.reinforcedImportance DESC, m.createdAt DESC';
      break;
    case 'importance':
      order = 'm.importance DESC, m.createdAt DESC';
      impField = 'importance';
      break;
    case 'created':
      order = 'm.createdAt DESC';
      break;
    case 'accessed':
      order = 'COALESCE(m.lastAccessedAt, m.createdAt) DESC';
      break;
    case 'reinforcement-count':
      order = 'm.reinforcementCount DESC, m.reinforcedImportance DESC';
      break;
    case 'links':
      // SQLite's json_array_length tolerates NULL / empty arrays.
      order = "json_array_length(COALESCE(m.relatedMemoryIds, '[]')) DESC, m.reinforcedImportance DESC";
      break;
    default:
      throw new Error(`Unknown --sort field '${field}'. Valid: ${[...SORT_FIELDS].join(', ')}`);
  }
  if (reverse) {
    // Flip every DESC→ASC and ASC→DESC in the fragment.
    order = order.replace(/\bDESC\b/g, '__ASC__').replace(/\bASC\b/g, 'DESC').replace(/__ASC__/g, 'ASC');
  }
  return { order, impField };
}

// SELECT fragment that pulls every column the renderers need, including the
// joined-in character / chat names. `m.*` is followed by aliases for the joins
// so callers don't have to re-resolve UUIDs.
const SELECT_BASE = `
  SELECT
    m.id,
    m.characterId,
    m.aboutCharacterId,
    m.chatId,
    m.projectId,
    m.sourceMessageId,
    m.content,
    m.summary,
    m.keywords,
    m.tags,
    m.importance,
    m.reinforcedImportance,
    m.reinforcementCount,
    m.lastReinforcedAt,
    m.lastAccessedAt,
    m.source,
    m.relatedMemoryIds,
    m.createdAt,
    m.updatedAt,
    CASE WHEN m.embedding IS NULL THEN 0 ELSE 1 END AS hasEmbedding,
    holder.name AS holderName,
    aboutChar.name AS aboutCharName,
    chats.title AS chatTitle,
    projects.name AS projectName
  FROM memories m
  LEFT JOIN characters holder ON holder.id = m.characterId
  LEFT JOIN characters aboutChar ON aboutChar.id = m.aboutCharacterId
  LEFT JOIN chats ON chats.id = m.chatId
  LEFT JOIN projects ON projects.id = m.projectId
`;

// ---------- output helpers ----------

function truncate(str, n) {
  if (str == null) return '';
  const s = String(str);
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function aboutLabel(row) {
  if (row.aboutCharacterId == null) return '(none)';
  if (row.aboutCharacterId === row.characterId) return 'self';
  return row.aboutCharName || '(unknown)';
}

function chatLabel(row, fullTitles) {
  if (row.chatId == null) return '(manual entry)';
  const t = row.chatTitle || '(untitled)';
  return fullTitles ? t : truncate(t, 32);
}

function linkCount(row) {
  if (!row.relatedMemoryIds) return 0;
  try {
    const arr = JSON.parse(row.relatedMemoryIds);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

function shortId(id) {
  return id ? id.slice(0, 8) : '';
}

function summaryWidth() {
  const cols = process.stdout.columns || 120;
  // Reserve enough for the other columns; let summary take the rest.
  // Minimum 30, maximum 120.
  const reserved = 80;
  const w = cols - reserved;
  if (w < 30) return 30;
  if (w > 120) return 120;
  return w;
}

function renderJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

// ---------- ls ----------

async function cmdLs(flags) {
  const { db, openMounts } = await openDb(flags);
  try {
    const { where, params, meta } = buildWhereClause(db, flags, openMounts);
    const { order, impField } = buildOrderBy(flags.sort, flags.reverse);
    const limit = flags.limit > 0 ? flags.limit : 50;
    const sql = `${SELECT_BASE} ${where} ORDER BY ${order} LIMIT ?`;
    const rows = db.prepare(sql).all(...params, limit);

    if (flags.json) {
      renderJson({
        sort: impField,
        count: rows.length,
        memories: rows.map(rowToJson),
      });
      return;
    }

    renderTable(rows, { showHolder: meta.allCharacters, impField, fullTitles: flags.fullTitles });
  } finally {
    db.close();
  }
}

function rowToJson(row) {
  let keywords = [];
  let tags = [];
  let relatedMemoryIds = [];
  try { keywords = JSON.parse(row.keywords || '[]'); } catch { /* ignore */ }
  try { tags = JSON.parse(row.tags || '[]'); } catch { /* ignore */ }
  try { relatedMemoryIds = JSON.parse(row.relatedMemoryIds || '[]'); } catch { /* ignore */ }
  return {
    id: row.id,
    characterId: row.characterId,
    holder: row.holderName,
    aboutCharacterId: row.aboutCharacterId,
    aboutCharacter: row.aboutCharName,
    chatId: row.chatId,
    chatTitle: row.chatTitle,
    projectId: row.projectId,
    projectName: row.projectName,
    sourceMessageId: row.sourceMessageId,
    source: row.source,
    importance: row.importance,
    reinforcedImportance: row.reinforcedImportance,
    reinforcementCount: row.reinforcementCount,
    lastReinforcedAt: row.lastReinforcedAt,
    lastAccessedAt: row.lastAccessedAt,
    hasEmbedding: Boolean(row.hasEmbedding),
    keywords,
    tags,
    relatedMemoryIds,
    summary: row.summary,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function renderTable(rows, { showHolder, impField, fullTitles }) {
  if (rows.length === 0) {
    console.log('(no memories matched the filters)');
    return;
  }
  const impHeader = impField === 'importance' ? 'imp' : 'imp';
  const sumW = summaryWidth();

  const header = [
    showHolder ? 'holder'.padEnd(14) : null,
    impHeader.padStart(4),
    'rein'.padStart(4),
    'src'.padEnd(6),
    'about'.padEnd(20),
    'chat'.padEnd(fullTitles ? 24 : 32),
    'links'.padStart(5),
    'emb',
    'summary',
  ].filter(Boolean).join('  ');
  console.log(colorize(header, DIM));
  console.log(colorize(header.replace(/[^\s]/g, '-'), DIM));

  for (const row of rows) {
    const impVal = impField === 'importance' ? row.importance : row.reinforcedImportance;
    const impStr = colorize(formatImportance(impVal), importanceColor(impVal));
    const rein = String(row.reinforcementCount ?? 0).padStart(4);
    const src = (row.source || '').padEnd(6);
    const about = truncate(aboutLabel(row), 20).padEnd(20);
    const chat = truncate(chatLabel(row, fullTitles), fullTitles ? 24 : 32).padEnd(fullTitles ? 24 : 32);
    const links = String(linkCount(row)).padStart(5);
    const emb = row.hasEmbedding ? 'Y' : '-';
    const summary = truncate(row.summary || '', sumW);

    const cells = [
      showHolder ? truncate(row.holderName || '(?)', 14).padEnd(14) : null,
      impStr,
      rein,
      src,
      about,
      chat,
      links,
      emb,
      summary,
    ].filter(c => c !== null);
    console.log(cells.join('  '));
  }
}

// ---------- find ----------

async function cmdFind(flags, positional) {
  const pattern = positional[0];
  if (!pattern) {
    throw new Error('memories find: missing <pattern>. Usage: quilltap memories find [filters] <pattern>');
  }
  const inWhere = flags.findIn || 'summary';
  if (!['summary', 'content', 'both'].includes(inWhere)) {
    throw new Error(`--in must be one of: summary, content, both (got '${inWhere}')`);
  }
  const { db, openMounts } = await openDb(flags);
  try {
    const { where, params, meta } = buildWhereClause(db, flags, openMounts);
    const like = `%${pattern}%`;

    const matchClauses = [];
    const matchParams = [];
    if (inWhere === 'summary' || inWhere === 'both') {
      matchClauses.push('m.summary LIKE ?');
      matchParams.push(like);
    }
    if (inWhere === 'content' || inWhere === 'both') {
      matchClauses.push('m.content LIKE ?');
      matchParams.push(like);
    }
    const matchSql = `(${matchClauses.join(' OR ')})`;

    let order;
    let orderParams = [];
    let impField = 'reinforcedImportance';
    if (flags.sort) {
      const ob = buildOrderBy(flags.sort, flags.reverse);
      order = ob.order;
      impField = ob.impField;
    } else {
      // Relevance ranking: summary-hit > content-only-hit > then reinforced + recency.
      order = `CASE WHEN m.summary LIKE ? THEN 1 ELSE 2 END,
               m.reinforcedImportance DESC,
               m.createdAt DESC`;
      orderParams = [like];
      if (flags.reverse) {
        // Reverse the relevance dimension by inverting the CASE outcome.
        order = `CASE WHEN m.summary LIKE ? THEN 2 ELSE 1 END,
                 m.reinforcedImportance ASC,
                 m.createdAt ASC`;
      }
    }

    const limit = flags.limit > 0 ? flags.limit : 50;
    const fullWhere = where ? `${where} AND ${matchSql}` : `WHERE ${matchSql}`;
    const sql = `${SELECT_BASE} ${fullWhere} ORDER BY ${order} LIMIT ?`;
    const allParams = [...params, ...matchParams, ...orderParams, limit];
    const rows = db.prepare(sql).all(...allParams);

    if (flags.json) {
      renderJson({
        pattern,
        in: inWhere,
        count: rows.length,
        memories: rows.map(rowToJson),
      });
      return;
    }

    renderTable(rows, { showHolder: meta.allCharacters, impField, fullTitles: flags.fullTitles });
  } finally {
    db.close();
  }
}

// ---------- grep ----------

async function cmdSemanticGrep(flags, query) {
  if (!flags.character || flags.character === 'all') {
    console.error('Error: memories grep --semantic requires --character <name|id>.');
    console.error('The server search endpoint scopes results to one holder at a time.');
    process.exit(1);
  }

  // Resolve character locally so the server gets a stable UUID.
  let characterId;
  {
    const { db, openMounts } = await openDb(flags);
    try {
      const resolved = resolveCharacter(db, flags.character, openMounts);
      characterId = resolved.id;
    } finally {
      db.close();
    }
  }
  // Sanity-check: the server validates `characterId` as a UUID. If the local
  // resolution returned something else (shouldn't happen), bail early with a
  // useful message rather than letting the server emit a generic "Validation
  // error".
  if (!/^[0-9a-fA-F-]{36}$/.test(characterId)) {
    console.error(`Error: could not resolve --character to a UUID (got "${characterId}").`);
    console.error('Pass --character <name|id|all> against the same instance the dev server is running.');
    process.exit(1);
  }

  const top = flags.top > 0 ? flags.top : 20;
  const threshold = flags.threshold >= 0 ? flags.threshold : 0.5;
  const port = flags.port || 3000;
  const url = `http://localhost:${port}/api/v1/memories?action=search`;

  const body = { characterId, query, limit: top, minScore: threshold };
  if (flags.source) body.source = flags.source;
  if (flags.minImportance != null) body.minImportance = flags.minImportance;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`Could not reach Quilltap server at http://localhost:${port}: ${err.message}`);
    console.error('Semantic search requires the running server (the embedding provider lives there).');
    console.error('Start it with: npm run dev');
    process.exit(1);
  }

  let payload = null;
  try {
    const text = await res.text();
    payload = text ? JSON.parse(text) : null;
  } catch { /* leave payload null */ }

  if (!res.ok) {
    if (payload && payload.error && /dimension/i.test(payload.error)) {
      console.error(`Error: ${payload.error}`);
      console.error('Re-apply the embedding profile, or switch the active profile back to one that matches the corpus.');
      process.exit(1);
    }
    const msg = (payload && payload.error) || `HTTP ${res.status}`;
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }

  const memories = (payload && payload.memories) || [];
  if (memories.length === 0) {
    console.log('(no matches)');
    return;
  }

  for (const m of memories) {
    const score = (m.score ?? 0).toFixed(3);
    const summary = (m.summary || '').replace(/\s+/g, ' ').trim();
    const trimmed = summary.length > 100 ? summary.slice(0, 100) + '…' : summary;
    console.log(`${score}  imp ${(m.reinforcedImportance ?? m.importance ?? 0).toFixed(2)}  ${trimmed}`);
    const content = (m.content || '').replace(/\s+/g, ' ').trim();
    const snippet = content.length > 240 ? content.slice(0, 240) + '…' : content;
    if (snippet) console.log(`        ${snippet}`);
  }
  console.log('');
  console.log(`${memories.length} match${memories.length === 1 ? '' : 'es'}` +
    (payload.usedEmbedding === false ? '  (fallback keyword search — no usable embeddings)' : ''));
}

async function cmdGrep(flags, positional) {
  const pattern = positional[0];
  if (!pattern) {
    throw new Error('memories grep: missing <pattern>. Usage: quilltap memories grep [filters] <pattern>');
  }
  if (flags.semantic) {
    return cmdSemanticGrep(flags, pattern);
  }
  const { db, openMounts } = await openDb(flags);
  try {
    const { where, params } = buildWhereClause(db, flags, openMounts);
    // Always restrict to rows whose content can match — quick pre-filter so we
    // don't read all 32k rows into JS just to drop most of them.
    const likeNeedle = flags.ignoreCase ? `%${pattern.toLowerCase()}%` : `%${pattern}%`;
    const contentClause = flags.ignoreCase
      ? 'LOWER(m.content) LIKE ?'
      : 'm.content LIKE ?';
    const fullWhere = where ? `${where} AND ${contentClause}` : `WHERE ${contentClause}`;

    const limit = flags.limit > 0 ? flags.limit : 50;
    const sql = `${SELECT_BASE} ${fullWhere}
                 ORDER BY m.reinforcedImportance DESC, m.createdAt DESC
                 LIMIT ?`;
    const rows = db.prepare(sql).all(...params, likeNeedle, limit);

    const maxPerFile = flags.max > 0 ? flags.max : 5;
    const ctxLines = flags.context > 0 ? flags.context : 0;
    const results = [];

    for (const row of rows) {
      const matches = findMatches(row.content || '', pattern, {
        ignoreCase: flags.ignoreCase,
        max: maxPerFile,
        context: ctxLines,
      });
      if (matches.length === 0) continue;
      results.push({ row, matches });
    }

    if (flags.json) {
      renderJson({
        pattern,
        ignoreCase: flags.ignoreCase,
        count: results.length,
        matches: results.map(({ row, matches }) => ({
          id: row.id,
          holder: row.holderName,
          aboutCharacter: row.aboutCharName,
          chatTitle: row.chatTitle,
          importance: row.reinforcedImportance,
          matches,
        })),
      });
      return;
    }

    if (results.length === 0) {
      console.log('(no matches)');
      return;
    }

    if (flags.pathsOnly) {
      for (const { row } of results) {
        console.log(row.id);
      }
      return;
    }

    for (const { row, matches } of results) {
      const header = `${colorize(shortId(row.id), CYAN)}  (holder: ${row.holderName || '?'}, imp ${formatImportance(row.reinforcedImportance).trim()}, chat: "${truncate(chatLabel(row, flags.fullTitles), flags.fullTitles ? 60 : 32)}"):`;
      console.log(header);
      for (const m of matches) {
        const snippetLines = m.context.map((line, idx) => {
          const isMatchLine = idx === m.matchIndexInContext;
          const lineNumPrefix = `  line ${m.line + idx - m.matchIndexInContext}:`;
          if (!isTty()) return `${lineNumPrefix}  ${line}`;
          const colored = isMatchLine
            ? highlightMatch(line, pattern, flags.ignoreCase)
            : colorize(line, DIM);
          return `${lineNumPrefix}  ${colored}`;
        });
        console.log(snippetLines.join('\n'));
      }
      console.log('');
    }
  } finally {
    db.close();
  }
}

function findMatches(text, pattern, { ignoreCase, max, context }) {
  if (!text) return [];
  const lines = text.split('\n');
  const needle = ignoreCase ? pattern.toLowerCase() : pattern;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const hay = ignoreCase ? lines[i].toLowerCase() : lines[i];
    if (hay.includes(needle)) {
      const ctxStart = Math.max(0, i - context);
      const ctxEnd = Math.min(lines.length, i + context + 1);
      const slice = lines.slice(ctxStart, ctxEnd);
      out.push({
        line: i + 1,
        text: lines[i],
        context: slice,
        matchIndexInContext: i - ctxStart,
      });
      if (out.length >= max) break;
    }
  }
  return out;
}

function highlightMatch(line, pattern, ignoreCase) {
  if (!pattern) return line;
  try {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, ignoreCase ? 'gi' : 'g');
    return line.replace(re, (m) => colorize(m, BOLD + YELLOW));
  } catch {
    return line;
  }
}

// ---------- show ----------

async function cmdShow(flags, positional) {
  const idArg = positional[0];
  if (!idArg) {
    throw new Error('memories show: missing <id>. Usage: quilltap memories show <id|prefix>');
  }
  const { db } = await openDb(flags);
  try {
    const id = resolveMemoryId(db, idArg);
    const row = db.prepare(`${SELECT_BASE} WHERE m.id = ?`).get(id);
    if (!row) {
      throw new Error(`Memory ${id} not found`);
    }

    const depthRaw = flags.depth;
    let depth = depthRaw < 0 ? 1 : depthRaw;
    if (flags.noRelated) depth = 0;
    if (depth > 4) depth = 4;
    const maxNodes = flags.maxNodes > 0 ? flags.maxNodes : 100;

    let graph = null;
    if (depth > 0) {
      graph = traverseMemoryGraph(db, id, depth, maxNodes);
    }

    // Pull holder + about character vault IDs so the JSON view is fully resolved.
    if (flags.json) {
      const json = rowToJson(row);
      if (graph) json.related = graphToJson(graph.root);
      if (graph) {
        json.graphMeta = {
          visited: graph.visited,
          cycles: graph.cycles,
          truncated: graph.truncated,
        };
      }
      renderJson(json);
      return;
    }

    renderShowText(row, graph, depth);
  } finally {
    db.close();
  }
}

function resolveMemoryId(db, idArg) {
  if (UUID_RE.test(idArg)) {
    const row = db.prepare('SELECT id FROM memories WHERE id = ?').get(idArg);
    if (!row) throw new Error(`No memory with id ${idArg}`);
    return row.id;
  }
  if (idArg.length < 8) {
    throw new Error('Memory id prefix must be at least 8 characters.');
  }
  const prefix = idArg.toLowerCase();
  const rows = db.prepare("SELECT id FROM memories WHERE LOWER(id) LIKE ? LIMIT 11").all(`${prefix}%`);
  if (rows.length === 0) {
    throw new Error(`No memory matching prefix '${idArg}'`);
  }
  if (rows.length > 1) {
    const list = rows.slice(0, 10).map(r => `  ${r.id}`).join('\n');
    const err = new Error(`Multiple memories match prefix '${idArg}':\n${list}${rows.length > 10 ? '\n  …' : ''}`);
    err.ambiguous = true;
    throw err;
  }
  return rows[0].id;
}

function renderShowText(row, graph, depth) {
  const sep = '─'.repeat(77);
  console.log(`Memory ${row.id}`);
  console.log(sep);
  const holderName = row.holderName || '?';
  const aboutName = row.aboutCharacterId == null
    ? '(none)'
    : row.aboutCharacterId === row.characterId
      ? 'self'
      : row.aboutCharName || '(unknown)';
  console.log(`  Holder:        ${holderName}    (${shortId(row.characterId)})`);
  console.log(`  About:         ${aboutName}${row.aboutCharacterId && row.aboutCharacterId !== row.characterId ? `    (${shortId(row.aboutCharacterId)})` : ''}`);
  console.log(`  Source:        ${row.source || '(?)'}`);
  const reinf = row.reinforcedImportance != null ? Number(row.reinforcedImportance).toFixed(2) : '?';
  const baseImp = row.importance != null ? Number(row.importance).toFixed(2) : '?';
  console.log(`  Importance:    ${reinf} (reinforced from ${baseImp}, count: ${row.reinforcementCount ?? 0})`);
  if (row.createdAt) console.log(`  Created:       ${row.createdAt}`);
  if (row.lastAccessedAt) console.log(`  Last access:   ${row.lastAccessedAt}`);
  if (row.lastReinforcedAt) console.log(`  Last reinf.:   ${row.lastReinforcedAt}`);
  console.log(`  Embedding:     ${row.hasEmbedding ? 'present' : '(none)'}`);
  if (row.chatId) {
    console.log(`  Chat:          "${row.chatTitle || '(untitled)'}"    (${shortId(row.chatId)})`);
    if (row.sourceMessageId) {
      console.log(`  Source msg:    ${shortId(row.sourceMessageId)}    (in chat above)`);
    }
  } else {
    console.log(`  Chat:          (manual entry)`);
  }
  if (row.projectId) {
    console.log(`  Project:       ${row.projectName || '(?)'}    (${shortId(row.projectId)})`);
  } else {
    console.log(`  Project:       (none)`);
  }

  try {
    const kw = JSON.parse(row.keywords || '[]');
    if (kw.length) console.log(`  Keywords:      [${kw.join(', ')}]`);
  } catch { /* ignore */ }
  try {
    const tags = JSON.parse(row.tags || '[]');
    if (tags.length) console.log(`  Tags:          [${tags.join(', ')}]`);
  } catch { /* ignore */ }

  console.log('');
  console.log('Summary:');
  console.log(`  ${row.summary || '(no summary)'}`);
  console.log('');
  console.log('Content:');
  for (const line of (row.content || '').split('\n')) {
    console.log(`  ${line}`);
  }

  if (depth > 0 && graph && graph.root) {
    const direct = (graph.root.children || []).filter(c => c && !c.cycle && !c.missing);
    console.log('');
    console.log(`Related (${direct.length} direct, --depth ${depth}):`);
    for (const child of graph.root.children || []) {
      if (!child) continue;
      if (child.cycle) {
        console.log(`  ↺ ${shortId(child.id)}  (already shown)`);
        continue;
      }
      if (child.missing) {
        console.log(`  ✗ ${shortId(child.id)}  (deleted or missing)`);
        continue;
      }
      const imp = child.reinforcedImportance != null ? Number(child.reinforcedImportance).toFixed(2) : '?';
      const sum = truncate(child.summary || '', 80);
      console.log(`  ▸ ${shortId(child.id)}  (imp ${imp})  "${sum}"`);
    }
  }
}

// ---------- tree ----------

async function cmdTree(flags, positional) {
  const idArg = positional[0];
  if (!idArg) {
    throw new Error('memories tree: missing <id>. Usage: quilltap memories tree <id|prefix>');
  }
  const { db } = await openDb(flags);
  try {
    const id = resolveMemoryId(db, idArg);
    let depth = flags.depth >= 0 ? flags.depth : 2;
    if (depth > 4) depth = 4;
    const maxNodes = flags.maxNodes > 0 ? Math.min(flags.maxNodes, 1000) : 100;

    const graph = traverseMemoryGraph(db, id, depth, maxNodes);

    if (flags.json) {
      renderJson({
        root: graphToJson(graph.root),
        visited: graph.visited,
        cycles: graph.cycles,
        truncated: graph.truncated,
        depth,
        maxNodes,
      });
      return;
    }

    if (!graph.root) {
      console.log('(no nodes — max-nodes cap hit before root could render)');
      return;
    }

    renderTreeNode(graph.root, '', true, true);
    console.log('');
    const depthSuffix = graph.truncated ? `, depth ${depth} reached (max-nodes ${maxNodes} hit)` : `, depth ${depth} reached`;
    console.log(`${graph.visited} nodes visited, ${graph.cycles} cycles detected${depthSuffix}.`);
  } finally {
    db.close();
  }
}

function renderTreeNode(node, prefix, isLast, isRoot) {
  if (!node) return;
  if (node.cycle) {
    console.log(`${prefix}${isLast ? '└─' : '├─'} ↺ ${shortId(node.id)}  (already shown)`);
    return;
  }
  if (node.missing) {
    console.log(`${prefix}${isLast ? '└─' : '├─'} ✗ ${shortId(node.id)}  (deleted or missing)`);
    return;
  }
  const imp = node.reinforcedImportance != null ? Number(node.reinforcedImportance).toFixed(2) : '?';
  const sum = truncate(node.summary || '', 80);
  if (isRoot) {
    console.log(`${shortId(node.id)}  (imp ${imp})  "${sum}"`);
  } else {
    console.log(`${prefix}${isLast ? '└─' : '├─'} ${shortId(node.id)}  (imp ${imp})  "${sum}"`);
  }
  const children = node.children || [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const last = i === children.length - 1;
    const childPrefix = isRoot ? '' : prefix + (isLast ? '   ' : '│  ');
    renderTreeNode(child, childPrefix, last, false);
  }
}

// Walk the related-memory graph rooted at `rootId`. Maintains a visited-set
// for cycle handling; renders dangling edges as { missing: true } leaves;
// halts early when the visit count would exceed `maxNodes`.
function traverseMemoryGraph(db, rootId, maxDepth, maxNodes) {
  const visited = new Set();
  let cycleCount = 0;
  let truncated = false;
  const stmt = db.prepare(
    'SELECT id, summary, reinforcedImportance, relatedMemoryIds FROM memories WHERE id = ?'
  );

  function walk(id, depth) {
    if (visited.size >= maxNodes) { truncated = true; return null; }
    if (visited.has(id)) { cycleCount++; return { id, cycle: true }; }
    visited.add(id);
    const row = stmt.get(id);
    if (!row) return { id, missing: true };
    if (depth >= maxDepth) return { ...row, children: [] };
    let childIds = [];
    try { childIds = JSON.parse(row.relatedMemoryIds || '[]'); } catch { childIds = []; }
    const children = childIds.map(cid => walk(cid, depth + 1)).filter(Boolean);
    return { ...row, children };
  }

  return { root: walk(rootId, 0), visited: visited.size, cycles: cycleCount, truncated };
}

function graphToJson(node) {
  if (!node) return null;
  if (node.cycle) return { id: node.id, cycle: true };
  if (node.missing) return { id: node.id, missing: true };
  return {
    id: node.id,
    summary: node.summary,
    reinforcedImportance: node.reinforcedImportance,
    children: (node.children || []).map(graphToJson),
  };
}

// ---------- status ----------

async function cmdStatus(flags) {
  const { db, openMounts } = await openDb(flags);
  try {
    let holderRows;
    if (flags.character && flags.character !== 'all') {
      const c = resolveCharacter(db, flags.character, openMounts);
      holderRows = [{ id: c.id, name: c.name }];
    } else {
      holderRows = db.prepare(`
        SELECT c.id, c.name, COUNT(m.id) AS cnt
        FROM characters c
        LEFT JOIN memories m ON m.characterId = c.id
        GROUP BY c.id
        HAVING cnt > 0
        ORDER BY cnt DESC, c.name
      `).all();
    }

    const report = [];
    for (const holder of holderRows) {
      const stats = computeHolderStats(db, holder.id);
      report.push({ holder, stats });
    }

    if (flags.json) {
      renderJson({
        holders: report.map(({ holder, stats }) => ({
          holder: { id: holder.id, name: holder.name },
          ...stats,
        })),
      });
      return;
    }

    for (const { holder, stats } of report) {
      renderStatusBlock(holder, stats);
      console.log('');
    }

    // After per-holder rendering, log any dangling edges to stderr so the user
    // notices the inconsistency without it cluttering the structured output.
    const danglingTotal = report.reduce((sum, r) => sum + r.stats.graph.danglingEdges, 0);
    if (danglingTotal > 0) {
      process.stderr.write(
        `Warning: ${danglingTotal} dangling related-memory edges across all holders. ` +
        `These are JSON UUIDs in relatedMemoryIds that no longer resolve to a memory.\n`
      );
    }
  } finally {
    db.close();
  }
}

function computeHolderStats(db, characterId) {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN source = 'AUTO' THEN 1 ELSE 0 END) AS auto,
      SUM(CASE WHEN source = 'MANUAL' THEN 1 ELSE 0 END) AS manual,
      SUM(CASE WHEN aboutCharacterId = characterId THEN 1 ELSE 0 END) AS selfRef,
      SUM(CASE WHEN aboutCharacterId IS NOT NULL AND aboutCharacterId != characterId THEN 1 ELSE 0 END) AS aboutOthers,
      SUM(CASE WHEN aboutCharacterId IS NULL THEN 1 ELSE 0 END) AS legacy,
      SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) AS withEmbedding,
      SUM(CASE WHEN embedding IS NULL THEN 1 ELSE 0 END) AS withoutEmbedding
    FROM memories
    WHERE characterId = ?
  `).get(characterId);

  const graph = scanDanglingEdges(db, { characterId });

  const topMemories = db.prepare(`
    SELECT id, summary, reinforcedImportance
    FROM memories
    WHERE characterId = ?
    ORDER BY reinforcedImportance DESC, createdAt DESC
    LIMIT 5
  `).all(characterId);

  return {
    counts: {
      total: counts.total || 0,
      auto: counts.auto || 0,
      manual: counts.manual || 0,
    },
    aboutDistribution: {
      selfReferential: counts.selfRef || 0,
      aboutOthers: counts.aboutOthers || 0,
      legacy: counts.legacy || 0,
    },
    embeddings: {
      present: counts.withEmbedding || 0,
      missing: counts.withoutEmbedding || 0,
    },
    graph: {
      withLinks: graph.withLinks,
      isolated: graph.isolated,
      avgDegree: graph.avgDegree,
      maxDegree: graph.maxDegree,
      danglingEdges: graph.danglingEdges,
    },
    top: topMemories,
  };
}

function renderStatusBlock(holder, stats) {
  console.log(`Holder: ${holder.name}   (${shortId(holder.id)})`);
  console.log(`  Total memories:        ${stats.counts.total}`);
  console.log(`    AUTO:                ${stats.counts.auto}`);
  console.log(`    MANUAL:              ${stats.counts.manual}`);
  console.log(`  About-distribution:`);
  console.log(`    self-referential:    ${stats.aboutDistribution.selfReferential}`);
  console.log(`    about-others:        ${stats.aboutDistribution.aboutOthers}`);
  const legacySuffix = stats.aboutDistribution.legacy > 0 ? '   ⚠ run alignment migration?' : '';
  console.log(`    legacy (NULL):       ${stats.aboutDistribution.legacy}${legacySuffix}`);
  console.log(`  Embeddings:`);
  console.log(`    present:             ${stats.embeddings.present}`);
  const missingSuffix = stats.embeddings.missing > 0 ? '   ⚠ may not be recallable' : '';
  console.log(`    missing:             ${stats.embeddings.missing}${missingSuffix}`);
  console.log(`  Graph:`);
  console.log(`    nodes with links:    ${stats.graph.withLinks}`);
  console.log(`    isolated (0 links):  ${stats.graph.isolated}`);
  console.log(`    avg degree:          ${stats.graph.avgDegree}`);
  console.log(`    max degree:          ${stats.graph.maxDegree}`);
  const danglingSuffix = stats.graph.danglingEdges > 0 ? '   ⚠ JSON UUIDs that no longer resolve' : '';
  console.log(`    dangling edges:      ${stats.graph.danglingEdges}${danglingSuffix}`);
  if (stats.top.length) {
    console.log(`  Top by reinforcedImportance:`);
    for (const t of stats.top) {
      const imp = t.reinforcedImportance != null ? Number(t.reinforcedImportance).toFixed(2) : '?';
      console.log(`    ${shortId(t.id)}  (imp ${imp})  "${truncate(t.summary || '', 80)}"`);
    }
  }
}

// ---------- validate ----------

async function cmdValidate(flags) {
  const { db, openMounts } = await openDb(flags);
  try {
    let holderIds = null;
    let holderRows;
    if (flags.character && flags.character !== 'all') {
      const c = resolveCharacter(db, flags.character, openMounts);
      holderRows = [{ id: c.id, name: c.name }];
      holderIds = [c.id];
    } else {
      holderRows = db.prepare(`
        SELECT c.id, c.name FROM characters c
        WHERE EXISTS (SELECT 1 FROM memories m WHERE m.characterId = c.id)
        ORDER BY c.name
      `).all();
    }

    const includePairs = Boolean(flags.list);
    let totalDangling = 0;
    let totalEdges = 0;
    let totalNodes = 0;
    const perHolder = [];
    for (const holder of holderRows) {
      const stats = scanDanglingEdges(db, {
        characterId: holder.id,
        includePairs,
      });
      totalDangling += stats.danglingEdges;
      totalEdges += stats.totalEdges;
      totalNodes += stats.nodes;
      perHolder.push({ holder, stats });
    }

    if (flags.json) {
      renderJson({
        scanned: holderIds ? 'single' : 'all',
        characterIds: holderRows.map(h => h.id),
        totals: {
          nodes: totalNodes,
          edges: totalEdges,
          danglingEdges: totalDangling,
        },
        holders: perHolder.map(({ holder, stats }) => ({
          holder: { id: holder.id, name: holder.name },
          ...stats,
        })),
      });
    } else {
      const scope = holderIds ? `holder ${holderRows[0].name}` : `${holderRows.length} holders`;
      const drift = totalEdges > 0 ? ((totalDangling / totalEdges) * 100).toFixed(2) : '0.00';
      console.log(`Scanned ${scope}: ${totalNodes} memories, ${totalEdges} edges, ${totalDangling} dangling (${drift}%).`);
      if (totalDangling === 0) {
        console.log(colorize('Graph is clean.', GREEN));
      } else if (flags.list) {
        console.log('');
        for (const { holder, stats } of perHolder) {
          if (!stats.danglingPairs || stats.danglingPairs.length === 0) continue;
          console.log(colorize(`${holder.name}  (${shortId(holder.id)})`, BOLD));
          for (const pair of stats.danglingPairs) {
            console.log(`  ${shortId(pair.sourceId)}  →  ${pair.targetIds.map(shortId).join(', ')}`);
          }
        }
      } else {
        console.log(colorize('Run with --list to see offending source memory IDs and dangling targets.', YELLOW));
      }
    }

    if (totalDangling > 0) {
      process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

// ---------- help ----------

function printMemoriesHelp() {
  console.log(`
Quilltap Memories Tool

Usage: quilltap memories <subcommand> [filters] [options]

Subcommands:
  ls       [filters] [--sort <field>] [-r] [--limit N] [--json]
                                             List memories (default sort:
                                             reinforcedImportance DESC).
  find     [filters] [--in summary|content|both] [--limit N] <pattern>
                                             Substring search on summary
                                             and/or content.
  grep     [filters] [-i] [-l] [--max N] [--context N] <pattern>
                                             Pattern search inside content
                                             with snippets.
  grep --semantic --character <name|id> [--top N] [--threshold 0..1] <query>
                                             Embedding search via the running
                                             server (default --top 20,
                                             --threshold 0.5). One holder at a
                                             time; --port sets the server port.
  show     <id|prefix> [--depth N] [--no-related] [--json]
                                             Full record + related-memory
                                             neighbourhood.
  tree     <id|prefix> [--depth N] [--max-nodes N] [--json]
                                             ASCII walk of the
                                             related-memory graph.
  status   [--character <name|id>] [--json]  Per-holder rollup + dangling-
                                             edge check.
  validate [--character <name|id>] [--list]  Read-only memory-graph health
                                  [--json]   check. Exits 1 if any
                                             dangling edges remain.

Shared filter flags:
  --character <name|id|all>   Holder. Default: all.
  --about <name|id|self|none> Subject (aboutCharacterId).
  --source AUTO|MANUAL        Restrict by source.
  --chat <id|title|none>      Source chat ('none' for manual memories).
  --project <id|name>         Project context.
  --since <date>              ISO date floor on createdAt.
  --until <date>              ISO date ceiling on createdAt.
  --min-importance <n>        Floor on raw importance.
  --min-reinforced <n>        Floor on reinforcedImportance.
  --has-embedding             Only memories with an embedding.
  --no-embedding              Only memories WITHOUT an embedding.

Sort flags (ls / find / grep):
  --sort <field>              reinforced (default) | importance | created |
                              accessed | reinforcement-count | links
  -r, --reverse               Flip the sort order.
  --limit N                   Default 50.
  --full-titles               Don't truncate chat titles to 32 chars.

Global flags (may appear before or after the subcommand):
  -d, --data-dir <path>       Override data directory.
  --instance <name>           Use a registered instance.
  --passphrase <pass>         Decrypt .dbkey if peppered.
  --json                      Machine-readable output.
  -h, --help                  Show this help.

Note: -i is reserved here for 'grep --ignore-case'. Use the long --instance
form to target a registered instance.

All memories verbs are read-only. They open the main encrypted database
(quilltap.db) and never write to it.

Examples:
  quilltap memories ls
  quilltap memories ls --character Ariadne --sort created --limit 10
  quilltap memories find "concrete examples"
  quilltap memories grep -i --max 3 --context 1 "concrete examples"
  quilltap memories grep --semantic --character Ariadne --top 10 "the argument about Calvin"
  quilltap memories show abc12345 --depth 2
  quilltap memories tree abc12345 --depth 3
  quilltap memories status --character Ariadne
  quilltap memories validate
  quilltap memories validate --list
`);
}

// ---------- dispatcher ----------

async function memoriesCommand(args) {
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    printMemoriesHelp();
    return;
  }
  // The dispatcher in bin/quilltap.js already strips global flags that appear
  // BEFORE the verb. Anything left here is verb + flags. The first positional
  // is the verb.
  const { flags, positional } = parseFlags(args);
  if (flags.help) { printMemoriesHelp(); return; }
  const verb = positional.shift();
  if (!verb) {
    printMemoriesHelp();
    return;
  }
  switch (verb) {
    case 'ls': await cmdLs(flags); break;
    case 'find': await cmdFind(flags, positional); break;
    case 'grep': await cmdGrep(flags, positional); break;
    case 'show': await cmdShow(flags, positional); break;
    case 'tree': await cmdTree(flags, positional); break;
    case 'status': await cmdStatus(flags); break;
    case 'validate': await cmdValidate(flags); break;
    default:
      console.error(`Unknown memories subcommand: ${verb}`);
      console.error("Run 'quilltap memories --help' for a list.");
      process.exit(1);
  }
}

module.exports = {
  memoriesCommand,
  // Exported for unit tests:
  parseFlags,
  buildWhereClause,
  buildOrderBy,
  traverseMemoryGraph,
  findMatches,
  resolveMemoryId,
};
