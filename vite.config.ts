import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Emscripten glue resolves wasm as `${scriptDir}ammo.wasm.wasm`; with bundled ESM, scriptDir is empty so the browser fetches `/ammo.wasm.wasm`. */
function ammoWasmRootPlugin() {
  // three.js resolves wasm as `${scriptDir}ammo.wasm.wasm`; with bundled ESM, scriptDir is empty
  // so the browser fetches `/ammo.wasm.wasm`.
  //
  // Some three.js packages don't ship the binary alongside `ammo.wasm.js`, so guard against missing files.
  const wasmPath = path.resolve(__dirname, 'node_modules/three/examples/jsm/libs/ammo.wasm.wasm')
  const hasWasm = fs.existsSync(wasmPath)
  return {
    name: 'ammo-wasm-root',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url === '/ammo.wasm.wasm') {
          if (!hasWasm) {
            res.statusCode = 404
            res.end()
            return
          }
          res.setHeader('Content-Type', 'application/wasm')
          fs.createReadStream(wasmPath).pipe(res)
          return
        }
        next()
      })
    },
    closeBundle() {
      if (!hasWasm) return
      fs.copyFileSync(wasmPath, path.resolve(__dirname, 'dist/ammo.wasm.wasm'))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ammoWasmRootPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@three-mmd': resolve(__dirname, './src/vendor/three-mmd'),
      '@three-jsm': resolve(__dirname, './node_modules/three/examples/jsm'),
    },
  },
  optimizeDeps: {
    exclude: ['@pixiv/three-vrm', '@pixiv/three-vrm-animation', '@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
    port: 3000,
    open: true,
  },
})
