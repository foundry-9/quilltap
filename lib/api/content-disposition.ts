/**
 * Percent-encode a string as an RFC 8187 ext-value (`charset'lang'value`).
 *
 * `encodeURIComponent` is the right base but too permissive: it leaves
 * `! * ' ( )` unescaped, and those fall outside RFC 8187 `attr-char`. The
 * apostrophe is the worst offender — it is the delimiter in `charset'lang'value`,
 * so an unescaped `'` makes the whole `filename*` ungrammatical and browsers
 * discard it, falling back to the mangled ASCII name. Escape every stray char.
 */
function encodeExtValue(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*!]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

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
  const encodedFilename = encodeExtValue(filename);
  return `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}
