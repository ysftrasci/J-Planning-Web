// J-Planning — Seri (Streak) Hesaplama
// Kural (1.5): Bir görev periyodu SUCCESSFUL olduğunda seri +1 artar.
// FAILED olduğunda seri kırılır (0'a döner).
// Geçmişe dönük düzeltme (late-mark) yapıldığında, ilgili tarihten itibaren
// seri YENİDEN HESAPLANIR (bu fonksiyon her seferinde kayıtlardan baştan hesaplar,
// böylece "yeniden hesaplama" doğal olarak gerçekleşir — ayrı bir migrasyon gerekmez).

import { getPeriodKey, getPreviousPeriodKey } from './period.js';
import { formatNumberLocativeSuffix } from './turkishSuffix.js';

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
  const createdKey = getPeriodKey(task, new Date(task.createdAt));

  let iterations = 0;
  while (iterations < 1000) {
    const rec = recordsMap.get(checkKey);
    if (rec && (rec.status === 'SUCCESSFUL' || rec.status === 'FROZEN')) {
      streak += 1;
    } else {
      break;
    }
    if (checkKey <= createdKey) break;
    checkKey = getPreviousPeriodKey(task, checkKey);
    iterations += 1;
  }
  return streak;
}

// Görevin şu anki (en güncel) serisini hesaplar — istatistik ekranı için.
export function calculateCurrentStreak(task, records) {
  if (task.period === 'ONCE') return 0;
  const todayKey = getPeriodKey(task, new Date());
  const recordsMap = new Map(records.map((r) => [r.periodKey, r]));
  const startKey = recordsMap.has(todayKey) ? todayKey : getPreviousPeriodKey(task, todayKey);
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
// subtaskCount = 1: Basit görevler için kesinleşmiş (SUCCESSFUL, FAILED, FROZEN) kayıtlar üzerinden ikili hesaplama.
// subtaskCount > 1: Çoklu alt görevli işlerde PENDING_PARTIAL kayıtları da oransal olarak (completedSubtasks/subtaskCount) hesaba dahil edilir.
export function calculateCompletionStats(records, subtaskCount = 1) {
  const effectiveSubtaskCount = Math.max(1, Number(subtaskCount) || 1);

  if (effectiveSubtaskCount === 1) {
    const finalized = records.filter((r) => r.status === 'SUCCESSFUL' || r.status === 'FAILED' || r.status === 'FROZEN');
    const successCount = finalized.filter((r) => r.status === 'SUCCESSFUL' || r.status === 'FROZEN').length;
    const total = finalized.length;
    const rate = total > 0 ? Math.round((successCount / total) * 100) : 0;
    return { successCount, failedCount: total - successCount, total, rate };
  }

  // subtaskCount > 1: Kesinleşmiş kayıtlar ve devam eden kısmi kayıtlar (PENDING_PARTIAL) hesaba dahil edilir.
  // Henüz başlanmamış (PENDING veya kaydı olmayan) periyotlar hesaba katılmaz.
  const validRecords = records.filter(
    (r) =>
      r.status === 'SUCCESSFUL' ||
      r.status === 'FAILED' ||
      r.status === 'FROZEN' ||
      r.status === 'PENDING_PARTIAL'
  );

  let totalScore = 0;
  for (const rec of validRecords) {
    if (rec.status === 'SUCCESSFUL' || rec.status === 'FROZEN') {
      totalScore += 1.0;
    } else if (rec.status === 'PENDING_PARTIAL') {
      const completed = Math.max(0, Math.min(Number(rec.completedSubtasks) || 0, effectiveSubtaskCount));
      totalScore += completed / effectiveSubtaskCount;
    } else if (rec.status === 'FAILED') {
      totalScore += 0.0;
    }
  }

  const total = validRecords.length;
  const rate = total > 0 ? Math.round((totalScore / total) * 100) : 0;
  const roundedSuccess = Number(totalScore.toFixed(1));

  return {
    successCount: roundedSuccess,
    failedCount: total - Math.round(totalScore),
    total,
    rate,
  };
}

// Güncel dönem özeti: görev periyodu DAILY ise "bu hafta kaç gün", WEEKLY/MONTHLY
// ise daha uzun bir pencere (son 4 hafta / son 3 ay) üzerinden özet verir.
// Amaç: uzun vadeli (tüm zamanlar) orana ek olarak, YAKIN DÖNEM bağlamı sağlamak.
export function calculateRecentSummary(task, records) {
  if (task.period === 'ONCE') {
    return { successCount: 0, countedPeriods: 0, summaryText: '', periodType: 'ONCE' };
  }
  const recordsMap = new Map(records.map((r) => [r.periodKey, r]));
  const todayKey = getPeriodKey(task, new Date());
  const windowSize = task.period === 'DAILY' ? 7 : task.period === 'WEEKLY' ? 4 : 3;
  const interval = task.intervalValue && task.intervalValue > 1 ? task.intervalValue : 1;

  let checkKey = todayKey;
  let successCount = 0;
  let countedPeriods = 0;

  for (let i = 0; i < windowSize; i++) {
    const rec = recordsMap.get(checkKey);
    // Henüz kesinleşmemiş periyotlar da (kayıt yok veya PENDING_PARTIAL) pencereye dahil edilir.
    if (rec && (rec.status === 'SUCCESSFUL' || rec.status === 'FAILED' || rec.status === 'FROZEN')) {
      if (rec.status === 'SUCCESSFUL' || rec.status === 'FROZEN') successCount += 1;
      countedPeriods += 1;
    } else {
      countedPeriods += 1;
    }
    checkKey = getPreviousPeriodKey(task, checkKey);
  }

  // Türkçe tamlama: intervalValue > 1 ise "dönemin", intervalValue === 1 ise "günün/haftanın/ayın"
  let periodGenitive = 'dönemin';
  if (interval === 1) {
    if (task.period === 'DAILY') periodGenitive = 'günün';
    else if (task.period === 'WEEKLY') periodGenitive = 'haftanın';
    else if (task.period === 'MONTHLY') periodGenitive = 'ayın';
  }

  const successNumberText = formatNumberLocativeSuffix(successCount);
  const summaryText = `Son ${countedPeriods} ${periodGenitive} ${successNumberText} tamamlandı`;

  return { successCount, countedPeriods, summaryText, periodType: task.period };
}
