import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("J-Planning React Hatası:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '32px', textAlign: 'center', fontFamily: 'sans-serif', backgroundColor: '#FAF5F7', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h2 style={{ color: '#B83256', marginBottom: '12px' }}>J-Planning Yüklenirken Bir Hata Oluştu</h2>
          <p style={{ color: '#64748B', maxWidth: '400px', margin: '0 auto 20px', fontSize: '14px' }}>
            {this.state.error?.toString()}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '12px 24px', borderRadius: '8px', border: 'none', backgroundColor: '#E06D8C', color: '#fff', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            Sayfayı Yenile
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// PWA Service Worker Kaydı
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('J-Planning Service Worker yüklendi:', reg.scope);
      })
      .catch((err) => {
        console.warn('Service Worker hatası:', err);
      });
  });
}
