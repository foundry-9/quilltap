# Phase 7 Component Usage Guide

## Quick Start

### Adding Image Profiles Tab to Settings

In your settings page component:

```typescript
import ImageProfilesTab from '@/components/settings/image-profiles-tab'

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      {/* ... other settings tabs ... */}
      <ImageProfilesTab />
    </div>
  )
}
```

### Adding Image Profile Selection to Chat Settings

In your chat settings/creation form:

```typescript
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'

export function ChatSettingsForm({ chat }) {
  const [imageProfileId, setImageProfileId] = useState(chat?.imageProfileId)

  return (
    <form>
      {/* ... other form fields ... */}

      <div>
        <label className="block text-sm font-medium mb-2">
          Image Generation Profile (Optional)
        </label>
        <ImageProfilePicker
          value={imageProfileId}
          onChange={setImageProfileId}
          characterId={chat?.characterId}
          personaId={chat?.personaId}
        />
      </div>

      {/* ... rest of form ... */}
    </form>
  )
}
```

## Component Reference

### ImageProfileForm

**Purpose**: Create or edit image profiles

**Props**:
```typescript
interface ImageProfileFormProps {
  profile?: ImageProfile        // undefined for create mode
  apiKeys: ApiKey[]            // Available API keys
  onSuccess?: () => void       // Called after save
  onCancel?: () => void        // Called when canceling
}
```

**Example - Create Mode**:
```tsx
<ImageProfileForm
  apiKeys={availableApiKeys}
  onSuccess={() => {
    refreshProfiles()
    closeDialog()
  }}
  onCancel={closeDialog}
/>
```

**Example - Edit Mode**:
```tsx
<ImageProfileForm
  profile={selectedProfile}
  apiKeys={availableApiKeys}
  onSuccess={() => {
    refreshProfiles()
    closeDialog()
  }}
  onCancel={closeDialog}
/>
```

**Features**:
- Form validation with error display
- Provider selection (OPENAI, GROK, GOOGLE_IMAGEN)
- API key selection and validation
- Real-time model discovery
- Provider-specific parameters
- Default profile management
- Loading states

### ImageProfilePicker

**Purpose**: Select an image profile for use in chats

**Props**:
```typescript
interface ImageProfilePickerProps {
  value?: string | null        // Currently selected profile ID
  onChange?: (id: string | null) => void
  characterId?: string         // For tag-based sorting
  personaId?: string          // For tag-based sorting
}
```

**Example - Basic Usage**:
```tsx
const [profileId, setProfileId] = useState<string | null>(null)

<ImageProfilePicker
  value={profileId}
  onChange={setProfileId}
/>
```

**Example - With Character Sorting**:
```tsx
<ImageProfilePicker
  value={chat.imageProfileId}
  onChange={(id) => updateChat({ imageProfileId: id })}
  characterId={chat.characterId}
  personaId={chat.personaId}
/>
```

**Features**:
- Lists all available profiles
- Tag-based sorting by character/persona
- Shows profile details in preview
- Supports null selection (no image generation)
- Loading and error states

### ImageProfileParameters

**Purpose**: Configure provider-specific parameters

**Props**:
```typescript
interface ImageProfileParametersProps {
  provider: 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN'
  parameters: Record<string, any>
  onChange: (params: Record<string, any>) => void
}
```

**Example**:
```tsx
const [params, setParams] = useState({})

<ImageProfileParameters
  provider={selectedProvider}
  parameters={params}
  onChange={setParams}
/>
```

**Provider-Specific Parameters**:

**OpenAI**:
- `quality`: "standard" | "hd"
- `style`: "vivid" | "natural"
- `size`: "1024x1024" | "1792x1024" | "1024x1792"

**Google Imagen**:
- `aspectRatio`: "1:1" | "16:9" | "9:16" | "4:3" | "3:2"
- `negativePrompt`: string

**Grok**:
- (No additional parameters)

### ProviderIcon and ProviderBadge

**Purpose**: Visual indicators for image providers

**ProviderIcon Props**:
```typescript
interface ProviderIconProps {
  provider: 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN'
  className?: string  // Default: 'h-5 w-5'
}
```

**Example - ProviderIcon**:
```tsx
<ProviderIcon provider="OPENAI" className="h-6 w-6" />
```

**Example - ProviderBadge**:
```tsx
<ProviderBadge provider="GROK" />
// Renders: [xAI icon] Grok
```

**Usage in Lists**:
```tsx
<div className="flex items-center gap-2">
  <ProviderIcon provider={profile.provider} />
  <span>{profile.name}</span>
  {profile.isDefault && (
    <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
      Default
    </span>
  )}
</div>
```

### ImageProfilesTab

**Purpose**: Full management interface for settings page

**Usage**:
```tsx
import ImageProfilesTab from '@/components/settings/image-profiles-tab'

<ImageProfilesTab />
```

**Features**:
- List all profiles
- Create new profiles
- Edit existing profiles
- Delete with confirmation
- Display profile details
- Error handling

## Integration Patterns

### Pattern 1: Standalone Form Dialog

```tsx
import { ImageProfileForm } from '@/components/image-profiles/ImageProfileForm'
import { Dialog } from '@/components/ui/dialog'

export function CreateProfileDialog() {
  const [open, setOpen] = useState(false)
  const [apiKeys, setApiKeys] = useState([])

  useEffect(() => {
    fetchApiKeys()
  }, [])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Image Profile</DialogTitle>
        </DialogHeader>
        <ImageProfileForm
          apiKeys={apiKeys}
          onSuccess={() => {
            setOpen(false)
            refreshProfiles()
          }}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
```

### Pattern 2: Picker in Form

```tsx
import { ImageProfilePicker } from '@/components/image-profiles/ImageProfilePicker'
import { useState } from 'react'

export function ChatForm({ initialChat }) {
  const [formData, setFormData] = useState({
    ...initialChat,
    imageProfileId: initialChat?.imageProfileId || null,
  })

  return (
    <form onSubmit={handleSubmit}>
      <label>Image Generation (Optional)</label>
      <ImageProfilePicker
        value={formData.imageProfileId}
        onChange={(id) =>
          setFormData(prev => ({ ...prev, imageProfileId: id }))
        }
        characterId={formData.characterId}
      />

      <button type="submit">Save</button>
    </form>
  )
}
```

### Pattern 3: Settings Page Integration

```tsx
import ImageProfilesTab from '@/components/settings/image-profiles-tab'
import { useState } from 'react'

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('profiles')

  return (
    <div>
      <div className="border-b mb-6">
        <button
          onClick={() => setActiveTab('profiles')}
          className={activeTab === 'profiles' ? 'font-bold border-b-2' : ''}
        >
          Image Profiles
        </button>
        {/* ... other tabs ... */}
      </div>

      {activeTab === 'profiles' && <ImageProfilesTab />}
    </div>
  )
}
```

## API Integration Details

### Creating a Profile

```typescript
const response = await fetch('/api/image-profiles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'DALL-E 3 HD',
    provider: 'OPENAI',
    modelName: 'dall-e-3',
    apiKeyId: 'key-uuid',
    parameters: {
      quality: 'hd',
      style: 'vivid',
    },
    isDefault: true,
  }),
})
```

### Listing Profiles

```typescript
// Get all profiles
const response = await fetch('/api/image-profiles')

// Get profiles sorted by character tags
const response = await fetch(
  '/api/image-profiles?sortByCharacter=char-id&sortByPersona=persona-id'
)
```

### Getting Available Models

```typescript
// Without API key (returns defaults)
const response = await fetch('/api/image-profiles/models?provider=OPENAI')

// With API key (fetches actual models)
const response = await fetch(
  '/api/image-profiles/models?provider=OPENAI&apiKeyId=key-id'
)
```

### Validating an API Key

```typescript
// Validate stored key
const response = await fetch('/api/image-profiles/validate-key', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    provider: 'OPENAI',
    apiKeyId: 'key-uuid',
  }),
})

// Validate direct key
const response = await fetch('/api/image-profiles/validate-key', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    provider: 'OPENAI',
    apiKey: 'sk-...',
  }),
})
```

## Error Handling

### Form Validation Errors

```typescript
// Component handles validation and displays errors
<ImageProfileForm
  apiKeys={apiKeys}
  onSuccess={handleSuccess}
/>

// User sees errors like:
// "Profile name is required"
// "Provider is required"
// "API key is required"
```

### API Errors

```typescript
// Components display API errors gracefully
try {
  const response = await fetch(...)
  if (!response.ok) {
    const data = await response.json()
    setError(data.error || 'An error occurred')
  }
} catch (err) {
  setError('Network error')
}
```

### Retry Logic

```typescript
// Validation button allows user to retry
<button
  onClick={handleValidateKey}
  disabled={!formData.apiKeyId || isValidating}
>
  {isValidating ? 'Validating...' : 'Validate'}
</button>
```

## Styling and Customization

### Tailwind Classes Used

```
Spacing: px-3 py-2, px-4 py-2, mb-2, mt-1, gap-2, gap-3, gap-6, space-y-4, space-y-6
Colors: text-gray-*, bg-gray-*, border-gray-*, text-blue-600, bg-blue-600
Borders: border, border-gray-300, rounded-md, rounded-lg
States: disabled:bg-gray-400, hover:bg-*, focus:outline-*
```

### Customizing Styles

To customize component styling:

1. **Override in component props**: Pass className to wrapper elements
2. **Modify Tailwind config**: Update tailwind.config.ts
3. **Create wrapper component**: Extend components with custom styling

Example custom wrapper:

```tsx
export function CustomImageProfileForm(props) {
  return (
    <div className="max-w-2xl mx-auto">
      <ImageProfileForm {...props} />
    </div>
  )
}
```

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Performance Considerations

- Models are fetched on provider change (debounced)
- Profiles are fetched once on mount
- No unnecessary re-renders with proper state management
- Lazy loading of profile lists

## Accessibility

- Semantic HTML form elements
- Proper label associations
- Error messages linked to fields
- Keyboard navigation support
- ARIA attributes where needed

## Troubleshooting

### Models not loading?
- Check API key is valid
- Verify provider is correct
- Check network requests in DevTools

### Form not submitting?
- Check validation errors are resolved
- Ensure API key is selected
- Check network requests for errors

### Profiles not appearing?
- Ensure profiles are created first
- Check API is returning data
- Verify user authentication

## Next Steps

After implementing these components:

1. **Add to Settings Page**: Integrate ImageProfilesTab
2. **Add to Chat Settings**: Integrate ImageProfilePicker
3. **Test Creation Flow**: Create and test image profiles
4. **Test Selection**: Use profiles in chat settings
5. **Monitor Usage**: Track profile selection and usage

## Support

For issues or questions:
1. Check component TypeScript types
2. Review API endpoint documentation
3. Check browser console for errors
4. Verify API responses in Network tab
