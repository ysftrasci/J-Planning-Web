import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA Service Worker Kaydı
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('J-Planning Service Worker başarıyla yüklendi:', reg.scope);
      })
      .catch((err) => {
        console.warn('Service Worker yükleme hatası:', err);
      });
  });
}
