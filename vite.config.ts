import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  resolve: { tsconfigPaths: true, dedupe: ['react', 'react-dom'] },
  // Pre-bundle deps up front so Vite never re-optimizes mid-session (which can load two React copies during SSR).
  optimizeDeps: { include: ['@opencoredev/loginwithchatgpt-react'] },
  environments: {
    ssr: {
      optimizeDeps: {
        include: [
          'react',
          'react-dom',
          'react-dom/server',
          '@opencoredev/loginwithchatgpt-react',
          '@opencoredev/loginwithchatgpt-server',
          '@opencoredev/loginwithchatgpt-ai',
          'ai',
          'zod',
        ],
      },
    },
  },
  plugins: [
    // Runs the SSR environment inside workerd with the bindings from wrangler.jsonc (D1, Queue, vars).
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})
