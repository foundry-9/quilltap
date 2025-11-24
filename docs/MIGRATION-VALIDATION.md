# Migration Validation Framework

**Purpose**: Define validation checkpoints for JSON database migration
**Reference**: [INVENTORY-PHASE.md](./INVENTORY-PHASE.md)

## Pre-Migration Baseline (Current State)

This section captures the current Prisma schema state for later comparison.

### Model Count Baseline

Run this command to generate a baseline:
```bash
npm run data:dump-metadata
```

This creates `data/cache/prisma-metadata-{DATE}.json` with:
- Count of records in each model
- Schema version (0.7.0)
- Timestamp of capture

**Expected Models**: 23 total

### Schema Models Checklist

All models must be migrated:

#### Authentication & User (4 models)
- [ ] `User` - Main user record + password/TOTP/backup codes
- [ ] `ChatSettings` - UI preferences
- [ ] `Account` - OAuth provider accounts
- [ ] `Session` - NextAuth sessions
- [ ] `VerificationToken` - Email verification + password reset tokens

#### API & LLM Configuration (3 models)
- [ ] `ApiKey` - Encrypted API keys (AES-256-GCM)
- [ ] `ConnectionProfile` - LLM profiles
- [ ] `ConnectionProfileTag` - Tags for LLM profiles

#### Characters & Personas (5 models)
- [ ] `Character` - Character definitions
- [ ] `Persona` - Persona definitions
- [ ] `CharacterPersona` - Character ↔ Persona relationships
- [ ] `CharacterTag` - Character tags
- [ ] `PersonaTag` - Persona tags

#### Chat System (4 models)
- [ ] `Chat` - Chat metadata
- [ ] `Message` - Individual messages
- [ ] `ChatFile` - File attachments
- [ ] `ChatTag` - Chat tags

#### Images & Assets (4 models)
- [ ] `Image` - Image metadata + binary reference
- [ ] `ImageTag` - Image tags
- [ ] `ChatAvatarOverride` - Per-chat avatar overrides
- [ ] `ImageProfile` - Image generation profiles
- [ ] `ImageProfileTag` - Image profile tags

#### Tags (1 model)
- [ ] `Tag` - Global tag catalog

**Total**: 23 models

## Field-Level Migration Checklist

### Encrypted Fields (Must Preserve Encryption)

These fields contain sensitive data and must maintain encryption:

**User Model**:
- [ ] `passwordHash` (bcrypt)
- [ ] `totpSecret` (AES-256-GCM encrypted)
- [ ] `totpSecretIv`
- [ ] `totpSecretAuthTag`
- [ ] `backupCodes` (AES-256-GCM encrypted)
- [ ] `backupCodesIv`
- [ ] `backupCodesAuthTag`

**ApiKey Model**:
- [ ] `keyEncrypted` (AES-256-GCM)
- [ ] `keyIv`
- [ ] `keyAuthTag`

**Validation**: After migration, verify encrypted fields:
1. Decrypt TOTP secret and verify it works with authenticator
2. Verify password hash works with bcrypt comparison
3. Test backup code validation
4. Decrypt API key and test against LLM provider

### JSON-Typed Fields (Flexible Structure)

These fields contain flexible JSON that must be preserved as-is:

- [ ] `ConnectionProfile.parameters` - LLM parameters (temp, max_tokens, etc)
- [ ] `Message.rawResponse` - Full LLM API response
- [ ] `Chat.sillyTavernMetadata` - Optional ST metadata
- [ ] `Character.sillyTavernData` - Full ST character spec
- [ ] `Persona.sillyTavernData` - Full ST persona spec
- [ ] `ImageProfile.parameters` - Image generation parameters

### Relationship Integrity (Must Preserve FK Rules)

Validate all foreign key relationships and cascade rules:

| Relationship | Cascade Rule | Validation |
|---|---|---|
| User → Account | Cascade | Deleting user removes all accounts |
| User → Session | Cascade | Deleting user removes all sessions |
| User → ApiKey | Cascade | Deleting user removes all API keys |
| User → ConnectionProfile | Cascade | Deleting user removes all profiles |
| User → Character | Cascade | Deleting user removes all characters |
| User → Persona | Cascade | Deleting user removes all personas |
| User → Chat | Cascade | Deleting user removes all chats |
| User → Image | Cascade | Deleting user removes all images |
| User → Tag | Cascade | Deleting user removes all tags |
| User → ImageProfile | Cascade | Deleting user removes all image profiles |
| User → ChatSettings | Cascade | Deleting user removes settings |
| Chat → Message | Cascade | Deleting chat removes all messages |
| Chat → ChatFile | Cascade | Deleting chat removes all files |
| Character → Chat | Cascade | Deleting character soft-validates chats |
| Persona → Chat | SetNull | Deleting persona nulls chat.personaId |
| ChatFile → Message | SetNull | Deleting message nulls ChatFile.messageId |
| ImageProfile → ApiKey | SetNull | Deleting ApiKey nulls imageProfile.apiKeyId |
| ConnectionProfile → ApiKey | SetNull | Deleting ApiKey nulls profile.apiKeyId |

## Data Migration Validation Tests

### Test 1: Record Count Parity
```
For each model M:
  Count(Prisma M) == Count(JSON M)
```

Verify all record counts match between Prisma and JSON store.

### Test 2: Field Completeness
```
For each model M and field F:
  All non-nullable fields in Prisma must exist in JSON
  All enum values must be valid
```

### Test 3: Relationship Integrity
```
For each foreign key:
  JSON reference must point to existing record
  Cascade rules must be consistent
```

### Test 4: Encryption Validation
```
For each encrypted field E:
  JSON(E) must decrypt successfully
  Decrypted content must match Prisma value
```

### Test 5: JSON Field Validation
```
For each JSON-typed field:
  Must be valid JSON
  Must parse successfully
  Must maintain structure
```

## Enums to Validate

All enum values must be preserved exactly:

### Provider
- [ ] OPENAI
- [ ] ANTHROPIC
- [ ] OLLAMA
- [ ] OPENROUTER
- [ ] OPENAI_COMPATIBLE
- [ ] GROK
- [ ] GAB_AI

### ImageProvider
- [ ] OPENAI
- [ ] GROK
- [ ] GOOGLE_IMAGEN

### Role
- [ ] SYSTEM
- [ ] USER
- [ ] ASSISTANT
- [ ] TOOL

### ImageTagType
- [ ] CHARACTER
- [ ] PERSONA
- [ ] CHAT
- [ ] THEME

### AvatarDisplayMode
- [ ] ALWAYS
- [ ] GROUP_ONLY
- [ ] NEVER

## Timestamp Fields

All timestamp fields must be preserved in ISO-8601 format:

- [ ] User.createdAt
- [ ] User.updatedAt
- [ ] User.emailVerified
- [ ] User.totpVerifiedAt
- [ ] All model.createdAt fields
- [ ] All model.updatedAt fields

## Validation Milestones

### Phase: Inventory (Now)
- [x] Freeze schema version
- [x] Generate baseline metadata
- [x] Document all models and fields
- [ ] Execute metadata dump against dev database

### Phase: Scaffold (Next)
- [ ] Create JSON schema definitions (Zod)
- [ ] Create directory structure
- [ ] Implement JsonStore service

### Phase: Dual-Write (After Scaffold)
- [ ] Implement dual-write layer
- [ ] Add validation tests
- [ ] Run parity checks

### Phase: Verification (Final)
- [ ] Run full validation suite
- [ ] Generate final comparison report
- [ ] Approve data integrity

### Phase: Cutover (Go-Live)
- [ ] Flip DATA_BACKEND to json
- [ ] Final export and snapshot
- [ ] Remove Prisma dependencies

## Validation Script Template

```typescript
// tests/migration-validation.test.ts

describe('JSON Migration Validation', () => {
  describe('Record Count Parity', () => {
    it('should have same count of Users', async () => {
      const prismaCount = await prisma.user.count();
      const jsonCount = await jsonStore.users.count();
      expect(jsonCount).toBe(prismaCount);
    });
    // ... similar for all 23 models
  });

  describe('Encryption Validation', () => {
    it('should decrypt TOTP secret successfully', async () => {
      const user = await prisma.user.findFirst();
      const jsonUser = await jsonStore.users.findById(user.id);
      const decrypted = await decrypt(jsonUser.totpSecretCiphertext);
      expect(decrypted).toBe(user.totpSecret);
    });
  });

  describe('Relationship Integrity', () => {
    it('should maintain Chat → Message relationships', async () => {
      const chats = await prisma.chat.findMany({ include: { messages: true } });
      for (const chat of chats) {
        const jsonMessages = await jsonStore.chats.getMessages(chat.id);
        expect(jsonMessages.length).toBe(chat.messages.length);
      }
    });
  });
});
```

## Success Criteria

Migration is **READY FOR CUTOVER** when:

1. ✅ All 23 models migrated to JSON
2. ✅ Record counts match Prisma baseline
3. ✅ All fields present and correctly typed
4. ✅ All relationships intact
5. ✅ All encryption working
6. ✅ All JSON fields valid
7. ✅ All timestamps in ISO-8601 format
8. ✅ All enums have valid values
9. ✅ All validation tests pass
10. ✅ No data loss detected

---

**Status**: Inventory Phase In Progress
**Last Updated**: 2025-11-22
