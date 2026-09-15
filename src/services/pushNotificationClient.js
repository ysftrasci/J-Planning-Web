import { auth } from './firebase';

const WORKER_URL = (import.meta.env.VITE_WORKER_URL || 'https://jplanning-auth-worker.ysftrasci.workers.dev').replace(/\/+$/, '');

/**
 * Cloudflare Worker'a anlık push bildirimi gönderme isteği atar.
 * Fire-and-forget prensibiyle çalışır: Hata durumunda asla throw fırlatmaz,
 * çağıran ana akışı (arkadaş ekleme, görev atama vb.) kesinlikle engellemez veya geciktirmez.
 *
 * @param {('FRIEND_REQUEST'|'TASK_ASSIGNED'|'TASK_COMPLETED'|'TASK_DELETED')} type
 * @param {string} targetUid
 * @param {object} [params={}] - { senderName, taskTitle }
 * @returns {Promise<boolean>} Gönderim isteğinin başarı durumu
 */
export async function sendPushNotification(type, targetUid, params = {}) {
  try {
    const user = auth.currentUser;
    if (!user || !targetUid) return false;

    // Kullanıcının güncel Firebase ID Token'ını al
    const idToken = typeof user.getIdToken === 'function' ? await user.getIdToken() : null;
    if (!idToken) {
      console.warn('[PushNotificationClient] Kullanıcı oturum tokenı alınamadığı için bildirim atlandı.');
      return false;
    }

    const response = await fetch(`${WORKER_URL}/push/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        type,
        targetUid,
        params,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.warn(`[PushNotificationClient] Worker bildirim uyarısı (${response.status}):`, errData.message || errData.error);
      return false;
    }

    return true;
  } catch (err) {
    // Ağ kesintisi veya fetch hatası durumunda sessizce logla, asla throw yapma
    console.warn('[PushNotificationClient] Push bildirimi gönderilemedi:', err.message);
    return false;
  }
}
