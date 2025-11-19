# Quilltap API Documentation

Complete API reference for Quilltap v1.0.

## Table of Contents

- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Handling](#error-handling)
- [Endpoints](#endpoints)
  - [Health](#health)
  - [API Keys](#api-keys)
  - [Connection Profiles](#connection-profiles)
  - [Characters](#characters)
  - [Personas](#personas)
  - [Chats](#chats)
  - [Messages](#messages)

## Authentication

All API endpoints (except `/api/health`) require authentication via NextAuth.js session cookies.

### Session Cookie

- Automatically set after Google OAuth login
- httpOnly, secure (in production)
- Include credentials in requests:

```javascript
fetch('/api/characters', {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
  },
});
```

### Unauthorized Response

```json
{
  "error": "Unauthorized",
  "message": "You must be signed in to access this resource"
}
```

## Rate Limiting

Rate limits are enforced on all endpoints:

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Auth endpoints | 5 requests | 60 seconds |
| Chat streaming | 20 messages | 60 seconds |
| API endpoints | 100 requests | 10 seconds |
| General | 100 requests | 60 seconds |

### Rate Limit Headers

All responses include rate limit information:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642584000
```

### Rate Limit Exceeded Response

```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Please try again later."
}
```

Status code: `429 Too Many Requests`

## Error Handling

### Error Response Format

```json
{
  "error": "Error Type",
  "message": "Human-readable error message",
  "details": {} // Optional additional details
}
```

### Common HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error
- `503` - Service Unavailable

## Endpoints

### Health

#### `GET /api/health`

Check application health status.

**Authentication**: Not required

**Response**: `200 OK`

```json
{
  "status": "healthy",
  "timestamp": "2025-01-19T12:00:00.000Z",
  "uptime": 86400,
  "environment": "production",
  "database": "connected"
}
```

**Unhealthy Response**: `503 Service Unavailable`

```json
{
  "status": "unhealthy",
  "timestamp": "2025-01-19T12:00:00.000Z",
  "uptime": 86400,
  "environment": "production",
  "database": "disconnected",
  "error": "Connection refused"
}
```

---

### API Keys

#### `GET /api/keys`

List all API keys for authenticated user.

**Response**: `200 OK`

```json
[
  {
    "id": "key-uuid",
    "provider": "OPENAI",
    "label": "My OpenAI Key",
    "keyMasked": "sk-...1234",
    "isActive": true,
    "lastUsed": "2025-01-19T10:00:00.000Z",
    "createdAt": "2025-01-15T12:00:00.000Z",
    "updatedAt": "2025-01-19T10:00:00.000Z"
  }
]
```

#### `POST /api/keys`

Create a new API key.

**Request Body**:

```json
{
  "provider": "OPENAI",
  "label": "My OpenAI Key",
  "apiKey": "sk-..."
}
```

**Validation**:
- `provider`: Required, one of: OPENAI, ANTHROPIC, OLLAMA, OPENROUTER, OPENAI_COMPATIBLE
- `label`: Required, 1-100 characters
- `apiKey`: Required, will be encrypted

**Response**: `201 Created`

```json
{
  "id": "key-uuid",
  "provider": "OPENAI",
  "label": "My OpenAI Key",
  "keyMasked": "sk-...1234",
  "isActive": true,
  "createdAt": "2025-01-19T12:00:00.000Z"
}
```

#### `GET /api/keys/[id]`

Get a specific API key (masked).

**Response**: `200 OK`

```json
{
  "id": "key-uuid",
  "provider": "OPENAI",
  "label": "My OpenAI Key",
  "keyMasked": "sk-...1234",
  "isActive": true,
  "lastUsed": "2025-01-19T10:00:00.000Z",
  "createdAt": "2025-01-15T12:00:00.000Z"
}
```

#### `PUT /api/keys/[id]`

Update an API key.

**Request Body**:

```json
{
  "label": "Updated Label",
  "isActive": false
}
```

**Response**: `200 OK`

#### `DELETE /api/keys/[id]`

Delete an API key.

**Response**: `204 No Content`

#### `POST /api/keys/[id]/test`

Test an API key connection.

**Response**: `200 OK`

```json
{
  "success": true,
  "message": "Connection successful",
  "provider": "OPENAI"
}
```

**Error Response**: `400 Bad Request`

```json
{
  "success": false,
  "message": "Invalid API key",
  "provider": "OPENAI"
}
```

---

### Connection Profiles

#### `GET /api/profiles`

List all connection profiles.

**Response**: `200 OK`

```json
[
  {
    "id": "profile-uuid",
    "name": "GPT-4 Profile",
    "provider": "OPENAI",
    "apiKeyId": "key-uuid",
    "baseUrl": null,
    "modelName": "gpt-4",
    "parameters": {
      "temperature": 0.7,
      "max_tokens": 1000,
      "top_p": 1
    },
    "isDefault": true,
    "createdAt": "2025-01-15T12:00:00.000Z"
  }
]
```

#### `POST /api/profiles`

Create a connection profile.

**Request Body**:

```json
{
  "name": "GPT-4 Profile",
  "provider": "OPENAI",
  "apiKeyId": "key-uuid",
  "modelName": "gpt-4",
  "parameters": {
    "temperature": 0.7,
    "max_tokens": 1000
  },
  "isDefault": false
}
```

**For Ollama/OpenAI-compatible**:

```json
{
  "name": "Local Ollama",
  "provider": "OLLAMA",
  "baseUrl": "http://localhost:11434",
  "modelName": "llama2",
  "parameters": {}
}
```

**Response**: `201 Created`

#### `GET /api/profiles/[id]`

Get a specific profile.

**Response**: `200 OK`

#### `PUT /api/profiles/[id]`

Update a profile.

**Response**: `200 OK`

#### `DELETE /api/profiles/[id]`

Delete a profile.

**Response**: `204 No Content`

---

### Characters

#### `GET /api/characters`

List all characters.

**Response**: `200 OK`

```json
[
  {
    "id": "char-uuid",
    "name": "Alice",
    "description": "A friendly AI assistant",
    "personality": "Helpful and kind",
    "scenario": "You're chatting with Alice",
    "firstMessage": "Hello! How can I help you today?",
    "avatarUrl": null,
    "createdAt": "2025-01-15T12:00:00.000Z",
    "personas": [
      {
        "personaId": "persona-uuid",
        "isDefault": true,
        "persona": {
          "id": "persona-uuid",
          "name": "User"
        }
      }
    ]
  }
]
```

#### `POST /api/characters`

Create a character.

**Request Body**:

```json
{
  "name": "Alice",
  "description": "A friendly AI assistant",
  "personality": "Helpful and kind",
  "scenario": "You're chatting with Alice",
  "firstMessage": "Hello! How can I help you today?",
  "exampleDialogues": "<START>\nUser: Hi\nAlice: Hello!\n<END>",
  "systemPrompt": "You are Alice, a helpful assistant."
}
```

**Response**: `201 Created`

#### `GET /api/characters/[id]`

Get a character with linked personas.

**Response**: `200 OK`

#### `PUT /api/characters/[id]`

Update a character.

**Response**: `200 OK`

#### `DELETE /api/characters/[id]`

Delete a character.

**Response**: `204 No Content`

#### `POST /api/characters/import`

Import a SillyTavern character (PNG or JSON).

**Request**: `multipart/form-data`

```
file: <character.png or character.json>
```

**Response**: `201 Created`

```json
{
  "id": "char-uuid",
  "name": "Imported Character",
  "message": "Character imported successfully"
}
```

#### `GET /api/characters/[id]/export`

Export character as SillyTavern JSON.

**Response**: `200 OK`

```json
{
  "name": "Alice",
  "description": "...",
  "personality": "...",
  "scenario": "...",
  "first_mes": "...",
  "mes_example": "...",
  "creator": "Quilltap",
  "character_version": "1.0"
}
```

#### `GET /api/characters/[id]/personas`

Get personas linked to character.

**Response**: `200 OK`

```json
[
  {
    "personaId": "persona-uuid",
    "isDefault": true,
    "persona": {
      "id": "persona-uuid",
      "name": "User",
      "description": "Default user persona"
    }
  }
]
```

#### `POST /api/characters/[id]/personas`

Link a persona to character.

**Request Body**:

```json
{
  "personaId": "persona-uuid",
  "isDefault": false
}
```

**Response**: `201 Created`

---

### Personas

#### `GET /api/personas`

List all personas.

**Response**: `200 OK`

```json
[
  {
    "id": "persona-uuid",
    "name": "User",
    "description": "Default user persona",
    "personalityTraits": "Curious, friendly",
    "createdAt": "2025-01-15T12:00:00.000Z"
  }
]
```

#### `POST /api/personas`

Create a persona.

**Request Body**:

```json
{
  "name": "User",
  "description": "Default user persona",
  "personalityTraits": "Curious, friendly"
}
```

**Response**: `201 Created`

#### `GET /api/personas/[id]`

Get a specific persona.

**Response**: `200 OK`

#### `PUT /api/personas/[id]`

Update a persona.

**Response**: `200 OK`

#### `DELETE /api/personas/[id]`

Delete a persona.

**Response**: `204 No Content`

#### `POST /api/personas/import`

Import a SillyTavern persona.

**Request**: `multipart/form-data`

```
file: <persona.json>
```

**Response**: `201 Created`

#### `GET /api/personas/[id]/export`

Export persona as SillyTavern JSON.

**Response**: `200 OK`

---

### Chats

#### `GET /api/chats`

List all chats for authenticated user.

**Response**: `200 OK`

```json
[
  {
    "id": "chat-uuid",
    "title": "Chat with Alice",
    "characterId": "char-uuid",
    "personaId": "persona-uuid",
    "connectionProfileId": "profile-uuid",
    "createdAt": "2025-01-19T10:00:00.000Z",
    "updatedAt": "2025-01-19T12:00:00.000Z",
    "character": {
      "id": "char-uuid",
      "name": "Alice"
    },
    "connectionProfile": {
      "id": "profile-uuid",
      "name": "GPT-4 Profile"
    }
  }
]
```

#### `POST /api/chats`

Create a new chat.

**Request Body**:

```json
{
  "characterId": "char-uuid",
  "personaId": "persona-uuid",
  "connectionProfileId": "profile-uuid",
  "title": "Chat with Alice",
  "scenario": "Optional custom scenario"
}
```

**Response**: `201 Created`

```json
{
  "id": "chat-uuid",
  "title": "Chat with Alice",
  "characterId": "char-uuid",
  "messages": [
    {
      "id": "msg-uuid",
      "role": "ASSISTANT",
      "content": "Hello! How can I help you today?",
      "createdAt": "2025-01-19T12:00:00.000Z"
    }
  ]
}
```

#### `GET /api/chats/[id]`

Get a chat with full message history.

**Response**: `200 OK`

```json
{
  "id": "chat-uuid",
  "title": "Chat with Alice",
  "messages": [
    {
      "id": "msg-uuid",
      "role": "SYSTEM",
      "content": "System prompt...",
      "createdAt": "2025-01-19T10:00:00.000Z"
    },
    {
      "id": "msg-uuid-2",
      "role": "ASSISTANT",
      "content": "Hello!",
      "createdAt": "2025-01-19T10:00:01.000Z"
    }
  ]
}
```

#### `PUT /api/chats/[id]`

Update a chat.

**Request Body**:

```json
{
  "title": "Updated Title"
}
```

**Response**: `200 OK`

#### `DELETE /api/chats/[id]`

Delete a chat (cascades to messages).

**Response**: `204 No Content`

#### `POST /api/chats/import`

Import a SillyTavern chat.

**Request**: `multipart/form-data`

```
file: <chat.jsonl>
characterId: <char-uuid>
connectionProfileId: <profile-uuid>
```

**Response**: `201 Created`

#### `GET /api/chats/[id]/export`

Export chat as SillyTavern JSONL.

**Response**: `200 OK`

---

### Messages

#### `POST /api/chats/[id]/messages`

Send a message and get streaming response.

**Request Body**:

```json
{
  "content": "Hello, how are you?"
}
```

**Response**: Server-Sent Events (text/event-stream)

```
data: {"type":"start"}

data: {"type":"token","content":"I"}

data: {"type":"token","content":"'m"}

data: {"type":"token","content":" doing"}

data: {"type":"token","content":" well"}

data: {"type":"done","messageId":"msg-uuid"}
```

**Error during streaming**:

```
data: {"type":"error","message":"API request failed"}
```

#### `PUT /api/messages/[id]`

Edit a message.

**Request Body**:

```json
{
  "content": "Updated message content"
}
```

**Response**: `200 OK`

```json
{
  "id": "msg-uuid",
  "content": "Updated message content",
  "updatedAt": "2025-01-19T12:05:00.000Z"
}
```

#### `DELETE /api/messages/[id]`

Delete a message.

**Response**: `204 No Content`

#### `POST /api/messages/[id]/swipe`

Generate alternative response (swipe).

**Response**: Server-Sent Events (same format as chat messages)

Creates a new message in the same swipe group.

---

## WebSocket Events (Future)

WebSocket support for real-time features is planned for v2.0.

## SDK Examples

### JavaScript/TypeScript

```typescript
// Send message with streaming
async function sendMessage(chatId: string, content: string) {
  const response = await fetch(`/api/chats/${chatId}/messages`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader!.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        console.log(data);
      }
    }
  }
}
```

### Python

```python
import requests

# List characters
response = requests.get(
    'https://yourdomain.com/api/characters',
    cookies={'next-auth.session-token': 'your-session-cookie'}
)
characters = response.json()
```

## Versioning

Current API version: **v1.0**

Future versions will be available at `/api/v2/...` to maintain backwards compatibility.

## Support

- Report issues: https://github.com/foundry-9/quilltap/issues
- Documentation: https://github.com/foundry-9/quilltap/tree/main/docs
