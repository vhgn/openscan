/** Only same-origin relative paths are safe post-login destinations. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  if (/[\r\n]/.test(next)) return null
  return next
}
