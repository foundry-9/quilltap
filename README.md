# Quilltap

AI-powered roleplay chat platform with multi-provider LLM support and full SillyTavern compatibility.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.0-green.svg)](package.json)

## What is Quilltap?

Quilltap is a modern, self-hosted chat platform designed for AI-powered roleplay conversations. It provides a sleek web interface for chatting with AI characters using your own API keys from multiple LLM providers.

**Key Features:**

- 🤖 Multi-provider support (OpenAI, Anthropic, Ollama, OpenRouter, and OpenAI-compatible APIs)
- 🎭 Full character and persona management
- 💬 Real-time streaming responses
- 🔄 SillyTavern import/export compatibility
- 🔐 Secure encrypted API key storage
- 🐳 Docker-based deployment
- 🔒 OAuth authentication (Google)

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
- OAuth authentication (no password management)
- Rate limiting and security headers
- All data stored in your own PostgreSQL database

## How It Works

Quilltap is built on a modern stack:

- **Frontend & Backend**: Next.js 14+ with TypeScript
- **Database**: PostgreSQL 16 with Prisma ORM
- **Authentication**: NextAuth.js with Google OAuth
- **Styling**: Tailwind CSS
- **Deployment**: Docker + Docker Compose
- **Production**: Nginx reverse proxy with Let's Encrypt SSL

The architecture is straightforward: a Next.js application serves both the web UI and API endpoints, connecting to a PostgreSQL database. All chat processing happens server-side, with streaming responses sent to the client via Server-Sent Events.

Your API keys are encrypted with AES-256-GCM using a user-specific key derived from your user ID and a master pepper. This means your keys are secure at rest and can only be decrypted when you're authenticated.

## Getting Started

### Prerequisites

- **Docker and Docker Compose** (recommended)
- **Node.js 20+** (for local development without Docker)
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
# Database (already configured for Docker)
DATABASE_URL="postgresql://postgres:dev_password@db:5432/quilltap"

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

The application will be available at [http://localhost:3000](http://localhost:3000)

### Local Development (Without Docker)

If you prefer to run the database in Docker but the app locally:

#### 1. Start PostgreSQL in Docker

```bash
docker run -d \
  --name quilltap-db \
  -e POSTGRES_DB=quilltap \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=dev_password \
  -p 5432:5432 \
  postgres:16-alpine
```

#### 2. Install dependencies

```bash
npm install
```

#### 3. Run database migrations

```bash
npx prisma migrate dev
```

#### 4. Start the development server

```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

### Using an Existing PostgreSQL Server

If you have a PostgreSQL server already running:

1. Create a database named `quilltap`
2. Update `DATABASE_URL` in `.env.local` to point to your server:

   ```env
   DATABASE_URL="postgresql://username:password@hostname:5432/quilltap"
   ```

3. Run migrations: `npx prisma migrate dev`
4. Start the app: `npm run dev`

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
# - Production database credentials
# - Google OAuth redirect URI: https://yourdomain.com/api/auth/callback/google

# 3. Initialize SSL certificates
chmod +x docker/init-letsencrypt.sh
./docker/init-letsencrypt.sh yourdomain.com admin@yourdomain.com

# 4. Start production services
docker-compose -f docker-compose.prod.yml up -d

# 5. Run database migrations
docker-compose -f docker-compose.prod.yml exec app npx prisma migrate deploy

# 6. Check logs
docker-compose -f docker-compose.prod.yml logs -f
```

Your application will be available at `https://yourdomain.com` with automatic SSL certificate renewal.

For detailed production deployment instructions, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Database Management

Useful commands for managing your database:

```bash
# Generate Prisma client (after schema changes)
npm run db:generate

# Push schema changes to database (development)
npm run db:push

# Create and run migrations (production)
npm run db:migrate

# Open Prisma Studio (visual database browser)
npm run db:studio
```

## Configuration

### Environment Variables

Required environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/quilltap` |
| `NEXTAUTH_URL` | Your app's URL | `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Secret for NextAuth.js | Generate with `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | From Google Cloud Console |
| `ENCRYPTION_MASTER_PEPPER` | Master encryption key | Generate with `openssl rand -base64 32` |

**Important**: Back up your `ENCRYPTION_MASTER_PEPPER` securely. If lost, all encrypted API keys become unrecoverable.

### Connection Profiles

Once logged in, you'll need to:

1. **Add API Keys**: Go to Settings → API Keys and add keys for your LLM providers
2. **Create Connection Profiles**: Configure how you want to connect to each provider (model, temperature, etc.)
3. **Create Characters**: Set up characters for roleplay
4. **Start Chatting**: Create a new chat with a character and connection profile

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5.6
- **Database**: PostgreSQL 16
- **ORM**: Prisma 6.19
- **Auth**: NextAuth.js 4.24
- **Styling**: Tailwind CSS 4.1
- **Container**: Docker + Docker Compose
- **Reverse Proxy**: Nginx (production)
- **SSL**: Let's Encrypt (production)

## Documentation

- [API Documentation](docs/API.md) - Complete API reference
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment instructions
- [Development Progress](DEVELOPMENT.md) - Feature completion status
- [Roadmap](features/ROADMAP.md) - Technical architecture and implementation details

## Troubleshooting

### Application won't start

- Check that Docker is running: `docker ps`
- Check logs: `docker-compose logs -f`
- Ensure ports 3000 and 5432 aren't in use

### Can't connect to database

- Verify `DATABASE_URL` in `.env.local`
- Check database container is running: `docker ps | grep postgres`
- Try running migrations: `npx prisma migrate dev`

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
- [Prisma](https://www.prisma.io/) - Database ORM
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [PostgreSQL](https://www.postgresql.org/) - Database
- [Docker](https://www.docker.com/) - Containerization

Special thanks to the [SillyTavern](https://github.com/SillyTavern/SillyTavern) project for inspiring the character format and import/export compatibility.
