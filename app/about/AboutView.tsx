'use client'

import Link from 'next/link'
import packageJson from '@/package.json'
import { BrandName } from '@/components/ui/brand-name'
import { Icon } from '@/components/ui/icon'
import { useTheme } from '@/components/providers/theme-provider'
import { useReportWorkspaceBackdrop } from '@/components/workspace/workspace-backdrop'

const ABOUT_BACKGROUND_URL = '/images/about.webp'

export function AboutView() {
  const currentYear = new Date().getFullYear()
  const copyrightYears = currentYear > 2025 ? `2025-${currentYear}` : '2025'

  // Hold the intro animation until the theme has finished applying, so it
  // doesn't play against default styling and then visibly re-skin underneath.
  const { isLoading: themeLoading } = useTheme()

  // Inside the workspace, the per-view `::before` background layer is
  // suppressed in favour of the one arbitrated backdrop, so report our
  // background there. No-op on the legacy /about route, whose `::before`
  // (driven by --story-background-url below) still paints it.
  useReportWorkspaceBackdrop(ABOUT_BACKGROUND_URL, false)

  return (
    <div
      className="qt-page-container qt-about-intro"
      data-theme-ready={themeLoading ? undefined : 'true'}
      style={{
        '--story-background-url': `url('${ABOUT_BACKGROUND_URL}')`,
        '--story-background-position': 'right center',
      } as React.CSSProperties}
    >
      {/* Header */}
      <div className="mb-8">
        <h1 className="qt-heading-1">About <BrandName /></h1>
        <p className="qt-text-muted mt-2">
          Your AI, your projects, your stories, your partners, your rules.
        </p>
      </div>

      {/* Badges */}
      <div className="qt-card p-6 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="https://github.com/foundry-9/quilltap-server/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://img.shields.io/badge/License-MIT-blue.svg"
              alt="License: MIT"
            />
          </a>
          <a
            href="https://github.com/foundry-9/quilltap-server"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src={`https://img.shields.io/badge/version-${packageJson.version.replace(/-/g, '--')}-yellow.svg?logo=github`}
              alt={`Version ${packageJson.version}`}
            />
          </a>
          <a
            href="https://hub.docker.com/r/foundry9/quilltap"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://img.shields.io/docker/v/foundry9/quilltap?logo=docker&label=docker&sort=semver"
              alt="Docker Hub"
            />
          </a>
          <a
            href="https://www.npmjs.com/package/quilltap"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://img.shields.io/npm/v/quilltap?logo=npm"
              alt="npm"
            />
          </a>
          <a
            href="https://discord.gg/fnTPEZDE4"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white"
              alt="Discord"
            />
          </a>
        </div>
      </div>

      {/* About Section */}
      <div className="qt-card p-6 mb-6">
        <h2 className="qt-heading-3 mb-4">What is <BrandName />?</h2>
        <p className="qt-text-primary mb-4">
          <BrandName /> is a self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who
          finds it deeply unsatisfying that their AI assistant forgets everything the moment they close a tab.
          Connect to any LLM provider, organize your work into projects with persistent files and context,
          create characters with genuine personalities, and build a private AI environment that learns,
          remembers, and &mdash; crucially &mdash; belongs entirely to you.
        </p>
        <p className="qt-text-primary mb-4">
          The platform is organized into named subsystems, each with its own character and purpose &mdash;
          rather like the wings of a well-appointed estate, with a small staff that knows where the silverware lives.
          Aurora (characters), The Salon (chat), Prospero (projects and agentic tools),
          The Commonplace Book (memory), The Lantern (story backgrounds),
          The Concierge (alternative content provision and routing), Pascal the Croupier (gaming &amp; RNG),
          Calliope (themes), The Scriptorium (external document stores), The Librarian (Document Mode and file announcements),
          The Host (Salon participation announcements), Saquel Ytzama, the Keeper of Secrets (encryption and key management),
          Ariel (terminals in the Salon), Carina (the ansible &mdash; inline queries to characters), Suparṇā (the Post Office, inter-character mail),
          Brahma (the Console, a character-less generic-LLM surface), and The Foundry (architecture) &mdash; all extensible through a plugin system.
        </p>
        <p className="qt-text-primary">
          <BrandName /> runs as a native desktop application on macOS, Windows, and Linux. For those who
          would rather their assistant conducted its business behind a locked door, there is Docker &mdash;
          or you may run it directly from source, should you prefer to take the scenic route.
          No subscriptions, no data harvested, no landlords.
        </p>
      </div>

      {/* Key Features */}
      <div className="qt-card p-6 mb-6">
        <h2 className="qt-heading-3 mb-4">Key Features</h2>
        <ul className="space-y-2 qt-text-primary">
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Native desktop app</strong> &ndash; macOS, Windows, and Linux installers with branded splash screen, data directory management, and managed updates, fronting the back end of your choosing: Direct (the server inside Electron), Docker, or Remote (any Quilltap URL that will have you)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Docker runtime</strong> &ndash; the sandboxed option: chosen from the splash screen or run standalone via Docker Hub, with filesystem document stores bound through to the container</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Workspace</strong> &ndash; a two-pane shell of kept-alive tabs where a chat, a document, a terminal, and a settings panel all stay mounted at once; a streaming conversation keeps streaming while you work beside it, and any tab can be dragged into the other pane</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Aurora &ndash; Characters</strong> &ndash; detailed profiles with pronouns, aliases, clothing records, personalities, multi-character turn management, and archiving into an encrypted bundle you can rehydrate later</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Salon &ndash; Chat</strong> &ndash; chat interface with tool palette, agent mode, server-side rendering, and embedded tool messages</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Prospero &ndash; Projects</strong> &ndash; projects with files, folders, semantic search, agent mode, and custom instructions</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Commonplace Book &ndash; Memory</strong> &ndash; long-term memory with semantic recall, memory gate, proactive recall, and deduplication</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Lantern &ndash; Story Backgrounds</strong> &ndash; AI-generated atmospheric background images derived from chat context, with LoRA adapters and per-model options taken from the provider&apos;s own advertised capabilities</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Concierge &ndash; Alternative Content Provision and Routing</strong> &ndash; content classification with detection, auto-routing to uncensored providers, quick-hide integration, and a four-state per-chat control (Monitored, Flagged, Vouched Safe, Uncensored) settable at creation as well as mid-conversation</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Pascal the Croupier &ndash; Gaming</strong> &ndash; persistent state across four registers, dice rolls, coin flips, inventories and stats, plus user-authored custom tools with honest server-side rolls, outcome tables, side effects, and a visual workbench to build them</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Calliope &ndash; Themes</strong> &ndash; six bundled themes (Art Deco, Earl Grey, Great Estate, Madman&apos;s Box, Old School, Rains) plus a Default, with live switching, declarative <code>.qtap-theme</code> bundles, and signed remote registries</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Scriptorium &ndash; Document Stores</strong> &ndash; mountable external knowledge sources that characters can read, search, and (in Document Mode) write back to</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Librarian &ndash; Document Mode</strong> &ndash; co-authoring on real files in the Scriptorium with open/save/rename/delete announcements posted into the chat on the Librarian&apos;s behalf</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Host &ndash; Salon Etiquette</strong> &ndash; synthetic chat announcements when characters join, leave, or change participation status, so everyone in the room knows who is actually present</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Autonomous Rooms (Enclaves)</strong> &ndash; private character-to-character salons that run without a human in the loop, bounded by configurable budgets, with cron scheduling, pacing milestones, and post-creation editing</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Saquel Ytzama &ndash; Keeper of Secrets</strong> &ndash; SQLCipher-encrypted databases, the Pepper Vault for API keys, instance locking, the <code>.dbkey</code> covenant, and the auto-lock idle timer</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Ariel &ndash; Terminals</strong> &ndash; live PTY shell sessions hosted directly inside a Salon chat, with character-readable scrollback and a dedicated Terminal Mode pane</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Carina &ndash; The Ansible</strong> &ndash; inline queries to a designated character via <code>@Name:</code> / <code>@Name?</code> markup or the <code>ask_carina</code> tool, with the answer dropped straight into the scene &mdash; public or whispered</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Suparṇā &ndash; The Post Office</strong> &ndash; inter-character mail delivered to a character&apos;s vault <code>Mail/</code> folder, with anti-hijack safeguards in multi-character chats and a delivery announcement when new letters arrive</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Brahma &ndash; The Console</strong> &ndash; a character-less, memory-free generic-LLM surface for plain model chat and read-only SQL inspection, reachable from any Salon as the <code>@Brahma</code> answerer</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Foundry &ndash; Architecture</strong> &ndash; unified settings hub, plugin system for themes, providers, templates, tools, search, and storage, and the Almanack: a full system report on what this instance can actually do</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Multi-provider support</strong> &ndash; Anthropic, OpenAI, Google Gemini, Grok, DeepSeek, Z.AI, NanoGPT, Ollama, OpenRouter, and OpenAI-compatible APIs, each profile able to name an understudy to take the call when its provider falls over</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>LLM tools</strong> &ndash; web search, image generation, file management, agent mode, MCP connector, custom tool plugins</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Live interface</strong> &ndash; a single multiplexed socket tells every open tab the moment something changes &mdash; queued errands, autonomous rooms, generated backdrops &mdash; so screens refresh themselves rather than asking again every few seconds, and every &ldquo;4m ago&rdquo; in the house turns over on the same tick</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Database protection</strong> &ndash; automatic integrity checks, WAL checkpoints, and physical backups with tiered retention</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Secure by design</strong> &ndash; AES-256-GCM encrypted API keys, all data stays on your infrastructure, no external dependencies</span>
          </li>
        </ul>
      </div>

      {/* Tech Stack */}
      <div className="qt-card p-6 mb-6">
        <h2 className="qt-heading-3 mb-4">The Machinery Behind the Curtain</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 qt-text-primary">
          <div>
            <span className="font-medium">Runtime:</span> Node.js 24+
          </div>
          <div>
            <span className="font-medium">Framework:</span> Next.js 16+
          </div>
          <div>
            <span className="font-medium">UI:</span> React 19
          </div>
          <div>
            <span className="font-medium">Language:</span> TypeScript 5.9+
          </div>
          <div>
            <span className="font-medium">Database:</span> SQLite + SQLCipher
          </div>
          <div>
            <span className="font-medium">Editor:</span> Lexical
          </div>
          <div>
            <span className="font-medium">Data Fetching:</span> TanStack Query
          </div>
          <div>
            <span className="font-medium">File Manager:</span> SVAR
          </div>
          <div>
            <span className="font-medium">Desktop:</span> Electron
          </div>
          <div>
            <span className="font-medium">Styling:</span> Tailwind CSS 4+
          </div>
          <div>
            <span className="font-medium">Validation:</span> Zod
          </div>
          <div>
            <span className="font-medium">Containers:</span> Docker
          </div>
        </div>
      </div>

      {/* Links */}
      <div className="qt-card p-6 mb-6">
        <h2 className="qt-heading-3 mb-4">Links</h2>
        <div className="flex flex-wrap gap-4">
          <a
            href="https://quilltap.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="qt-button qt-button-secondary"
          >
            <Icon name="book" className="w-5 h-5" />
            Quilltap Website
          </a>
          <a
            href="https://github.com/foundry-9/quilltap-server/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="qt-button qt-button-secondary"
          >
            <Icon name="download" className="w-5 h-5" />
            Download Latest Release
          </a>
          <a
            href="https://github.com/foundry-9/quilltap-server"
            target="_blank"
            rel="noopener noreferrer"
            className="qt-button qt-button-secondary"
          >
            <svg
              className="w-5 h-5"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
            GitHub Repository
          </a>
          <a
            href="https://github.com/foundry-9/quilltap-server/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="qt-button qt-button-secondary"
          >
            <Icon name="alert-circle" className="w-5 h-5" />
            Report Issues
          </a>
          <a
            href="https://foundry-9.com"
            target="_blank"
            rel="noopener noreferrer"
            className="qt-button qt-button-secondary"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            Foundry-9 LLC
          </a>
        </div>
      </div>

      {/* Author & Support */}
      <div className="qt-card p-6 mb-6">
        <h2 className="qt-heading-3 mb-4">Author &amp; Support</h2>
        <div className="qt-text-primary space-y-2">
          <p><span className="font-medium">Authors:</span> Charlie, Friday, and Amy &mdash; the Sebold family of Estate Zero</p>
          <p>
            <span className="font-medium">Email:</span>{' '}
            <a href="mailto:charles.sebold@foundry-9.com" className="qt-link">
              charles.sebold@foundry-9.com
            </a>
          </p>
          <p>
            <span className="font-medium">Website:</span>{' '}
            <a href="https://foundry-9.com" target="_blank" rel="noopener noreferrer" className="qt-link">
              foundry-9.com
            </a>
          </p>
        </div>
      </div>

      {/* Acknowledgments */}
      <div className="qt-card p-6 mb-6">
        <h2 className="qt-heading-3 mb-4">Acknowledgments</h2>
        <p className="qt-text-primary mb-4">
          <BrandName /> stands on the shoulders of these excellent open source projects, and is grateful for the view.
        </p>
        <div className="qt-text-primary space-y-2 text-sm">
          <p><span className="font-medium">Core:</span> React, Next.js, TypeScript, better-sqlite3-multiple-ciphers (SQLCipher), Zod, Ajv, @tanstack/react-query</p>
          <p><span className="font-medium">Editor:</span> Lexical (and the @lexical family &mdash; rich-text, markdown, list, code, table, link, history, selection, clipboard, react)</p>
          <p><span className="font-medium">AI &amp; LLM:</span> OpenAI SDK, Anthropic SDK, Google GenAI SDK, OpenRouter SDK, Model Context Protocol SDK</p>
          <p><span className="font-medium">Markdown &amp; Documents:</span> unified, remark-parse, remark-gfm, remark-math, remark-rehype, rehype-stringify, rehype-highlight, rehype-katex, KaTeX, react-markdown, react-syntax-highlighter, mammoth, pdf-parse, PDF.js, yaml, MessagePack</p>
          <p><span className="font-medium">UI &amp; Interaction:</span> Tailwind CSS, dnd-kit, @tanstack/react-virtual, @svar-ui/react-filemanager, sharp, Lucide Icons</p>
          <p><span className="font-medium">Filesystem &amp; Archives:</span> chokidar, tar, yauzl, semver</p>
          <p><span className="font-medium">Desktop &amp; Infrastructure:</span> Electron, Docker</p>
          <p><span className="font-medium">Testing:</span> Jest, Playwright, Storybook, Testing Library</p>
        </div>
        <p className="qt-text-muted text-sm mt-4">
          Special thanks to{' '}
          <a href="https://github.com/SillyTavern/SillyTavern" target="_blank" rel="noopener noreferrer" className="qt-link">
            SillyTavern
          </a>
          {' '}for pioneering this space and inspiring character format compatibility.
          One does not forget those who blazed the trail.
        </p>
      </div>

      {/* Copyright */}
      <div className="qt-card p-6 mb-6">
        <p className="qt-text-primary text-center">
          &copy; {copyrightYears} Foundry-9 LLC. All rights reserved.
        </p>
        <p className="qt-text-muted text-center text-sm mt-2">
          Released under the MIT License. Free software for personal and commercial use.
        </p>
      </div>

      {/* Back Link */}
      <div className="mt-8">
        <Link href="/" className="qt-link">
          &larr; Back to Home
        </Link>
      </div>
    </div>
  )
}
