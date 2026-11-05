import { createFileRoute } from '@tanstack/react-router'
import { clearSessionCookieHeader } from '#/lib/session'
import { run } from '#/lib/db'
import { sha256Hex } from '#/lib/crypto'

async function logout(request: Request) {
  const token = (request.headers.get('cookie') ?? '').match(/(?:^|;\s*)openscan_session=([^;]+)/)?.[1]
  if (token) await run('DELETE FROM sessions WHERE id = ?', await sha256Hex(token))
  return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': clearSessionCookieHeader() } })
}

export const Route = createFileRoute('/api/auth/logout')({
  server: { handlers: { GET: ({ request }) => logout(request), POST: ({ request }) => logout(request) } },
})
