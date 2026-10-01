import { defineConfig } from 'vitest/config'
import path from 'node:path'

// `import.meta.dirname` rather than `__dirname`: Vite's native config loader
// does not define the CommonJS global, and warns on every run that it is about
// to become the default.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
})
