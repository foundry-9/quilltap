# Quilltap Logging System

This directory contains the transport abstraction layer for the Quilltap logging system.

## Overview

The logging system supports multiple output destinations (transports) and can be configured via environment variables to send logs to:
- Console (stdout/stderr)
- Files with automatic rotation
- Both console and files simultaneously
- Future: Remote logging services (CloudWatch, etc.)

## Architecture

```
┌─────────────┐
│   Browser   │
│ (React app) │
└──────┬──────┘
       │ POST /api/logs
       ▼
┌─────────────────────────────────────┐
│         Next.js Server              │
│                                     │
│  ┌──────────────────────────────┐  │
│  │    Logger (lib/logger.ts)    │  │
│  │  - error/warn/info/debug     │  │
│  │  - child loggers with ctx    │  │
│  └────────┬─────────────────────┘  │
│           │                         │
│           │ Transports:             │
│           ├─► Console (stdout)      │
│           ├─► File (rotating)       │
│           └─► (Future: CloudWatch)  │
└─────────────────────────────────────┘
```

## Usage

### Server-side (Node.js)

```typescript
import { logger } from '@/lib/logger';

// Basic logging
logger.info('User logged in', { userId: '123' });
logger.error('Database query failed', { query: 'SELECT...' }, error);

// Child loggers with context
const requestLogger = logger.child({ requestId: 'abc-123' });
requestLogger.info('Processing request'); // Automatically includes requestId
```

### Client-side (Browser)

```typescript
import { clientLogger } from '@/lib/client-logger';

// Logs are batched and sent to server
clientLogger.info('Button clicked', { buttonId: 'submit' });
clientLogger.error('API call failed', { endpoint: '/api/users' });
```

## Configuration

Set these environment variables in your `.env` file:

```bash
# Log level: error, warn, info, debug
LOG_LEVEL="info"

# Output destination: console, file, both
LOG_OUTPUT="console"

# Directory for log files (when using file or both)
LOG_FILE_PATH="./logs"

# Max file size in bytes before rotation (default: 10MB)
LOG_FILE_MAX_SIZE="10485760"

# Max number of rotated files to keep (default: 5)
LOG_FILE_MAX_FILES="5"
```

## File Structure

```
lib/logging/
├── README.md              # This file
└── transports/
    ├── base.ts           # LogTransport interface and LogData type
    ├── console.ts        # Console transport (stdout/stderr)
    ├── file.ts           # File transport with rotation
    └── index.ts          # Export barrel
```

## Transports

### Console Transport

Outputs logs to stdout/stderr using the appropriate console method for each log level.

### File Transport

Writes logs to files with automatic rotation:
- **combined.log** - All log entries
- **error.log** - Error-level logs only
- Rotates when files exceed max size (combined.log.1, combined.log.2, etc.)
- Automatically deletes old rotated files beyond max count
- Newline-delimited JSON format for easy parsing

## Browser Logging

Browser logs are sent to the server via POST `/api/logs`:
- Authenticated requests only
- Rate limited to 100 logs/minute per user
- Batched (up to 10 logs or 5 seconds)
- Falls back to console if API fails
- Always logs to console in development mode

## Adding New Transports

To add a new transport (e.g., CloudWatch, Sentry):

1. Create a new file in `lib/logging/transports/`
2. Implement the `LogTransport` interface:

```typescript
import { LogTransport, LogData } from './base';

export class CloudWatchTransport implements LogTransport {
  async write(logData: LogData): Promise<void> {
    // Send to CloudWatch
  }
}
```

3. Export from `index.ts`
4. Add to `initializeTransports()` in `lib/logger.ts`

## Log Format

All logs follow this structured format:

```typescript
{
  timestamp: string;        // ISO 8601
  level: LogLevel;          // error, warn, info, debug
  message: string;          // Log message
  context: {                // Additional context
    [key: string]: any;
  };
  error?: {                 // Optional error details
    name: string;
    message: string;
    stack?: string;
  };
}
```

## Best Practices

1. **Use appropriate log levels:**
   - `error` - Errors that need attention
   - `warn` - Warning conditions
   - `info` - Normal but significant events
   - `debug` - Detailed debug information

2. **Add context:**
   ```typescript
   logger.info('User action', { userId, action: 'login' });
   ```

3. **Use child loggers for request context:**
   ```typescript
   const reqLogger = logger.child({ requestId });
   ```

4. **Don't log sensitive data:**
   - Never log API keys, passwords, or tokens
   - Sanitize user data before logging

5. **Include error objects:**
   ```typescript
   logger.error('Operation failed', { operation: 'save' }, error);
   ```
