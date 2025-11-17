# Quilltap

AI-powered roleplay chat platform with multi-provider LLM support and SillyTavern compatibility.

## Phase 0: Foundation - Complete ✅

OAuth authentication with Google is now working! Users can sign in and access the dashboard.

## Features (Phase 0)

- ✅ Next.js 14 with TypeScript
- ✅ PostgreSQL database with Prisma ORM
- ✅ Google OAuth authentication via NextAuth.js
- ✅ Docker Compose development environment
- ✅ Tailwind CSS styling
- ✅ Responsive dashboard layout

## Tech Stack

- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL 16
- **ORM**: Prisma
- **Auth**: NextAuth.js v5
- **Styling**: Tailwind CSS
- **Container**: Docker + Docker Compose

## Getting Started

### Prerequisites

- Docker and Docker Compose installed
- Google OAuth credentials (for authentication)
- Node.js 20+ (for local development)

### Setup

1. **Clone the repository**

```bash
git clone https://github.com/foundry-9/quilltap.git
cd quilltap
```

2. **Configure environment variables**

```bash
cp .env.example .env.local
```

Edit `.env.local` and add your Google OAuth credentials:

- Get credentials from [Google Cloud Console](https://console.cloud.google.com/)
- Create OAuth 2.0 credentials
- Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`

3. **Generate secrets**

```bash
# Generate NEXTAUTH_SECRET
openssl rand -base64 32

# Generate ENCRYPTION_MASTER_PEPPER (for Phase 0.3)
openssl rand -base64 32
```

Add these to your `.env.local` file.

### Running with Docker (Recommended)

```bash
# Start all services (database + app)
docker-compose up

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

The application will be available at http://localhost:3000

### Running Locally (Without Docker)

1. **Start PostgreSQL** (via Docker or local installation)

```bash
# Using Docker for just the database
docker run -d \
  --name quilltap-db \
  -e POSTGRES_DB=quilltap \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=dev_password \
  -p 5432:5432 \
  postgres:16-alpine
```

2. **Install dependencies**

```bash
npm install
```

3. **Run database migrations**

```bash
npx prisma migrate dev
```

4. **Start the development server**

```bash
npm run dev
```

The application will be available at http://localhost:3000

## Database Management

```bash
# Generate Prisma client
npm run db:generate

# Push schema changes to database (dev)
npm run db:push

# Create and run migrations
npm run db:migrate

# Open Prisma Studio (visual database browser)
npm run db:studio
```

## Project Structure

```
quilltap/
├── app/                      # Next.js App Router
│   ├── api/                  # API routes
│   │   └── auth/             # NextAuth.js endpoints
│   ├── auth/                 # Auth pages (signin, error)
│   ├── dashboard/            # Dashboard pages
│   ├── layout.tsx            # Root layout
│   └── page.tsx              # Home page
├── components/               # React components
│   ├── dashboard/            # Dashboard components
│   └── providers/            # Context providers
├── lib/                      # Utility libraries
│   ├── auth.ts               # NextAuth configuration
│   └── prisma.ts             # Prisma client
├── prisma/                   # Database schema
│   └── schema.prisma         # Prisma schema
├── public/                   # Static assets
├── docker-compose.yml        # Docker configuration
├── Dockerfile                # Multi-stage Docker build
└── .env.local                # Environment variables
```

## Development Workflow

1. Make changes to the code
2. Next.js hot reload will update automatically
3. For database changes:
   - Update `prisma/schema.prisma`
   - Run `npm run db:push` or `npm run db:migrate`
   - Run `npm run db:generate` to update Prisma client

## Upcoming Phases

See [ROADMAP.md](features/ROADMAP.md) for the complete development plan.

### Phase 0.3: Core Infrastructure (Week 2)
- API key management with encryption
- Secure storage in PostgreSQL
- Connection profile management

### Phase 0.5: Single Chat MVP (Weeks 3-4)
- Character creation and management
- OpenAI integration
- Real-time chat with streaming responses

### Phase 0.7: Multi-Provider Support (Weeks 5-6)
- Anthropic (Claude)
- Ollama
- OpenRouter
- OpenAI-compatible providers

### Phase 0.9: Feature Complete (Weeks 7-9)
- SillyTavern character import/export
- Chat branching and swipes
- Persona system
- Full UI polish

### Phase 1.0: Production Ready (Weeks 10-11)
- Production deployment with Nginx
- SSL/TLS automation
- Comprehensive testing
- Documentation

## Contributing

This is currently a personal project, but contributions are welcome! Please open an issue first to discuss major changes.

## License

MIT License - see [LICENSE](LICENSE) file for details

## Support

For issues and questions, please use the [GitHub Issues](https://github.com/foundry-9/quilltap/issues) page.

## Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- Authentication by [NextAuth.js](https://next-auth.js.org/)
- Database with [Prisma](https://www.prisma.io/)
- Styled with [Tailwind CSS](https://tailwindcss.com/)
