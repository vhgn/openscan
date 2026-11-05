/**
 * Worker entry. TanStack Start serves pages/API (fetch); the same Worker also
 * consumes the scan queue and runs the cron that schedules recurring reports.
 */
import handler from '@tanstack/react-start/server-entry'
import { runStep, scheduledTick } from './lib/scanner/engine'

interface JobMessage {
  scanId: string
}

export default {
  fetch: (request: Request) => handler.fetch(request),

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
  },
} satisfies ExportedHandler<Env, JobMessage>
