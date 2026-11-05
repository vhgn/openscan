/**
 * Server-rendered consent and error pages for /oauth/authorize, in the Essay style.
 * Plain HTML (no client JS) so the consent decision is a simple same-origin form POST.
 */
import { SCOPES, escapeHtml, type Scope } from './core'

const FONTS =
  'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&display=swap'

const CSS = `
:root{--paper:#fbfbf9;--wash:#f1f1ec;--ink:#141414;--ink3:#4a4a46;--muted:#6f6f6a;--rule:rgb(20 20 20/.12);--cream:#e3c98b;--alarm:#9b2c2c}
*{box-sizing:border-box}
html,body{margin:0;background:var(--paper);color:var(--ink)}
body{font-family:Newsreader,ui-serif,Georgia,serif;font-size:18px;line-height:1.6}
main{max-width:34rem;margin:0 auto;padding:56px 16px 80px}
.wordmark{font-family:'Instrument Serif',ui-serif,Georgia,serif;font-size:24px;line-height:1}
.label{font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:.2em;color:var(--muted);margin:40px 0 8px}
h1{font-family:'Instrument Serif',ui-serif,Georgia,serif;font-weight:400;font-size:40px;line-height:1.1;margin:0 0 16px}
.squiggle{text-decoration:underline wavy var(--cream) 2px;text-underline-offset:6px;text-decoration-skip-ink:none}
p{margin:0 0 14px}
.muted{color:var(--ink3)}
ul{list-style:none;padding:0;margin:20px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
li{padding:10px 0;border-top:1px solid var(--rule)}
li:first-child{border-top:0}
code{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:14px;background:var(--wash);padding:1px 5px;border-radius:3px;word-break:break-all}
.small{font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:13px;color:var(--muted);line-height:1.5}
.actions{display:flex;gap:12px;align-items:center;margin-top:28px;flex-wrap:wrap}
/* same as .btn / .btn-quiet in src/styles.css */
.btn{display:inline-flex;align-items:center;gap:.5rem;padding:.6rem 1.15rem;font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:14px;font-weight:600;background:var(--ink);color:var(--paper);border:0;border-radius:0;cursor:pointer;white-space:nowrap;transition:background .15s}
.btn:hover{background:#333}
.btn-quiet{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1px rgb(20 20 20/.35)}
.btn-quiet:hover{background:rgb(20 20 20/.04)}
.warn{color:var(--alarm)}
`

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="same-origin">
<title>${escapeHtml(title)} — openscan</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${FONTS}">
<style>${CSS}</style>
</head><body><main>
<div class="wordmark">openscan</div>
${body}
</main></body></html>`
}

/** Headers for every page served by /oauth/authorize: no framing (clickjacking), no caching. */
export function pageHeaders(status = 200): ResponseInit {
  return {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      // same-origin (not no-referrer): with no-referrer, browsers send `Origin: null` on the consent POST.
      'referrer-policy': 'same-origin',
    },
  }
}

export function consentPage(input: {
  requestId: string
  clientName: string | null
  clientId: string
  clientUri: string | null
  redirectUri: string
  scopes: Scope[]
  login: string
}): string {
  const redirect = new URL(input.redirectUri)
  const destination = redirect.protocol === 'http:' || redirect.protocol === 'https:' ? redirect.host : redirect.protocol.replace(/:$/, '')
  const name = input.clientName?.trim() || destination
  const scopes = input.scopes.map((s) => `<li>${escapeHtml(SCOPES[s])}</li>`).join('')
  return shell(
    'Connect an app',
    `<p class="label">Connect an MCP client</p>
<h1><span class="squiggle">${escapeHtml(name)}</span> wants to use openscan as you.</h1>
<p class="muted">Signed in as <strong>${escapeHtml(input.login)}</strong>. If you approve, this app can:</p>
<ul>${scopes}</ul>
<p class="small">You will be sent back to <code>${escapeHtml(destination)}</code>.${
      input.clientUri ? ` The app says its home page is <code>${escapeHtml(input.clientUri)}</code>.` : ''
    } The name above is supplied by the app itself, so only approve if you just started this connection.</p>
<p class="small">Client ID <code>${escapeHtml(input.clientId)}</code>. You can disconnect it at any time in Settings.</p>
<form method="post" action="/oauth/authorize" class="actions">
<input type="hidden" name="request_id" value="${escapeHtml(input.requestId)}">
<button class="btn" type="submit" name="decision" value="approve">Approve</button>
<button class="btn btn-quiet" type="submit" name="decision" value="deny">Deny</button>
</form>`,
  )
}

export function errorPage(title: string, message: string): string {
  return shell(
    title,
    `<p class="label">Authorization</p>
<h1>${escapeHtml(title)}</h1>
<p class="muted">${escapeHtml(message)}</p>
<p class="small">Go back to the app that sent you here and start the connection again.</p>`,
  )
}
