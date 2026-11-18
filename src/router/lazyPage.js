// Sayfaları ihtiyaç anında yükler (kod bölme).
// Yeni bir yayından sonra uzun süre açık kalmış eski bir sekme, artık sunucuda olmayan eski bir
// parçayı isteyebilir; bu durumda sayfa bir kez yenilenir ve güncel sürüm yüklenir.
import { lazy } from 'react';

const RELOAD_KEY = 'jplanning:chunk-reload-at';
const RELOAD_GUARD_MS = 10000;

export function lazyPage(loader) {
  return lazy(() =>
    loader().catch((err) => {
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
        if (Date.now() - last > RELOAD_GUARD_MS) {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
          window.location.reload();
          return new Promise(() => {});
        }
      } catch {
        // sessionStorage yoksa hatayı olduğu gibi göster
      }
      throw err;
    })
  );
}
