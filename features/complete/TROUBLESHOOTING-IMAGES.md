# Troubleshooting Image Display Issues

## Current Status

✅ Migration completed successfully - 13 files migrated
✅ Files exist on disk in `public/data/files/storage/`
✅ Metadata is correct in `public/data/files/files.jsonl`
✅ API endpoint is configured correctly
✅ Frontend code is correct

## The Issue

Images are not displaying in the photo gallery despite files being present.

## Diagnosis

### Mirel's Gallery Should Show:
- **Total images**: 12 (all user images)
- **Tagged to Mirel**: 3 images

### Mirel's Tagged Images:
1. `/data/files/storage/1716da8c-95c9-4383-bb34-47b7b19c2cc3.jpeg` ✓ EXISTS
2. `/data/files/storage/6c2bea39-2bca-476f-8529-930d12f20148.png` ✓ EXISTS
3. `/data/files/storage/f7850280-8686-4353-a77f-d29c1c3f976e.png` ✓ EXISTS

All files are present on disk and should be accessible via Next.js.

### Missing Avatar Issue
Mirel's default avatar (ID: `26463a98-be68-41c6-8ad7-94c317251afe`) was already missing before migration. It was one of the 3 skipped files. The file was never on disk.

## Most Likely Solution

**Restart your Next.js development server.**

Next.js caches static files from the `public/` directory. When new files are added to `public/` while the dev server is running, it may not detect them until restart.

### Steps:
1. Stop your dev server (Ctrl+C)
2. Start it again: `npm run dev`
3. Clear your browser cache or do a hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
4. Navigate to Mirel's photo gallery

## Alternative Issues to Check

### 1. Check Browser Console
Open browser DevTools (F12) and check the Console tab for:
- 404 errors when loading images
- CORS errors
- Network errors

### 2. Check Network Tab
In DevTools Network tab:
- Are the image requests being made?
- What URLs are being requested?
- What status codes are returned (200, 404, 403)?

### 3. Test Direct File Access
Try accessing an image directly in your browser:
```
https://localhost:3000/data/files/storage/1716da8c-95c9-4383-bb34-47b7b19c2cc3.jpeg
```

If this returns 404, the dev server hasn't picked up the new files.

### 4. Check API Response
Test the images API endpoint:
```
https://localhost:3000/api/images?tagId=ab20f301-6f4a-4870-88c8-4c935e5182a0
```

This should return 3 images for Mirel.

### 5. Verify File Permissions
Ensure files are readable:
```bash
ls -la public/data/files/storage/
```

All files should be readable (644 permissions).

## Verification Script

Run this to verify everything is set up correctly:

```bash
# Check files exist
ls -lh public/data/files/storage/ | wc -l
# Should show 14 lines (13 files + header)

# Check index has 13 entries
wc -l public/data/files/files.jsonl
# Should show 13

# Check Mirel's tagged images
cat public/data/files/files.jsonl | jq -r 'select(.tags | contains(["ab20f301-6f4a-4870-88c8-4c935e5182a0"])) | .id'
# Should show 3 UUIDs
```

## Expected Behavior After Restart

After restarting the dev server:
- Photo gallery should show 12 total images
- When viewing Mirel's character, 3 images should be tagged to her
- The images should load and display correctly
- The missing avatar issue will remain (file was already lost before migration)

## Next Steps

1. **Restart dev server** - Most likely fix
2. **Check browser console** - Look for specific errors
3. **Test direct file access** - Verify files are being served
4. **Report findings** - If still not working, share:
   - Browser console errors
   - Network tab status codes
   - Result of direct file access test
