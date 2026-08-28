/**
 * Self-Inventory — section formatters (the RENDER half).
 *
 * Pure functions that turn the structured `SelfInventory*Section` objects built
 * by `builders.ts` into the markdown report. `formatSelfInventoryResults` is the
 * public entry point, re-exported from `../self-inventory-handler.ts`.
 */

import { formatBytes } from '@/lib/utils/format-bytes';
import type { SelfInventoryToolOutput, SelfInventoryVaultSection, SelfInventoryVaultCharacterSection, SelfInventoryVaultGroupsSection, SelfInventoryVaultFile, SelfInventoryVaultAccessSection, SelfInventoryVaultAccessCharacterSection, SelfInventoryVaultAccessGroupsSection, SelfInventoryVaultAccessParticipant, SelfInventoryMemorySection, SelfInventoryLoadedMemoriesSection, SelfInventoryChatSection, SelfInventoryPromptSection, SelfInventoryLastTurnSection, SelfInventoryCarinaSection, SelfInventoryQuilltapSection, SelfInventoryRuntimeMode, SelfInventoryContextSection, SelfInventoryContextChat, SelfInventoryContextProject, SelfInventoryContextGroups, SelfInventoryContextCharacters, SelfInventoryContextFiles } from '../../self-inventory-tool';
import { formatNumber, formatDate } from './helpers';

function formatVaultFileLine(f: SelfInventoryVaultFile): string {
  return `- ${f.relativePath}  [${f.fileType}, ${formatBytes(f.fileSizeBytes)}, modified ${formatDate(f.lastModified)}]`;
}

function formatVaultCharacter(section: SelfInventoryVaultCharacterSection): string {
  if (!section.available) {
    return `## Character Vault\nUnavailable — ${section.message}`;
  }

  const header = `## Character Vault\nMount point: ${section.mountPointName} (${section.fileCount} file${section.fileCount === 1 ? '' : 's'})`;
  if (section.files.length === 0) {
    return `${header}\n(no files)`;
  }

  const lines = section.files.map(formatVaultFileLine);
  const footer = `(To read one of these files: doc_read_file({ uri: "qtap://self/<relativePath>" }) — the reserved authority 'self' always addresses your own vault, whatever its name. The triple form doc_read_file(scope='document_store', mount_point='self', path='<relativePath>') still works, as do the name '${section.mountPointName}' and its ID.)`;
  return `${header}\n${lines.join('\n')}\n${footer}`;
}

function formatVaultGroups(section: SelfInventoryVaultGroupsSection): string {
  if (!section.available) {
    return `## Group Vaults\nUnavailable — ${section.message}`;
  }
  if (section.groups.length === 0) {
    return `## Group Vaults\n(no group vaults)`;
  }

  const blocks = section.groups.map((g) => {
    const head = `### ${g.groupName} — ${g.mountPointName} (${g.fileCount} file${g.fileCount === 1 ? '' : 's'})`;
    if (g.files.length === 0) {
      return `${head}\n(no files)`;
    }
    const lines = g.files.map(formatVaultFileLine);
    const footer = `(To read a file: doc_read_file({ uri: "qtap://${g.mountPointName}/<relativePath>" }) — or doc_read_file(scope='document_store', mount_point='${g.mountPointName}', path='<relativePath>'))`;
    return `${head}\n${lines.join('\n')}\n${footer}`;
  });

  return [`## Group Vaults`, ...blocks].join('\n\n');
}

function formatVaultSection(section: SelfInventoryVaultSection): string {
  const parts: string[] = [];
  if (section.character) parts.push(formatVaultCharacter(section.character));
  if (section.groups) parts.push(formatVaultGroups(section.groups));
  return parts.join('\n\n');
}

function formatVaultAccessCharacter(section: SelfInventoryVaultAccessCharacterSection): string {
  if (!section.available) {
    return `## Vault Access — Character (this chat)\nUnavailable — ${section.message}`;
  }

  const toggleLine = section.sharedVaultsEnabled
    ? `Shared Vaults: ON — other present characters can read this vault.`
    : `Shared Vaults: OFF — only the owner and user persona can access this vault via chat tools.`;

  const readWrite = section.participants.filter((p) => p.access === 'read_write');
  const readOnly = section.participants.filter((p) => p.access === 'read_only');

  const formatParticipant = (p: SelfInventoryVaultAccessParticipant): string => {
    const tags: string[] = [];
    if (p.isSelf) tags.push('self');
    if (p.controlledBy === 'user') tags.push('user persona');
    if (p.status === 'silent') tags.push('silent');
    const tagSuffix = tags.length > 0 ? ` (${tags.join(', ')})` : '';
    return `- ${p.characterName}${tagSuffix}`;
  };

  const rwBlock =
    readWrite.length === 0
      ? '(none)'
      : readWrite.map(formatParticipant).join('\n');
  const roBlock =
    readOnly.length === 0
      ? '(none)'
      : readOnly.map(formatParticipant).join('\n');

  return [
    `## Vault Access — Character (this chat)`,
    `Mount point: ${section.mountPointName}`,
    toggleLine,
    `Read/Write:`,
    rwBlock,
    `Read-only:`,
    roBlock,
  ].join('\n');
}

function formatVaultAccessGroups(section: SelfInventoryVaultAccessGroupsSection): string {
  if (!section.available) {
    return `## Vault Access — Groups\nUnavailable — ${section.message}`;
  }
  if (section.groups.length === 0) {
    return `## Vault Access — Groups\n(no groups)`;
  }

  const blocks = section.groups.map((g) => {
    const head = `### ${g.groupName}`;
    if (g.members.length === 0) {
      return `${head}\n(no members)`;
    }
    const lines = g.members.map(
      (m) => `- ${m.characterName}${m.isSelf ? ' (self)' : ''} — read/write`
    );
    return `${head}\nAll members can read and write this group's vault, in any chat:\n${lines.join('\n')}`;
  });

  return [`## Vault Access — Groups`, ...blocks].join('\n\n');
}

function formatVaultAccessSection(section: SelfInventoryVaultAccessSection): string {
  const parts: string[] = [];
  if (section.character) parts.push(formatVaultAccessCharacter(section.character));
  if (section.groups) parts.push(formatVaultAccessGroups(section.groups));
  return parts.join('\n\n');
}

function formatLoadedMemoriesSection(section: SelfInventoryLoadedMemoriesSection): string {
  if (!section.available) {
    return `## Memories Loaded This Turn\nUnavailable — ${section.message}`;
  }

  const parts: string[] = [`## Memories Loaded This Turn`];

  if (section.recap) {
    parts.push(`### Memory Recap`);
    parts.push(section.recap);
  }

  if (section.semanticMemories.length > 0) {
    parts.push(`### Relevant Memories (${section.semanticMemories.length})`);
    for (const m of section.semanticMemories) {
      parts.push(
        `- [importance ${m.importance.toFixed(2)}, score ${m.score.toFixed(2)}, weight ${m.effectiveWeight.toFixed(2)}] ${m.summary}`
      );
    }
  } else {
    parts.push(`### Relevant Memories\n(none loaded this turn)`);
  }

  if (section.interCharacterMemories.length > 0) {
    parts.push(`### Memories About Other Characters (${section.interCharacterMemories.length})`);
    for (const m of section.interCharacterMemories) {
      parts.push(`- About ${m.aboutCharacterName} [importance ${m.importance.toFixed(2)}]: ${m.summary}`);
    }
  }

  return parts.join('\n');
}

function formatMemorySection(section: SelfInventoryMemorySection): string {
  if (!section.available) {
    return `## Memory Stats\nUnavailable — ${section.message ?? 'unknown error'}`;
  }
  return [
    `## Memory Stats`,
    `Total memories: ${formatNumber(section.totalCount)}`,
    `High-importance (>= ${section.threshold}): ${formatNumber(section.highImportanceCount)} (${section.highImportancePercent}%)`,
  ].join('\n');
}

function formatChatsSection(section: SelfInventoryChatSection): string {
  if (!section.available) {
    return `## Conversation Stats\nUnavailable — ${section.message ?? 'unknown error'}`;
  }
  if (section.chatCount === 0) {
    return `## Conversation Stats\nChats: 0\n(no conversations yet)`;
  }
  return [
    `## Conversation Stats`,
    `Chats: ${formatNumber(section.chatCount)}`,
    `Earliest created: ${section.earliestCreatedAt ?? '(unknown)'}`,
    `Most recent activity: ${section.latestActivityAt ?? '(unknown)'}`,
  ].join('\n');
}

function formatPromptSection(section: SelfInventoryPromptSection): string {
  if (!section.available) {
    return `## Assembled System Prompt\nUnavailable — ${section.message ?? 'unknown error'}`;
  }
  return [
    `## Assembled System Prompt`,
    `${formatNumber(section.characterCount)} chars, ~${formatNumber(section.approxTokens ?? 0)} tokens`,
    `(Excludes per-turn tool instructions, memory blocks, conversation history, and wardrobe/status notifications.)`,
    ``,
    `---`,
    section.systemPrompt ?? '',
    `---`,
  ].join('\n');
}

function formatLastTurnSection(section: SelfInventoryLastTurnSection): string {
  if (!section.available) {
    return `## Last-Turn LLM Usage\nUnavailable — ${section.message ?? 'unknown error'}`;
  }

  const sourceLabel =
    section.source === 'llm_log'
      ? `llm_log (logged ${section.loggedAt ?? 'unknown'})`
      : `profile_fallback (no LLM call recorded yet for this chat)`;

  const promptTokens = section.promptTokens ?? 0;
  const completionTokens = section.completionTokens ?? 0;
  const totalTokens = section.totalTokens ?? 0;

  const tokenLine = `Tokens: ${formatNumber(promptTokens)} prompt + ${formatNumber(completionTokens)} completion = ${formatNumber(totalTokens)} total`;
  const windowLine = section.contextWindow
    ? `Context window: ${formatNumber(section.contextWindow)} (utilization: ${section.utilizationPercent ?? 0}%)`
    : `Context window: (unknown)`;

  return [
    `## Last-Turn LLM Usage`,
    `Source: ${sourceLabel}`,
    `Provider: ${section.provider ?? '(unknown)'} / ${section.modelName ?? '(unknown)'}`,
    tokenLine,
    windowLine,
  ].join('\n');
}

function formatCarinaSection(section: SelfInventoryCarinaSection): string {
  if (!section.available) {
    return `## Carina\nUnavailable — ${section.message}`;
  }

  const selfLine = section.selfEnabled
    ? `You ARE a Carina answerer — others can put quick questions to you with @YourName: (public) or @YourName? (whisper), and the ask_carina tool can route to you. Because you are an answerer, a Carina line opens to ANY character (a line opens when either side is an answerer), so you can reach everyone listed below. Queries reach the other party in isolation (no chat history), and the reply renders under the answerer's own avatar.`
    : `You are NOT a Carina answerer — you cannot be addressed with @-queries or reached via the ask_carina tool. You can still reach the Carina answerers listed below (a line opens when either side is an answerer).`;

  let reachBlock: string;
  if (section.reachable.length === 0) {
    reachBlock = section.selfEnabled
      ? `Characters you can reach via Carina: (none — there are no other characters)`
      : `Carina answerers you can reach: (none)`;
  } else if (section.selfEnabled) {
    reachBlock = [
      `Characters you can reach via Carina (${section.reachable.length}):`,
      ...section.reachable.map(
        (r) => `- ${r.name}${r.isAnswerer ? ' (also a Carina answerer)' : ''}`
      ),
    ].join('\n');
  } else {
    reachBlock = [
      `Carina answerers you can reach (${section.reachable.length}):`,
      ...section.reachable.map((r) => `- ${r.name}`),
    ].join('\n');
  }

  return [`## Carina`, selfLine, ``, reachBlock].join('\n');
}

const RUNTIME_MODE_LABELS: Record<SelfInventoryRuntimeMode, string> = {
  'local-dev': 'Local (development)',
  'local-production': 'Local (production)',
  'docker': 'Docker',
  'electron': 'Electron desktop app',
  'electron-docker': 'Electron + Docker',
};

function formatQuilltapSection(section: SelfInventoryQuilltapSection): string {
  if (!section.available) {
    return `## Quilltap\nUnavailable — ${section.message ?? 'unknown error'}`;
  }

  const parts: string[] = [`## Quilltap`];

  if (section.includedParts.version) {
    parts.push(
      `Version: ${section.version}`,
      `Runtime: ${RUNTIME_MODE_LABELS[section.runtimeMode] ?? section.runtimeMode}`,
    );
    if (section.clientShell.type === 'electron') {
      parts.push(`Client: Electron shell v${section.clientShell.shellVersion}`);
    } else if (section.clientShell.type === 'browser') {
      parts.push(`Client: Web browser`);
    } else {
      parts.push(`Client: (unknown)`);
    }
  }

  if (section.includedParts.releaseNotes) {
    if (section.releaseNotes) {
      parts.push('', `### Release Notes (v${section.releaseNotesVersion})`, section.releaseNotes);
    } else {
      parts.push('', `### Release Notes`, '(no release notes found for this version)');
    }
  }

  if (section.includedParts.changelog) {
    if (section.changelog) {
      parts.push('', `### Changelog`, section.changelog);
    } else {
      parts.push('', `### Changelog`, '(changelog not available)');
    }
  }

  return parts.join('\n');
}

function formatContextChat(chat: SelfInventoryContextChat): string {
  if (!chat.available) {
    return `### This Chat\nUnavailable — ${chat.message ?? 'unknown error'}`;
  }
  return [`### This Chat`, `- Name: ${chat.title ?? '(untitled)'}`, `- ID: ${chat.chatId}`].join('\n');
}

function formatContextProject(project: SelfInventoryContextProject): string {
  if (!project.available) {
    return `### Project\nUnavailable — ${project.message}`;
  }
  if (!project.present) {
    return `### Project\n(this chat is not part of a project)`;
  }
  const stores =
    project.mountPoints.length > 0
      ? project.mountPoints.map((m) => m.name).join(', ')
      : '(none)';
  return [
    `### Project`,
    `- Name: ${project.name}`,
    `- ID: ${project.id}`,
    `- Linked stores: ${stores}`,
  ].join('\n');
}

function formatContextGroups(groups: SelfInventoryContextGroups): string {
  if (!groups.available) {
    return `### Your Groups\nUnavailable — ${groups.message}`;
  }
  if (groups.groups.length === 0) {
    return `### Your Groups\n(you are not a member of any groups)`;
  }
  const lines = groups.groups.map((g) => {
    const stores = g.mountPoints.length > 0 ? g.mountPoints.map((m) => m.name).join(', ') : '(none)';
    return `- ${g.name} (id: ${g.id}) — linked stores: ${stores}`;
  });
  return [`### Your Groups`, ...lines].join('\n');
}

function formatContextCharacters(characters: SelfInventoryContextCharacters): string {
  if (!characters.available) {
    return `### Characters Present\nUnavailable — ${characters.message}`;
  }
  if (characters.characters.length === 0) {
    return `### Characters Present\n(no other characters are present in this chat)`;
  }
  const lines = characters.characters.map((c) => {
    const personaTag = c.isUserPersona ? ' (user persona)' : '';
    const aliasTag = c.aliases.length > 0 ? ` [aka ${c.aliases.join(', ')}]` : '';
    const identityLine = c.identity ? `\n    Identity: ${c.identity}` : '';
    return `- ${c.name}${personaTag}${aliasTag} (id: ${c.id})${identityLine}`;
  });
  return [`### Characters Present`, ...lines].join('\n');
}

function formatContextFiles(files: SelfInventoryContextFiles): string {
  if (!files.available) {
    return `### Attached Files\nUnavailable — ${files.message}`;
  }
  if (files.files.length === 0) {
    return `### Attached Files\n(no files are attached to this chat)`;
  }
  const lines = files.files.map((f) => {
    const title = f.displayTitle ? ` "${f.displayTitle}"` : '';
    const mountTag = f.mountPoint ? `, mount_point=${f.mountPoint}` : '';
    return `- ${f.filePath}${title} [scope=${f.scope}${mountTag}]\n    Reach it: ${f.howToReach}`;
  });
  return [`### Attached Files`, ...lines].join('\n');
}

function formatContextSection(section: SelfInventoryContextSection): string {
  const parts: string[] = [`## Context`];
  if (section.chat) parts.push('', formatContextChat(section.chat));
  if (section.project) parts.push('', formatContextProject(section.project));
  if (section.groups) parts.push('', formatContextGroups(section.groups));
  if (section.characters) parts.push('', formatContextCharacters(section.characters));
  if (section.files) parts.push('', formatContextFiles(section.files));
  return parts.join('\n');
}

export function formatSelfInventoryResults(output: SelfInventoryToolOutput): string {
  if (!output.success) {
    return `You are running on Quilltap v${output.quilltapVersion}.\n\nSelf-Inventory Error: ${output.error ?? 'Unknown error'}`;
  }

  const lines = [
    `You are running on Quilltap v${output.quilltapVersion}.`,
    ``,
    `# Self-Inventory Report`,
    `Character: ${output.characterName} (id: ${output.characterId})`,
  ];

  if (output.vault) {
    lines.push('', formatVaultSection(output.vault));
  }
  if (output.vaultAccess) {
    lines.push('', formatVaultAccessSection(output.vaultAccess));
  }
  if (output.memory) {
    lines.push('', formatMemorySection(output.memory));
  }
  if (output.loadedMemories) {
    lines.push('', formatLoadedMemoriesSection(output.loadedMemories));
  }
  if (output.chats) {
    lines.push('', formatChatsSection(output.chats));
  }
  if (output.prompt) {
    lines.push('', formatPromptSection(output.prompt));
  }
  if (output.lastTurn) {
    lines.push('', formatLastTurnSection(output.lastTurn));
  }
  if (output.carina) {
    lines.push('', formatCarinaSection(output.carina));
  }
  if (output.quilltap) {
    lines.push('', formatQuilltapSection(output.quilltap));
  }
  if (output.context) {
    lines.push('', formatContextSection(output.context));
  }

  return lines.join('\n');
}
