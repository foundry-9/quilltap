# Image Profile API Endpoints - Phase 6 Reference

## Quick Reference

### Base URL
All endpoints require authentication. Include session cookie or auth header.

## List & Create Profiles

### GET /api/image-profiles
List all image profiles for the current user.

**Query Parameters**:
- `sortByCharacter` (optional): Character ID for tag-based sorting
- `sortByPersona` (optional): Persona ID for tag-based sorting

**Response**: Array of image profiles

```bash
curl http://localhost:3000/api/image-profiles \
  -H "Cookie: __Secure-next-auth.session-token=..."
```

---

### POST /api/image-profiles
Create a new image profile.

**Body**:
```json
{
  "name": "My DALL-E Profile",
  "provider": "OPENAI",
  "apiKeyId": "uuid-of-api-key",
  "modelName": "dall-e-3",
  "parameters": {
    "quality": "hd",
    "style": "vivid"
  },
  "isDefault": true
}
```

**Required Fields**:
- `name` (string, non-empty, unique per user)
- `provider` (OPENAI | GROK | GOOGLE_IMAGEN)
- `modelName` (string)

**Optional Fields**:
- `apiKeyId` (string): UUID of stored API key
- `baseUrl` (string): Custom endpoint URL
- `parameters` (object): Provider-specific settings
- `isDefault` (boolean): Set as default profile

**Response**: Created profile object (201)

```bash
curl -X POST http://localhost:3000/api/image-profiles \
  -H "Content-Type: application/json" \
  -H "Cookie: __Secure-next-auth.session-token=..." \
  -d '{
    "name": "DALL-E 3",
    "provider": "OPENAI",
    "modelName": "dall-e-3",
    "apiKeyId": "abc123",
    "parameters": {"quality": "hd", "style": "vivid"},
    "isDefault": true
  }'
```

---

## Individual Profile Operations

### GET /api/image-profiles/[id]
Get a specific profile by ID.

**Path Parameters**:
- `id` (string): Profile UUID

**Response**: Profile object with full details

```bash
curl http://localhost:3000/api/image-profiles/abc123 \
  -H "Cookie: __Secure-next-auth.session-token=..."
```

---

### PUT /api/image-profiles/[id]
Update a profile.

**Path Parameters**:
- `id` (string): Profile UUID

**Body**: All fields optional
```json
{
  "name": "Updated Name",
  "provider": "OPENAI",
  "modelName": "gpt-image-1",
  "apiKeyId": "new-api-key-id",
  "parameters": { "quality": "hd" },
  "isDefault": false
}
```

**Response**: Updated profile object

```bash
curl -X PUT http://localhost:3000/api/image-profiles/abc123 \
  -H "Content-Type: application/json" \
  -H "Cookie: __Secure-next-auth.session-token=..." \
  -d '{"parameters": {"quality": "hd"}}'
```

---

### DELETE /api/image-profiles/[id]
Delete a profile.

**Path Parameters**:
- `id` (string): Profile UUID

**Response**: Success message (200)

```bash
curl -X DELETE http://localhost:3000/api/image-profiles/abc123 \
  -H "Cookie: __Secure-next-auth.session-token=..."
```

---

## Provider Models & Validation

### GET /api/image-profiles/models
Get available models for a provider.

**Query Parameters**:
- `provider` (required): OPENAI | GROK | GOOGLE_IMAGEN
- `apiKeyId` (optional): API key UUID (uses stored key)

**Response**:
```json
{
  "provider": "OPENAI",
  "models": ["gpt-image-1", "dall-e-3", "dall-e-2"],
  "supportedModels": ["gpt-image-1", "dall-e-3", "dall-e-2"]
}
```

```bash
# Without API key (returns defaults)
curl "http://localhost:3000/api/image-profiles/models?provider=OPENAI" \
  -H "Cookie: __Secure-next-auth.session-token=..."

# With API key (validates and returns actual models)
curl "http://localhost:3000/api/image-profiles/models?provider=OPENAI&apiKeyId=abc123" \
  -H "Cookie: __Secure-next-auth.session-token=..."
```

---

### POST /api/image-profiles/validate-key
Validate an API key for image generation.

**Body**: One of the following:
```json
{
  "provider": "OPENAI",
  "apiKeyId": "uuid-of-stored-key"
}
```

or

```json
{
  "provider": "OPENAI",
  "apiKey": "sk-..."
}
```

**Response**:
```json
{
  "valid": true,
  "message": "API key is valid",
  "models": ["gpt-image-1", "dall-e-3", "dall-e-2"]
}
```

```bash
# Validate stored key
curl -X POST http://localhost:3000/api/image-profiles/validate-key \
  -H "Content-Type: application/json" \
  -H "Cookie: __Secure-next-auth.session-token=..." \
  -d '{"provider": "OPENAI", "apiKeyId": "abc123"}'

# Validate direct key
curl -X POST http://localhost:3000/api/image-profiles/validate-key \
  -H "Content-Type: application/json" \
  -H "Cookie: __Secure-next-auth.session-token=..." \
  -d '{"provider": "OPENAI", "apiKey": "sk-..."}'
```

---

## Supported Providers

### OPENAI
Models: gpt-image-1, dall-e-3, dall-e-2
Parameters:
- quality: "standard" | "hd"
- style: "vivid" | "natural"
- size: "1024x1024", "1792x1024", "1024x1792"

### GROK
Models: grok-2-image
Parameters: (minimal)
- (Supports basic prompt-based generation)

### GOOGLE_IMAGEN
Models: imagen-4.0-generate-001, imagen-3.0-generate-002, imagen-3.0-fast-generate-001
Parameters:
- aspectRatio: "1:1", "16:9", "9:16", "4:3", "3:2"
- negativePrompt: string

---

## Error Responses

### 401 Unauthorized
User not authenticated

```json
{
  "error": "Unauthorized"
}
```

### 400 Bad Request
Invalid input parameters

```json
{
  "error": "Invalid provider. Must be one of: OPENAI, GROK, GOOGLE_IMAGEN"
}
```

### 404 Not Found
Resource doesn't exist or doesn't belong to user

```json
{
  "error": "Image profile not found"
}
```

### 409 Conflict
Duplicate resource (e.g., profile name already exists)

```json
{
  "error": "An image profile with this name already exists"
}
```

### 500 Server Error
Internal server error

```json
{
  "error": "Failed to create image profile"
}
```

---

## Common Workflows

### Create a Complete Profile

1. Verify API key is valid
```bash
curl -X POST http://localhost:3000/api/image-profiles/validate-key \
  -H "Content-Type: application/json" \
  -d '{"provider": "OPENAI", "apiKey": "sk-..."}'
```

2. Create the API key in system (use /api/keys endpoint)

3. Create the image profile
```bash
curl -X POST http://localhost:3000/api/image-profiles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "DALL-E 3",
    "provider": "OPENAI",
    "modelName": "dall-e-3",
    "apiKeyId": "key-uuid",
    "parameters": {"quality": "hd"},
    "isDefault": true
  }'
```

### Assign Profile to Chat

Use `/api/chats/[id]` PUT endpoint with imageProfileId:
```bash
curl -X PUT http://localhost:3000/api/chats/chat-uuid \
  -H "Content-Type: application/json" \
  -d '{"imageProfileId": "profile-uuid"}'
```

### Switch Default Profile

Update old default to false, new to true:
```bash
# Disable old default
curl -X PUT http://localhost:3000/api/image-profiles/old-id \
  -H "Content-Type: application/json" \
  -d '{"isDefault": false}'

# Enable new default (automatically disables others)
curl -X PUT http://localhost:3000/api/image-profiles/new-id \
  -H "Content-Type: application/json" \
  -d '{"isDefault": true}'
```

---

## Testing with cURL

```bash
# Set auth token in variable
export TOKEN="__Secure-next-auth.session-token=..."

# List profiles
curl http://localhost:3000/api/image-profiles \
  -H "Cookie: $TOKEN"

# Create profile
curl -X POST http://localhost:3000/api/image-profiles \
  -H "Content-Type: application/json" \
  -H "Cookie: $TOKEN" \
  -d '{"name":"Test","provider":"OPENAI","modelName":"dall-e-3"}'

# Get specific profile
curl http://localhost:3000/api/image-profiles/PROFILE_ID \
  -H "Cookie: $TOKEN"

# Update profile
curl -X PUT http://localhost:3000/api/image-profiles/PROFILE_ID \
  -H "Content-Type: application/json" \
  -H "Cookie: $TOKEN" \
  -d '{"name":"Updated"}'

# Delete profile
curl -X DELETE http://localhost:3000/api/image-profiles/PROFILE_ID \
  -H "Cookie: $TOKEN"

# Get models
curl "http://localhost:3000/api/image-profiles/models?provider=OPENAI" \
  -H "Cookie: $TOKEN"

# Validate key
curl -X POST http://localhost:3000/api/image-profiles/validate-key \
  -H "Content-Type: application/json" \
  -H "Cookie: $TOKEN" \
  -d '{"provider":"OPENAI","apiKey":"sk-..."}'
```

---

## Notes

- All endpoints require user authentication
- User can only access/modify their own profiles
- API keys are encrypted in database (never exposed in responses)
- Default profiles are automatically managed (only one per user)
- Profile names must be unique per user
- Deleting a profile cascades to chats (imageProfileId set to NULL)
- Model discovery can work without an API key (returns defaults)
- API key validation uses real provider endpoints
