// J-Planning — Bulut Senkronizasyon Servisi (Faz 6 - Sadeleştirilmiş)
//
// Turso birincil bulut veritabanı haline geldiği için her yazma işleminde
// Firestore'a yapılan ağır 10-tablo JSON snapshot yüklemeleri ve dinleyicileri
// devre dışı bırakılmıştır. Fonksiyon imzaları geriye dönük uyumluluk için korunmuştur.


/**
 * Geriye dönük uyumluluk için no-op olarak korunmuştur.
 * Turso tüm yazma işlemlerini doğrudan bulutta kalıcı hale getirmektedir.
 */
export function triggerAutoCloudSyncForCurrentUser() {
  // Turso zaten bulut veritabanıdır, ek bir arka plan işlemine gerek yoktur.
}

export function triggerAutoCloudSync(_uid) {
  // No-op
}

export async function uploadCloudSync(_uid) {
  // No-op
}

export async function performInitialCloudSync(_uid) {
  // No-op
}

export async function downloadAndApplyCloudSync(_uid) {
  // No-op
}

export function listenCloudSync(_uid, _onRemoteUpdate) {
  // Dinleyici gerekmez, boş unsubscriber döndürür
  return () => {};
}

export async function getLocalSnapshotPayload() {
  return null;
}

export async function applyRemoteTablesToLocal(_tables) {
  // No-op
}
