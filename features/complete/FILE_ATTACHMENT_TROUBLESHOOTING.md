# File Attachment Fallback Troubleshooting Guide

## Common Issues and Solutions

### Issue 1: "Image generation parameter mismatch - temperature setting"

**Symptom:** The LLM responds with an error message about image generation parameters instead of describing your image.

**Root Cause:** The cheap LLM received the image description request but couldn't process it due to:
- Invalid parameter values for that specific model
- Model doesn't actually support image inputs despite being configured
- API endpoint mismatch

**Solution:**

1. **Check your Cheap LLM configuration:**
   ```
   Settings → Connection Profiles → Find your cheap LLM profile
   ```

2. **Verify the model supports vision:**
   - ✅ **OpenAI**: `gpt-4o-mini`, `gpt-4-vision-preview`, `gpt-4o`
   - ✅ **Anthropic**: `claude-haiku-4-5-20251015`, `claude-sonnet-4-5-20250929`
   - ✅ **Google**: `gemini-2.0-flash`, `gemini-1.5-pro-latest`, `gemini-1.5-flash-latest`
   - ✅ **Grok**: `grok-vision-beta`
   - ❌ **NOT vision-capable**: `gpt-3.5-turbo`, `claude-3-haiku-20240307` (old), text-only models

3. **Check parameter values:**
   ```
   Settings → Connection Profiles → Edit cheap LLM profile

   Recommended values:
   - Temperature: 0.7 (or whatever the model supports)
   - Max Tokens: 1000-2000
   - Top P: 1.0
   ```

4. **Test the profile directly:**
   - Use the "Test Message" button in the profile settings
   - This will verify the API key and parameters work

5. **Temporary workaround:**
   - If image descriptions keep failing, the system will mark them as unsupported
   - Text files will still work via fallback
   - You can disable the cheap LLM temporarily and use providers with native image support

### Issue 2: "No cheap LLM profile available for image description"

**Symptom:** Images attached to non-vision providers show error: "No cheap LLM profile available"

**Root Cause:** You haven't configured a cheap LLM profile yet.

**Solution:**

1. **Create a cheap LLM profile:**
   ```
   Settings → Connection Profiles → Add Profile

   Provider: OpenAI (or Anthropic/Google)
   Model: gpt-4o-mini (or vision-capable model)
   Mark as: "cheap LLM"
   ```

2. **Set as default cheap profile:**
   ```
   Settings → Chat Settings → Cheap LLM Settings
   Select your new profile as the default
   ```

3. **Verify it works:**
   - Edit the profile
   - Click "Test Message"
   - Should see: "✓ Test message sent successfully!"

### Issue 3: "Cheap LLM profile does not support image files"

**Symptom:** You have a cheap LLM configured but images still fail.

**Root Cause:** Your cheap LLM profile is using a text-only model.

**Solution:**

1. **Check the model name** in your cheap LLM profile settings

2. **Look for vision indicators:**
   - ✅ Contains "vision", "4o", "haiku-4", "gemini-2", "gemini-1.5"
   - ❌ Contains only "3.5", "turbo", "haiku-3", "opus-3"

3. **Update to a vision-capable model:**
   ```
   Settings → Connection Profiles → Edit cheap profile
   Change model to: gpt-4o-mini (or other vision model)
   Save
   ```

4. **Check the "File attachments" line** under the provider dropdown:
   - Should say: "Images (JPEG, PNG, GIF, WEBP)" or similar
   - If it says: "No file attachments supported" → wrong model

### Issue 4: Text files work but images don't

**Symptom:** Text file attachments are processed correctly, but images fail or show errors.

**Diagnosis:**

This is expected behavior when:
- Your cheap LLM doesn't support images (text-only model)
- No cheap LLM is configured
- Cheap LLM has API issues

**Solution:**

Choose one approach:

**Option A: Fix cheap LLM for images**
1. Set up vision-capable cheap LLM (see Issue 2 above)
2. Test it with the "Test Message" button
3. Try attaching image again

**Option B: Use provider with native image support**
1. Switch to a provider that supports images natively:
   - OpenAI (gpt-4o, gpt-4-vision, gpt-4o-mini)
   - Anthropic (Claude Sonnet/Opus/Haiku 4+)
   - Google (Gemini 1.5/2.0)
   - Grok (with vision models)
2. No fallback needed - images sent directly

**Option C: Convert images to text descriptions manually**
1. Use an external tool to describe the image
2. Paste the description as text
3. Attach as a .txt file instead

### Issue 5: Long delay before response starts

**Symptom:** After attaching an image, there's a 3-5 second delay before the response begins.

**Root Cause:** The system is sending the image to the cheap LLM for description before forwarding to the main provider.

**This is expected behavior:**

```
Image attachment → Cheap LLM (1-3 sec) → Description → Main LLM → Response
```

**To reduce delay:**

1. **Use faster cheap LLM models:**
   - `gpt-4o-mini` (very fast)
   - `gemini-2.0-flash` (very fast)
   - `claude-haiku-4-5` (fast)

2. **Or use provider with native image support:**
   - No description step needed
   - Images sent directly
   - Faster response time

### Issue 6: "Failed to read text file"

**Symptom:** Text file attachment fails with read error.

**Common causes:**

1. **File is too large**
   - Current limit: System memory dependent
   - Recommended: Under 1MB for text files

2. **File encoding issues**
   - Use UTF-8 encoding
   - Avoid exotic character sets

3. **File permissions**
   - Check file is readable
   - Try re-uploading the file

**Solution:**

1. **Check file size:** `ls -lh filename.txt`
2. **Check encoding:** `file filename.txt`
3. **Re-upload:** Delete and upload again
4. **Try copy-paste:** Copy file content and paste as message instead

## Debugging Steps

### Step 1: Check Server Logs

Look for these log messages:

```bash
# Successful processing
[Image Fallback] Using cheap LLM: gpt-4o-mini for image description

# Parameter issues
[Image Fallback] Suspicious response from cheap LLM: error...

# Complete failure
[Image Fallback] Error generating description: API error
```

### Step 2: Verify Profile Configuration

```bash
# In your browser console (F12), check:
Settings → Connection Profiles → Your cheap LLM profile

Look for:
1. Provider shows "File attachments: Images (...)"
2. Model name contains vision indicators
3. API key is valid and active
4. Parameters are within valid ranges
```

### Step 3: Test Isolation

**Test cheap LLM in isolation:**
1. Create a new chat with the cheap LLM profile as the main provider
2. Try sending a message with an image attachment
3. If it works here but fails as fallback → parameter mismatch
4. If it fails here too → model/API issue

**Test without fallback:**
1. Use a provider with native image support
2. Attach the same image
3. If it works → fallback issue
4. If it fails → image file issue

### Step 4: Check File Format

**Verify image is supported:**
```bash
file image.png
# Should show: PNG image data...

# Supported formats:
- JPEG (.jpg, .jpeg)
- PNG (.png)
- GIF (.gif)
- WebP (.webp)

# Unsupported:
- SVG (vector format)
- BMP (legacy format)
- TIFF (not widely supported)
```

## Error Messages Reference

| Error Message | Meaning | Solution |
|---------------|---------|----------|
| "No cheap LLM profile available" | No cheap LLM configured | Create a cheap LLM profile |
| "Cheap LLM profile does not support image files" | Text-only model | Switch to vision-capable model |
| "Failed to generate image description: API error" | API call failed | Check API key and connectivity |
| "Image description produced unexpected result" | Got error instead of description | Check model parameters |
| "Failed to read text file: ENOENT" | File not found | Re-upload the file |
| "File type X is not supported" | Unsupported format | Convert to supported format |

## Best Practices

### For Best Results:

1. **Use recommended cheap LLM models:**
   - OpenAI: `gpt-4o-mini` (fastest, cheapest)
   - Google: `gemini-2.0-flash` (very fast, free tier)
   - Anthropic: `claude-haiku-4-5-20251015` (accurate)

2. **Keep images under 5MB:**
   - Faster upload
   - Faster processing
   - Lower API costs

3. **Use appropriate providers:**
   - Text-heavy workflows → any provider + text fallback
   - Image-heavy workflows → native vision provider
   - Mixed workflows → cheap LLM fallback

4. **Test your setup:**
   - Before important chats
   - After changing profiles
   - When switching models

5. **Monitor costs:**
   - Each image description costs ~$0.001-0.003
   - Text fallback is free
   - Native image support varies by provider

## Getting Help

If you're still experiencing issues:

1. **Check the main documentation:** `FILE_ATTACHMENT_FALLBACK.md`
2. **Look at provider capabilities:** `UI_ATTACHMENT_SUPPORT_PREVIEW.md`
3. **Review server logs** for detailed error messages
4. **Test with minimal setup:** Single provider, single file type
5. **Report issues** with:
   - Provider being used
   - Cheap LLM configuration
   - File type and size
   - Full error message from logs
