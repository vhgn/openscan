import { createFileRoute, Link } from '@tanstack/react-router'
import { TopBar } from '#/components/ui'
import { SKILLS, STAGE_LABELS, type Stage } from '#/lib/skills/registry'

export const Route = createFileRoute('/skills')({
  head: () => ({ meta: [{ title: 'Scanning skills — openscan' }] }),
  component: SkillsPage,
})

const ORDER: Stage[] = ['recon', 'hunt', 'supply-chain', 'ci-agents', 'validate', 'report']
const APPLIED_LABEL = { prompt: 'agent playbook', deterministic: 'deterministic check', ingest: 'result import', reference: 'reference' } as const

function SkillsPage() {
  return (
    <div className="min-h-screen">
      <TopBar
        right={
          <Link to="/dashboard" className="muted hover:underline">
            ← Dashboard
          </Link>
        }
      />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Scanning skills</h1>
        <p className="muted mt-1 max-w-3xl text-sm">
          openscan's pipeline is built from published agentic security skills by Trail of Bits, Cloudflare, Anthropic, NVIDIA, Cognition and OpenAI. Originals
          are vendored in <code>skills/vendor/</code> with their licenses; this page shows where each one runs and how.
        </p>
        <div className="mt-8 space-y-10">
          {ORDER.map((stage) => {
            const list = SKILLS.filter((s) => s.stages[0] === stage)
            if (!list.length) return null
            return (
              <section key={stage}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">{STAGE_LABELS[stage]}</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {list.map((s) => (
                    <article key={s.id} className="app-card p-4 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <a href={s.repoUrl} target="_blank" rel="noreferrer" className="font-semibold hover:underline">
                          {s.name}
                        </a>
                        <span className="muted whitespace-nowrap text-xs">
                          {s.publisher} · {s.license}
                        </span>
                      </div>
                      <p className="muted mt-1 text-xs">{s.summary}</p>
                      <p className="mt-2">{s.howUsed}</p>
                      <p className="mt-2 flex flex-wrap gap-1">
                        {s.applied.map((a) => (
                          <span key={a} className="rounded border hairline px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                            {APPLIED_LABEL[a]}
                          </span>
                        ))}
                        {s.stages.slice(1).map((st) => (
                          <span key={st} className="muted rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                            also: {STAGE_LABELS[st]}
                          </span>
                        ))}
                      </p>
                    </article>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </main>
    </div>
  )
}
