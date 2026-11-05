import { createFileRoute } from '@tanstack/react-router'
import { Lede, Page, SectionHead, Title } from '#/components/ui'
import { SKILLS, STAGE_LABELS, type Stage } from '#/lib/skills/registry'
import { getMe } from '#/server-fns/app'

export const Route = createFileRoute('/skills')({
  loader: () => getMe(),
  head: () => ({ meta: [{ title: 'Methods — openscan' }] }),
  component: SkillsPage,
})

const ORDER: Stage[] = ['recon', 'hunt', 'supply-chain', 'ci-agents', 'validate', 'report']
const APPLIED_LABEL = { prompt: 'agent playbook', deterministic: 'deterministic check', ingest: 'result import', reference: 'reference' } as const

function SkillsPage() {
  const { user } = Route.useLoaderData()
  return (
    <Page user={user}>
      <p className="label">Methods</p>
      <Title>Whose methods we follow, and where.</Title>
      <Lede>
        Every review is built from published agentic security skills by Trail of Bits, Cloudflare, Anthropic, NVIDIA, Cognition and OpenAI. The originals are vendored in{' '}
        <code className="font-mono text-[15px]">skills/vendor/</code> with their licenses. This page shows the stage each one runs in and what it changes.
      </Lede>

      {ORDER.map((stage) => {
        const list = SKILLS.filter((s) => s.stages[0] === stage)
        if (!list.length) return null
        return (
          <section key={stage}>
            <SectionHead>{STAGE_LABELS[stage]}</SectionHead>
            <div className="mt-4">
              {list.map((s) => (
                <article key={s.id} className="border-t border-rule py-5 first:border-t-0">
                  <h3 className="font-display text-[26px] leading-tight">
                    <a href={s.repoUrl} target="_blank" rel="noreferrer" className="hover:underline hover:decoration-1 hover:underline-offset-4">
                      {s.name}
                    </a>
                  </h3>
                  <p className="mt-0.5 font-sans text-[12.5px] text-muted">
                    {s.publisher} · {s.license} · {s.applied.map((a) => APPLIED_LABEL[a]).join(', ')}
                    {s.stages.length > 1 && <> · also in {s.stages.slice(1).map((st) => STAGE_LABELS[st].toLowerCase()).join(', ')}</>}
                  </p>
                  <p className="mt-2 text-[17px] italic leading-[1.55] text-ink-3">{s.summary}</p>
                  <p className="mt-2 text-[17px] leading-[1.6]">{s.howUsed}</p>
                </article>
              ))}
            </div>
          </section>
        )
      })}
    </Page>
  )
}
