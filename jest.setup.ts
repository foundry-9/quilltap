import '@testing-library/jest-dom'

// Mock environment variables for tests
process.env.ENCRYPTION_MASTER_PEPPER = process.env.ENCRYPTION_MASTER_PEPPER || 'test-pepper-for-unit-tests-32-chars-long!'

// Mock Next.js server-side globals
if (typeof global.Request === 'undefined') {
  global.Request = class Request {
    constructor(public url: string, public init?: any) {}
    async json() {
      return this.init?.body ? JSON.parse(this.init.body) : {}
    }
  } as any
}

if (typeof global.Response === 'undefined') {
  global.Response = class Response {
    constructor(public body?: any, public init?: any) {}
  } as any
}

if (typeof global.Headers === 'undefined') {
  global.Headers = class Headers {
    private headers: Map<string, string> = new Map()
    set(name: string, value: string) {
      this.headers.set(name, value)
    }
    get(name: string) {
      return this.headers.get(name)
    }
  } as any
}

// Mock @prisma/client to avoid needing prisma generate in tests
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    user: {},
    character: {},
    persona: {},
    chat: {},
    message: {},
    apiKey: {},
    connectionProfile: {},
  })),
  Provider: {
    OPENAI: 'OPENAI',
    ANTHROPIC: 'ANTHROPIC',
    OLLAMA: 'OLLAMA',
    OPENROUTER: 'OPENROUTER',
    OPENAI_COMPATIBLE: 'OPENAI_COMPATIBLE',
  },
}))
