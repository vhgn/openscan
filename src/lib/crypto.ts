import { str } from './env'

const enc = new TextEncoder()
const dec = new TextDecoder()

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  const s = input.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(input))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

let keyCache: { secret: string; key: CryptoKey } | undefined
async function aesKey(): Promise<CryptoKey> {
  const secret = str('SESSION_SECRET')
  if (!secret) throw new Error('SESSION_SECRET is not configured')
  if (keyCache?.secret === secret) return keyCache.key
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`openscan:${secret}`))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  keyCache = { secret, key }
  return key
}

/** AES-GCM encrypt a string at rest. Output: base64url(iv).base64url(ciphertext) */
export async function encrypt(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), enc.encode(plain))
  return `${b64url(iv)}.${b64url(ct)}`
}

export async function decrypt(payload: string | null | undefined): Promise<string | null> {
  if (!payload) return null
  const [iv, ct] = payload.split('.')
  if (!iv || !ct) return null
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlDecode(iv) },
      await aesKey(),
      b64urlDecode(ct),
    )
    return dec.decode(pt)
  } catch {
    return null
  }
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
