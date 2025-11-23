# Getting Started with Image Generation

Your quick start guide to using image generation in Quilltap.

---

## 🚀 The 5-Minute Setup

### Step 1: Choose Your Provider (2 min)

Choose one or more image generation providers:

- **OpenAI (DALL-E)** - Best for photorealism and detail
  - Sign up: https://platform.openai.com/signup
  - Get API key: https://platform.openai.com/api-keys

- **Google Imagen** - Great for diverse styles and landscapes
  - Sign up: https://cloud.google.com
  - Enable Imagen API in Google Cloud Console

- **Grok (xAI)** - Best for creative and experimental
  - Sign up: https://console.x.ai
  - Get API key from dashboard

### Step 2: Add API Key (1 min)

1. Go to **Settings** (top menu or sidebar)
2. Click the **API Keys** tab
3. Click **New API Key**
4. Select your provider
5. Paste the key you got from step 1
6. Give it a label (e.g., "My OpenAI Key")
7. Click **Save**

### Step 3: Create a Profile (2 min)

1. Go back to **Settings**
2. Click the **Image Generation Profiles** tab
3. Click **New Profile**
4. Fill in the form:
   - **Name**: "DALL-E 3" or something descriptive
   - **Provider**: Select your provider
   - **API Key**: Select the key you just added
   - Click **Validate** (shows ✓ if valid)
   - **Model**: Select from dropdown
   - **Parameters**: Keep defaults or adjust if desired
   - Check "Set as default profile" if you want
5. Click **Create Profile**

**Done! You're ready to use image generation.**

---

## 💬 Using Image Generation

### In Your Chat

1. Open a chat (or create a new one)
2. In chat settings, select your image profile
3. Type: "Generate an image of a sunset"
4. The AI will create the image for you! 🎨

That's it. The AI handles the rest automatically.

---

## 📚 What's Next?

### Want more details?
→ Read [USER_GUIDE_IMAGE_GENERATION.md](USER_GUIDE_IMAGE_GENERATION.md)

### Need a quick reference?
→ Use [QUICK_REFERENCE_IMAGE_GENERATION.md](QUICK_REFERENCE_IMAGE_GENERATION.md)

### Want to understand the architecture?
→ Check [IMAGE_GENERATION_FEATURE_COMPLETE.md](IMAGE_GENERATION_FEATURE_COMPLETE.md)

### Looking for all documentation?
→ See [IMAGE_GENERATION_DOCS_INDEX.md](IMAGE_GENERATION_DOCS_INDEX.md)

---

## ❓ Quick Q&A

**Q: Do I need all three providers?**
A: No, one is enough to get started. Try the one that interests you most.

**Q: What if I don't have an API key?**
A: Sign up with one of the providers above (all have free tiers or trials).

**Q: Which provider should I start with?**
A: OpenAI (DALL-E) is most popular and easiest to get started with.

**Q: Can I switch providers later?**
A: Yes, you can create multiple profiles and switch between them.

**Q: Will this cost me money?**
A: Yes, each image generation uses credits from your provider account. Check their pricing.

**Q: How long does image generation take?**
A: Usually 10-60 seconds depending on the model.

**Q: Can I generate multiple images at once?**
A: Ask the AI to "generate multiple images of..." and it may comply.

**Q: Are my images private?**
A: Yes, they're only visible in your chat history. You control who sees them.

---

## 🎯 Common Use Cases

### Character Design
```
"Create a fantasy character design: a ranger with silver hair,
leather armor, and a bow. Include a forest background."
```

### Concept Art
```
"Design a futuristic city with flying vehicles,
holographic signs, and tall buildings"
```

### Storytelling
```
"Illustrate a scene from a story: a person sitting by a
campfire under the stars, with mountains in the distance"
```

### Visual Brainstorming
```
"Generate 3 different logo concepts for a tech startup
[Ask in separate messages for variety]"
```

---

## ⚠️ Common Issues

**"API key not found"**
- Add an API key in Settings → API Keys

**"Failed to generate image"**
- Check that your API key is valid
- Make sure you have credits left
- Try a different prompt or model

**"Image not showing in chat"**
- Make sure you selected a profile in chat settings
- Try asking more clearly: "Please generate an image of..."

---

## 📖 Key Terms

| Term | Meaning |
|------|---------|
| **API Key** | Your secret password to use a provider's service |
| **Provider** | The company providing image generation (OpenAI, Google, xAI) |
| **Profile** | Your configuration for a specific image generator |
| **Default Profile** | The profile used if you don't pick one in chat |
| **Model** | The specific AI model to use (dall-e-3, imagen-4, etc.) |
| **Parameters** | Settings that affect how images are generated |

---

## 📊 Provider Quick Comparison

| | OpenAI | Google | Grok |
|---|--------|--------|------|
| **Best For** | Photorealism | Diversity | Creativity |
| **Easiest Setup** | ✅ | 🔧 | ✅ |
| **Quality** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Speed** | Medium | Fast | Medium |
| **Cost** | $$ | $$ | $$ |
| **Configuration** | Medium | High | Low |

---

## ✅ Setup Checklist

Use this to track your progress:

```
SETUP PHASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ Choose a provider
□ Sign up for API key
□ Get API key from provider
□ Open Quilltap Settings
□ Add API key (Settings → API Keys)
□ Create profile (Settings → Image Profiles)
□ Validate API key in profile
□ Select profile for chat (Chat Settings)

READY TO GENERATE!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
□ Open a chat
□ Ask for an image
□ See generated image
□ Celebrate! 🎉
```

---

## 🎨 Next Steps After Setup

### Explore Providers
- Try different models
- Test different parameters
- Find your favorites

### Create Multiple Profiles
- One for detailed work
- One for fast generation
- One for experimentation

### Prompting Techniques
- Be specific with descriptions
- Include style (oil painting, digital art, etc.)
- Use adjectives (beautiful, detailed, professional)
- Experiment and iterate

### Monitor Usage
- Check your provider's billing dashboard
- Keep track of how many images you generate
- Set up usage alerts if available

---

## 📞 Need Help?

| Problem | Where to Look |
|---------|---------------|
| Setup questions | This document (Getting Started) |
| How to use | [USER_GUIDE_IMAGE_GENERATION.md](USER_GUIDE_IMAGE_GENERATION.md) |
| Quick reference | [QUICK_REFERENCE_IMAGE_GENERATION.md](QUICK_REFERENCE_IMAGE_GENERATION.md) |
| Visual guides | [IMAGE_GENERATION_VISUAL_GUIDE.md](IMAGE_GENERATION_VISUAL_GUIDE.md) |
| Troubleshooting | USER_GUIDE → Troubleshooting section |
| API info | [API_ENDPOINTS_IMAGE_PROFILES.md](API_ENDPOINTS_IMAGE_PROFILES.md) |
| All docs | [IMAGE_GENERATION_DOCS_INDEX.md](IMAGE_GENERATION_DOCS_INDEX.md) |

---

## 💡 Pro Tips

1. **Start simple**: Use default parameters first, then experiment
2. **Be descriptive**: Longer prompts usually get better results
3. **Try multiple providers**: Each has different strengths
4. **Iterate**: Refine your prompts based on results
5. **Monitor costs**: Keep an eye on your API usage
6. **Create test prompts**: Save ones that work well

---

## What You Can Do Now

✅ Generate images in your chat
✅ Create multiple profiles for different styles
✅ Switch between providers and models
✅ Use as default for all chats
✅ Download and share generated images
✅ Include images in your conversation history

---

## Time Investment

| Activity | Time |
|----------|------|
| Initial setup | 5 minutes |
| Per-chat setup | 30 seconds |
| First image generation | 10-60 seconds |
| Learning advanced features | 15-20 minutes |

---

## You're All Set! 🎉

You now have a complete image generation system in Quilltap.

**Next: Open a chat and generate your first image!**

---

## Where to Go From Here

- **Want to learn more?** → Read the [USER_GUIDE_IMAGE_GENERATION.md](USER_GUIDE_IMAGE_GENERATION.md)
- **Need quick reference?** → Bookmark [QUICK_REFERENCE_IMAGE_GENERATION.md](QUICK_REFERENCE_IMAGE_GENERATION.md)
- **Curious about how it works?** → Check [IMAGE_GENERATION_FEATURE_COMPLETE.md](IMAGE_GENERATION_FEATURE_COMPLETE.md)
- **Looking for all docs?** → See [IMAGE_GENERATION_DOCS_INDEX.md](IMAGE_GENERATION_DOCS_INDEX.md)

---

**Welcome to image generation in Quilltap! Happy creating!** 🎨✨
