/** Deterministic security-printing geometry: guilloche rosettes as SVG path data. */

const f = (n: number) => (Math.round(n * 10) / 10).toString()

/** Hypotrochoid ring: the curve family banknote engravers draw with a geometric lathe. */
export function rosette(cx: number, cy: number, R: number, r: number, d: number, steps = 720, rotate = 0): string {
  const k = (R - r) / r
  // close the curve: lcm-ish number of turns for integer ratios
  const turns = Math.round(r / gcd(Math.round(R), Math.round(r)))
  const total = turns * Math.PI * 2
  let p = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * total
    const x = (R - r) * Math.cos(t) + d * Math.cos(k * t)
    const y = (R - r) * Math.sin(t) - d * Math.sin(k * t)
    const xr = x * Math.cos(rotate) - y * Math.sin(rotate)
    const yr = x * Math.sin(rotate) + y * Math.cos(rotate)
    p += `${i ? 'L' : 'M'}${f(cx + xr)} ${f(cy + yr)}`
  }
  return p + 'Z'
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}
