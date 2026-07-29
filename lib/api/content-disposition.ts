/**
 * Content-Disposition header construction shared by every route that serves
 * a download. RFC 5987: plain `filename="…"` for ASCII names, ASCII fallback
 * plus `filename*=UTF-8''…` when the name carries non-ASCII characters.
 */
export function buildContentDisposition(
  filename: string,
  disposition: 'inline' | 'attachment' = 'inline'
): string {
  const hasNonAscii = /[^\x00-\x7F]/.test(filename);
  if (!hasNonAscii) {
    return `${disposition}; filename="${filename}"`;
  }

  const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_');
  const encodedFilename = encodeURIComponent(filename);
  return `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}
