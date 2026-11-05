/** PEM handling: GitHub hands out PKCS#1 keys; WebCrypto only imports PKCS#8. */

function derLength(len: number): number[] {
  if (len < 0x80) return [len]
  const bytes: number[] = []
  while (len > 0) {
    bytes.unshift(len & 0xff)
    len >>= 8
  }
  return [0x80 | bytes.length, ...bytes]
}

function derWrap(tag: number, content: Uint8Array): Uint8Array<ArrayBuffer> {
  const len = derLength(content.length)
  const out = new Uint8Array(1 + len.length + content.length)
  out[0] = tag
  out.set(len, 1)
  out.set(content, 1 + len.length)
  return out
}

/** Wrap a PKCS#1 RSAPrivateKey into a PKCS#8 PrivateKeyInfo. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const version = new Uint8Array([0x02, 0x01, 0x00])
  // SEQUENCE { OID 1.2.840.113549.1.1.1 (rsaEncryption), NULL }
  const algId = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ])
  const octet = derWrap(0x04, pkcs1)
  const body = new Uint8Array(version.length + algId.length + octet.length)
  body.set(version, 0)
  body.set(algId, version.length)
  body.set(octet, version.length + algId.length)
  return derWrap(0x30, body)
}

export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const normalized = pem.replace(/\\n/g, '\n').trim()
  const isPkcs1 = normalized.includes('BEGIN RSA PRIVATE KEY')
  const b64 = normalized.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '')
  const bin = atob(b64)
  const der = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i)
  return isPkcs1 ? pkcs1ToPkcs8(der) : der
}

