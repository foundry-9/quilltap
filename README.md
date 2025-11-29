# Quilltap

AI-powered roleplay chat platform with multi-provider LLM support and full SillyTavern compatibility.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.6.17-green.svg)](package.json)

## What is Quilltap?

[Quilltap](https://github.com/foundry-9/quilltap) is a modern, self-hosted chat platform designed for AI-powered roleplay conversations. It provides a sleek web interface for chatting with AI characters using your own API keys from multiple LLM providers.

**Key Features:**

- 🤖 Multi-provider support (OpenAI, Anthropic, Google Gemini, Grok, Gab AI, Ollama, OpenRouter, and OpenAI-compatible APIs)
- 🧠 Cheap LLM + embedding pipeline for automatic memories, summaries, and semantic search
- 🎨 Native image generation profiles (OpenAI, Google Imagen, Grok, OpenRouter)
- 🎭 Full character and persona management
- 💬 Real-time streaming responses
- 🔄 SillyTavern import/export compatibility
- 🔐 Secure encrypted API key storage
- 🔒 Google OAuth plus local email/password login with optional TOTP 2FA
- 🐳 Docker-based deployment

## What Can It Do?

### Character Management

- Create custom characters with detailed personalities, scenarios, and example dialogues
- Upload and assign avatar images to characters
- Import characters from SillyTavern (JSON format only - PNG card format not supported)
- Export characters to share or backup (JSON format only)
- Link personas to characters for personalized interactions

### Persona System

- Create user personas that define your character in roleplay
- Upload and assign avatar images to personas
- Link specific personas to characters for consistent interactions
- Import/export personas from SillyTavern

### Advanced Chat Features

- Real-time streaming responses from AI
- Message editing and deletion
- Chat branching with swipes (generate alternative responses)
- Full chat history preservation
- Import/export entire conversations from SillyTavern

### Image & Avatar Management

- Upload images via file or URL
- Generate new art for characters and chats using your configured image providers
- Image gallery with tagging system
- Assign avatars to characters and personas
- Chat-specific avatar overrides
- User-specific secure image storage

### Image Generation

- Create reusable image generation profiles for OpenAI (DALL·E 3), Google Imagen, Grok, or OpenRouter providers
- Launch the generation dialog directly from chats to iterate on prompts and send results back into the conversation
- Automatically collect output in the image gallery for reuse as avatars, personas, or reference shots
- Fine-tune quality, style, aspect ratio, and provider-specific parameters per profile with global defaults in Settings

### Memory & Embeddings

- Configure Cheap LLM strategies (user-defined profile, provider cheapest, or local-first) to drive summarization and housekeeping tasks
- Flag any connection profile as "cheap" or set a global default cheap profile for automated jobs
- Manage dedicated embedding profiles (OpenAI `text-embedding-3` family or local Ollama embeddings) for semantic recall
- Memory search automatically prefers embeddings when available and falls back to keyword heuristics when not

### Multi-Provider Support

Configure dedicated connection profiles for each provider you want to use:

| Provider | Capabilities |
|----------|--------------|
| **OpenAI** | GPT-4o, GPT-4o-mini, GPT-4.1, GPT-3.5 legacy models, tool/function calling, file attachments, and DALL·E 3 image generation. |
| **Anthropic** | Claude 3/4 families (Opus, Sonnet, Haiku) with streaming, image understanding, and tool/JSON output control. |
| **Google Gemini** | Gemini 2.0 Flash/Pro with multimodal inputs plus Imagen 3 image generation through Google Generative AI. |
| **Grok (xAI)** | Grok 2 and Grok 2 Mini via the OpenAI-compatible xAI endpoint, multimodal attachments, and native image generation. |
| **Gab AI** | OpenAI-compatible chat API focused on text-only completions—ideal for low-cost narration where attachments aren't needed. |
| **Ollama** | Local/offline models (Llama 3.2, Phi-3, etc.) reachable at `http://localhost:11434`, perfect for the Local First cheap-LLM strategy. |
| **OpenRouter** | Access 100+ hosted models through the OpenRouter SDK with streaming, pricing sync, and optional image generation (model-dependent). |
| **OpenAI-Compatible** | Generic connector for LM Studio, vLLM, Text Generation Web UI, and any other OpenAI-format API you want to self-host. |

### Security & Privacy

- AES-256-GCM encryption for API keys
- Per-user encryption keys
- OAuth authentication (Google) plus local email/password login with optional TOTP 2FA
- Rate limiting and security headers
- All data stored in JSON files in your data directory (completely portable)

## How It Works

Quilltap is built on a modern stack:

- **Frontend & Backend**: Next.js 14+ with TypeScript
- **Data Store**: JSON-based file storage with atomic writes and JSONL append-only support
- **Authentication**: NextAuth.js with Google OAuth plus local email/password + optional TOTP 2FA
- **Styling**: Tailwind CSS
- **Deployment**: Docker + Docker Compose (single container, no database service needed)
- **Production**: Nginx reverse proxy with Let's Encrypt SSL

The architecture is straightforward: a Next.js application serves both the web UI and API endpoints, with all data persisted to JSON files in a `data/` directory. This approach eliminates the need for a separate database service, making deployment simpler and more portable. All chat processing happens server-side, with streaming responses sent to the client via Server-Sent Events.

Your API keys are encrypted with AES-256-GCM using a user-specific key derived from your user ID and a master pepper. This means your keys are secure at rest and can only be decrypted when you're authenticated. Session data is stored in append-only JSONL format for performance and auditability.

## Getting Started

### Prerequisites

- **Docker and Docker Compose** (recommended)
- **Node.js 20+** (for local development)
- **Google OAuth credentials** ([Get them here](https://console.cloud.google.com/))

### Quick Start with Docker

This is the recommended approach for most users.

#### 1. Clone the repository

```bash
git clone https://github.com/foundry-9/quilltap.git
cd quilltap
```

#### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and set your values:

```env
# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-nextauth-secret-here"

# Google OAuth (get from https://console.cloud.google.com/)
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Encryption
ENCRYPTION_MASTER_PEPPER="your-encryption-pepper-here"
```

#### 3. Generate secrets

```bash
# Generate NEXTAUTH_SECRET
openssl rand -base64 32

# Generate ENCRYPTION_MASTER_PEPPER
openssl rand -base64 32
```

Add these values to your `.env.local` file.

#### 4. Set up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
6. Copy the Client ID and Client Secret to your `.env.local`

#### 5. Start the application

```bash
# Start the development container
docker-compose up

# Or run in background
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down
```

The application will be available at [https://localhost:3000](https://localhost:3000)
and any JSON data written while Docker is running in development mode will be
persisted to your local `data/` directory via a bind mount, making it easy to
switch between Docker and local `npm run dev` workflows. The dev container generates
and uses a self-signed certificate stored in `certs/`, so your browser will prompt
you to trust it the first time you connect.

### Local Development

For local development, you only need Node.js:

#### 1. Install dependencies

```bash
npm install
```

#### 2. Configure environment variables (local hosting)

```bash
cp .env.example .env.local
```

Edit `.env.local` with your values (see Quick Start section above).

#### 3. Start the development server

```bash
npm run dev
```

The application will be available at [https://localhost:3000](https://localhost:3000)

All data will be stored in the `data/` directory in JSON files. The application will create this directory automatically on first run.

## Production Deployment

For production deployment with Docker, Nginx, and SSL:

### Hosting Prerequisites

- A domain name pointed to your server
- Port 80 and 443 open on your firewall

### Quick Production Setup

```bash
# 1. Clone and configure
git clone https://github.com/foundry-9/quilltap.git
cd quilltap
cp .env.example .env.production

# 2. Edit .env.production with your production values
# Make sure to set:
# - NEXTAUTH_URL=https://yourdomain.com
# - Google OAuth redirect URI: https://yourdomain.com/api/auth/callback/google
# - All encryption and auth secrets

# 3. Initialize SSL certificates
chmod +x docker/init-letsencrypt.sh
./docker/init-letsencrypt.sh yourdomain.com admin@yourdomain.com

# 4. Start production services
docker-compose -f docker-compose.prod.yml up -d

# 5. Check logs
docker-compose -f docker-compose.prod.yml logs -f
```

Your application will be available at `https://yourdomain.com` with automatic SSL certificate renewal.

The application automatically creates the `data/` directory for storing all data. Ensure this directory is backed up regularly. For detailed production deployment instructions, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Data Management

Quilltap stores all data in JSON files in the `data/` directory:

```text
data/
├── auth/                 # NextAuth data (accounts.json, sessions.jsonl)
├── binaries/             # Binary metadata index (image/file attachments)
├── characters/           # Character JSON definitions (one file per character)
├── chats/                # Conversation logs (per-chat JSONL + index)
├── personas/             # Persona JSON definitions
├── settings/             # App prefs (general.json, image-profiles.json, connection-profiles.json)
└── tags/                 # tags.json lookup table
```

### Backup & Restore

To backup your data:

```bash
cp -r data/ data-backup-$(date +%Y%m%d).tar.gz
```

To restore from backup:

```bash
tar -xzf data-backup-YYYYMMDD.tar.gz
docker-compose restart app
```

For detailed backup and restore procedures, see [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md).

## Configuration

### Environment Variables

Required environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXTAUTH_URL` | Your app's URL | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Secret for NextAuth.js | Generate with `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | From Google Cloud Console |
| `ENCRYPTION_MASTER_PEPPER` | Master encryption key | Generate with `openssl rand -base64 32` |

Optional environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATA_BACKEND` | Data backend mode (json/prisma/dual) | `json` |
| `LOG_LEVEL` | Logging level (error/warn/info/debug) | `info` |

**Important**: Back up your `ENCRYPTION_MASTER_PEPPER` securely. If lost, all encrypted API keys become unrecoverable. Also ensure the `data/` directory is backed up regularly.

### Connection Profiles

Once logged in, you'll need to:

1. **Add API Keys**: Settings → API Keys for each provider you plan to use
2. **Create LLM Connection Profiles**: Configure provider, model, temperature, and mark any profile as the default or "cheap"
3. **Configure Image Profiles (optional)**: Settings → Image Profiles for OpenAI, Google Imagen, Grok, or OpenRouter image generation
4. **Configure Embeddings & Cheap LLM settings (optional)**: Settings → Embedding Profiles and Chat Settings to pick embedding providers and Cheap LLM strategy
5. **Create Characters**: Set up characters/personas for roleplay
6. **Start Chatting**: Launch a new chat with a character and selected connection profile

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5.6
- **Data Storage**: JSON files with atomic writes and JSONL append-only support
- **Authentication**: NextAuth.js 4.24 with Google OAuth, email/password login, and TOTP 2FA
- **Encryption**: AES-256-GCM for sensitive data
- **Styling**: Tailwind CSS 4.1
- **Container**: Docker + Docker Compose
- **Reverse Proxy**: Nginx (production)
- **SSL**: Let's Encrypt (production)

## Documentation

- [API Documentation](docs/API.md) - Complete API reference
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment instructions
- [Development Progress](DEVELOPMENT.md) - Feature completion status
- [Roadmap](features/ROADMAP.md) - Technical architecture and implementation details
- [Local User Authentication](features/LOCAL_USER_AUTH.md) - Original implementation plan for email/password + TOTP 2FA

## Troubleshooting

### Application won't start

- Check that Docker is running: `docker ps`
- Check logs: `docker-compose logs -f`
- Ensure port 3000 isn't in use
- Verify the `data/` directory is writable

### Data not persisting

- Ensure the `data/` directory exists and is writable: `ls -la data/`
- Check file permissions: `chmod 755 data/`
- If running in Docker, verify volume mounts in docker-compose.yml
- Check application logs for write errors

### Authentication issues

- Verify Google OAuth credentials are correct
- Check that redirect URI matches exactly in Google Cloud Console
- Ensure `NEXTAUTH_URL` matches your actual URL
- Verify `NEXTAUTH_SECRET` is set

### Import/Export not working

- Ensure files are valid SillyTavern format (V2 spec, JSON only)
- PNG character card format is not supported - use JSON format for character import/export
- Note: Avatar images work fine - the limitation is only the PNG card format (JSON embedded in PNG)
- Check file size limits
- Verify you're logged in

For more help, please [open an issue](https://github.com/foundry-9/quilltap/issues).

## Contributing

Contributions are welcome! Please:

1. Open an issue first to discuss major changes
2. Fork the repository
3. Create a feature branch
4. Make your changes
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

Copyright (c) 2025 Foundry-9

## Support

- **Issues**: [GitHub Issues](https://github.com/foundry-9/quilltap/issues)
- **Author**: Charles Sebold
- **Email**: <charles@sebold.tech>
- **Website**: <https://foundry-9.com>

## Release History

## Version History

- **1.0:** Production Ready
  - Complete tag system implementation across all entities
  - Full image management capabilities
  - Production deployment infrastructure (Docker, Nginx, SSL)
  - Two new LLM providers (Grok, Gab AI)
  - Comprehensive logging, rate limiting, and environment utilities
  - Extensive test coverage (1000+ new test lines)
  - Detailed API and deployment documentation
  - Reorganized routes with proper authentication layer
  - Enhanced UI components for settings and dashboard
- **1.1:** Quality of Life and Features
  - UI/UX Enhancements
    - Toast notification system for user feedback
    - Styled dialog boxes replacing JavaScript alerts
    - Message timestamps display
    - Auto-scroll and highlight animation for new messages
    - Dark mode support across persona pages and dialogs
    - Dashboard updates with live counts and recent chats
    - Footer placement improvements
    - Two-mode toggle for tag management
  - Character & Persona Features
    - Favorite characters functionality
    - Character view page enhancements
    - Character edit page with persona linking
    - Avatar photos and photo management
    - Image gallery system with tagging
    - Persona display name/title support
    - Multi-persona import format support
  - Chat Features
    - Multiple chat imports support
    - SillyTavern chat import with sorting
    - Markdown rendering in chat and character views
    - Tags and persona display in chat lists
    - Improved modal dialogs
    - SillyTavern-compatible story string template support
  - Tag System
    - Comprehensive tag system implementation
    - Tag display in chat lists
  - Provider Support
    - Gab AI added as first-class provider
    - Grok added as first-class provider
    - Multi-provider support (Phase 0.7)
    - Connection testing functionality for profiles
    - Fetch Models and Test Message for OPENAI_COMPATIBLE and ANTHROPIC providers
    - Anthropic model list updated with Claude 4/4.5 models
    - Models sorted alphabetically in UI dropdowns
  - Testing & Development
    - Comprehensive unit tests for avatar display and layout
    - Unit tests for image utilities and alert dialog
    - Unit tests for Phase 0.7 multi-provider support
    - Comprehensive front-end and back-end test suite
    - Playwright test configuration
    - GitHub Actions CI/CD with Jest
    - Pre-commit hooks with lint and test checks
  - Infrastructure
    - SSL configuration
    - Security improvements to maskApiKey (fixed-length masking)
    - Package overrides for npm audit vulnerabilities
- **1.2:** Image Support
  - Local User Authentication - Complete email/password auth implementation with signup/signin pages
  - Two-Factor Authentication (2FA) - TOTP-based 2FA setup and management
  - Image Generation System - Multi-provider support (OpenAI, Google Imagen, Grok) with:
  - Image generation dialog and UI components
  - Image profile management system
  - Chat integration for generated images
  - Image galleries and modals
  - Chat File Management - Support for file attachments in chats
  - Tool System - Tool executor framework with image generation tool support
  - Database Schema Enhancements - Added fields for:
  - Character titles and avatar display styles
  - Image profiles and generation settings
  - User passwords, TOTP secrets, 2FA status (still in progress)
- **1.3:** JSON not databases
  - Moved from Postgres to JSON stores in files
- **1.4:** Improved provider support and tags
  - Add separate Chat and View buttons on Characters page
  - Migrate OpenRouter to native SDK with auto-conversion
  - Add searchable model selector for 10+ models
  - Enhance tag appearance settings with layout and styling options
  - Add customizable tag styling
  - Consolidate Google Imagen profiles and enable image generation tool for Google Gemini
  - Add Google provider support to connection profile testing endpoints
  - Add Google to API key provider dropdown in UI
- **1.5:** Memory system
  - Character memory management
  - Editable via a rich UI for browsing
  - Cheap LLM setup for memory summarization
  - Semantic embeddings and search
  - Improved chat composer with Markdown preview, auto-sizing
  - Default theme font improvements
  - Improved diagnostics include memory system
- **1.6:** Physical descriptions, JSON store polish, and attachment fallbacks
  - JSON data store finalized with atomic writes, advisory file locking, schema versioning, and full CLI/docs to migrate/validate Prisma exports into the JSON repositories.
  - Centralized file manager moves every upload into `data/files`, serves them via `/api/files/[id]`, and ships migration/cleanup scripts plus UI fixes so galleries and avatars consistently load from `/data/files/storage/*`.
  - Attachment UX now shows each provider's supported file types in connection profiles and adds a cheap-LLM-powered fallback that inlines text files, generates descriptions for images, and streams status events when providers lack native support.
  - Cheap LLM + embedding controls let you mark profiles as "cheap," pick provider strategies or user-defined defaults, manage dedicated OpenAI/Ollama embedding profiles, and fall back to keyword heuristics when embeddings are unavailable while powering summaries/memories.
  - Characters and personas gain tabbed detail/edit pages plus a physical description editor with short/medium/long/complete tiers that feed galleries, chat context, and other tooling.
  - Image generation prompt expansion now understands `{{Character}}`/`{{me}}` placeholders, pulls those physical description tiers, and has the cheap LLM craft provider-sized prompts before handing them to Grok, Imagen, DALL·E, etc.

## Roadmap

- [ ] Finish local email/password and TOTP/MFA login
- [ ] Add backends for files (S3 to start, for better hosting)
- [ ] [Plugin system](features/plugins.md) to extend functionality and allow updates for volatile things like LLM support, image support, etc.
- [ ] Multiple themes and plugin downloadable themes
- [ ] Enhanced roleplay options using more complex templates
- [ ] "Visual Novel" options?
- [ ] Worldbook/Lore
- [ ] General SSE-based MCP support
- [ ] Console logging in a window with all log entries at various log levels showing and persisting there
- [ ] Python script support

## Acknowledgments

Built with these excellent open source projects:

- [Next.js](https://nextjs.org/) - React framework
- [NextAuth.js](https://next-auth.js.org/) - Authentication
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Zod](https://zod.dev/) - TypeScript-first schema validation
- [Docker](https://www.docker.com/) - Containerization

Special thanks to the [SillyTavern](https://github.com/SillyTavern/SillyTavern) project for pioneering this space and inspiring the character format and import/export compatibility.
