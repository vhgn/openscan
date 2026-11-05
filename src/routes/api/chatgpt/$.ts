import { createFileRoute } from '@tanstack/react-router'
import { chatgptAuth } from '#/lib/chatgpt'

/** Mounts the Login-with-ChatGPT SDK handler (login, status, session, logout, models, responses). */
export const Route = createFileRoute('/api/chatgpt/$')({
  server: {
    handlers: {
      GET: ({ request }) => chatgptAuth().handler(request),
      POST: ({ request }) => chatgptAuth().handler(request),
    },
  },
})
