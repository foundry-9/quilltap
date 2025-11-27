# Quilltap

AI-powered roleplay chat platform with multi-provider LLM support and full SillyTavern compatibility.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.5.11-yellow.svg)](package.json)

## What is Quilltap?

Quilltap is a modern, self-hosted chat platform designed for AI-powered roleplay conversations. It provides a sleek web interface for chatting with AI characters using your own API keys from multiple LLM providers.

**Key Features:**

- 🤖 Multi-provider support (OpenAI, Anthropic, Ollama, OpenRouter, and OpenAI-compatible APIs)
- 🎭 Full character and persona management
- 💬 Real-time streaming responses
- 🔄 SillyTavern import/export compatibility
- 🔐 Secure encrypted API key storage
- 🐳 Docker-based deployment
- 🔒 OAuth authentication (Google) with local email/password auth planned

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
- Image gallery with tagging system
- Assign avatars to characters and personas
- Chat-specific avatar overrides
- User-specific secure image storage

### Multi-Provider Support

Configure connections to any of these providers:

- **OpenAI** (GPT-4, GPT-3.5-turbo, etc.)
- **Anthropic** (Claude 3.5 Sonnet, Opus, Haiku, etc.)
- **Ollama** (Local LLM hosting)
- **OpenRouter** (Access to multiple models through one API)
- **OpenAI-Compatible** (LM Studio, vLLM, text-generation-webui, etc.)

### Security & Privacy

- AES-256-GCM encryption for API keys
- Per-user encryption keys
- OAuth authentication (Google)
- Optional local email/password authentication with TOTP 2FA (planned for v1.1+)
- Rate limiting and security headers
- All data stored in JSON files in your data directory (completely portable)

## How It Works

Quilltap is built on a modern stack:

- **Frontend & Backend**: Next.js 14+ with TypeScript
- **Data Store**: JSON-based file storage with atomic writes and JSONL append-only support
- **Authentication**: NextAuth.js with Google OAuth
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
# Start all services (database + app)
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

#### 2. Configure environment variables

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

### Prerequisites

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

```
data/
├── characters/           # Character definitions
├── personas/            # User personas
├── chats/              # Conversations
├── auth/               # Authentication data (sessions, accounts)
├── settings/           # Application settings
└── binaries/           # Image files
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

1. **Add API Keys**: Go to Settings → API Keys and add keys for your LLM providers
2. **Create Connection Profiles**: Configure how you want to connect to each provider (model, temperature, etc.)
3. **Create Characters**: Set up characters for roleplay
4. **Start Chatting**: Create a new chat with a character and connection profile

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5.6
- **Data Storage**: JSON files with atomic writes and JSONL append-only support
- **Authentication**: NextAuth.js 4.24 with Google OAuth
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
- [Local User Authentication](features/LOCAL_USER_AUTH.md) - Email/password + TOTP 2FA implementation plan (planned)

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
- **Email**: charles@sebold.tech
- **Website**: <https://foundry-9.com>

## Acknowledgments

Built with these excellent open source projects:

- [Next.js](https://nextjs.org/) - React framework
- [NextAuth.js](https://next-auth.js.org/) - Authentication
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Zod](https://zod.dev/) - TypeScript-first schema validation
- [Docker](https://www.docker.com/) - Containerization

Special thanks to the [SillyTavern](https://github.com/SillyTavern/SillyTavern) project for inspiring the character format and import/export compatibility.
