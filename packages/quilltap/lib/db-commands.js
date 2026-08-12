'use strict';

const fs = require('fs');
const path = require('path');
const {
  openMainDb,
  openLlmLogsDb,
  openMountIndexDb,
  openEncryptedDb,
  UUID_RE,
  ambiguous,
  resolveCharacter,
  resolveCharactersByAlias,
  readVaultAliases,
  resolveChat,
  resolveProject,
} = require('./db-helpers');
const { getLockStatus } = require('./lock-helpers');

// Tables grouped by domain for `db schema` (with-no-arg) overview, and for
// DB-routing when a verb names a specific table. Keep this list short — it's
// a cheat-sheet, not an exhaustive catalogue.
const DB_DOMAINS = {
  main: {
    'Characters & memory': ['characters', 'wardrobe_items', 'character_plugin_data', 'memories'],
    'Chats & messages': ['chats', 'chat_messages', 'chat_settings', 'chat_documents', 'terminal_sessions'],
    'Projects & files': ['projects', 'files', 'folders'],
    'Connections & templates': ['connection_profiles', 'prompt_templates', 'roleplay_templates'],
    'System': ['background_jobs', 'migrations_state', 'instance_settings', 'users'],
  },
  logs: {
    'LLM logs': ['llm_logs'],
  },
  mount: {
    'Document mount index': [
      'doc_mount_points', 'doc_mount_folders', 'doc_mount_files',
      'doc_mount_documents', 'doc_mount_chunks', 'doc_mount_blobs',
      'doc_mount_file_links', 'project_doc_mount_links',
    ],
  },
};

// Lookup: table name → which DB it lives in
const TABLE_DB = (() => {
  const m = {};
  for (const [db, groups] of Object.entries(DB_DOMAINS)) {
    for (const tables of Object.values(groups)) {
      for (const t of tables) m[t] = db;
    }
  }
  return m;
})();

// GitHub heading anchors: lowercase, spaces → dashes, most punctuation dropped.
// Underscores are preserved, so `### chat_messages` → `#chat_messages`.
function ddlAnchor(tableName) {
  return `docs/developer/DDL.md#${tableName.toLowerCase()}`;
}

// ---------- arg parsing ----------

function parseSubArgs(args) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
    i++;
  }
  return { flags, positional };
}

function asInt(v, dflt) {
  if (v === undefined || v === true) return dflt;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

function asBool(v) {
  return v === true || v === 'true' || v === '1';
}

// ---------- output ----------

function printTable(rows) {
  if (!rows || rows.length === 0) {
    console.log('(no results)');
    return;
  }
  console.table(rows);
}

function printJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function truncate(s, n) {
  if (s == null) return '';
  const str = String(s);
  if (str.length <= n) return str;
  return str.slice(0, n) + `… (+${str.length - n} chars)`;
}

function printRecord(label, row) {
  console.log(`── ${label} ──`);
  for (const [k, v] of Object.entries(row)) {
    if (v == null) continue;
    if (typeof v === 'string' && v.length > 80) {
      console.log(`  ${k}:`);
      for (const line of v.split('\n')) console.log(`    ${line}`);
    } else {
      console.log(`  ${k}: ${v}`);
    }
  }
}

// ---------- verb: schema ----------

function cmdSchema(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const json = asBool(flags.json);

  if (flags.grep) {
    return schemaGrep(String(flags.grep), { json, ctx });
  }

  const table = positional[0];
  if (!table) {
    return schemaOverview({ json, ctx });
  }
  return schemaForTable(table, { json, ctx });
}

function getAllTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
}

function getTableInfo(db, table) {
  return db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all();
}

function getForeignKeys(db, table) {
  return db.prepare(`PRAGMA foreign_key_list("${table.replace(/"/g, '""')}")`).all();
}

function getIndexes(db, table) {
  return db.prepare(`PRAGMA index_list("${table.replace(/"/g, '""')}")`).all();
}

function openDbForTable(ctx, table) {
  const which = TABLE_DB[table] || 'main';
  if (which === 'logs') return { db: ctx.openLogs(), which };
  if (which === 'mount') return { db: ctx.openMounts(), which };
  return { db: ctx.openMain(), which };
}

function schemaForTable(table, { json, ctx }) {
  // Try main first, fall back to other DBs if not found
  const order = (TABLE_DB[table] === 'logs') ? ['logs', 'main', 'mount']
    : (TABLE_DB[table] === 'mount') ? ['mount', 'main', 'logs']
    : ['main', 'logs', 'mount'];

  for (const which of order) {
    const opener = which === 'logs' ? ctx.openLogs : which === 'mount' ? ctx.openMounts : ctx.openMain;
    let db;
    try { db = opener(); } catch { continue; }
    try {
      const tables = new Set(getAllTables(db));
      if (!tables.has(table)) continue;
      const cols = getTableInfo(db, table);
      const fks = getForeignKeys(db, table);
      const idxs = getIndexes(db, table);

      if (json) {
        printJson({ database: which, table, columns: cols, foreignKeys: fks, indexes: idxs });
        return;
      }

      console.log(`Table: ${table}  (database: ${which})`);
      console.log('');
      console.log('Columns:');
      const rows = cols.map(c => ({
        name: c.name,
        type: c.type,
        notNull: c.notnull ? 'NOT NULL' : '',
        default: c.dflt_value === null ? '' : c.dflt_value,
        pk: c.pk ? `pk${c.pk > 1 ? '(' + c.pk + ')' : ''}` : '',
      }));
      console.table(rows);
      if (fks.length) {
        console.log('Foreign keys:');
        console.table(fks.map(f => ({ from: f.from, to: `${f.table}.${f.to}`, onDelete: f.on_delete, onUpdate: f.on_update })));
      }
      if (idxs.length) {
        console.log('Indexes:');
        for (const idx of idxs) {
          const cols = db.prepare(`PRAGMA index_info("${idx.name.replace(/"/g, '""')}")`).all().map(c => c.name).join(', ');
          console.log(`  ${idx.unique ? 'UNIQUE ' : ''}${idx.name} (${cols})`);
        }
      }
      console.log('');
      console.log(`→ ${ddlAnchor(table)}`);
      return;
    } finally {
      try { db.close(); } catch {}
    }
  }
  throw new Error(`Table '${table}' not found in any database.`);
}

function schemaOverview({ json, ctx }) {
  const out = {};
  for (const [which, opener] of [['main', ctx.openMain], ['logs', ctx.openLogs], ['mount', ctx.openMounts]]) {
    let db;
    try { db = opener(); } catch { continue; }
    try {
      out[which] = getAllTables(db);
    } finally {
      try { db.close(); } catch {}
    }
  }

  if (json) {
    printJson({ databases: out, domains: DB_DOMAINS });
    return;
  }

  for (const [whichDb, groups] of Object.entries(DB_DOMAINS)) {
    if (!out[whichDb]) continue;
    const present = new Set(out[whichDb]);
    console.log(`── ${whichDb} database (${out[whichDb].length} tables) ──`);
    for (const [groupName, tables] of Object.entries(groups)) {
      const hits = tables.filter(t => present.has(t));
      if (hits.length === 0) continue;
      console.log(`  ${groupName}:`);
      for (const t of hits) console.log(`    ${t}`);
    }
    const grouped = new Set(Object.values(groups).flat());
    const ungrouped = out[whichDb].filter(t => !grouped.has(t) && !t.startsWith('sqlite_'));
    if (ungrouped.length) {
      console.log('  Other:');
      for (const t of ungrouped) console.log(`    ${t}`);
    }
    console.log('');
  }
  console.log("Use `quilltap db schema <table>` for column details, or `quilltap db schema --grep <text>` to search.");
}

function schemaGrep(needle, { json, ctx }) {
  const lc = needle.toLowerCase();
  const matches = [];
  for (const [which, opener] of [['main', ctx.openMain], ['logs', ctx.openLogs], ['mount', ctx.openMounts]]) {
    let db;
    try { db = opener(); } catch { continue; }
    try {
      const tables = getAllTables(db);
      for (const t of tables) {
        const tableHit = t.toLowerCase().includes(lc);
        const cols = getTableInfo(db, t);
        const colHits = cols.filter(c => c.name.toLowerCase().includes(lc));
        if (tableHit || colHits.length) {
          matches.push({
            database: which,
            table: t,
            tableMatch: tableHit,
            columns: tableHit && colHits.length === 0 ? cols.map(c => c.name) : colHits.map(c => c.name),
          });
        }
      }
    } finally {
      try { db.close(); } catch {}
    }
  }

  if (json) { printJson({ query: needle, matches }); return; }

  if (matches.length === 0) {
    console.log(`No tables or columns matching '${needle}'.`);
    return;
  }
  for (const m of matches) {
    const flag = m.tableMatch ? '*' : ' ';
    console.log(`${flag} ${m.database}: ${m.table}`);
    for (const c of m.columns) console.log(`      .${c}`);
  }
  console.log('');
  console.log('(* = table name matched; columns shown are matched columns, or all columns if the whole table matched)');
}

// ---------- verb: find ----------

function cmdFind(args, ctx) {
  const [kind, ...rest] = args;
  if (!kind) throw new Error('Usage: quilltap db find <character|chat|project> [query]');
  const { flags, positional } = parseSubArgs(rest);
  const json = asBool(flags.json);
  const limit = asInt(flags.limit, 50);
  const query = positional.join(' ');

  if (kind === 'character') return findCharacters(query, { json, limit, ctx });
  if (kind === 'chat') return findChats(query, { json, limit, ctx });
  if (kind === 'project') return findProjects(query, { json, limit, ctx });
  throw new Error(`Unknown find kind: ${kind}. Try character|chat|project.`);
}

function findCharacters(query, { json, limit, ctx }) {
  // Aliases live in each character's vault `properties.json` post-4.6, not on
  // the `characters` row, so name matching comes from the main DB and alias
  // matching/display comes from the mount-index DB.
  const db = ctx.openMain();
  let mounts = null;
  try {
    mounts = ctx.openMounts();
  } catch {
    mounts = null; // mount-index DB absent — name-only matching, no aliases
  }
  try {
    const SELECT_COLS =
      'SELECT id, name, npc, isFavorite, controlledBy, characterDocumentMountPointId AS mp FROM characters';
    let rows;
    if (!query) {
      rows = db.prepare(`${SELECT_COLS} ORDER BY name LIMIT ?`).all(limit);
    } else if (UUID_RE.test(query)) {
      rows = db.prepare(`${SELECT_COLS} WHERE id = ?`).all(query);
    } else {
      const byName = db
        .prepare(`${SELECT_COLS} WHERE LOWER(name) LIKE LOWER(?) ORDER BY name`)
        .all(`%${query}%`);
      const seen = new Set(byName.map((r) => r.id));
      rows = [...byName];
      // Fold in alias matches from the vault, then re-fetch their rows so the
      // output columns stay uniform.
      for (const m of resolveCharactersByAlias(db, mounts, query)) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        const r = db.prepare(`${SELECT_COLS} WHERE id = ?`).get(m.id);
        if (r) rows.push(r);
      }
      rows = rows.slice(0, limit);
    }

    // Attach vault-sourced aliases for display and drop the internal mount id.
    const enriched = rows.map(({ mp, ...rest }) => ({
      ...rest,
      aliases: readVaultAliases(mounts, mp),
    }));

    if (json) return printJson(enriched);
    printTable(
      enriched.map((r) => ({
        ...r,
        aliases: r.aliases.length ? r.aliases.join(', ') : '',
      })),
    );
  } finally {
    if (mounts) { try { mounts.close(); } catch {} }
    db.close();
  }
}

function findChats(query, { json, limit, ctx }) {
  const db = ctx.openMain();
  try {
    let rows;
    if (!query) {
      rows = db.prepare('SELECT id, title, chatType, messageCount, lastMessageAt FROM chats ORDER BY lastMessageAt DESC LIMIT ?').all(limit);
    } else if (UUID_RE.test(query)) {
      rows = db.prepare('SELECT id, title, chatType, projectId, messageCount, lastMessageAt FROM chats WHERE id = ?').all(query);
    } else {
      rows = db.prepare(
        'SELECT id, title, chatType, projectId, messageCount, lastMessageAt FROM chats WHERE LOWER(title) LIKE LOWER(?) ORDER BY lastMessageAt DESC LIMIT ?'
      ).all(`%${query}%`, limit);
    }
    if (json) return printJson(rows);
    printTable(rows);
  } finally {
    db.close();
  }
}

function findProjects(query, { json, limit, ctx }) {
  const db = ctx.openMain();
  try {
    let rows;
    if (!query) {
      rows = db.prepare('SELECT id, name, createdAt FROM projects ORDER BY name LIMIT ?').all(limit);
    } else if (UUID_RE.test(query)) {
      rows = db.prepare('SELECT id, name, description, createdAt FROM projects WHERE id = ?').all(query);
    } else {
      rows = db.prepare(
        'SELECT id, name, createdAt FROM projects WHERE LOWER(name) LIKE LOWER(?) ORDER BY name LIMIT ?'
      ).all(`%${query}%`, limit);
    }
    if (json) return printJson(rows);
    printTable(rows);
  } finally {
    db.close();
  }
}

// ---------- verb: chats ----------

function cmdChats(args, ctx) {
  const { flags } = parseSubArgs(args);
  const json = asBool(flags.json);
  const limit = asInt(flags.limit, 50);

  const db = ctx.openMain();
  try {
    let rows;
    if (flags.character) {
      const c = resolveCharacter(db, String(flags.character), ctx.openMounts);
      rows = db.prepare(
        "SELECT id, title, chatType, messageCount, lastMessageAt, projectId " +
        "FROM chats WHERE participants LIKE ? ORDER BY lastMessageAt DESC LIMIT ?"
      ).all(`%${c.id}%`, limit);
      if (!json) console.log(`Chats for character: ${c.name} (${c.id})`);
    } else if (flags.project) {
      const p = resolveProject(db, String(flags.project));
      rows = db.prepare(
        "SELECT id, title, chatType, messageCount, lastMessageAt " +
        "FROM chats WHERE projectId = ? ORDER BY lastMessageAt DESC LIMIT ?"
      ).all(p.id, limit);
      if (!json) console.log(`Chats for project: ${p.name} (${p.id})`);
    } else {
      rows = db.prepare(
        "SELECT id, title, chatType, messageCount, lastMessageAt, projectId " +
        "FROM chats ORDER BY lastMessageAt DESC LIMIT ?"
      ).all(limit);
    }
    if (json) return printJson(rows);
    printTable(rows);
  } finally {
    db.close();
  }
}

// ---------- verb: messages ----------

function cmdMessages(args, ctx) {
  const { flags } = parseSubArgs(args);
  const json = asBool(flags.json);
  const last = asInt(flags.last, 20);
  const full = asBool(flags.full);
  if (!flags.chat) throw new Error('Usage: quilltap db messages --chat <id|title> [--last N] [--full] [--from <participant>] [--type <type>]');

  const db = ctx.openMain();
  try {
    const chat = resolveChat(db, String(flags.chat));
    const conditions = ['chatId = ?'];
    const params = [chat.id];
    if (flags.from) { conditions.push('participantId = ?'); params.push(String(flags.from)); }
    if (flags.type) { conditions.push('type = ?'); params.push(String(flags.type)); }

    const totalRow = db.prepare(`SELECT count(*) AS n FROM chat_messages WHERE ${conditions.join(' AND ')}`).get(...params);
    const sql = `
      SELECT id, createdAt, role, type, systemSender, participantId, content
      FROM chat_messages WHERE ${conditions.join(' AND ')}
      ORDER BY createdAt DESC LIMIT ?
    `;
    params.push(last);
    const rows = db.prepare(sql).all(...params).reverse(); // oldest first

    if (json) return printJson({ chat, total: totalRow.n, returned: rows.length, messages: rows });

    console.log(`Chat: ${chat.title} (${chat.id}) — showing ${rows.length} of ${totalRow.n} matching messages`);
    const summary = rows.map(r => ({
      createdAt: r.createdAt,
      id: r.id,
      role: r.role,
      type: r.type,
      from: r.systemSender || r.participantId || '',
      content: full ? r.content : truncate(r.content, 120),
    }));
    printTable(summary);
  } finally {
    db.close();
  }
}

// ---------- verb: logs ----------

function cmdLogs(args, ctx) {
  const { flags } = parseSubArgs(args);
  const json = asBool(flags.json);
  const limit = asInt(flags.limit, 50);

  const logsDb = ctx.openLogs();
  try {
    let rows;
    if (flags.message) {
      rows = logsDb.prepare(
        'SELECT id, createdAt, type, provider, modelName, chatId, characterId, durationMs FROM llm_logs WHERE messageId = ? ORDER BY createdAt DESC LIMIT ?'
      ).all(String(flags.message), limit);
    } else if (flags.chat) {
      // need to resolve chat from main DB if a name was given
      let chatId = String(flags.chat);
      if (!UUID_RE.test(chatId)) {
        const main = ctx.openMain();
        try {
          chatId = resolveChat(main, chatId).id;
        } finally {
          main.close();
        }
      }
      rows = logsDb.prepare(
        'SELECT id, createdAt, type, provider, modelName, messageId, characterId, durationMs FROM llm_logs WHERE chatId = ? ORDER BY createdAt DESC LIMIT ?'
      ).all(chatId, limit);
    } else if (flags.character) {
      const main = ctx.openMain();
      let c;
      try { c = resolveCharacter(main, String(flags.character), ctx.openMounts); } finally { main.close(); }
      rows = logsDb.prepare(
        'SELECT id, createdAt, type, provider, modelName, chatId, messageId, durationMs FROM llm_logs WHERE characterId = ? ORDER BY createdAt DESC LIMIT ?'
      ).all(c.id, limit);
    } else if (flags.tail) {
      const n = asInt(flags.tail, 20);
      rows = logsDb.prepare(
        'SELECT id, createdAt, type, provider, modelName, chatId, messageId, characterId, durationMs FROM llm_logs ORDER BY createdAt DESC LIMIT ?'
      ).all(n);
    } else {
      throw new Error('Usage: quilltap db logs (--chat <id|title> | --message <id> | --character <id|name> | --tail N) [--limit N]');
    }
    if (json) return printJson(rows);
    printTable(rows);
  } finally {
    logsDb.close();
  }
}

// ---------- verb: message (single record) ----------

function cmdMessage(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const id = positional[0];
  if (!id) throw new Error('Usage: quilltap db message <id> [--json] [--rendered]');
  const json = asBool(flags.json);
  const rendered = asBool(flags.rendered);

  const db = ctx.openMain();
  try {
    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id);
    if (!row) throw new Error(`No chat_message with id ${id}`);
    if (json) return printJson(row);

    printRecord(`Message ${row.id}`, {
      chatId: row.chatId,
      createdAt: row.createdAt,
      role: row.role,
      type: row.type,
      systemSender: row.systemSender,
      participantId: row.participantId,
      provider: row.provider,
      modelName: row.modelName,
      tokenCount: row.tokenCount,
    });
    console.log('');
    console.log('── Content ──');
    console.log(row.content || '(empty)');
    if (rendered && row.renderedHtml) {
      console.log('');
      console.log('── Rendered HTML ──');
      console.log(row.renderedHtml);
    }
  } finally {
    db.close();
  }
}

// ---------- verb: log (single record) ----------

function cmdLog(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const id = positional[0];
  if (!id) throw new Error('Usage: quilltap db log <id> [--json] [--field request|response|both]');
  const json = asBool(flags.json);
  const field = flags.field || 'both';

  const db = ctx.openLogs();
  try {
    const row = db.prepare('SELECT * FROM llm_logs WHERE id = ?').get(id);
    if (!row) throw new Error(`No llm_log with id ${id}`);
    if (json) return printJson(row);

    let finishReason = null;
    try {
      const parsed = typeof row.response === 'string' ? JSON.parse(row.response) : row.response;
      if (parsed && typeof parsed.finishReason === 'string') finishReason = parsed.finishReason;
    } catch { /* leave null */ }

    printRecord(`LLM log ${row.id}`, {
      createdAt: row.createdAt,
      type: row.type,
      provider: row.provider,
      modelName: row.modelName,
      chatId: row.chatId,
      messageId: row.messageId,
      characterId: row.characterId,
      durationMs: row.durationMs,
      finishReason,
      usage: row.usage,
      cacheUsage: row.cacheUsage,
    });
    if (field === 'request' || field === 'both') {
      console.log('');
      console.log('── Request ──');
      console.log(row.request);
    }
    if (field === 'response' || field === 'both') {
      console.log('');
      console.log('── Response ──');
      console.log(row.response);
    }
  } finally {
    db.close();
  }
}

// ---------- verb: memories ----------

function cmdMemories(args, ctx) {
  const { flags } = parseSubArgs(args);
  const json = asBool(flags.json);
  const limit = asInt(flags.limit, 50);
  if (!flags.character) throw new Error('Usage: quilltap db memories --character <id|name> [--about <id|name>] [--source AUTO|MANUAL] [--limit N]');

  const db = ctx.openMain();
  try {
    const holder = resolveCharacter(db, String(flags.character), ctx.openMounts);
    const conditions = ['characterId = ?'];
    const params = [holder.id];
    if (flags.about) {
      const a = resolveCharacter(db, String(flags.about), ctx.openMounts);
      conditions.push('aboutCharacterId = ?');
      params.push(a.id);
    }
    if (flags.source) {
      conditions.push('source = ?');
      params.push(String(flags.source).toUpperCase());
    }
    const rows = db.prepare(`
      SELECT id, createdAt, source, importance, reinforcementCount,
             aboutCharacterId, chatId, summary
      FROM memories WHERE ${conditions.join(' AND ')}
      ORDER BY createdAt DESC LIMIT ?
    `).all(...params, limit);

    const totalRow = db.prepare(`SELECT count(*) AS n FROM memories WHERE ${conditions.join(' AND ')}`).get(...params);

    if (json) return printJson({ holder, total: totalRow.n, returned: rows.length, memories: rows });

    console.log(`Memories held by ${holder.name} (${holder.id}) — ${rows.length} of ${totalRow.n}`);
    printTable(rows.map(r => ({
      createdAt: r.createdAt,
      id: r.id,
      src: r.source,
      imp: r.importance,
      rein: r.reinforcementCount,
      about: r.aboutCharacterId === holder.id ? 'self' : (r.aboutCharacterId || ''),
      summary: truncate(r.summary, 100),
    })));
  } finally {
    db.close();
  }
}

// ---------- verb: characters ----------

// Single-file vault documents the character-properties overlay manages. Must
// stay in sync with `CHARACTER_VAULT_DESCRIPTORS` in
// lib/database/repositories/vault-overlay/. Post-4.6-cutover the vault is the
// only home for these fields.
//
// REQUIRED files are written unconditionally by `writeCharacterVaultManagedFields`
// (empty string when the field is blank), so a healthy character always has all
// of them. The physical-* pair is OPTIONAL: the writer skips both when the
// character has no physicalDescription. It writes them as a pair, so having
// exactly one of the two is an inconsistency worth flagging.
const REQUIRED_VAULT_SINGLE_FILES = [
  'properties.json',
  'identity.md',
  'description.md',
  'personality.md',
  'example-dialogues.md',
];
// manifesto is nullable/optional. The full-projection writer writes an empty
// manifesto.md when the field is blank, but the patch-level write overlay only
// writes it when a patch carries a `manifesto` key — so a perfectly valid
// character can simply lack the file. On read, absent == empty == null, so we
// report manifesto's presence but never count its absence as "missing" or let
// it block. (Treated like the physical-* pair: optional, surfaced, not required.)
const OPTIONAL_VAULT_SINGLE_FILES = [
  'manifesto.md',
];
const PHYSICAL_VAULT_FILES = [
  'physical-description.md',
  'physical-prompts.json',
];

function safeJsonArray(raw) {
  if (raw == null || raw === '') return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function normalizeEmpty(v) {
  if (v == null) return '';
  return v;
}

function inspectCharacterVault(row, mounts) {
  // `flag` / `*Db` / divergence reporting only make sense before the 4.6
  // vault cutover, when the DB still carried the content columns. After
  // the cutover the columns are gone and the vault is the only source of
  // truth — `row` won't carry them. Treat them as null and skip the
  // divergence check; the file-presence count is still useful.
  const preCutover = row.identity !== undefined
    || row.description !== undefined
    || row.systemPrompts !== undefined;

  const status = {
    id: row.id,
    name: row.name,
    flag: row.readPropertiesFromDocumentStore == null
      ? null
      : Number(row.readPropertiesFromDocumentStore),
    mountPointId: row.characterDocumentMountPointId || null,
    vault: 'missing',
    presentSingleFiles: 0,
    expectedSingleFiles: REQUIRED_VAULT_SINGLE_FILES.length,
    missingSingleFiles: [],
    manifestoPresent: false,   // optional single file: present or not, both valid
    physicalFilesPresent: 0,   // 0, 1, or 2 of the optional physical-* pair
    physicalInconsistent: false,
    promptsVault: 0,
    promptsDb: 0,
    scenariosVault: 0,
    scenariosDb: 0,
    wardrobeVault: 0,
    diverged: [],
    issue: null,
    preCutover,
  };

  if (preCutover) {
    status.promptsDb = safeJsonArray(row.systemPrompts).length;
    status.scenariosDb = safeJsonArray(row.scenarios).length;
  }

  if (!row.characterDocumentMountPointId) {
    status.issue = 'no vault';
    return status;
  }

  status.vault = 'present';
  const mountPointId = row.characterDocumentMountPointId;

  // One-shot listing of every link for this vault; the rest is just lookups.
  const links = mounts.prepare(
    'SELECT relativePath, fileId FROM doc_mount_file_links WHERE mountPointId = ?'
  ).all(mountPointId);
  const byPath = new Map();
  for (const link of links) {
    byPath.set(link.relativePath.toLowerCase(), link);
  }

  for (const p of REQUIRED_VAULT_SINGLE_FILES) {
    if (byPath.has(p)) {
      status.presentSingleFiles++;
    } else {
      status.missingSingleFiles.push(p);
    }
  }

  // Manifesto is optional: report presence, never require it.
  status.manifestoPresent = OPTIONAL_VAULT_SINGLE_FILES.every((p) => byPath.has(p));

  // Physical-* files are optional (a character may legitimately have no
  // physical description). Both-or-neither is healthy; exactly one is not.
  status.physicalFilesPresent = PHYSICAL_VAULT_FILES.filter((p) => byPath.has(p)).length;
  status.physicalInconsistent = status.physicalFilesPresent === 1;

  for (const [p] of byPath) {
    if (p.startsWith('prompts/') && p.endsWith('.md')) status.promptsVault++;
    else if (p.startsWith('scenarios/') && p.endsWith('.md')) status.scenariosVault++;
    else if (p.startsWith('wardrobe/') && p.endsWith('.md')) status.wardrobeVault++;
  }

  // Compare vault contents to DB row for each managed field where the
  // corresponding file is actually present. Only meaningful pre-cutover;
  // post-cutover the DB no longer carries the columns to compare against.
  if (preCutover) {
    const docStmt = mounts.prepare(
      'SELECT content FROM doc_mount_documents WHERE fileId = ?'
    );
    const readVault = (relPath) => {
      const link = byPath.get(relPath);
      if (!link) return null;
      const doc = docStmt.get(link.fileId);
      return doc ? doc.content : null;
    };

    const mdFields = [
      ['identity.md', 'identity'],
      ['description.md', 'description'],
      ['manifesto.md', 'manifesto'],
      ['personality.md', 'personality'],
      ['example-dialogues.md', 'exampleDialogues'],
    ];
    for (const [vaultPath, dbField] of mdFields) {
      const vault = readVault(vaultPath);
      if (vault === null) continue;
      const db = row[dbField] ?? '';
      if (vault !== db) status.diverged.push(dbField);
    }

    const propsRaw = readVault('properties.json');
    if (propsRaw !== null) {
      try {
        const props = JSON.parse(propsRaw);
        const scalarChecks = [
          ['pronouns', row.pronouns],
          ['title', row.title],
          ['firstMessage', row.firstMessage],
          ['talkativeness', row.talkativeness],
        ];
        for (const [k, dbVal] of scalarChecks) {
          if (normalizeEmpty(props[k]) !== normalizeEmpty(dbVal)) {
            status.diverged.push(k);
          }
        }
        const vaultAliases = JSON.stringify(Array.isArray(props.aliases) ? props.aliases : []);
        const dbAliases = JSON.stringify(safeJsonArray(row.aliases));
        if (vaultAliases !== dbAliases) status.diverged.push('aliases');
        // systemTransparency: tristate (0 / 1 / null), only reported if vault has it
        if (props.systemTransparency !== undefined) {
          if ((props.systemTransparency ?? null) !== (row.systemTransparency ?? null)) {
            status.diverged.push('systemTransparency');
          }
        }
      } catch {
        status.diverged.push('properties.json:unparseable');
      }
    }

    const physArr = safeJsonArray(row.physicalDescriptions);
    const primary = physArr[0] || null;
    const physMd = readVault('physical-description.md');
    if (physMd !== null) {
      const dbVal = primary && primary.fullDescription != null ? primary.fullDescription : '';
      if (physMd !== dbVal) status.diverged.push('physicalDescription.fullDescription');
    }
    const physJsonRaw = readVault('physical-prompts.json');
    if (physJsonRaw !== null) {
      try {
        const physJson = JSON.parse(physJsonRaw);
        const promptChecks = [
          ['short', primary?.shortPrompt],
          ['medium', primary?.mediumPrompt],
          ['long', primary?.longPrompt],
          ['complete', primary?.completePrompt],
        ];
        for (const [k, dbVal] of promptChecks) {
          if (normalizeEmpty(physJson[k]) !== normalizeEmpty(dbVal)) {
            status.diverged.push(`physical.${k}Prompt`);
          }
        }
      } catch {
        status.diverged.push('physical-prompts.json:unparseable');
      }
    }

    if (status.promptsVault !== status.promptsDb) {
      status.diverged.push(`systemPrompts:count(vault=${status.promptsVault},db=${status.promptsDb})`);
    }
    if (status.scenariosVault !== status.scenariosDb) {
      status.diverged.push(`scenarios:count(vault=${status.scenariosVault},db=${status.scenariosDb})`);
    }
  }

  const anyContent = status.presentSingleFiles > 0
    || status.manifestoPresent
    || status.physicalFilesPresent > 0
    || status.promptsVault > 0
    || status.scenariosVault > 0
    || status.wardrobeVault > 0;
  if (!anyContent) {
    status.issue = 'vault empty';
  } else if (status.missingSingleFiles.length > 0) {
    status.issue = `${status.missingSingleFiles.length} required files missing`;
  } else if (status.physicalInconsistent) {
    status.issue = 'physical files incomplete (1 of 2)';
  } else if (status.diverged.length > 0) {
    status.issue = `diverged (${status.diverged.length})`;
  } else if (!preCutover) {
    status.issue = 'ok (post-cutover, vault is canonical)';
  } else if (status.flag === 1) {
    status.issue = 'ok (vault authoritative)';
  } else {
    status.issue = 'ok (db matches vault)';
  }
  return status;
}

async function cmdCharacters(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const sub = positional[0] || 'status';
  switch (sub) {
    case 'status':
      return cmdCharactersStatus(flags, ctx);
    case 'archives':
      return cmdCharactersArchives(flags, ctx);
    case 'archive':
      return cmdCharactersArchiveVerb('archive', positional[1], flags, ctx);
    case 'rehydrate':
      return cmdCharactersArchiveVerb('rehydrate', positional[1], flags, ctx);
    case 'export':
      return cmdCharactersExport(positional[1], flags, ctx);
    default:
      throw new Error(`Unknown characters subcommand: ${sub}. Try: status, archives, archive, rehydrate, export`);
  }
}

function cmdCharactersStatus(flags, ctx) {
  const json = asBool(flags.json);
  const limit = asInt(flags.limit, 0);
  const onlyDiverged = asBool(flags.diverged);
  const onlyBlocked = asBool(flags.blocked);
  const idQuery = flags.id ? String(flags.id) : null;

  const main = ctx.openMain();
  const mounts = ctx.openMounts();
  try {
    // Probe the schema so this verb works both pre- and post-cutover: after
    // the 4.6 migration the content columns are gone, so we can only ask
    // for what's there.
    const existing = new Set(
      main.prepare('PRAGMA table_info(characters)')
        .all()
        .map(r => r.name)
    );
    const wanted = [
      'id', 'name', 'characterDocumentMountPointId', 'systemTransparency',
      'readPropertiesFromDocumentStore',
      'identity', 'description', 'manifesto', 'personality', 'exampleDialogues',
      'pronouns', 'aliases', 'title', 'firstMessage', 'talkativeness',
      'physicalDescriptions', 'systemPrompts', 'scenarios',
    ];
    const cols = wanted.filter(c => existing.has(c));
    let sql = `SELECT ${cols.join(', ')} FROM characters`;
    const params = [];
    if (idQuery) {
      const c = resolveCharacter(main, idQuery, ctx.openMounts);
      sql += ' WHERE id = ?';
      params.push(c.id);
    } else {
      sql += ' ORDER BY name';
      if (limit > 0) {
        sql += ' LIMIT ?';
        params.push(limit);
      }
    }
    const rows = main.prepare(sql).all(...params);

    const all = rows.map(r => inspectCharacterVault(r, mounts));
    const filtered = all.filter(s => {
      if (onlyBlocked && !(s.issue && (s.issue === 'no vault' || s.issue === 'vault empty' || s.issue.endsWith(' files missing')))) {
        return false;
      }
      if (onlyDiverged && s.diverged.length === 0 && (!s.missingSingleFiles || s.missingSingleFiles.length === 0)) {
        return false;
      }
      return true;
    });

    if (json) {
      const summary = {
        totalScanned: all.length,
        returned: filtered.length,
        counts: summarizeCharacterStatuses(all),
        characters: filtered,
      };
      return printJson(summary);
    }

    const summary = summarizeCharacterStatuses(all);
    let headline = `Scanned ${all.length} character${all.length === 1 ? '' : 's'}: ` +
      `${summary.ok} ok, ${summary.diverged} diverged, ${summary.missingFiles} with missing files, ` +
      `${summary.noVault} with no vault, ${summary.empty} empty`;
    if (summary.physIncomplete > 0) headline += `, ${summary.physIncomplete} with incomplete physical files`;
    headline += '.';
    console.log(headline);
    console.log('');
    // The readPropertiesFromDocumentStore flag and the DB side of the
    // prompts/scenarios counts only exist before the 4.6 cutover. Post-cutover
    // (the normal case now) the vault is canonical, so drop the dead `flag`
    // column and show vault-only counts instead of misleading `vault/db`.
    const anyPreCutover = all.some(s => s.preCutover);
    printTable(filtered.map(s => {
      const missing = s.vault === 'missing';
      const row = { id: s.id.slice(0, 8), name: truncate(s.name, 28) };
      if (anyPreCutover) row.flag = s.flag == null ? '-' : s.flag;
      row.vault = s.vault;
      row.files = missing ? '-' : `${s.presentSingleFiles}/${s.expectedSingleFiles}`;
      row.manifesto = missing ? '-' : (s.manifestoPresent ? 'yes' : 'no');
      row.phys = missing ? '-' : `${s.physicalFilesPresent}/2`;
      row.prompts = missing ? '-' : (anyPreCutover ? `${s.promptsVault}/${s.promptsDb}` : String(s.promptsVault));
      row.scenarios = missing ? '-' : (anyPreCutover ? `${s.scenariosVault}/${s.scenariosDb}` : String(s.scenariosVault));
      row.wardrobe = missing ? '-' : s.wardrobeVault;
      row.status = truncate(s.issue, 60);
      return row;
    }));

    if (filtered.length > 0 && filtered.some(s => s.diverged.length > 0)) {
      console.log('');
      console.log('Run with --json to see the full diverged-field list per character.');
    }
  } finally {
    try { mounts.close(); } catch {}
    try { main.close(); } catch {}
  }
}

function summarizeCharacterStatuses(all) {
  let ok = 0, diverged = 0, missingFiles = 0, noVault = 0, empty = 0, physIncomplete = 0;
  for (const s of all) {
    if (!s.issue) continue;
    if (s.issue.startsWith('ok')) ok++;
    else if (s.issue === 'no vault') noVault++;
    else if (s.issue === 'vault empty') empty++;
    else if (s.issue.endsWith(' files missing')) missingFiles++;
    else if (s.issue.startsWith('physical files incomplete')) physIncomplete++;
    else if (s.issue.startsWith('diverged')) diverged++;
  }
  return { ok, diverged, missingFiles, noVault, empty, physIncomplete };
}

// ---------- characters: archive shelf ----------

const ARCHIVE_MAGIC = Buffer.from('QTAPARC1', 'ascii');
const ARCHIVE_INTERNAL_PASSPHRASE = '__quilltap_no_passphrase__';

/**
 * List archived characters and the ARCHIVE bundle files on the shelf,
 * including loose bundles (files rows no character points at — the survivors
 * of a "keep archived bundles" wipe). Read-only.
 */
function cmdCharactersArchives(flags, ctx) {
  const json = asBool(flags.json);
  const main = ctx.openMain();
  try {
    const cols = new Set(main.prepare('PRAGMA table_info(characters)').all().map(r => r.name));
    if (!cols.has('archivedAt')) {
      console.log('This database predates character archiving (no archivedAt column).');
      return;
    }
    const archived = main.prepare(
      'SELECT id, name, archivedAt, archiveFileId FROM characters WHERE archivedAt IS NOT NULL ORDER BY archivedAt DESC'
    ).all();
    const bundles = main.prepare(
      "SELECT id, originalFilename, storageKey, size, createdAt FROM files WHERE category = 'ARCHIVE' ORDER BY createdAt DESC"
    ).all();

    const referenced = new Set(archived.map(c => c.archiveFileId).filter(Boolean));
    const looseBundles = bundles.filter(b => !referenced.has(b.id));

    if (json) {
      return printJson({ archivedCharacters: archived, bundles, looseBundles });
    }

    if (archived.length === 0 && bundles.length === 0) {
      console.log('The archive shelf stands empty — no archived characters, no bundles.');
      return;
    }

    if (archived.length > 0) {
      console.log(`Archived characters (${archived.length}):`);
      printTable(archived.map(c => ({
        id: c.id.slice(0, 8),
        name: truncate(c.name, 28),
        archivedAt: c.archivedAt,
        bundle: c.archiveFileId ? c.archiveFileId.slice(0, 8) : '(none — pre-bundle tombstone)',
      })));
    }
    if (bundles.length > 0) {
      console.log('');
      console.log(`Archive bundles (${bundles.length}${looseBundles.length > 0 ? `, ${looseBundles.length} loose` : ''}):`);
      printTable(bundles.map(b => ({
        id: b.id.slice(0, 8),
        file: truncate(b.originalFilename, 44),
        bytes: b.size,
        createdAt: b.createdAt,
        state: referenced.has(b.id) ? 'held by character' : 'loose (importable only)',
      })));
    }
  } finally {
    try { main.close(); } catch {}
  }
}

/**
 * Archive or rehydrate a character through the RUNNING server's API. The
 * archive pipeline (export, encryption, prune) and the passphrase cache live
 * in the server process — the CLI cannot run them against the raw database —
 * so the server must be up, and it is the server that holds the instance
 * lock. `--write` is still required as the explicit opt-in to a write.
 */
async function cmdCharactersArchiveVerb(verb, query, flags, ctx) {
  if (!query) {
    throw new Error(`Usage: characters ${verb} <name|id> --write [--port N]`);
  }
  if (!asBool(flags.write)) {
    throw new Error(`characters ${verb} changes data; add --write to proceed.`);
  }
  const port = asInt(flags.port, 3000);

  const main = ctx.openMain();
  let character;
  try {
    character = resolveCharacter(main, String(query), ctx.openMounts);
  } finally {
    try { main.close(); } catch {}
  }

  const url = `http://localhost:${port}/api/v1/characters/${encodeURIComponent(character.id)}?action=${verb}`;
  let res;
  try {
    res = await fetch(url, { method: 'POST' });
  } catch (err) {
    throw new Error(
      `Could not reach the Quilltap server at http://localhost:${port}: ${err.message}\n` +
      `The ${verb} operation runs inside the server (it needs the export pipeline and the ` +
      'unlocked passphrase), so start the server first.'
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `${verb} failed with HTTP ${res.status}`);
  }

  if (asBool(flags.json)) return printJson(body);
  if (verb === 'archive') {
    console.log(
      body.pruneComplete === false
        ? `${character.name} is archived, but the prune did not finish — run the same command again to complete it.`
        : `${character.name} rests in the archive. Bundle file: ${body.archiveFileId || '(none)'}.`
    );
  } else {
    const r = body.restored;
    console.log(
      r
        ? `${character.name} is awake again — ${r.memories} memories, ${r.documents} documents, ${r.blobs} blobs restored.`
        : `${character.name} is awake again.`
    );
    if (body.archiveBundleFileId) {
      console.log(`The archive bundle stays in the file library (file ${body.archiveBundleFileId}); delete it there if you no longer want the spare copy.`);
    }
    for (const w of body.warnings || []) console.log(`warning: ${w}`);
  }
}

/** Parse + decrypt a QTAPARC1 bundle. Returns null on a wrong passphrase. */
function tryDecryptArchiveBundle(data, passphrase) {
  const crypto = require('crypto');
  const headerLength = data.readUInt32BE(ARCHIVE_MAGIC.length);
  const bodyStart = ARCHIVE_MAGIC.length + 4 + headerLength;
  if (headerLength <= 0 || data.length < bodyStart + 16) {
    throw new Error('Archive bundle is truncated (bad header or missing auth tag).');
  }
  const header = JSON.parse(data.subarray(ARCHIVE_MAGIC.length + 4, bodyStart).toString('utf8'));
  const salt = Buffer.from(header.salt, 'hex');
  const iv = Buffer.from(header.iv, 'hex');
  const key = crypto.pbkdf2Sync(passphrase, new Uint8Array(salt), header.kdfIterations, 32, header.kdfDigest);
  const keyHash = crypto.createHash('sha256').update(new Uint8Array(key)).digest('hex');
  if (keyHash !== header.keyHash) return null;

  const ciphertext = data.subarray(bodyStart, data.length - 16);
  const authTag = data.subarray(data.length - 16);
  const decipher = crypto.createDecipheriv(header.algorithm, new Uint8Array(key), new Uint8Array(iv));
  decipher.setAuthTag(new Uint8Array(authTag));
  return Buffer.concat([decipher.update(new Uint8Array(ciphertext)), decipher.final()]);
}

/**
 * Export a character as a plaintext `.qtap` — the interchange escape hatch.
 *
 * Archived characters: decrypt their bundle straight off the disk (offline;
 * prompts for the passphrase on protected instances). This is the only way to
 * reach an archived character's packed-away material — mail, photographs,
 * summaries — without rehydrating. Live characters: proxy to the running
 * server's export pipeline. Read-only either way.
 */
async function cmdCharactersExport(query, flags, ctx) {
  if (!query) {
    throw new Error('Usage: characters export <name|id> [--out <path>] [--port N]');
  }

  const main = ctx.openMain();
  let character;
  let archiveFile = null;
  try {
    character = resolveCharacter(main, String(query), ctx.openMounts);
    const cols = new Set(main.prepare('PRAGMA table_info(characters)').all().map(r => r.name));
    if (cols.has('archivedAt')) {
      const row = main.prepare('SELECT archivedAt, archiveFileId FROM characters WHERE id = ?').get(character.id);
      if (row && row.archivedAt && row.archiveFileId) {
        archiveFile = main.prepare('SELECT id, storageKey, sha256 FROM files WHERE id = ?').get(row.archiveFileId);
        if (!archiveFile) {
          throw new Error(`${character.name} is archived but their bundle file row (${row.archiveFileId}) is missing.`);
        }
      } else if (row && row.archivedAt) {
        throw new Error(`${character.name} is a pre-bundle tombstone (no archive bundle exists to export).`);
      }
    }
  } finally {
    try { main.close(); } catch {}
  }

  const safeName = String(character.name || character.id).replace(/[\\/:*?"<>|]/g, '_');
  const outPath = path.resolve(flags.out ? String(flags.out) : `${safeName}.qtap`);

  let plaintext;
  if (archiveFile) {
    if (!archiveFile.storageKey) {
      throw new Error('The bundle row has no storage key; the file was never written.');
    }
    const bundlePath = path.join(ctx.dataDir, '..', 'files', archiveFile.storageKey);
    if (!fs.existsSync(bundlePath)) {
      throw new Error(`Bundle bytes not found on disk: ${bundlePath}`);
    }
    const data = fs.readFileSync(bundlePath);

    if (!data.subarray(0, ARCHIVE_MAGIC.length).equals(ARCHIVE_MAGIC)) {
      // Pre-encryption plaintext bundle — pass it through untouched.
      plaintext = data;
    } else {
      plaintext = tryDecryptArchiveBundle(data, ARCHIVE_INTERNAL_PASSPHRASE);
      if (plaintext === null && process.env.QUILLTAP_DB_PASSPHRASE) {
        plaintext = tryDecryptArchiveBundle(data, process.env.QUILLTAP_DB_PASSPHRASE);
      }
      if (plaintext === null) {
        const { promptPassphrase } = require('./db-helpers');
        const pass = await promptPassphrase('Archive passphrase: ');
        if (pass) plaintext = tryDecryptArchiveBundle(data, pass);
      }
      if (plaintext === null) {
        throw new Error(
          'That passphrase does not open this archive. If you changed your passphrase and this ' +
          'bundle was reported left behind, it still wants the old one.'
        );
      }
    }
  } else {
    // Live character: the export pipeline lives in the server.
    const port = asInt(flags.port, 3000);
    const url = `http://localhost:${port}/api/v1/system/tools?action=export`;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'characters',
          scope: 'selected',
          selectedIds: [character.id],
          includeMemories: true,
        }),
      });
    } catch (err) {
      throw new Error(
        `Could not reach the Quilltap server at http://localhost:${port}: ${err.message}\n` +
        'Exporting a live character runs the server\'s export pipeline, so start the server first. ' +
        '(Archived characters export offline from their bundle.)'
      );
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Export failed with HTTP ${res.status}`);
    }
    plaintext = Buffer.from(await res.arrayBuffer());
  }

  fs.writeFileSync(outPath, plaintext);
  console.log(`Wrote ${plaintext.length} bytes to ${outPath}`);
  if (archiveFile) {
    console.log('This is the decrypted archive bundle — a plaintext .qtap. Guard it accordingly.');
  }
}

// ---------- verb: optimize ----------

const OPTIMIZE_TARGETS = {
  'main':         { filename: 'quilltap.db',              label: 'main' },
  'llm-logs':     { filename: 'quilltap-llm-logs.db',     label: 'llm-logs' },
  'mount-points': { filename: 'quilltap-mount-index.db',  label: 'mount-points' },
};

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${(ms / 60_000).toFixed(2)} min`;
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function cmdOptimize(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const json = asBool(flags.json);

  // Resolve target list
  let targets;
  if (positional.length === 0 || (positional.length === 1 && positional[0] === 'all')) {
    targets = Object.keys(OPTIMIZE_TARGETS);
  } else {
    targets = positional.map(p => {
      if (!OPTIMIZE_TARGETS[p]) {
        const allowed = Object.keys(OPTIMIZE_TARGETS).join(' | ');
        throw new Error(`Unknown optimize target '${p}'. Allowed: ${allowed} | all`);
      }
      return p;
    });
  }

  // Refuse to proceed if any instance is actively holding the lock.
  const lockStatus = getLockStatus(ctx.dataDir);
  if (lockStatus.state === 'active' || lockStatus.state === 'suspect') {
    const msg = lockStatus.state === 'active'
      ? `Database is currently in use — ${lockStatus.reason}.\n` +
        `Stop the running Quilltap instance before optimizing, then try again.\n` +
        `(See \`quilltap db --lock-status\` for details.)`
      : `Lock file ${lockStatus.reason}.\n` +
        `This may be a stale lock from a reused PID. Inspect it with\n` +
        `\`quilltap db --lock-status\` and clean it up with \`quilltap db --lock-clean\` if safe.`;
    const err = new Error(msg);
    err.locked = true;
    throw err;
  }
  if (lockStatus.state === 'corrupt') {
    throw new Error(
      `Lock file at ${lockStatus.lockPath} is corrupt. Inspect it manually or clean with ` +
      `\`quilltap db --lock-clean\`, then retry.`,
    );
  }

  const results = [];
  for (const key of targets) {
    const target = OPTIMIZE_TARGETS[key];
    const dbPath = path.join(ctx.dataDir, target.filename);
    if (!fs.existsSync(dbPath)) {
      if (!json) console.log(`Skipping ${target.label}: ${dbPath} not found.`);
      results.push({ target: target.label, skipped: true, reason: 'not found' });
      continue;
    }
    const result = optimizeOneDb(key, dbPath, ctx);
    results.push(result);
  }

  if (json) {
    printJson({ results });
    return;
  }

  // Final summary
  const totalSaved = results
    .filter(r => !r.skipped && r.sizeBefore != null && r.sizeAfter != null)
    .reduce((acc, r) => acc + (r.sizeBefore - r.sizeAfter), 0);
  if (totalSaved > 0) {
    console.log('');
    console.log(`Total reclaimed: ${formatBytes(totalSaved)}`);
  }
}

function optimizeOneDb(key, dbPath, ctx) {
  const target = OPTIMIZE_TARGETS[key];
  const opener = key === 'main' ? openMainDb : key === 'llm-logs' ? openLlmLogsDb : openMountIndexDb;

  console.log('');
  console.log(`── ${target.label}  (${dbPath}) ──`);
  const sizeBefore = fileSize(dbPath);
  console.log(`  size before: ${formatBytes(sizeBefore)}`);

  let db;
  try {
    db = opener(ctx.dataDir, ctx.pepper, { readonly: false });
  } catch (err) {
    console.log(`  open failed: ${err.message}`);
    return { target: target.label, skipped: true, reason: err.message };
  }

  const steps = [];
  function runStep(name, fn) {
    const t0 = Date.now();
    let info = '';
    try {
      info = fn() || '';
    } catch (err) {
      const elapsed = Date.now() - t0;
      console.log(`  ${name}: FAILED after ${formatDuration(elapsed)} — ${err.message}`);
      steps.push({ name, ok: false, ms: elapsed, error: err.message });
      throw err;
    }
    const elapsed = Date.now() - t0;
    console.log(`  ${name}: ${formatDuration(elapsed)}${info ? ` (${info})` : ''}`);
    steps.push({ name, ok: true, ms: elapsed });
  }

  try {
    runStep('VACUUM',          () => { db.exec('VACUUM'); });
    runStep('ANALYZE',         () => { db.exec('ANALYZE'); });
    runStep('PRAGMA optimize', () => { db.pragma('optimize'); });
  } catch {
    try { db.close(); } catch {}
    return { target: target.label, skipped: false, sizeBefore, sizeAfter: fileSize(dbPath), steps };
  } finally {
    try { db.close(); } catch {}
  }

  const sizeAfter = fileSize(dbPath);
  const delta = sizeBefore - sizeAfter;
  const deltaStr = delta === 0
    ? 'no change'
    : delta > 0
      ? `reclaimed ${formatBytes(delta)}`
      : `grew by ${formatBytes(-delta)}`;
  console.log(`  size after:  ${formatBytes(sizeAfter)}  (${deltaStr})`);
  return { target: target.label, skipped: false, sizeBefore, sizeAfter, steps };
}

// ---------- verb: backup ----------

// Targets mirror OPTIMIZE_TARGETS but live separately so the verb can grow
// its own per-target metadata (e.g. exclude logs) without disturbing optimize.
const BACKUP_TARGETS = OPTIMIZE_TARGETS;
const INTEGRITY_TARGETS = OPTIMIZE_TARGETS;

function isoTimestampForDir() {
  // 2026-05-20T14-32-07
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '').slice(0, 19);
}

function resolveBackupTargets(positional) {
  if (positional.length === 0 || (positional.length === 1 && positional[0] === 'all')) {
    return Object.keys(BACKUP_TARGETS);
  }
  return positional.map(p => {
    if (!BACKUP_TARGETS[p]) {
      const allowed = Object.keys(BACKUP_TARGETS).join(' | ');
      throw new Error(`Unknown backup target '${p}'. Allowed: ${allowed} | all`);
    }
    return p;
  });
}

async function cmdBackup(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const json = asBool(flags.json);
  const out = typeof flags.out === 'string' ? flags.out : '';

  const targets = resolveBackupTargets(positional);

  // Backups are safe while the server is running — page-level online copy.
  // Log the situation and proceed; do not refuse.
  const lockStatus = getLockStatus(ctx.dataDir);
  if (!json && (lockStatus.state === 'active' || lockStatus.state === 'suspect')) {
    const pidPart = lockStatus.lock && lockStatus.lock.pid ? ` (PID ${lockStatus.lock.pid})` : '';
    console.log(`Live instance detected${pidPart} — taking online snapshot.`);
  }

  // Resolve destination directory. Default: <dataDir>/backups/<ISO-timestamp>/
  const destDir = out
    ? (out.startsWith('~') ? path.join(require('os').homedir(), out.slice(1)) : out)
    : path.join(ctx.dataDir, 'backups', isoTimestampForDir());
  fs.mkdirSync(destDir, { recursive: true });

  if (!json) {
    console.log(`Destination: ${destDir}`);
  }

  const results = [];
  for (const key of targets) {
    const target = BACKUP_TARGETS[key];
    const sourcePath = path.join(ctx.dataDir, target.filename);
    if (!fs.existsSync(sourcePath)) {
      if (!json) console.log(`Skipping ${target.label}: ${sourcePath} not found.`);
      results.push({ target: target.label, source: sourcePath, skipped: true, ok: false, reason: 'not found' });
      continue;
    }
    const result = await backupOneDb(key, sourcePath, destDir, ctx);
    results.push(result);
  }

  const okCount = results.filter(r => r.ok).length;
  const totalBytes = results.filter(r => r.ok && r.destSize != null).reduce((acc, r) => acc + r.destSize, 0);

  if (json) {
    printJson({ destDir, results, summary: { ok: okCount, total: results.length, totalBytes } });
    return;
  }

  console.log('');
  console.log(`Snapshot complete: ${okCount}/${results.length} target${results.length === 1 ? '' : 's'} (${formatBytes(totalBytes)} written).`);

  if (okCount !== results.length) {
    // Surface failure via non-zero exit so scripts can pick it up.
    const err = new Error('one or more snapshots failed');
    err.silent = true;
    throw err;
  }
}

async function backupOneDb(key, sourcePath, destDir, ctx) {
  const target = BACKUP_TARGETS[key];
  const opener = key === 'main' ? openMainDb : key === 'llm-logs' ? openLlmLogsDb : openMountIndexDb;
  const destPath = path.join(destDir, target.filename);

  console.log('');
  console.log(`── ${target.label}  (${sourcePath}) ──`);
  const sourceSize = fileSize(sourcePath);
  console.log(`  source size: ${formatBytes(sourceSize)}`);

  if (fs.existsSync(destPath)) {
    console.log(`  refusing: destination ${destPath} already exists`);
    return { target: target.label, source: sourcePath, sourceSize, dest: destPath, ok: false, error: 'destination exists' };
  }

  // Open source RW. We need write capability for `wal_checkpoint(TRUNCATE)`
  // and `BEGIN EXCLUSIVE`. The lock is held only for the duration of the
  // file copy itself.
  let src;
  try {
    src = opener(ctx.dataDir, ctx.pepper, { readonly: false });
  } catch (err) {
    console.log(`  open failed: ${err.message}`);
    return { target: target.label, source: sourcePath, sourceSize, dest: destPath, ok: false, error: err.message };
  }

  // The SQLCipher build in this driver does not expose `sqlcipher_export`
  // and the SQLite online-backup API refuses cross-cipher copies. We
  // instead take a brief exclusive lock, force a WAL checkpoint, and copy
  // the encrypted .db file at the byte level — the pages are already
  // encrypted in the source, so the destination inherits the key.
  const t0 = Date.now();
  let inTxn = false;
  try {
    src.exec('BEGIN EXCLUSIVE');
    inTxn = true;
    try { src.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
    fs.copyFileSync(sourcePath, destPath);
    src.exec('COMMIT');
    inTxn = false;
  } catch (err) {
    if (inTxn) { try { src.exec('ROLLBACK'); } catch {} }
    try { src.close(); } catch {}
    try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
    console.log(`  backup failed: ${err.message}`);
    return { target: target.label, source: sourcePath, sourceSize, dest: destPath, ok: false, error: err.message, durationMs: Date.now() - t0 };
  } finally {
    try { src.close(); } catch {}
  }
  const durationMs = Date.now() - t0;
  const destSize = fileSize(destPath);
  console.log(`  dest: ${destPath}`);
  console.log(`  dest size:   ${formatBytes(destSize)}  (${formatDuration(durationMs)})`);

  // Post-flight: open the snapshot with the same key and run quick_check.
  let verifyDb;
  try {
    verifyDb = openEncryptedDb(destPath, ctx.pepper, { readonly: true, friendlyName: `snapshot of ${target.label}` });
  } catch (err) {
    console.log(`  verify failed: ${err.message}`);
    return { target: target.label, source: sourcePath, sourceSize, dest: destPath, destSize, durationMs, ok: false, error: `verify open failed: ${err.message}` };
  }
  try {
    const rows = verifyDb.pragma('quick_check');
    const result = rows && rows[0] ? (rows[0].integrity_check || rows[0].quick_check || Object.values(rows[0])[0]) : 'unknown';
    if (result !== 'ok') {
      console.log(`  verify failed: quick_check returned ${result}`);
      return { target: target.label, source: sourcePath, sourceSize, dest: destPath, destSize, durationMs, ok: false, error: `quick_check: ${result}` };
    }
    console.log(`  verify: ok`);
  } catch (err) {
    console.log(`  verify failed: ${err.message}`);
    return { target: target.label, source: sourcePath, sourceSize, dest: destPath, destSize, durationMs, ok: false, error: err.message };
  } finally {
    try { verifyDb.close(); } catch {}
  }

  return { target: target.label, source: sourcePath, sourceSize, dest: destPath, destSize, durationMs, ok: true };
}

// ---------- verb: integrity ----------

function cmdIntegrity(args, ctx) {
  const { flags, positional } = parseSubArgs(args);
  const json = asBool(flags.json);

  let targets;
  if (positional.length === 0 || (positional.length === 1 && positional[0] === 'all')) {
    targets = Object.keys(INTEGRITY_TARGETS);
  } else {
    targets = positional.map(p => {
      if (!INTEGRITY_TARGETS[p]) {
        const allowed = Object.keys(INTEGRITY_TARGETS).join(' | ');
        throw new Error(`Unknown integrity target '${p}'. Allowed: ${allowed} | all`);
      }
      return p;
    });
  }

  // Read-only — safe alongside a running instance. Log it once if active.
  const lockStatus = getLockStatus(ctx.dataDir);
  if (!json && (lockStatus.state === 'active' || lockStatus.state === 'suspect')) {
    const pidPart = lockStatus.lock && lockStatus.lock.pid ? ` (PID ${lockStatus.lock.pid})` : '';
    console.log(`Live instance detected${pidPart} — running read-only checks.`);
  }

  const results = [];
  for (const key of targets) {
    const target = INTEGRITY_TARGETS[key];
    const dbPath = path.join(ctx.dataDir, target.filename);
    if (!fs.existsSync(dbPath)) {
      if (!json) console.log(`Skipping ${target.label}: ${dbPath} not found.`);
      results.push({ target: target.label, ok: false, openable: false, issues: [], reason: 'not found' });
      continue;
    }
    const result = integrityOneDb(key, dbPath, ctx);
    results.push(result);
  }

  const anyOpenFailed = results.some(r => r.openable === false && r.reason !== 'not found');
  const anyIssues = results.some(r => r.openable !== false && !r.ok);

  if (json) {
    printJson({ results });
  } else {
    console.log('');
    if (!anyIssues && !anyOpenFailed) {
      console.log('All databases reported ok.');
    } else if (anyOpenFailed) {
      console.log('One or more databases could not be opened.');
    } else {
      console.log('One or more databases reported integrity issues — see above.');
    }
  }

  if (anyOpenFailed) {
    const err = new Error('database open failure');
    err.silent = true;
    err.exitCode = 2;
    throw err;
  }
  if (anyIssues) {
    const err = new Error('integrity issues detected');
    err.silent = true;
    err.exitCode = 1;
    throw err;
  }
}

function integrityOneDb(key, dbPath, ctx) {
  const target = INTEGRITY_TARGETS[key];
  const opener = key === 'main' ? openMainDb : key === 'llm-logs' ? openLlmLogsDb : openMountIndexDb;

  console.log('');
  console.log(`── ${target.label}  (${dbPath}) ──`);

  let db;
  try {
    db = opener(ctx.dataDir, ctx.pepper, { readonly: true });
  } catch (err) {
    console.log(`  open failed: ${err.message}`);
    return { target: target.label, ok: false, openable: false, issues: [], reason: err.message };
  }

  const issues = [];
  let cipherCheck = null;
  let integrityCheck = null;
  const t0 = Date.now();
  try {
    try {
      const rows = db.pragma('cipher_integrity_check');
      if (rows && rows.length === 0) {
        cipherCheck = 'ok';
        console.log('  cipher_integrity_check: ok');
      } else {
        const lines = rows.map(r => (r.cipher_integrity_check || Object.values(r)[0] || '')).filter(Boolean);
        if (lines.length === 1 && lines[0] === 'ok') {
          cipherCheck = 'ok';
          console.log('  cipher_integrity_check: ok');
        } else {
          cipherCheck = lines.join('; ');
          for (const line of lines) {
            console.log(`  cipher_integrity_check: ${line}`);
            issues.push({ pragma: 'cipher_integrity_check', message: line });
          }
        }
      }
    } catch (err) {
      // Plain SQLite has no cipher_integrity_check; treat as N/A and continue.
      cipherCheck = `n/a (${err.message})`;
      console.log(`  cipher_integrity_check: n/a (${err.message})`);
    }

    const integRows = db.pragma('integrity_check');
    const lines = integRows.map(r => (r.integrity_check || Object.values(r)[0] || '')).filter(Boolean);
    if (lines.length === 1 && lines[0] === 'ok') {
      integrityCheck = 'ok';
      console.log('  integrity_check:        ok');
    } else {
      integrityCheck = lines.join('; ');
      for (const line of lines) {
        console.log(`  integrity_check:        ${line}`);
        issues.push({ pragma: 'integrity_check', message: line });
      }
    }
  } finally {
    try { db.close(); } catch {}
  }
  const durationMs = Date.now() - t0;
  console.log(`  duration: ${formatDuration(durationMs)}`);

  const ok = (cipherCheck === 'ok' || cipherCheck === null || (typeof cipherCheck === 'string' && cipherCheck.startsWith('n/a')))
    && integrityCheck === 'ok';
  return {
    target: target.label,
    ok,
    openable: true,
    cipherIntegrityCheck: cipherCheck,
    integrityCheck,
    issues,
    durationMs,
  };
}

// ---------- dispatch ----------

const VERBS = {
  schema: cmdSchema,
  find: cmdFind,
  chats: cmdChats,
  messages: cmdMessages,
  logs: cmdLogs,
  message: cmdMessage,
  log: cmdLog,
  memories: cmdMemories,
  characters: cmdCharacters,
  optimize: cmdOptimize,
  backup: cmdBackup,
  integrity: cmdIntegrity,
};

function isVerb(arg) {
  return Object.prototype.hasOwnProperty.call(VERBS, arg);
}

async function runVerb(args, ctx) {
  const [verb, ...rest] = args;
  const handler = VERBS[verb];
  if (!handler) throw new Error(`Unknown db subcommand: ${verb}`);
  return handler(rest, ctx);
}

function makeCtx(dataDir, pepper) {
  return {
    dataDir,
    pepper,
    openMain:   () => openMainDb(dataDir, pepper, { readonly: true }),
    openLogs:   () => openLlmLogsDb(dataDir, pepper, { readonly: true }),
    openMounts: () => openMountIndexDb(dataDir, pepper, { readonly: true }),
  };
}

module.exports = {
  VERBS,
  isVerb,
  runVerb,
  makeCtx,
  DB_DOMAINS,
  TABLE_DB,
  ddlAnchor,
};
