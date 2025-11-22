# Image Generation - Quick Reference Card

## 3-Step Setup

### 1️⃣ Add API Key
**Settings** → **API Keys** → **New API Key**
- Choose provider (OpenAI, Grok, or Google)
- Paste key from provider's website
- Give it a label

### 2️⃣ Create Profile
**Settings** → **Image Generation Profiles** → **New Profile**
- Fill name, provider, API key
- Click **Validate**
- Select model
- Set parameters (optional)
- Check "Default" if desired

### 3️⃣ Use in Chat
Open/create chat → Select profile → Ask for image

---

## Providers at a Glance

| Provider | Best For | Models | Key Params |
|----------|----------|--------|-----------|
| **OpenAI** | Photo-realistic, detailed | dall-e-3, dall-e-2, gpt-image-1 | Quality, Style, Size |
| **Google Imagen** | Natural, diverse | imagen-4.0, imagen-3.0 | Aspect Ratio, Negative Prompt |
| **Grok (xAI)** | Creative, experimental | grok-2-image | (Prompt-based) |

---

## Quick Workflows

### Change Profile for Chat
1. Open chat settings
2. Select different profile from dropdown
3. Done - new images use new profile

### Edit Profile Settings
1. **Settings** → **Image Generation Profiles**
2. Click **Edit** on profile
3. Change settings
4. Click **Update**

### Delete Profile
1. **Settings** → **Image Generation Profiles**
2. Click **Delete** on profile
3. Confirm

### Validate API Key
1. Open profile settings or create form
2. Click **Validate** button
3. See ✓ or ✗ status

---

## OpenAI Parameters

```
Quality:  standard | hd
          (hd = more detail & consistency)

Style:    vivid | natural
          (vivid = dramatic, natural = realistic)

Size:     1024x1024 (square)
        | 1792x1024 (landscape)
        | 1024x1792 (portrait)
```

---

## Google Imagen Parameters

```
Aspect Ratio:   1:1 | 16:9 | 9:16 | 4:3 | 3:2

Negative Prompt: Things to avoid
                (e.g., "blurry, low quality, distorted")
```

---

## Prompting Tips

| Goal | How To |
|------|--------|
| Clear request | "Generate an image of X" |
| Detailed | Include style, color, mood, composition |
| Specific | Name the art style (oil painting, watercolor, digital art) |
| Quality | Use adjectives (beautiful, detailed, professional) |
| Variety | Change the prompt each time or try different models |

---

## Keyboard Shortcuts

None specific to image generation - use chat normally.

---

## Common Issues & Fixes

| Problem | Fix |
|---------|-----|
| "API key not found" | Add key in Settings → API Keys |
| "Failed to generate" | Check API credits; validate key |
| No image generated | Make request clearer; ensure profile selected |
| Slow generation | Normal (10-60s); try faster model if impatient |
| Same image twice | Add variation to prompt or try different model |

---

## Image Location

Generated images appear:
- 📍 In the chat message thread
- 📍 In your chat history
- 📍 Saved in database (private to your account)

Right-click to download/save.

---

## API Usage

⚠️ **Remember**: Each image generation uses API credits from your provider account.

Track usage:
- OpenAI: https://platform.openai.com/account/billing/overview
- Google: Google Cloud Console billing
- Grok/xAI: Your account dashboard

---

## Default vs Per-Chat

| Setting | Used When | Precedence |
|---------|-----------|-----------|
| Default Profile | No profile set for chat | Lowest |
| Per-Chat Profile | Selected in chat settings | Highest |

---

## Model Recommendations

**Best Overall**: DALL-E 3 or Imagen 4

**Fastest**: DALL-E 2 or Imagen 3 Fast

**Creative**: Grok

**Versatile**: Google Imagen

---

## Aspect Ratio Guide

```
1:1   ████  Perfect for: Portraits, squares, avatars
16:9  ████████  Perfect for: Landscapes, wide shots
9:16  █
      █  Perfect for: Tall portraits, people standing
      █
4:3   ███   Perfect for: Standard photos
3:2   ███   Perfect for: Photography aspect ratio
```

---

## When Images Are Saved

✅ **Saved automatically**:
- Every generated image
- To your chat history
- In the database

✅ **Still visible**:
- Even if you edit chat
- In chat export
- In conversation history

✅ **Private**:
- Only visible to you
- Not shared unless you share the chat

---

## Cost Considerations

🔹 Each image costs API credits (varies by provider)

🔹 Models with higher quality/detail cost more

🔹 Monitor your usage on provider's dashboard

🔹 Set up usage alerts if available

---

## Next Steps

1. Get API keys for your preferred providers
2. Create 2-3 profiles with different settings
3. Try them out with various prompts
4. Find your favorites and optimize settings
5. Use consistently for best results

---

**Questions?** See `USER_GUIDE_IMAGE_GENERATION.md` for detailed walkthrough.
