# Development Progress

This document tracks the development progress of the future Quilltap.

## Project Structure

```text
quilltap/
├── app/                      # Next.js App Router entry point
│   ├── (authenticated)/      # Protected experience (characters, chats, personas, settings)
│   ├── api/                  # Route handlers for auth, json-store, migrations, tooling, etc.
│   ├── auth/                 # NextAuth flows (sign-in, error, callback)
│   ├── dashboard/            # Marketing/onboarding shell
│   ├── globals.css           # Root styles
│   ├── layout.tsx            # Root layout (providers, themes, fonts)
│   └── page.tsx              # Public landing page
├── components/               # Reusable UI (chat, character, memory, tags, providers, nav, etc.)
├── lib/                      # Domain logic (auth, chat, llm, json-store, migrations, tools, startup helpers)
├── data/                     # JSON-backed persistence (auth, chats, characters, personas, tags, settings)
├── __tests__/                # Jest + Playwright specs (unit/ integration)
├── __mocks__/                # Test doubles for auth, OpenRouter, Google, etc.
├── docs/                     # Engineering docs, deployment runbooks, migration notes
├── features/                 # Living roadmap & spec notes (memory, auth, Gemini, etc.)
├── hooks/                    # React hooks (custom avatar rendering, etc.)
├── types/                    # Project-level type augmentations (NextAuth module declarations)
├── public/                   # Static assets (uploads, icons, manifest)
├── docker/                   # Container assets (nginx config, scripts, cert helpers)
├── docker-compose*.yml       # Local/test/prod compose orchestration
├── Dockerfile                # Multi-stage runtime builder
├── backups/                  # Database snapshots/seeds
├── certs/                    # Dev TLS certificates
├── proxy.ts                  # Local HTTPS proxy helper for dev
├── project configs           # jest.config.ts, tailwind.config.ts, eslint.config.mjs, playwright.config.ts
└── package.json              # Workspace metadata, scripts, dependencies
```

## Development Workflow

1. Make changes to the code
2. Next.js hot reload will update automatically
3. Data is automatically persisted to JSON files in the `data/` directory

## Future Enhancements (Post-1.0)

The following features are planned for future releases:

- [ ] World Book/Lorebook support
- [ ] Redis caching for LLM responses
- [ ] Apple and GitHub OAuth providers
- [ ] Advanced prompt templates
- [ ] Chat folders/organization
- [X] Image generation integration
- [ ] Voice/TTS integration
- [ ] Mobile-responsive PWA
- [ ] Multi-user shared chats
- [ ] Admin dashboard
- [ ] Usage analytics
- [ ] Export to other formats (Character.AI, etc.)
- [ ] PNG character card format support (importing/exporting JSON embedded in PNG files)
- [ ] S3 support for all files (important for public hosting)

## Contributing

This is currently a personal project, but contributions are welcome! Please open an issue first to discuss major changes.

## Acknowledgments

See [ROADMAP.md](features/ROADMAP.md) for the complete development plan and technical architecture details.
