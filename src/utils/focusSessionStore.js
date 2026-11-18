// J-Planning — Süren odak seansını cihazda saklar.
// Odak sayfasından başka sayfaya geçince veya uygulama kapanınca seans kaybolmasın diye
// durum localStorage'da tutulur. Uygulama açıkken başka sayfadayken süre işlemeye devam eder;
// uygulama kapanıp yeniden açıldığında seans, uygulamanın son açık olduğu anda duraklatılmış
// olarak geri gelir (kapalı geçen süre sayılmaz).

const STORAGE_KEY = 'jplanning:focus-active-session';
const HEARTBEAT_MS = 15 * 1000;
// Bundan daha eski bir seans geri yüklenmez (ör. günler önce yarım bırakılmış).
const MAX_RESTORE_AGE_MS = 12 * 60 * 60 * 1000;

let heartbeatTimer = null;
// Seans bu sayfa yüklemesinde başlatıldı/geri yüklendi mi? (Sayfa yenilenince sıfırlanır.)
let liveInThisPageLoad = false;

function readRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRaw(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Kısıtlı ortam (gizli sekme vb.): seans yalnızca bellekte kalır.
  }
}

function touchLastAlive() {
  const state = readRaw();
  if (!state) {
    stopHeartbeat();
    return;
  }
  writeRaw({ ...state, lastAliveAt: Date.now() });
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function ensureHeartbeat() {
  if (heartbeatTimer || typeof window === 'undefined') return;
  heartbeatTimer = setInterval(touchLastAlive, HEARTBEAT_MS);
}

if (typeof window !== 'undefined') {
  // Sekme kapanırken / arka plana atılırken son canlı anı kaydet.
  window.addEventListener('pagehide', () => {
    if (heartbeatTimer) touchLastAlive();
  });
  document.addEventListener('visibilitychange', () => {
    if (heartbeatTimer && document.visibilityState === 'hidden') touchLastAlive();
  });
}

/**
 * state: { ownerId, sessionId, startTime (ms|null: duraklatılmış), pausedElapsed (sn),
 *          awardedMins (number[]), totalEarnedJp, sound }
 */
export function saveActiveFocusSession(state) {
  liveInThisPageLoad = true;
  writeRaw({ ...state, lastAliveAt: Date.now() });
  ensureHeartbeat();
}

export function clearActiveFocusSession() {
  liveInThisPageLoad = false;
  stopHeartbeat();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // yut
  }
}

/**
 * Bu kullanıcıya ait süren seansı döndürür; yoksa null.
 * Dönen nesnede `resumedAfterClose` true ise uygulama kapanıp açılmıştır ve seans
 * son canlı anda duraklatılmış olarak hesaplanmıştır.
 */
export function loadActiveFocusSession(ownerId) {
  const state = readRaw();
  if (!state || !state.sessionId || state.ownerId !== ownerId) return null;

  const lastAliveAt = Number(state.lastAliveAt) || 0;
  if (Date.now() - lastAliveAt > MAX_RESTORE_AGE_MS) {
    clearActiveFocusSession();
    return null;
  }

  const restored = {
    ...state,
    pausedElapsed: Math.max(0, Number(state.pausedElapsed) || 0),
    awardedMins: Array.isArray(state.awardedMins) ? state.awardedMins : [],
    totalEarnedJp: Number(state.totalEarnedJp) || 0,
    resumedAfterClose: false,
  };

  if (state.startTime && !liveInThisPageLoad) {
    // Uygulama kapalıyken geçen süreyi sayma: son canlı ana kadar olan süreyi ekle, duraklat.
    const ranSec = Math.max(0, Math.floor((lastAliveAt - Number(state.startTime)) / 1000));
    restored.pausedElapsed += ranSec;
    restored.startTime = null;
    restored.resumedAfterClose = true;
    writeRaw({ ...restored, lastAliveAt: Date.now() });
  }

  liveInThisPageLoad = true;
  ensureHeartbeat();
  return restored;
}
