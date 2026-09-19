import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // .env, .env.local vb. dosyalarından ortam değişkenlerini yükler
  const env = loadEnv(mode, process.cwd(), '')

  // Varsayılan proxy hedefi canlı Cloudflare Worker adresidir.
  // Yerel worker (wrangler dev) ile test etmek için .env.local dosyasına
  // VITE_WORKER_PROXY_TARGET=http://127.0.0.1:8787 tanımlanabilir.
  const workerTarget =
    env.VITE_WORKER_PROXY_TARGET ||
    process.env.VITE_WORKER_PROXY_TARGET ||
    'https://jplanning-auth-worker.ysftrasci.workers.dev'

  return {
    plugins: [react()],
    server: {
      host: true, // Yerel ağdaki tüm cihazların (telefon, tablet vb.) erişimine izin verir
      port: 5173,
      proxy: {
        '/api/worker': {
          target: workerTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/worker/, ''),
        },
      },
    },
  }
})
