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
import {
  deleteProduct,
  ensureDefaultProduct,
  forgetMemory,
  getProduct,
  listMemory,
  listProducts,
  memoryStats,
  productForRepo,
  productRepoIds,
  rememberFacts,
  saveProduct,
} from '#/lib/products'
import { uid } from '#/lib/db'
import { isDemoLoginEnabled } from '#/lib/env'
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
    productName: (await listProducts(user.id))[0]?.name ?? null,
  }
})
export type OnboardingData = Awaited<ReturnType<typeof getOnboarding>>

export const refreshRepos = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await requireUser()
  await syncUserRepos(user)
  return { ok: true }
})

export const saveRepoSelection = createServerFn({ method: 'POST' })
  .validator(z.object({ repoIds: z.array(z.number().int()).min(1).max(50), productName: z.string().trim().min(1).max(80).optional() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    // Selected repositories form (or join) the user's product so they share one memory.
    await ensureDefaultProduct(user.id, data.productName ?? 'My product', data.repoIds)
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
    // Owner answers become product memory facts, visible to every agent in the product.
    const q = await first<{ question: string; repo_id: number | null; product_id: string | null }>('SELECT question, repo_id, product_id FROM questions WHERE id = ?', data.id)
    const productId = q?.product_id ?? (q?.repo_id ? (await productForRepo(user.id, q.repo_id))?.id : null)
    if (q && productId) await rememberFacts(productId, null, null, [{ text: `Owner: ${q.question} → ${data.answer}`, evidence: 'answered by the owner' }])
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
    products: await Promise.all(
      (await listProducts(user.id)).map(async (p) => ({ id: p.id, name: p.name, repos: p.repos, memory: await memoryStats(p.id) })),
    ),
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
    return { ...detail, user: publicUser(user) }
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

// ------------------------------------------------------------------ products & memory

export const scanProduct = createServerFn({ method: 'POST' })
  .validator(z.object({ productId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const product = await getProduct(user.id, data.productId)
    if (!product) throw new Error('Product not found')
    const runId = uid()
    const ids: string[] = []
    for (const repoId of await productRepoIds(product.id)) ids.push(await createScan(user.id, repoId, 'security', 'manual', {}, runId))
    return { runId, scanIds: ids }
  })

export const getProductPage = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await authed()
    const isNew = data.id === 'new'
    const product = isNew ? null : await getProduct(user.id, data.id)
    if (!isNew && !product) throw redirect({ to: '/dashboard' })
    const members = product ? await productRepoIds(product.id) : []
    const repos = await listUserRepos(user.id)
    const owners = new Map<number, string>()
    for (const p of await listProducts(user.id)) for (const r of await productRepoIds(p.id)) owners.set(r, p.name)
    const memory = product ? await listMemory(product.id) : []
    return {
      user: publicUser(user),
      product: product ? { id: product.id, name: product.name, description: product.description } : null,
      repos: repos.map((r) => ({ id: r.id, fullName: r.full_name, member: members.includes(r.id), otherProduct: members.includes(r.id) ? null : (owners.get(r.id) ?? null) })),
      stats: product ? await memoryStats(product.id) : { facts: 0, reviewed: 0, verdicts: 0, saved: 0 },
      memory: memory.map((m) => ({ id: m.id, kind: m.kind, repo: repos.find((r) => r.id === m.repo_id)?.full_name ?? null, key: m.key, content: m.content, evidence: m.evidence, hits: m.hits, updatedAt: m.updated_at })),
    }
  })
export type ProductPageData = Awaited<ReturnType<typeof getProductPage>>

export const saveProductFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(80), description: z.string().max(500).optional(), repoIds: z.array(z.number().int()).max(100) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    if (data.id && !(await getProduct(user.id, data.id))) throw new Error('Product not found')
    const linked = (await listUserRepos(user.id)).map((r) => r.id)
    const repoIds = data.repoIds.filter((id) => linked.includes(id))
    // Repos in a product are scanned, so make sure they are selected.
    for (const id of repoIds) await run('UPDATE user_repositories SET selected = 1 WHERE user_id = ? AND repo_id = ?', user.id, id)
    return { id: await saveProduct(user.id, { id: data.id, name: data.name, description: data.description ?? null, repoIds }) }
  })

export const deleteProductFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await deleteProduct(user.id, data.id)
    return { ok: true }
  })

export const forgetMemoryFn = createServerFn({ method: 'POST' })
  .validator(z.object({ productId: z.string(), memoryId: z.string().optional(), kind: z.enum(['fact', 'reviewed', 'verdict']).optional() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    if (!(await getProduct(user.id, data.productId))) throw new Error('Product not found')
    await forgetMemory(data.productId, data.memoryId, data.kind)
    return { ok: true }
  })
