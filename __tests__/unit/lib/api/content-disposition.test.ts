/**
 * Content-Disposition construction (RFC 5987).
 *
 * Every download route in the app funnels its filename through this one
 * helper, so a browser's willingness to save "Château.qtap" under its real
 * name — rather than mangling it or dropping the header — rests entirely here.
 */

import { buildContentDisposition } from '@/lib/api/content-disposition'

describe('buildContentDisposition', () => {
  it('emits a plain filename for pure-ASCII names', () => {
    expect(buildContentDisposition('transcript.md')).toBe('inline; filename="transcript.md"')
  })

  it('defaults to inline and honours an explicit attachment', () => {
    expect(buildContentDisposition('backup.zip')).toBe('inline; filename="backup.zip"')
    expect(buildContentDisposition('backup.zip', 'attachment')).toBe(
      'attachment; filename="backup.zip"'
    )
  })

  it('adds an ASCII fallback plus a UTF-8 form for non-ASCII names', () => {
    const header = buildContentDisposition('Château.qtap', 'attachment')

    // Both halves must be present: old clients read the quoted fallback,
    // modern ones prefer filename* and recover the real name.
    expect(header).toBe(
      "attachment; filename=\"Ch_teau.qtap\"; filename*=UTF-8''Ch%C3%A2teau.qtap"
    )
  })

  it('replaces every non-ASCII character in the fallback, not just the first', () => {
    const header = buildContentDisposition('Ötzi—Bericht.pdf')

    expect(header).toContain('filename="_tzi_Bericht.pdf"')
    expect(header).toContain("filename*=UTF-8''%C3%96tzi%E2%80%94Bericht.pdf")
  })

  it('handles a name that is entirely non-ASCII', () => {
    const header = buildContentDisposition('日本語.txt')

    expect(header).toContain('filename="___.txt"')
    expect(header).toContain("filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.txt")
  })

  it('percent-encodes an apostrophe alongside non-ASCII (bug 41)', () => {
    // The apostrophe is RFC 8187's charset'lang'value delimiter — leaving it
    // raw made browsers discard filename* and fall back to the mangled ASCII
    // name. It must arrive as %27, and the non-ASCII must survive.
    const header = buildContentDisposition("Wings Over Suparṇā's Quiet Governance.qtap", 'attachment')

    expect(header).toContain("filename*=UTF-8''Wings%20Over%20Supar%E1%B9%87%C4%81%27s%20Quiet%20Governance.qtap")
    expect(header).not.toMatch(/filename\*=UTF-8''[^;]*'/) // no raw apostrophe survives in the ext-value
  })

  it('escapes the RFC 8187 stray chars encodeURIComponent leaves', () => {
    // ' ( ) * ! all sit outside attr-char; pair them with a non-ASCII char so
    // the filename* branch is taken.
    const header = buildContentDisposition("a'()*!—b.txt")

    expect(header).toContain("filename*=UTF-8''a%27%28%29%2A%21%E2%80%94b.txt")
  })

  it('leaves plain-ASCII apostrophe names on the quoted form, untouched', () => {
    // No non-ASCII → no filename* at all, so the apostrophe stays literal.
    expect(buildContentDisposition("O'Brien.pdf")).toBe('inline; filename="O\'Brien.pdf"')
  })

  it('treats an empty name as ASCII and emits the plain form', () => {
    expect(buildContentDisposition('')).toBe('inline; filename=""')
  })
})
