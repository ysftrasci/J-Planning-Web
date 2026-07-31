// J-Planning — Koyu/Açık Tema Yardımcısı (Web)

const THEME_KEY = 'jplanning:theme';

export function getStoredTheme() {
  if (typeof window === 'undefined') return 'light';
  return localStorage.getItem(THEME_KEY) || 'light';
}

export function setStoredTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme === 'dark' ? '#161513' : '#FAF9F6');
  }
}

// Uygulama ilk açıldığında kaydedilen temayı uygula
if (typeof window !== 'undefined') {
  applyTheme(getStoredTheme());
}
