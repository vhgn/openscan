import { env } from './env'

type Param = string | number | null

function stmt(sql: string, params: Param[]) {
  return env().DB.prepare(sql).bind(...params)
}

export async function all<T>(sql: string, ...params: Param[]): Promise<T[]> {
  const res = await stmt(sql, params).all<T>()
  return res.results ?? []
}

export async function first<T>(sql: string, ...params: Param[]): Promise<T | null> {
  return (await stmt(sql, params).first<T>()) ?? null
}

export async function run(sql: string, ...params: Param[]): Promise<void> {
  await stmt(sql, params).run()
}

/** Like run(), but returns how many rows changed (for conditional updates such as leases). */
export async function exec(sql: string, ...params: Param[]): Promise<number> {
  const res = await stmt(sql, params).run()
  return res.meta?.changes ?? 0
}

export async function batch(items: Array<[string, Param[]]>): Promise<void> {
  if (!items.length) return
  const db = env().DB
  await db.batch(items.map(([sql, params]) => db.prepare(sql).bind(...params)))
}

export const now = () => Date.now()
export const uid = () => crypto.randomUUID()

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
