/**
 * Worker entry. TanStack Start serves pages/API (fetch); the same Worker also
 * consumes the scan queue and runs the cron that schedules recurring reports.
 * The MCP endpoint (/mcp) and its OAuth server (/oauth/*, /.well-known/oauth-*)
 * are plain fetch handlers, routed before TanStack.
 */
import handler from '@tanstack/react-start/server-entry'
import { runStep, scheduledTick } from './lib/scanner/engine'
import { handleMcp } from './lib/mcp/server'
import { cleanupOAuth, handleOAuth } from './lib/oauth/server'

async function fetchHandler(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname === '/mcp' || pathname === '/mcp/') return handleMcp(request)
  return (await handleOAuth(request)) ?? handler.fetch(request)
}

interface JobMessage {
  scanId: string
}

export default {
  fetch: (request: Request) => fetchHandler(request),

  async queue(batch: MessageBatch<JobMessage>) {
    for (const msg of batch.messages) {
      try {
        await runStep(msg.body.scanId)
        msg.ack()
      } catch (err) {
        console.error('scan step crashed', msg.body.scanId, err)
        msg.retry({ delaySeconds: 15 })
      }
    }
  },

  async scheduled(_controller: ScheduledController, _env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduledTick())
    ctx.waitUntil(cleanupOAuth().catch((e) => console.error('oauth cleanup failed', e)))
  },
} satisfies ExportedHandler<Env, JobMessage>
