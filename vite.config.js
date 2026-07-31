import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Yerel ağdaki tüm cihazların (telefon, tablet vb.) erişimine izin verir
    port: 5173,
  },
})
