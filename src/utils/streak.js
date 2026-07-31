// J-Planning — Seri (Streak) Hesaplama
// Kural (1.5): Bir görev periyodu SUCCESSFUL olduğunda seri +1 artar.
// FAILED olduğunda seri kırılır (0'a döner).
// Geçmişe dönük düzeltme (late-mark) yapıldığında, ilgili tarihten itibaren
// seri YENİDEN HESAPLANIR (bu fonksiyon her seferinde kayıtlardan baştan hesaplar,
// böylece "yeniden hesaplama" doğal olarak gerçekleşir — ayrı bir migrasyon gerekmez).

import { getPeriodKey, getPreviousPeriodKey } from './period';

// records: bu taskId'ye ait tüm task_records satırları (periodKey, status)
// task: { id, period, createdAt }
// Belirli bir periodKey'e KADAR olan (o periyot dahil) seriyi hesaplar.
// Böylece "bugün tamamlanınca seri kaç olur" sorusuna cevap verebiliriz.
export function calculateStreakUpTo(task, records, uptoPeriodKey) {
  // ONCE görevlerde "seri" kavramı yok (hiç tekrarlanmaz) — hesaplamaya
  // hiç girmeden 0 döndür. Bu aynı zamanda getPreviousPeriodKey'in ONCE
  // için bir "önceki periyot" tanımlamamasından doğabilecek sonsuz döngü
  // riskini de baştan ortadan kaldırır.
  if (task.period === 'ONCE') return 0;

  const recordsMap = new Map(records.map((r) => [r.periodKey, r]));
  let streak = 0;
  let checkKey = uptoPeriodKey;
  const createdKey = getPeriodKey(task.period, new Date(task.createdAt));

  let iterations = 0;
  while (iterations < 1000) {
    const rec = recordsMap.get(checkKey);
    if (rec && (rec.status === 'SUCCESSFUL' || rec.status === 'FROZEN')) {
      streak += 1;
    } else {
      break;
    }
    if (checkKey <= createdKey) break;
    checkKey = getPreviousPeriodKey(task.period, checkKey);
    iterations += 1;
  }
  return streak;
}

// Görevin şu anki (en güncel) serisini hesaplar — istatistik ekranı için.
export function calculateCurrentStreak(task, records) {
  if (task.period === 'ONCE') return 0;
  const todayKey = getPeriodKey(task.period, new Date());
  const recordsMap = new Map(records.map((r) => [r.periodKey, r]));
  const startKey = recordsMap.has(todayKey) ? todayKey : getPreviousPeriodKey(task.period, todayKey);
  return calculateStreakUpTo(task, records, startKey);
}

// En uzun seri (rekor)
export function calculateMaxStreak(task, records) {
  if (task.period === 'ONCE') return 0;
  const sorted = [...records].sort((a, b) => (a.periodKey < b.periodKey ? -1 : 1));
  let max = 0;
  let current = 0;
  for (const rec of sorted) {
    if (rec.status === 'SUCCESSFUL' || rec.status === 'FROZEN') {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

// Tamamlanma oranı
export function calculateCompletionStats(records) {
  const finalized = records.filter((r) => r.status === 'SUCCESSFUL' || r.status === 'FAILED' || r.status === 'FROZEN');
  const successCount = finalized.filter((r) => r.status === 'SUCCESSFUL' || r.status === 'FROZEN').length;
  const total = finalized.length;
  const rate = total > 0 ? Math.round((successCount / total) * 100) : 0;
  return { successCount, failedCount: total - successCount, total, rate };
}

// Güncel dönem özeti: görev periyodu DAILY ise "bu hafta kaç gün", WEEKLY/MONTHLY
// ise daha uzun bir pencere (son 4 hafta / son 3 ay) üzerinden özet verir.
// Amaç: uzun vadeli (tüm zamanlar) orana ek olarak, YAKIN DÖNEM bağlamı sağlamak.
export function calculateRecentSummary(task, records) {
  if (task.period === 'ONCE') {
    return { successCount: 0, countedPeriods: 0, unitLabel: '', periodType: 'ONCE' };
  }
  const recordsMap = new Map(records.map((r) => [r.periodKey, r]));
  const todayKey = getPeriodKey(task.period, new Date());
  const windowSize = task.period === 'DAILY' ? 7 : task.period === 'WEEKLY' ? 4 : 3;
  const unitLabel = task.period === 'DAILY' ? 'gün' : task.period === 'WEEKLY' ? 'hafta' : 'ay';

  let checkKey = todayKey;
  let successCount = 0;
  let countedPeriods = 0;

  for (let i = 0; i < windowSize; i++) {
    const rec = recordsMap.get(checkKey);
    // Bugünün/bu haftanın periyodu henüz bitmediyse (kayıt yoksa ya da PENDING_PARTIAL
    // ise) sayıma dahil etme — sadece kesinleşmiş periyotları say.
    if (rec && (rec.status === 'SUCCESSFUL' || rec.status === 'FAILED')) {
      if (rec.status === 'SUCCESSFUL') successCount += 1;
      countedPeriods += 1;
    } else if (checkKey !== todayKey) {
      countedPeriods += 1;
    }
    checkKey = getPreviousPeriodKey(task.period, checkKey);
  }

  return { successCount, countedPeriods, unitLabel, periodType: task.period };
}
