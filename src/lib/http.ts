/** Small HTTP helpers for the REST routes. */

/** Weak ETag over the JSON body: identical responses hash to the same tag. */
export async function etagFor(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(body))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `W/"${hex.slice(0, 32)}"`
}

/** True when an If-None-Match header lists `etag` (or `*`). Weak comparison, per RFC 9110. */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  const strip = (t: string) => t.trim().replace(/^W\//, '')
  return ifNoneMatch.split(',').some((t) => t.trim() === '*' || strip(t) === strip(etag))
}

/**
 * JSON response with an ETag. Pollers send it back as If-None-Match and get an empty
 * 304 while nothing changed. `Cache-Control: no-cache` means "revalidate every time",
 * so a 304 is never stale.
 */
export async function jsonWithEtag(request: Request, data: unknown, init: ResponseInit = {}): Promise<Response> {
  const body = JSON.stringify(data)
  const etag = await etagFor(body)
  const headers = new Headers(init.headers)
  headers.set('etag', etag)
  headers.set('cache-control', 'private, no-cache')
  headers.set('vary', 'cookie')
  if (etagMatches(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers })
  headers.set('content-type', 'application/json')
  return new Response(body, { ...init, headers })
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error, ...extra }, { status })
}
