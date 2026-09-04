/**
 * Centralized download utilities that work in both Electron and browser contexts.
 *
 * In Electron, blob downloads go through `window.quilltap.saveFile` IPC (native save
 * dialog), and URL downloads use `window.quilltap.downloadUrl` which streams through
 * Electron's `will-download` handler to disk without memory pressure.
 *
 * In a regular browser, both use the standard anchor-click approach.
 */

/** Whether we're running inside the Electron shell with the preload bridge available. */
function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.quilltap?.saveFile;
}

/**
 * Trigger a download from a Blob.
 *
 * Used for blob-based downloads (.qtap exports, API key exports, fetched images).
 * In Electron: converts to ArrayBuffer and sends via IPC for a native save dialog.
 * In browser: creates an object URL and clicks a hidden anchor.
 */
export async function triggerDownload(blob: Blob, filename: string): Promise<void> {
  if (isElectron()) {
    console.debug('[download-utils] Saving blob via Electron IPC', { filename, size: blob.size });
    const arrayBuffer = await blob.arrayBuffer();
    const saved = await window.quilltap!.saveFile(arrayBuffer, filename);
    if (!saved) {
      console.debug('[download-utils] Save dialog cancelled by user', { filename });
    }
    return;
  }

  // Browser fallback: anchor-click approach
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Fetch a file (an image served by the app, typically) and hand it to
 * {@link triggerDownload} as a blob. Throws `Failed to fetch image (<status>)`
 * on a non-2xx answer so the caller can toast in its own words.
 */
export async function downloadFetchedFile(url: string, filename: string): Promise<void> {
  console.debug('[download-utils] Fetching file for download', { url, filename });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
  const blob = await res.blob();
  await triggerDownload(blob, filename);
}

/**
 * Trigger a download from a URL (e.g. an API endpoint that returns a file).
 *
 * Used for URL-based downloads (backup .zip, file downloads).
 * In Electron: uses `downloadURL()` via IPC which streams to disk through the
 * `will-download` session handler — no memory pressure from large files.
 * In browser: creates an anchor element with the download attribute.
 */
export async function triggerUrlDownload(url: string, filename: string): Promise<void> {
  if (isElectron()) {
    console.debug('[download-utils] Triggering Electron downloadURL', { url, filename });
    await window.quilltap!.downloadUrl(url);
    return;
  }

  // Browser fallback: anchor-click approach
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
