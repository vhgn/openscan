import { createStart } from '@tanstack/react-start'

/**
 * Selective SSR: only the public landing page (`/`, which opts in with `ssr: true`)
 * is rendered on the server. Every signed-in page renders in the browser; their
 * loaders still call server functions over RPC. The root shell (fonts, CSS) is
 * always server-rendered.
 */
export const startInstance = createStart(() => ({
  defaultSsr: false,
}))
