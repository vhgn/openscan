/** Server functions called from the UI (RPC over TanStack Start). */
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { all, batch, first, now, run } from '#/lib/db'
import { currentUser, requireUser } from '#/lib/session'
import { installUrl, manageInstallationUrl, githubConfigured } from '#/lib/github/app'
import { linkPublicRepo, listInstallTargets, listUserRepos, syncUserRepos } from '#/lib/github/repos'
import { linkChatGPT, unlinkChatGPT } from '#/lib/chatgpt'
import { cancelScan, createScan, loadPreferences, productIdForRepo, startProductScan } from '#/lib/scanner/engine'
import { listFindings, listProductScans, listQuestions, scanDetail, scanProgress } from '#/lib/queries'
import { codexClientFor, codexEnvironmentFor, openscanHost, settleInternetProbes, startInternetProbe } from '#/lib/codex/runtime'
import { environmentsSettingsUrl } from '#/lib/codex/cloud'
import {
  deleteProduct,
  ensureDefaultProduct,
  forgetMemory,
  getProduct,
  listMemory,
  listProducts,
  memoryStats,
  productPushRepoIds,
  productRepoIds,
  saveProduct,
  setPushForAllProducts,
} from '#/lib/products'
import { answerQuestionFor, setFindingStatus, startScanFor } from '#/lib/actions'
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

async function onboardingData(user: UserRow) {
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
    repos: repos.map((r) => ({ id: r.id, fullName: r.full_name, private: Boolean(r.private), language: r.language, description: r.description, selected: Boolean(r.selected), understood: Boolean(r.understood_at), codexEnv: r.codex_env_label ?? r.codex_env_id ?? null, codexChecked: Boolean(r.codex_checked_at), codexNet: r.codex_net, codexNetAt: r.codex_net_at })),
    codexEnvironmentsUrl: environmentsSettingsUrl(),
    openscanHost: openscanHost(),
    reading: scans.map((s) => ({ ...s, repo: repos.find((r) => r.id === s.repo_id)?.full_name ?? '' })),
    questions: await listQuestions(user.id, ['open', 'auto_answered', 'answered'], selected),
    preferences: await loadPreferences(user.id),
    hasPreferences: Boolean(await first('SELECT 1 FROM preferences WHERE user_id = ?', user.id)),
    productName: (await listProducts(user.id))[0]?.name ?? null,
  }
}

export const getOnboarding = createServerFn({ method: 'GET' }).handler(async () => onboardingData(await authed()))
export type OnboardingData = Awaited<ReturnType<typeof onboardingData>>

/** Accounts and organizations the GitHub App can be installed on (fetched on demand, not on every poll). */
export const getInstallTargets = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await authed()
  return listInstallTargets(user)
})

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
    await ensureDefaultProduct(user.id, data.productName ?? 'My product', data.repoIds, { rename: data.productName !== undefined })
    await batch([
      ['UPDATE user_repositories SET selected = 0 WHERE user_id = ?', [user.id]],
      ...data.repoIds.map((id): [string, Array<string | number | null>] => ['UPDATE user_repositories SET selected = 1 WHERE user_id = ? AND repo_id = ?', [user.id, id]]),
    ])
    if (user.onboarding_step === 'repos') await setStep(user.id, user.chatgpt_cookie_enc ? 'preferences' : 'chatgpt')
    // Already linked ChatGPT (e.g. coming back to change repos): start reading right away.
    if (user.chatgpt_cookie_enc || user.onboarding_step !== 'repos') await startUnderstanding(user.id)
    return { ok: true }
  })

/** Adds a public repository by "owner/name" or GitHub URL, no app install needed, and selects it. */
export const addPublicRepo = createServerFn({ method: 'POST' })
  .validator(z.object({ repo: z.string().trim().min(1).max(300) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const r = await linkPublicRepo(user.id, data.repo, { select: true })
    if (!r.ok) throw new Error(r.message)
    return { id: r.repo.id, fullName: r.repo.full_name }
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
    const before = await loadPreferences(user.id)
    await run(
      `INSERT INTO preferences (user_id, json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      user.id,
      JSON.stringify(data),
      now(),
    )
    // "On every push" is the default for every repo; product pages can still turn single repos on or off.
    if (data.frequency !== before.frequency && (data.frequency === 'on_push' || before.frequency === 'on_push')) {
      await setPushForAllProducts(user.id, data.frequency === 'on_push')
    }
    if (!user.onboarded_at) {
      await run('UPDATE users SET onboarded_at = ?, onboarding_step = ?, updated_at = ? WHERE id = ?', now(), 'waiting', now(), user.id)
      // Each product's first review starts with the repos already understood; the rest join it when reading finishes.
      const understood = await all<{ id: number; full_name: string }>(
        `SELECT r.id, r.full_name FROM repositories r JOIN user_repositories ur ON ur.repo_id = r.id WHERE ur.user_id = ? AND ur.selected = 1 AND r.understood_at IS NOT NULL`,
        user.id,
      )
      const byProduct = new Map<string, number[]>()
      for (const r of understood) {
        const pid = await productIdForRepo(user.id, r.id, r.full_name.split('/')[0])
        byProduct.set(pid, [...(byProduct.get(pid) ?? []), r.id])
      }
      for (const [pid, repoIds] of byProduct) await startProductScan(user.id, pid, 'onboarding', { repoIds })
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
    await answerQuestionFor(user.id, data.id, data.answer)
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

async function dashboardData(user: UserRow) {
  const repos = (await listUserRepos(user.id)).filter((r) => r.selected)
  return {
    user: publicUser(user),
    repos: repos.map((r) => ({ id: r.id, fullName: r.full_name, understood: Boolean(r.understood_at), codexEnv: r.codex_env_label ?? r.codex_env_id ?? null, codexChecked: Boolean(r.codex_checked_at) })),
    codexEnvironmentsUrl: environmentsSettingsUrl(),
    products: await Promise.all(
      (await listProducts(user.id)).map(async (p) => ({ id: p.id, name: p.name, repos: p.repos, pushRepos: p.push_repos, memory: await memoryStats(p.id) })),
    ),
    productScans: await listProductScans(user.id, { limit: 20 }),
    findings: await listFindings(user.id, { limit: 50 }),
    questions: await listQuestions(user.id, ['open']),
    preferences: await loadPreferences(user.id),
  }
}

/**
 * Everything `/home` needs in one call: the setup steps until onboarding is done
 * (or when the user asks to change repositories), the brief afterwards.
 */
export const getHome = createServerFn({ method: 'GET' })
  .validator(z.object({ setup: z.boolean().default(false) }))
  .handler(async ({ data }) => {
    const user = await authed()
    if (data.setup || user.onboarding_step !== 'done') return { kind: 'setup' as const, data: await onboardingData(user) }
    return { kind: 'brief' as const, data: await dashboardData(user) }
  })
export type DashboardData = Awaited<ReturnType<typeof dashboardData>>

export const getScan = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await authed()
    const detail = await scanDetail(user.id, data.id)
    if (!detail) throw redirect({ to: '/home' })
    return { ...detail, user: publicUser(user) }
  })

/** Reviews one repository: any public one typed as "owner/name" or a GitHub URL (linked on the way), or a linked one. */
export const cancelScanFn = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    return cancelScan(user.id, data.id)
  })

/** Cheap poll while a scan runs: status + new activity-log entries after `since`. */
export const getScanProgress = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string(), since: z.number().int().min(0).default(0) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    return scanProgress(user.id, data.id, data.since)
  })

export const scanRepo = createServerFn({ method: 'POST' })
  .validator(z.object({ repo: z.string().trim().min(1).max(300) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const r = await startScanFor(user.id, data.repo, 'security')
    if (!r.ok) throw new Error(r.message)
    return { id: r.id }
  })

export const updateFindingStatus = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string(), status: z.enum(['open', 'dismissed', 'fixed']) }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await setFindingStatus(user.id, data.id, data.status)
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

/** Starts a tiny Codex task that checks whether the repo's environment can reach openscan. */
export const testCodexInternet = createServerFn({ method: 'POST' })
  .validator(z.object({ repoId: z.number().int() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const repo = (await listUserRepos(user.id)).find((r) => r.id === data.repoId && r.selected)
    if (!repo) return { ok: false as const, reason: 'Repository not linked' }
    return startInternetProbe(user, repo)
  })

/** Settles running internet checks; the settings page polls this while any is running. */
export const checkCodexInternet = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await requireUser()
  return settleInternetProbes(user)
})

// ------------------------------------------------------------------ products & memory

/** Starts a security review of a whole product (one product scan, one repository scan per member). */
export const scanProduct = createServerFn({ method: 'POST' })
  .validator(z.object({ productId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const product = await getProduct(user.id, data.productId)
    if (!product) throw new Error('Product not found')
    const started = await startProductScan(user.id, product.id, 'manual')
    if (!started) throw new Error('This product has no repositories yet')
    return { productId: product.id, productScanId: started.id, scanIds: started.scanIds }
  })

export const getProductPage = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await authed()
    const isNew = data.id === 'new'
    const product = isNew ? null : await getProduct(user.id, data.id)
    if (!isNew && !product) throw redirect({ to: '/home' })
    const members = product ? await productRepoIds(product.id) : []
    const pushMembers = product ? await productPushRepoIds(product.id) : []
    const prefs = await loadPreferences(user.id)
    const repos = await listUserRepos(user.id)
    const owners = new Map<number, string>()
    for (const p of await listProducts(user.id)) for (const r of await productRepoIds(p.id)) owners.set(r, p.name)
    const memory = product ? await listMemory(product.id) : []
    return {
      user: publicUser(user),
      product: product ? { id: product.id, name: product.name, description: product.description } : null,
      repos: repos.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        member: members.includes(r.id),
        // Non-members show the default they would get on joining.
        scanOnPush: members.includes(r.id) ? pushMembers.includes(r.id) : prefs.frequency === 'on_push',
        otherProduct: members.includes(r.id) ? null : (owners.get(r.id) ?? null),
      })),
      productScans: product ? await listProductScans(user.id, { productId: product.id, limit: 15 }) : [],
      stats: product ? await memoryStats(product.id) : { facts: 0, reviewed: 0, verdicts: 0, saved: 0 },
      memory: memory.map((m) => ({ id: m.id, kind: m.kind, repo: repos.find((r) => r.id === m.repo_id)?.full_name ?? null, key: m.key, content: m.content, evidence: m.evidence, hits: m.hits, updatedAt: m.updated_at })),
    }
  })
export type ProductPageData = Awaited<ReturnType<typeof getProductPage>>

export const saveProductFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().optional(),
      name: z.string().trim().min(1).max(80),
      description: z.string().max(500).optional(),
      repoIds: z.array(z.number().int()).max(100),
      /** Members whose pushes start a product scan; omitted keeps current settings. */
      pushRepoIds: z.array(z.number().int()).max(100).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    if (data.id && !(await getProduct(user.id, data.id))) throw new Error('Product not found')
    const linked = (await listUserRepos(user.id)).map((r) => r.id)
    const repoIds = data.repoIds.filter((id) => linked.includes(id))
    // Repos in a product are scanned, so make sure they are selected.
    for (const id of repoIds) await run('UPDATE user_repositories SET selected = 1 WHERE user_id = ? AND repo_id = ?', user.id, id)
    const pushRepoIds = data.pushRepoIds?.filter((id) => repoIds.includes(id))
    return { id: await saveProduct(user.id, { id: data.id, name: data.name, description: data.description ?? null, repoIds, pushRepoIds }) }
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
