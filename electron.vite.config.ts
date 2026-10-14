import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const shared = resolve(root, 'src/shared')

/**
 * Content-Security-Policy for the renderer. Production allows only bundled scripts, no
 * network access at all and no eval. Development additionally allows the Vite dev server
 * (HMR websocket and injected <style> tags).
 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'inputsplit-csp',
    transformIndexHtml(html, context) {
      const dev = context.server !== undefined
      const policy = [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        dev ? "connect-src 'self' ws://localhost:* http://localhost:*" : "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; ')
      return html.replace('__CONTENT_SECURITY_POLICY__', policy)
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { input: { index: resolve(root, 'src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      rollupOptions: {
        input: { index: resolve(root, 'src/preload/index.ts') },
        // Sandboxed preload scripts must be a single CommonJS file.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(root, 'src/renderer/src'),
        '@shared': shared,
      },
    },
    plugins: [vue(), tailwindcss(), contentSecurityPolicy()],
    build: {
      minify: 'esbuild',
      rollupOptions: { input: { index: resolve(root, 'src/renderer/index.html') } },
    },
  },
})
