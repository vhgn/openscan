/**
 * A minimal Cloudflare D1 stand-in over node:sqlite, covering exactly the surface
 * src/lib/db.ts (and the few direct env().DB users) rely on:
 *
 *   db.prepare(sql).bind(...params).all() / .first() / .run()
 *   db.batch([stmt, ...])   — all-or-nothing, like D1
 *   db.exec(sql)
 *
 * Like D1, foreign keys are enforced (ON DELETE CASCADE matters for the webhook).
 * Rows are copied into plain objects so assert.deepEqual works on them.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url))

type Param = string | number | null

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
    readonly params: Param[] = [],
  ) {}

  bind(...params: Param[]): Statement {
    return new Statement(this.db, this.sql, params)
  }

  private stmt() {
    return this.db.prepare(this.sql)
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const rows = this.stmt().all(...(this.params as SQLInputValue[]))
    return { results: rows.map((r) => ({ ...r }) as T), success: true, meta: {} }
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.stmt().get(...(this.params as SQLInputValue[]))
    if (!row) return null
    return (column ? (row as Record<string, unknown>)[column] : { ...row }) as T
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const r = this.stmt().run(...(this.params as SQLInputValue[]))
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
  }
}

export class TestD1 {
  readonly sqlite: DatabaseSync

  constructor() {
    this.sqlite = new DatabaseSync(':memory:')
    this.sqlite.exec('PRAGMA foreign_keys = ON')
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      this.sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    }
  }

  prepare(sql: string): Statement {
    return new Statement(this.sqlite, sql)
  }

  async batch(statements: Statement[]) {
    this.sqlite.exec('BEGIN')
    try {
      const out = []
      for (const s of statements) out.push(await s.run())
      this.sqlite.exec('COMMIT')
      return out
    } catch (e) {
      this.sqlite.exec('ROLLBACK')
      throw e
    }
  }

  async exec(sql: string) {
    this.sqlite.exec(sql)
    return { count: 0, duration: 0 }
  }

  /** Synchronous helpers for test assertions/fixtures. */
  rows<T = Record<string, unknown>>(sql: string, ...params: Param[]): T[] {
    return this.sqlite.prepare(sql).all(...(params as SQLInputValue[])).map((r) => ({ ...r }) as T)
  }

  row<T = Record<string, unknown>>(sql: string, ...params: Param[]): T | undefined {
    const r = this.sqlite.prepare(sql).get(...(params as SQLInputValue[]))
    return r ? ({ ...r } as T) : undefined
  }

  write(sql: string, ...params: Param[]) {
    this.sqlite.prepare(sql).run(...(params as SQLInputValue[]))
  }
}
