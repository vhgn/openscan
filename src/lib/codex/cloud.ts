/**
 * Codex Cloud tasks client (the ChatGPT backend that `codex cloud` uses).
 * Endpoints/payloads mirror openai/codex `codex-rs/cloud-tasks-client` and
 * `codex-rs/backend-client` (ChatGPT path style: https://chatgpt.com/backend-api/wham/…).
 * This API is not publicly documented and may change; every call degrades gracefully.
 *
 * Auth = the user's Login-with-ChatGPT session: a fresh short-lived access token +
 * account id obtained server-side (see chatgpt.ts → codexCredentials). Tokens are
 * used only for these requests and never stored or logged.
 */

export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'

export interface CodexCredentials {
  accessToken: string
  accountId: string
}

export interface CodexEnvironment {
  id: string
  label: string | null
  isPinned: boolean
  taskCount: number
}

export type CodexTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'unknown'

export interface CodexTaskResult {
  status: CodexTaskStatus
  /** Assistant message texts (output items + worklog), oldest first. */
  messages: string[]
  error: string | null
}

export class CodexCloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function taskUrl(taskId: string): string {
  return `https://chatgpt.com/codex/tasks/${encodeURIComponent(taskId)}`
}

export function environmentsSettingsUrl(): string {
  return 'https://chatgpt.com/codex/settings/environments'
}

export function createCodexClient(creds: CodexCredentials, fetchImpl: FetchLike = fetch) {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${CODEX_BASE_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${creds.accessToken}`,
        'chatgpt-account-id': creds.accountId,
        'user-agent': 'codex-cli',
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    if (!res.ok) throw new CodexCloudError(`Codex Cloud ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`, res.status)
    try {
      return JSON.parse(text) as T
    } catch {
      throw new CodexCloudError(`Codex Cloud ${method} ${path} returned non-JSON`, res.status)
    }
  }

  return {
    /** Environments configured for a GitHub repo in the user's workspace. */
    async environmentsForRepo(fullName: string): Promise<CodexEnvironment[]> {
      const [owner, repo] = fullName.split('/')
      try {
        const rows = await call<Array<{ id: string; label?: string | null; is_pinned?: boolean | null; task_count?: number | null }>>(
          'GET',
          `/wham/environments/by-repo/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        )
        return (Array.isArray(rows) ? rows : []).map(normalizeEnv)
      } catch (e) {
        if (e instanceof CodexCloudError && e.status === 404) return []
        throw e
      }
    },

    /** Creates a task; qaMode=true runs it in "Ask" mode (analysis only, no code changes). */
    async createTask(input: { environmentId: string; branch: string; prompt: string; qaMode?: boolean }): Promise<string> {
      const res = await call<{ task?: { id?: string }; id?: string }>('POST', '/wham/tasks', {
        new_task: { environment_id: input.environmentId, branch: input.branch, run_environment_in_qa_mode: input.qaMode ?? true },
        input_items: [{ type: 'message', role: 'user', content: [{ content_type: 'text', text: input.prompt }] }],
      })
      const id = res.task?.id ?? res.id
      if (!id) throw new CodexCloudError('Codex Cloud created a task but returned no id', 500)
      return id
    },

    async getTask(taskId: string): Promise<CodexTaskResult> {
      return parseTaskDetails(await call<TaskDetails>('GET', `/wham/tasks/${encodeURIComponent(taskId)}`))
    },
  }
}
export type CodexClient = ReturnType<typeof createCodexClient>

function normalizeEnv(r: { id: string; label?: string | null; is_pinned?: boolean | null; task_count?: number | null }): CodexEnvironment {
  return { id: r.id, label: r.label ?? null, isPinned: Boolean(r.is_pinned), taskCount: r.task_count ?? 0 }
}

/** Same preference order as `codex cloud` autodetect: pinned, then most-used, then first. */
export function pickEnvironment(envs: CodexEnvironment[]): CodexEnvironment | null {
  if (!envs.length) return null
  return envs.find((e) => e.isPinned) ?? [...envs].sort((a, b) => b.taskCount - a.taskCount)[0]
}

// ---------------------------------------------------------------- task details parsing

type Fragment = string | { content_type?: string; text?: string }
interface TurnItem {
  type?: string
  role?: string
  content?: Fragment[] | null
}
interface Turn {
  turn_status?: string | null
  output_items?: TurnItem[] | null
  worklog?: { messages?: Array<{ author?: { role?: string }; content?: { parts?: Fragment[] } }> | null } | null
  error?: { code?: string | null; message?: string | null } | null
}
export interface TaskDetails {
  current_user_turn?: Turn | null
  current_assistant_turn?: Turn | null
  current_diff_task_turn?: Turn | null
}

function fragmentText(f: Fragment): string | null {
  if (typeof f === 'string') return f.trim() ? f : null
  return f.content_type?.toLowerCase() === 'text' && f.text ? f.text : null
}

/** Pure: mirrors CodeTaskDetailsResponseExt::assistant_text_messages + status mapping. */
export function parseTaskDetails(d: TaskDetails): CodexTaskResult {
  const turn = d.current_assistant_turn ?? null
  const raw = (turn?.turn_status ?? '').toLowerCase()
  const status: CodexTaskStatus = (['pending', 'in_progress', 'completed', 'failed', 'cancelled'] as const).includes(raw as never)
    ? (raw as CodexTaskStatus)
    : turn
      ? 'unknown'
      : 'pending'
  const messages: string[] = []
  for (const t of [d.current_diff_task_turn, d.current_assistant_turn]) {
    if (!t) continue
    for (const item of t.output_items ?? []) {
      if (item.type === 'message') for (const f of item.content ?? []) {
        const s = fragmentText(f)
        if (s) messages.push(s)
      }
    }
    for (const m of t.worklog?.messages ?? []) {
      if (m.author?.role === 'assistant') for (const f of m.content?.parts ?? []) {
        const s = fragmentText(f)
        if (s) messages.push(s)
      }
    }
  }
  const error = turn?.error ? [turn.error.code, turn.error.message].filter(Boolean).join(': ') || 'task failed' : null
  return { status, messages, error }
}
