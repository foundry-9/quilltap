# Where is Image Generation in Quilltap?

Quick navigation guide to find and use image generation features.

---

## 🎨 Image Generation Profiles

**Location**: Settings → Image Generation Profiles tab

### How to Access
1. Click on **Settings** in the main menu/sidebar
2. Look for tabs at the top: API Keys | Connection Profiles | Chat Settings | **Image Generation Profiles**
3. Click the **Image Generation Profiles** tab

### What You'll Find
- List of all your image generation profiles
- Buttons to:
  - **New Profile** - Create a new profile
  - **Edit** - Edit an existing profile
  - **Delete** - Remove a profile
- Profile details showing:
  - Profile name
  - Provider badge (OpenAI, Google, Grok)
  - Model name
  - API key used
  - Parameters
  - Default indicator

---

## 🔑 API Keys

**Location**: Settings → API Keys tab

### How to Access
1. Click on **Settings** in the main menu/sidebar
2. Click the **API Keys** tab (usually the first tab)

### What You'll Find
- List of all your API keys
- Buttons to:
  - **New API Key** - Add a key from a provider
  - **Test** - Test if a key works
  - **Delete** - Remove a key
- Key details showing:
  - Key label
  - Provider (OpenAI, Google, Grok, etc.)
  - Status (active/inactive)

---

## 💬 Using Image Generation in Chats

**Location**: Chat Settings → Image Generation Profile dropdown

### How to Access
1. Open a chat (or create a new one)
2. Look for chat settings (usually gear icon or settings section)
3. Find the **Image Generation Profile** dropdown
4. Select a profile from the list

### What You'll Find
- Dropdown menu showing:
  - "No image generation" option (to disable)
  - List of all available image profiles
  - Default profile (if one is set as default)
- Details of selected profile:
  - Profile name
  - Model being used
  - Provider badge

---

## 📍 File Locations in Codebase

### UI Components
```
components/
└─ image-profiles/
   ├─ ImageProfileForm.tsx           (Create/edit form)
   ├─ ImageProfileParameters.tsx     (Provider settings)
   ├─ ImageProfilePicker.tsx         (Chat selector)
   └─ ProviderIcon.tsx               (Visual indicators)

components/settings/
└─ image-profiles-tab.tsx            (Main settings tab)
```

### API Endpoints
```
app/api/
└─ image-profiles/
   ├─ route.ts                       (GET/POST profiles)
   ├─ [id]/route.ts                  (GET/PUT/DELETE profile)
   ├─ models/route.ts                (GET available models)
   └─ validate-key/route.ts          (POST validate key)
```

### Page Integration
```
app/(authenticated)/
└─ settings/
   └─ page.tsx                       (Settings page with all tabs)
```

---

## 🔄 User Workflow

```
1. Settings Page
   ├─ API Keys Tab
   │  └─ Add API key(s)
   │
   └─ Image Generation Profiles Tab
      ├─ Create profile(s)
      ├─ Configure parameters
      └─ Mark as default (optional)

2. Chat Page
   └─ Chat Settings
      └─ Select image profile

3. Chat Conversation
   └─ Ask for image
      └─ AI generates image
         └─ Image appears in chat
```

---

## 🎯 Quick Navigation Paths

### Setup Flow
```
Dashboard/Main Menu
  → Settings
    → API Keys Tab
      → New API Key
    → Image Generation Profiles Tab
      → New Profile
        → Select API Key
        → Select Model
        → Configure Parameters
        → Create
```

### Usage Flow
```
Chat/Conversation
  → Chat Settings
    → Image Generation Profile Dropdown
      → Select Profile
  → Type message requesting image
    → AI generates image
```

---

## 📱 Mobile Considerations

The Settings page is responsive and works on mobile:
- Tabs stack or scroll horizontally on small screens
- Forms are touch-friendly
- All buttons and inputs are accessible

---

## 🔍 What Each Section Does

### Image Generation Profiles Tab
- **New Profile Button**: Opens form to create a new image generation configuration
- **Profile List**: Shows all your created profiles with details
- **Edit Button**: Opens form to modify existing profile
- **Delete Button**: Removes profile (with confirmation)
- **Default Badge**: Indicates which profile is the default

### Settings in Profile
- **Name**: Friendly name for the profile
- **Provider**: OpenAI, Google Imagen, or Grok
- **API Key**: Which key to use for authentication
- **Model**: Specific model to use (dall-e-3, imagen-4, etc.)
- **Parameters**: Provider-specific settings (quality, style, aspect ratio, etc.)
- **Default**: Whether to use this profile by default

### Chat Integration
- **Dropdown**: Select which profile to use for image generation in this chat
- **Optional**: Leave empty to disable image generation for this chat
- **Per-Chat**: Each chat can have different profile selected

---

## 🚀 Getting Started (Steps)

1. **Navigate to Settings**
   - Click Settings in menu/sidebar

2. **Add API Key**
   - Click API Keys tab
   - Click New API Key
   - Select provider, paste key, save

3. **Create Image Profile**
   - Click Image Generation Profiles tab
   - Click New Profile
   - Fill form with details
   - Click Create Profile

4. **Use in Chat**
   - Open a chat
   - Access chat settings
   - Select your profile from Image Generation Profile dropdown
   - Ask for an image in the chat

5. **See Results**
   - AI generates and displays image
   - Image saved in chat history

---

## ❓ Can't Find Something?

### "I can't find Settings"
- Look for a gear icon ⚙️ or "Settings" link in the main menu
- Or check Dashboard → Settings

### "I don't see Image Generation Profiles tab"
- Make sure you're on the Settings page (not a chat settings)
- Check if you need to scroll tabs (on mobile)
- Tab should appear after Chat Settings tab

### "The dropdown doesn't show any profiles"
- You need to create a profile first
- Go to Settings → Image Generation Profiles
- Click New Profile and configure it

### "I can't add an API key"
- Make sure you have a valid key from the provider
- Try validating it in the form
- Check provider's documentation for key format

---

## 📚 More Information

For detailed instructions, see:
- [GETTING_STARTED_IMAGE_GENERATION.md](GETTING_STARTED_IMAGE_GENERATION.md) - Quick 5-min setup
- [USER_GUIDE_IMAGE_GENERATION.md](USER_GUIDE_IMAGE_GENERATION.md) - Complete guide
- [QUICK_REFERENCE_IMAGE_GENERATION.md](QUICK_REFERENCE_IMAGE_GENERATION.md) - Quick lookup
- [IMAGE_GENERATION_VISUAL_GUIDE.md](IMAGE_GENERATION_VISUAL_GUIDE.md) - Diagrams and flowcharts

---

## Summary

```
🎨 IMAGE GENERATION FEATURES LOCATED AT:

├─ API Management
│  └─ Settings → API Keys Tab
│
├─ Profile Management
│  └─ Settings → Image Generation Profiles Tab
│
├─ Chat Integration
│  └─ Chat Settings → Image Generation Profile Dropdown
│
└─ Usage
   └─ Ask for image in chat
      → AI generates and displays
```

**Everything is accessible through the Settings page!**
