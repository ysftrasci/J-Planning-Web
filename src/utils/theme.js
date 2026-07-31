const THEME_KEY = 'jplanning:theme';

export function getStoredTheme() {
  try {
    if (typeof window === 'undefined') return 'light';
    return localStorage.getItem(THEME_KEY) || 'light';
  } catch (e) {
    return 'light';
  }
}

export function setStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) {
    // kısıtlı ortamlar için yut
  }
  applyTheme(theme);
}

export function applyTheme(theme) {
  try {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#161513' : '#FAF9F6');
    }
  } catch (e) {}
}

if (typeof window !== 'undefined') {
  try {
    applyTheme(getStoredTheme());
  } catch (e) {}
}
