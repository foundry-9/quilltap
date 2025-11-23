# Image Generation Tool - User Guide

A practical walkthrough of how to set up and use the image generation feature in Quilltap.

## Quick Start (5 minutes)

### Step 1: Add an API Key

Before you can generate images, you need to add an API key for your chosen provider.

1. Go to **Settings** → **API Keys** (or **Dashboard** → **Settings** → **API Keys**)
2. Click **New API Key**
3. Choose your provider:
   - **OpenAI** - For DALL-E models
   - **Grok** - For xAI's Grok image generation
   - **Google** - For Google Imagen
4. Get your API key from the provider's website:
   - [OpenAI API Keys](https://platform.openai.com/api-keys)
   - [xAI API Keys](https://console.x.ai) (Grok)
   - [Google Cloud Console](https://console.cloud.google.com/) (Imagen)
5. Paste the key and give it a label (e.g., "My OpenAI Key")
6. Click **Save**

### Step 2: Create an Image Generation Profile

Now create a profile that configures how images will be generated.

1. Go to **Settings** → **Image Generation Profiles**
2. Click **New Profile**
3. Fill in the form:
   - **Profile Name**: Something descriptive (e.g., "DALL-E 3 HD")
   - **Provider**: Choose OpenAI, Grok, or Google Imagen
   - **API Key**: Select the key you just added
   - Click **Validate** to verify the key works
4. **Model**: Select which model to use
   - OpenAI: dall-e-3, dall-e-2, gpt-image-1
   - Grok: grok-2-image
   - Google Imagen: imagen-4.0-generate-001, imagen-3.0-generate-002, etc.
5. **Parameters** (optional):
   - **OpenAI**: Set quality (standard/HD), style (vivid/natural), size
   - **Google Imagen**: Set aspect ratio (1:1, 16:9, 9:16, etc.), negative prompt
   - **Grok**: Minimal settings, controlled via prompt
6. Check **Set as default profile** if you want this to be used by default
7. Click **Create Profile**

### Step 3: Use Image Generation in Chat

Now you can generate images while chatting!

1. Create a new chat or open an existing one
2. In the chat settings, select your image generation profile from **Image Generation Profile**
3. In the chat, ask for an image:
   - "Create an image of a sunset over mountains"
   - "Generate a portrait of a person in steampunk style"
   - "Make a cartoon illustration of a funny robot"
4. The AI will automatically generate the image and display it in the chat

That's it! The AI handles the rest - it detects when you want an image, calls the generation tool, and displays the result.

---

## Detailed Guide

### Managing Image Profiles

#### View All Profiles

Go to **Settings** → **Image Generation Profiles** to see all your profiles:

```
┌─────────────────────────────────────────────────────────────┐
│ Image Generation Profiles                      [New Profile] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ DALL-E 3 HD            [OpenAI Badge]                        │
│ Model: dall-e-3                                    [Default] │
│ API Key: My OpenAI Key                                       │
│ Parameters:                                                  │
│   quality: hd                                                │
│   style: vivid                                               │
│   size: 1024x1024                                            │
│                                  [Edit] [Delete]             │
│                                                              │
│ Grok Image Gen         [Grok Badge]                          │
│ Model: grok-2-image                                          │
│ API Key: xAI Key                                             │
│                                  [Edit] [Delete]             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### Edit a Profile

1. Find the profile in the list
2. Click **Edit**
3. Modify any settings:
   - Name, model, parameters
   - API key
   - Default status
4. Click **Update**

#### Delete a Profile

1. Find the profile in the list
2. Click **Delete**
3. Confirm deletion

### Provider-Specific Configuration

#### OpenAI (DALL-E)

**Supported Models**:
- `gpt-image-1` - Latest, most capable
- `dall-e-3` - High quality, follows prompts closely
- `dall-e-2` - Faster, earlier generation

**Parameters**:

| Parameter | Options | Effect |
|-----------|---------|--------|
| **Quality** | standard, hd | HD produces finer details and better consistency |
| **Style** | vivid, natural | Vivid is dramatic and hyper-real; Natural is realistic and less exaggerated |
| **Size** | 1024x1024, 1792x1024, 1024x1792 | Image dimensions (square, landscape, portrait) |

**Example Profile**:
```
Name: DALL-E 3 HD
Provider: OpenAI
Model: dall-e-3
Quality: hd
Style: vivid
Size: 1024x1024
```

**Usage Example**:
```
User: "Create a portrait of a woman with blue eyes, oil painting style"
Result: High-quality, detailed portrait matching the description
```

#### Google Imagen

**Supported Models**:
- `imagen-4.0-generate-001` - Latest
- `imagen-3.0-generate-002` - Stable
- `imagen-3.0-fast-generate-001` - Faster generation

**Parameters**:

| Parameter | Options | Effect |
|-----------|---------|--------|
| **Aspect Ratio** | 1:1, 16:9, 9:16, 4:3, 3:2 | Image proportions |
| **Negative Prompt** | Text | Things to avoid in the image |

**Example Profile**:
```
Name: Imagen 4 Fast
Provider: Google Imagen
Model: imagen-3.0-fast-generate-001
Aspect Ratio: 16:9
Negative Prompt: blurry, low quality, distorted
```

**Usage Example**:
```
User: "Generate a landscape scene of a mountain lake at sunset"
Result: High-quality landscape in 16:9 widescreen format
```

#### Grok (xAI)

**Supported Models**:
- `grok-2-image` - xAI's image generation model

**Parameters**:
- Minimal configuration - most control is via the prompt itself

**Example Profile**:
```
Name: Grok Image Gen
Provider: Grok
Model: grok-2-image
```

**Usage Example**:
```
User: "Draw a futuristic city with flying cars"
Result: Creative sci-fi illustration
```

### Using Profiles in Chats

#### Select Profile for a Chat

When creating or editing a chat:

1. Look for **Image Generation Profile** in the chat settings
2. Click the dropdown to see available profiles
3. Select a profile or leave it unset to disable image generation
4. The selected profile shows:
   - Profile name
   - Model being used
   - Provider icon

```
Image Generation Profile
┌──────────────────────────────────────────┐
│ ▼ DALL-E 3 HD (dall-e-3)        [OpenAI] │
│                                          │
│ Shows: Profile name (model) [Provider]   │
└──────────────────────────────────────────┘
```

#### Default vs. Per-Chat Profiles

- **Default Profile**: Set in Settings → Image Generation Profiles
  - Used automatically if no profile selected for chat
  - Good for consistent style across most conversations

- **Per-Chat Profile**: Selected in individual chat settings
  - Overrides default for that specific chat
  - Useful for experimenting or context-specific requirements

### Prompting for Image Generation

The AI will recognize when you want to generate images and automatically use the selected profile. Here are some effective ways to request images:

#### Clear Requests

```
"Generate an image of a sunset over the ocean"
"Create a portrait of a woman with red hair"
"Make an illustration of a futuristic robot"
"Draw a landscape of mountains and forests"
```

#### Detailed Descriptions

```
"Generate an oil painting of a medieval castle at night,
with torches lighting the walls and a full moon in the sky,
in the style of classic fantasy art"
```

#### Style-Specific Requests

```
"Create a photo-realistic image of a modern living room"
"Generate a cartoon illustration of a funny cat"
"Make a watercolor painting of wildflowers"
"Draw a steampunk-style airship"
```

#### Abstract Concepts

```
"Create an image representing 'growth and change'"
"Generate a visual of 'peaceful meditation'"
"Make an image showing 'technological advancement'"
```

#### Multi-Subject Requests

```
"Create an image with a woman and a dog playing in a park"
"Generate a scene with multiple hot air balloons over a valley"
```

### Understanding Image Generation

#### What Happens When You Request an Image

1. **Detection**: The AI recognizes your image request
2. **Tool Call**: The AI calls the `generate_image` tool with your prompt
3. **Execution**:
   - System loads your selected profile
   - Validates the API key
   - Sends request to the provider
   - Provider generates the image (usually 10-60 seconds)
4. **Storage**: Image is saved to your chat history
5. **Display**: Image appears in the chat
6. **Response**: AI provides context or commentary about the image

#### Typical Timeline

```
0s     - You send request
1s     - AI recognizes and calls tool
2-5s   - API call sent to provider
5-60s  - Provider generates image
60s+   - Image received and displayed
61s+   - AI responds about the image
```

#### Limitations

- **Provider Limits**: Each provider has usage limits (check your account)
- **Quality**: Depends on model selection and detailed prompts
- **Speed**: Depends on provider and model
- **Cost**: Each image generation costs API credits (check provider pricing)

### Troubleshooting

#### Issue: "API key not found" or "Unauthorized"

**Solution**:
1. Check that you have at least one API key added in Settings
2. Verify the key is for the correct provider
3. Try validating the key again

#### Issue: "Failed to generate image" or Provider Error

**Solutions**:
1. Check that your API key is valid and has sufficient credits
2. Try with a simpler prompt
3. Try a different model
4. Check provider status page for outages

#### Issue: Image Generation Not Working in Chat

**Solutions**:
1. Make sure you've selected an image generation profile for the chat
2. Try creating a new chat with the profile selected
3. Check that the profile's API key is valid (click "Edit Profile" → "Validate")
4. Try rephrasing your request more clearly

#### Issue: Same Image Generated Repeatedly

**This is normal!** If you use the exact same prompt and parameters, you'll get similar results. To get variety:
- Modify your prompt
- Try a different model
- Change quality/style parameters
- Use different aspect ratios

### Best Practices

#### 1. Create Multiple Profiles for Different Purposes

```
- DALL-E 3 HD (high quality, detailed)
- DALL-E 2 Fast (quick, experimental)
- Imagen 4 Widescreen (for landscapes)
```

#### 2. Set Default Profile Wisely

Choose one that works well for your most common use case:
- Detail-oriented work → DALL-E 3 HD
- Experimentation → Faster model
- Variety → Alternate between profiles

#### 3. Use Detailed Prompts

❌ Bad: "Generate an image"
✅ Good: "Generate a digital painting of an astronaut floating in space with colorful nebulae in the background"

#### 4. Understand Provider Strengths

- **OpenAI (DALL-E)**: Best for photorealism and detailed renderings
- **Google Imagen**: Great for natural-looking images and diverse styles
- **Grok**: Creative and experimental, good for unique interpretations

#### 5. Monitor API Usage

- Check your provider's dashboard regularly
- Be aware of costs (API credits used per image)
- Consider usage limits if on free tier

#### 6. Iterate and Refine

```
Round 1: "Create a dragon"
Result: Generic dragon

Round 2: "Create a blue dragon with golden wings,
         standing on a mountain peak, in fantasy art style"
Result: Much better!
```

### Advanced Tips

#### Using Negative Prompts (Google Imagen)

```
Prompt: "A person sitting on a beach"
Negative Prompt: "blurry, distorted faces, low quality"

Result: Clear image without common artifacts
```

#### Aspect Ratio Strategy

- **1:1 (Square)**: Portraits, profile pictures
- **16:9 (Landscape)**: Scenery, wide vistas
- **9:16 (Portrait)**: Full-body figures, tall scenes
- **4:3, 3:2**: Standard photography ratios

#### Model Selection Tips

| Goal | Recommend |
|------|-----------|
| Highest quality | DALL-E 3 or Imagen 4 |
| Fastest generation | DALL-E 2 or Imagen 3 Fast |
| Experimental | Grok |
| Style flexibility | Google Imagen |

---

## FAQ

**Q: Can I change the image generation profile mid-conversation?**
A: Yes, edit the chat settings and select a different profile. New images will use the new profile.

**Q: Do images generated this way count against my API limits?**
A: Yes, each image uses API credits from your provider account.

**Q: Can I download generated images?**
A: Yes, you can right-click and save images from the chat.

**Q: What if the AI doesn't generate an image when I ask for one?**
A: The AI decides whether to call the image generation tool. Try being more explicit: "Please generate an image of..." or "Create an image showing..."

**Q: Can I use the same API key for multiple providers?**
A: Each key is tied to a specific provider. Use separate keys for each.

**Q: What's the difference between "default" profile and per-chat profile?**
A: Default is used if chat has none selected. Per-chat overrides the default.

**Q: Can I generate multiple images in one request?**
A: This depends on the LLM - ask for "multiple images of..." or request them one at a time.

**Q: Are my images private?**
A: Images are stored in your chat history. They're only visible to you unless you share the chat.

**Q: Why do similar prompts produce different images?**
A: Diffusion models have randomness built in. If you need identical results, that's not the intended use.

---

## Examples & Inspiration

### Character Design
```
"Create a fantasy character design: a half-elf ranger with long silver hair,
wearing leather armor and carrying a bow. Include a natural forest background."
```

### Concept Art
```
"Design a futuristic city from the year 2150 with flying vehicles,
holographic billboards, and tall crystalline buildings"
```

### Illustration
```
"Illustrate a cozy library scene with warm lighting, bookshelves,
a reading chair, and a cat sleeping on a table"
```

### Visual Exploration
```
"Generate a series of color palettes for a peaceful meditation app
[Request in multiple prompts for variety]"
```

### Reference Material
```
"Create a reference sheet showing different poses of a human figure
[Use negative prompt to avoid blurriness]"
```

---

## Summary

You now have everything needed to use image generation in Quilltap:

1. ✅ Add API keys for your chosen providers
2. ✅ Create image generation profiles with your preferred settings
3. ✅ Select profiles for your chats
4. ✅ Ask the AI to generate images naturally
5. ✅ View and use the generated images

The system is designed to be seamless - just chat normally and let the AI decide when to generate images based on your requests.

**Happy creating!** 🎨
