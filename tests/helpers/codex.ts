/**
 * A fake Codex Cloud for scan tests.
 *
 * The engine talks to Codex through the real client (src/lib/codex/cloud.ts) over HTTP:
 *   GET  /backend-api/wham/environments/by-repo/github/:owner/:repo
 *   POST /backend-api/wham/tasks
 *   GET  /backend-api/wham/tasks/:id
 * FakeCodex serves those routes on the fetch stub, so the client, its request shapes,
 * task-details parsing, the prompts and the output contract all run for real; only
 * Codex's answers are scripted.
 *
 * Each role (recon, hunt, validate) gets a script: the answers to its successive polls.
 * The last answer repeats if the engine polls more often than scripted.
 */
import type { FetchStub } from './harness.ts'

export type CodexRole = 'recon' | 'hunt' | 'validate'

/** One poll answer: still queued/running, done with assistant messages, or failed. */
export type Poll =
  | { status: 'pending' | 'in_progress' }
  | { status: 'completed'; messages: string[] }
  | { status: 'failed' | 'cancelled'; error?: { code: string; message: string } }
  /** A turn status the client doesn't know (maps to "unknown"). */
  | { status: 'weird' }

export interface CreatedTask {
  id: string
  role: CodexRole
  environmentId: string
  branch: string
  qaMode: boolean
  prompt: string
  headers: { authorization: string | null; account: string | null }
  polls: number
}

export const pending: Poll = { status: 'pending' }
export const running: Poll = { status: 'in_progress' }
export const done = (output: unknown, chatter: string[] = []): Poll => ({ status: 'completed', messages: [...chatter, typeof output === 'string' ? output : JSON.stringify(output)] })
export const failed = (message = 'environment setup failed'): Poll => ({ status: 'failed', error: { code: 'env_error', message } })

export class FakeCodex {
  readonly tasks: CreatedTask[] = []
  readonly envLookups: string[] = []
  private scripts: Partial<Record<CodexRole, Poll[]>> = {}
  /** Make POST /wham/tasks fail with this HTTP status. */
  createStatus: number | null = null

  constructor(
    f: FetchStub,
    /** What /environments/by-repo returns, per "owner/repo" (missing = no environment). */
    readonly environments: Record<string, Array<{ id: string; label: string; is_pinned?: boolean; task_count?: number }>> = {},
  ) {
    const base = 'https://chatgpt.com/backend-api/wham'
    f.on('GET', new RegExp(`^${base}/environments/by-repo/github/([^/]+)/([^/?]+)$`), (_req, m) => {
      const repo = `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`
      this.envLookups.push(repo)
      return Response.json(this.environments[repo] ?? [])
    })
    f.on('POST', `${base}/tasks`, async (req) => {
      if (this.createStatus) return new Response('upstream error', { status: this.createStatus })
      const body = (await req.json()) as {
        new_task: { environment_id: string; branch: string; run_environment_in_qa_mode: boolean }
        input_items: Array<{ content: Array<{ text: string }> }>
      }
      const prompt = body.input_items[0].content[0].text
      const role = /^OPENSCAN-ROLE: (\w+)/m.exec(prompt)?.[1] as CodexRole | undefined
      if (!role) throw new Error(`FakeCodex: task prompt has no OPENSCAN-ROLE line:\n${prompt.slice(0, 200)}`)
      const id = `task_${role}_${this.tasks.length + 1}`
      this.tasks.push({
        id,
        role,
        environmentId: body.new_task.environment_id,
        branch: body.new_task.branch,
        qaMode: body.new_task.run_environment_in_qa_mode,
        prompt,
        headers: { authorization: req.headers.get('authorization'), account: req.headers.get('chatgpt-account-id') },
        polls: 0,
      })
      return Response.json({ task: { id } })
    })
    f.on('GET', new RegExp(`^${base}/tasks/([^/?]+)$`), (_req, m) => {
      const task = this.tasks.find((t) => t.id === decodeURIComponent(m[1]))
      if (!task) return new Response('not found', { status: 404 })
      const script = this.scripts[task.role]
      if (!script?.length) throw new Error(`FakeCodex: no script for the ${task.role} task`)
      const poll = script[Math.min(task.polls, script.length - 1)]
      task.polls++
      return Response.json(taskDetails(poll))
    })
  }

  /** Sets what successive polls of the `role` task return. */
  script(role: CodexRole, ...polls: Poll[]): this {
    this.scripts[role] = polls
    return this
  }

  task(role: CodexRole): CreatedTask {
    const t = this.tasks.find((x) => x.role === role)
    if (!t) throw new Error(`no ${role} task was created`)
    return t
  }
}

/** The /wham/tasks/:id body for a poll, in the shape codex-rs's backend client reads. */
function taskDetails(poll: Poll) {
  const turn: Record<string, unknown> = { turn_status: poll.status }
  if (poll.status === 'completed') {
    turn.output_items = poll.messages.map((text) => ({ type: 'message', role: 'assistant', content: [{ content_type: 'text', text }] }))
  }
  if ((poll.status === 'failed' || poll.status === 'cancelled') && poll.error) turn.error = poll.error
  return { current_user_turn: { turn_status: 'completed' }, current_assistant_turn: turn }
}
