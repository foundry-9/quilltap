# Unit Test Mocking Issues - Investigation Summary

## Problem
Tests in `__tests__/unit/profiles-test-message.test.ts` and `profiles-test-connection.test.ts` fail because Jest mocks for `decryptApiKey` and `createLLMProvider` don't expose proper mock methods like `.mockReturnValue()`.

## Error
```
TypeError: mockDecryptApiKey.mockReturnValue is not a function
TypeError: mockCreateLLMProvider.mockReturnValue is not a function
```

## Approaches Tried

### 1. Inline Mock Factories ❌
```typescript
jest.mock('@/lib/encryption', () => ({
  decryptApiKey: jest.fn(),
}))
```
Result: Mocks created but methods not accessible

### 2. jest.mocked() Helper ❌  
```typescript
const mockDecryptApiKey = jest.mocked(decryptApiKey)
```
Result: Type helper only, doesn't fix runtime issue

### 3. Direct Type Casting ❌
```typescript
(decryptApiKey as jest.Mock).mockReturnValue('value')
```
Result: Runtime error - mockReturnValue undefined

### 4. require() vs import ❌
Tried using `require()` instead of `import` to force module loading after mocks
Result: Same issue persists

### 5. __mocks__ Directory ❌
Created `__mocks__/lib/encryption.ts` and `__mocks__/lib/llm/factory.ts`
Result: Files not picked up by Jest or same issue persists

### 6. Moving Mocks to jest.setup.ts
**Status: NOT YET TRIED**  
Other modules like OpenAI are successfully mocked in jest.setup.ts. This approach should work.

## Current Test Status
- **Passing**: 306 tests (other test suites work fine)
- **Failing**: 25 tests (only profiles-test-message and profiles-test-connection)
- **Issue**: Mock setup only

## Recommended Solution

Add module mocks to `jest.setup.ts` similar to how OpenAI is mocked:

```typescript
// In jest.setup.ts
jest.mock('@/lib/encryption', () => ({
  decryptApiKey: jest.fn(),
  encryptApiKey: jest.fn(),
  maskApiKey: jest.fn(),
  testEncryption: jest.fn(),
}))

jest.mock('@/lib/llm/factory', () => ({
  createLLMProvider: jest.fn(),
}))
```

Then in test files, use `jest.mocked()` to get typed references:
```typescript
import { decryptApiKey } from '@/lib/encryption'
const mockDecryptApiKey = jest.mocked(decryptApiKey)
mockDecryptApiKey.mockReturnValue('test-key') // Should work
```

## Files Modified
- `__tests__/unit/profiles-test-message.test.ts` - Attempted various mock setups
- Created `__mocks__/lib/encryption.ts`
- Created `__mocks__/lib/llm/factory.ts`

## Next Steps
1. Move mocks to jest.setup.ts
2. Update test files to use jest.mocked()
3. Remove __mocks__ files if not needed
4. Verify all 25 tests pass
