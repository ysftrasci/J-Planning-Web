import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // .env, .env.local vb. dosyalarından ortam değişkenlerini yükler
  const env = loadEnv(mode, process.cwd(), '')

  // Öncelik: VITE_WORKER_VIA_NETLIFY > VITE_WORKER_PROXY_TARGET > varsayılan workers.dev
  // ISP engeli veya workers.dev erişim sorunlarında Netlify proxy'si (örn. https://j-planning.netlify.app)
  // üzerinden tünelleme yapılabilir.
  const netlifyTarget =
    env.VITE_WORKER_VIA_NETLIFY ||
    process.env.VITE_WORKER_VIA_NETLIFY

  const workerTarget =
    netlifyTarget ||
    env.VITE_WORKER_PROXY_TARGET ||
    process.env.VITE_WORKER_PROXY_TARGET ||
    'https://jplanning-auth-worker.ysftrasci.workers.dev'

  const workerProxyConfig = {
    target: workerTarget,
    changeOrigin: true,
  }

  // Netlify kullanıldığında yol /api/worker/* olarak korunmalıdır (netlify.toml splat kuralı).
  // Doğrudan worker veya yerel wrangler hedeflendiğinde /api/worker ön eki kırpılır.
  if (!netlifyTarget) {
    workerProxyConfig.rewrite = (path) => path.replace(/^\/api\/worker/, '')
  }

  return {
    plugins: [react()],
    server: {
      host: true, // Yerel ağdaki tüm cihazların (telefon, tablet vb.) erişimine izin verir
      port: 5173,
      proxy: {
        '/api/worker': workerProxyConfig,
      },
    },
  }
})
