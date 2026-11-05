import { createFileRoute, redirect } from '@tanstack/react-router'

/** Old address; signed-in users live on /home now. */
export const Route = createFileRoute('/dashboard')({
  validateSearch: (s: Record<string, unknown>) => s,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/home', search: search as never, replace: true })
  },
})
