/** Deterministic security-printing geometry (guilloche rosettes, rays, engraved eye) as SVG path data. */

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

/** Engraved sunburst: alternating long/short rays. */
export function rays(cx: number, cy: number, r0: number, r1: number, n: number): string {
  let p = ''
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const r = i % 2 ? r1 * 0.9 : r1
    p += `M${f(cx + Math.cos(a) * r0)} ${f(cy + Math.sin(a) * r0)}L${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`
  }
  return p
}

/** Almond eye outline (two arcs) centred on cx,cy. */
export function eyeOutline(cx: number, cy: number, w: number, h: number): string {
  return `M${f(cx - w)} ${f(cy)}Q${f(cx)} ${f(cy - h * 2)} ${f(cx + w)} ${f(cy)}Q${f(cx)} ${f(cy + h * 2)} ${f(cx - w)} ${f(cy)}Z`
}

/** Horizontal engraving hatch inside a box; clip it with the eye outline. */
export function hatch(x0: number, y0: number, x1: number, y1: number, gap: number): string {
  let p = ''
  for (let y = y0; y <= y1; y += gap) p += `M${f(x0)} ${f(y)}L${f(x1)} ${f(y)}`
  return p
}

/** Iris: radial fibres between two radii with slight jitter for an engraved look. */
export function iris(cx: number, cy: number, r0: number, r1: number, n: number): string {
  let p = ''
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const j = 0.92 + 0.08 * Math.sin(i * 12.9898)
    p += `M${f(cx + Math.cos(a) * r0)} ${f(cy + Math.sin(a) * r0)}L${f(cx + Math.cos(a) * r1 * j)} ${f(cy + Math.sin(a) * r1 * j)}`
  }
  return p
}
