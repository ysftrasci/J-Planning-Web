// J-Planning — Bulut Senkronizasyon Servisi (Faz 6 - Sadeleştirilmiş)
//
// Turso birincil bulut veritabanı haline geldiği için her yazma işleminde
// Firestore'a yapılan ağır 10-tablo JSON snapshot yüklemeleri ve dinleyicileri
// devre dışı bırakılmıştır. Fonksiyon imzaları geriye dönük uyumluluk için korunmuştur.

import { auth } from './firebase';

/**
 * Geriye dönük uyumluluk için no-op olarak korunmuştur.
 * Turso tüm yazma işlemlerini doğrudan bulutta kalıcı hale getirmektedir.
 */
export function triggerAutoCloudSyncForCurrentUser() {
  // Turso zaten bulut veritabanıdır, ek bir arka plan işlemine gerek yoktur.
}

export function triggerAutoCloudSync(uid) {
  // No-op
}

export async function uploadCloudSync(uid) {
  // No-op
}

export async function performInitialCloudSync(uid) {
  // No-op
}

export async function downloadAndApplyCloudSync(uid) {
  // No-op
}

export function listenCloudSync(uid, onRemoteUpdate) {
  // Dinleyici gerekmez, boş unsubscriber döndürür
  return () => {};
}

export async function getLocalSnapshotPayload() {
  return null;
}

export async function applyRemoteTablesToLocal(tables) {
  // No-op
}
