/** Server functions called from the UI (RPC over TanStack Start). */
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { all, batch, first, now, run } from '#/lib/db'
import { currentUser, requireUser } from '#/lib/session'
import { installUrl, manageInstallationUrl, githubConfigured } from '#/lib/github/app'
import { listUserRepos, syncUserRepos } from '#/lib/github/repos'
import { linkChatGPT, unlinkChatGPT } from '#/lib/chatgpt'
import { createScan, loadPreferences } from '#/lib/scanner/engine'
import { listFindings, listQuestions, listScans, scanDetail } from '#/lib/queries'
import { codexClientFor, codexEnvironmentFor } from '#/lib/codex/runtime'
import { environmentsSettingsUrl } from '#/lib/codex/cloud'
import { isDemoLoginEnabled, str } from '#/lib/env'
import { preferencesSchema, type OnboardingStep, type UserRow } from '#/lib/types'

function publicUser(u: UserRow) {
  return {
    id: u.id,
    login: u.login,
    name: u.name,
    avatarUrl: u.avatar_url,
    onboardingStep: u.onboarding_step,
    chatgpt: u.chatgpt_cookie_enc ? { email: u.chatgpt_email, plan: u.chatgpt_plan } : null,
  }
}
export type PublicUser = ReturnType<typeof publicUser>

async function authed(): Promise<UserRow> {
  const user = await currentUser()
  if (!user) throw redirect({ to: '/' })
  return user
}

async function setStep(userId: string, step: OnboardingStep) {
  await run('UPDATE users SET onboarding_step = ?, updated_at = ? WHERE id = ?', step, now(), userId)
}

async function selectedRepoIds(userId: string): Promise<number[]> {
  return (await all<{ repo_id: number }>('SELECT repo_id FROM user_repositories WHERE user_id = ? AND selected = 1', userId)).map((r) => r.repo_id)
}

async function startUnderstanding(userId: string) {
  for (const repoId of await selectedRepoIds(userId)) {
    const done = await first<{ id: string }>(
      `SELECT id FROM scans WHERE user_id = ? AND repo_id = ? AND kind = 'understand' AND status IN ('queued','running','completed') LIMIT 1`,
      userId,
      repoId,
    )
    if (!done) await createScan(userId, repoId, 'understand', 'onboarding')
  }
}

// ------------------------------------------------------------------ session

export const getMe = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await currentUser()
  return {
    user: user ? publicUser(user) : null,
    githubConfigured: githubConfigured(),
    demoLogin: isDemoLoginEnabled(),
  }
})

// ------------------------------------------------------------------ landing design

export const DESIGNS = ['signal', 'ledger', 'redline'] as const
export type DesignId = (typeof DESIGNS)[number]

export const getDesign = createServerFn({ method: 'GET' }).handler(async () => {
  const row = await first<{ value: string; updated_by: string | null; updated_at: number }>(`SELECT value, updated_by, updated_at FROM app_settings WHERE key = 'landing_design'`)
  const user = await currentUser()
  const admins = str('ADMIN_GITHUB_LOGINS').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return {
    approved: (row?.value as DesignId | undefined) ?? null,
    approvedBy: row?.updated_by ?? null,
    approvedAt: row?.updated_at ?? null,
    canApprove: Boolean(user) && (admins.length === 0 || admins.includes(user!.login.toLowerCase())),
    signedIn: Boolean(user),
  }
})

export const approveDesign = createServerFn({ method: 'POST' })
  .validator(z.object({ design: z.enum(DESIGNS) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const admins = str('ADMIN_GITHUB_LOGINS').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    if (admins.length && !admins.includes(user.login.toLowerCase())) throw new Error('Only admins can approve a design')
    await run(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('landing_design', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      data.design,
      user.login,
      now(),
    )
    return { ok: true }
  })

// ------------------------------------------------------------------ onboarding

export const getOnboarding = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await authed()
  const installations = await all<{ id: number; account_login: string; account_type: string; repository_selection: string | null }>(
    `SELECT i.* FROM installations i JOIN user_installations ui ON ui.installation_id = i.id WHERE ui.user_id = ?`,
    user.id,
  )
  const repos = await listUserRepos(user.id)
  const scans = await all<{ id: string; repo_id: number; status: string; progress: number; phase: string; engine: string | null }>(
    `SELECT s.id, s.repo_id, s.status, s.progress, s.phase, s.engine FROM scans s
     WHERE s.user_id = ? AND s.kind = 'understand'
     AND s.created_at = (SELECT MAX(created_at) FROM scans s2 WHERE s2.repo_id = s.repo_id AND s2.user_id = s.user_id AND s2.kind = 'understand')`,
    user.id,
  )
  const selected = repos.filter((r) => r.selected).map((r) => r.id)
  return {
    user: publicUser(user),
    step: user.onboarding_step,
    installUrl: installUrl(),
    installations: installations.map((i) => ({ ...i, manageUrl: manageInstallationUrl(i.id, i.account_type, i.account_login) })),
    repos: repos.map((r) => ({ id: r.id, fullName: r.full_name, private: Boolean(r.private), language: r.language, description: r.description, selected: Boolean(r.selected), understood: Boolean(r.understood_at), codexEnv: r.codex_env_label ?? r.codex_env_id ?? null, codexChecked: Boolean(r.codex_checked_at) })),
    codexEnvironmentsUrl: environmentsSettingsUrl(),
    reading: scans.map((s) => ({ ...s, repo: repos.find((r) => r.id === s.repo_id)?.full_name ?? '' })),
    questions: await listQuestions(user.id, ['open', 'auto_answered', 'answered'], selected),
    preferences: await loadPreferences(user.id),
    hasPreferences: Boolean(await first('SELECT 1 FROM preferences WHERE user_id = ?', user.id)),
  }
})
export type OnboardingData = Awaited<ReturnType<typeof getOnboarding>>

export const refreshRepos = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await requireUser()
  await syncUserRepos(user)
  return { ok: true }
})

export const saveRepoSelection = createServerFn({ method: 'POST' })
  .validator(z.object({ repoIds: z.array(z.number().int()).min(1).max(50) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await batch([
      ['UPDATE user_repositories SET selected = 0 WHERE user_id = ?', [user.id]],
      ...data.repoIds.map((id): [string, Array<string | number | null>] => ['UPDATE user_repositories SET selected = 1 WHERE user_id = ? AND repo_id = ?', [user.id, id]]),
    ])
    if (user.onboarding_step === 'repos') await setStep(user.id, user.chatgpt_cookie_enc ? 'preferences' : 'chatgpt')
    // Already linked ChatGPT (e.g. coming back to change repos): start reading right away.
    if (user.chatgpt_cookie_enc || user.onboarding_step !== 'repos') await startUnderstanding(user.id)
    return { ok: true }
  })

/** Called by the client once the ChatGPT widget reports "authenticated". */
export const linkChatGPTSession = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await requireUser()
  const result = await linkChatGPT(getRequest(), user)
  if (!result.linked) return result
  if (user.onboarding_step === 'chatgpt' || user.onboarding_step === 'repos') await setStep(user.id, 'preferences')
  await startUnderstanding(user.id)
  return result
})

export const skipChatGPT = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await requireUser()
  if (user.onboarding_step === 'chatgpt') await setStep(user.id, 'preferences')
  await startUnderstanding(user.id)
  return { ok: true }
})

export const disconnectChatGPT = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await requireUser()
  await unlinkChatGPT(user.id)
  return { ok: true }
})

export const savePreferences = createServerFn({ method: 'POST' })
  .validator(preferencesSchema)
  .handler(async ({ data }) => {
    const user = await requireUser()
    await run(
      `INSERT INTO preferences (user_id, json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      user.id,
      JSON.stringify(data),
      now(),
    )
    if (!user.onboarded_at) {
      await run('UPDATE users SET onboarded_at = ?, onboarding_step = ?, updated_at = ? WHERE id = ?', now(), 'waiting', now(), user.id)
      // Repos already understood get their first report immediately; the rest chain when reading finishes.
      const understood = await all<{ id: number }>(
        `SELECT r.id FROM repositories r JOIN user_repositories ur ON ur.repo_id = r.id WHERE ur.user_id = ? AND ur.selected = 1 AND r.understood_at IS NOT NULL`,
        user.id,
      )
      for (const r of understood) await createScan(user.id, r.id, 'security', 'onboarding')
    }
    return { ok: true }
  })

export const finishOnboarding = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await requireUser()
  await setStep(user.id, 'done')
  return { ok: true }
})

// ------------------------------------------------------------------ questions

export const answerQuestion = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), answer: z.string().min(1).max(4000) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await run(
      `UPDATE questions SET status = 'answered', answer = ?, answer_source = 'user', answered_at = ? WHERE id = ? AND user_id = ?`,
      data.answer,
      now(),
      data.id,
      user.id,
    )
    return { ok: true }
  })

export const dismissQuestion = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await run(`UPDATE questions SET status = 'dismissed', answered_at = ? WHERE id = ? AND user_id = ?`, now(), data.id, user.id)
    return { ok: true }
  })

// ------------------------------------------------------------------ dashboard & scans

export const getDashboard = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await authed()
  if (user.onboarding_step !== 'done') throw redirect({ to: '/onboarding' })
  const repos = (await listUserRepos(user.id)).filter((r) => r.selected)
  return {
    user: publicUser(user),
    repos: repos.map((r) => ({ id: r.id, fullName: r.full_name, understood: Boolean(r.understood_at), codexEnv: r.codex_env_label ?? r.codex_env_id ?? null, codexChecked: Boolean(r.codex_checked_at) })),
    codexEnvironmentsUrl: environmentsSettingsUrl(),
    scans: await listScans(user.id, 30),
    findings: await listFindings(user.id, { limit: 50 }),
    questions: await listQuestions(user.id, ['open']),
    preferences: await loadPreferences(user.id),
  }
})
export type DashboardData = Awaited<ReturnType<typeof getDashboard>>

export const getScan = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await authed()
    const detail = await scanDetail(user.id, data.id)
    if (!detail) throw redirect({ to: '/dashboard' })
    return detail
  })

export const startScan = createServerFn({ method: 'POST' })
  .validator(z.object({ repoId: z.number().int(), kind: z.enum(['understand', 'security']).default('security') }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const link = await first('SELECT 1 FROM user_repositories WHERE user_id = ? AND repo_id = ?', user.id, data.repoId)
    if (!link) throw new Error('Repository not linked')
    return { id: await createScan(user.id, data.repoId, data.kind, 'manual') }
  })

export const updateFindingStatus = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), status: z.enum(['open', 'dismissed', 'fixed']) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await run('UPDATE findings SET status = ? WHERE id = ? AND user_id = ?', data.status, data.id, user.id)
    return { ok: true }
  })


/** Re-discovers the user's Codex Cloud environments for their selected repos. */
export const refreshCodexEnvironments = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await requireUser()
  const client = await codexClientFor(user)
  if (!client) return { ok: false as const, reason: 'Link ChatGPT first' }
  const repos = (await listUserRepos(user.id)).filter((r) => r.selected)
  let found = 0
  for (const r of repos) if (await codexEnvironmentFor(user.id, r, client, true).catch(() => null)) found++
  return { ok: true as const, found, total: repos.length }
})
