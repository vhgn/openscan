import { LoginWithChatGPT } from '@opencoredev/loginwithchatgpt-react'
import { useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { linkChatGPTSession } from '#/server-fns/app'
import { ErrorNote } from './ui'

/** The Login with ChatGPT widget, linked to the openscan account once it authenticates. */
export function ChatGPTConnect() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return (
    <div className="lwc-essay border-y border-rule py-6 font-sans">
      {mounted ? (
        <LoginWithChatGPT
          consent={{ appName: 'openscan' }}
          onAuthenticated={async () => {
            const res = await linkChatGPTSession()
            if (!res.linked) setError(`ChatGPT session not ready (${res.status}). Try again.`)
            await router.invalidate()
          }}
        />
      ) : (
        <div className="h-10" />
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  )
}
