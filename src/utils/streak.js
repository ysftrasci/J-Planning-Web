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
    if (rec && rec.status === 'SUCCESSFUL') {
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
// Kural:
//  - Güncel dönem SUCCESSFUL → o dönem dahil geriye sayılır (+1 var).
//  - Güncel dönem FAILED     → seri 0 (dönem kesinleşmiş ve başarısız).
//  - Güncel dönem PENDING_PARTIAL / PENDING / kayıt yok
//                            → önceki dönemden başlanır; güncel dönem seriyi KIRMIYOR,
//                              ama +1 de katmıyor (henüz bitmedi).
export function calculateCurrentStreak(task, records) {
  if (task.period === 'ONCE') return 0;
  const todayKey = getPeriodKey(task, new Date());
  const recordsMap = new Map(records.map((r) => [r.periodKey, r]));
  const todayRec = recordsMap.get(todayKey);

  if (todayRec && todayRec.status === 'SUCCESSFUL') {
    // Güncel dönem tamamlandı: o dönem dahil say.
    return calculateStreakUpTo(task, records, todayKey);
  }
  if (todayRec && todayRec.status === 'FAILED') {
    // Güncel dönem kesinleşmiş ve başarısız: seri kırılmış.
    return 0;
  }
  // Kayıt yok, PENDING veya PENDING_PARTIAL: dönem devam ediyor.
  // Önceki dönemden geriye say; güncel döneme dokunma.
  return calculateStreakUpTo(task, records, getPreviousPeriodKey(task, todayKey));
}

// En uzun seri (rekor)
export function calculateMaxStreak(task, records) {
  if (task.period === 'ONCE') return 0;
  const sorted = [...records].sort((a, b) => (a.periodKey < b.periodKey ? -1 : 1));
  let max = 0;
  let current = 0;
  for (const rec of sorted) {
    if (rec.status === 'SUCCESSFUL') {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

// Tamamlanma oranı — ALT GÖREV bazlı hesaplama
// Her kayıt için (N = task.subtaskCount):
//   SUCCESSFUL     : pay += N,  payda += N  (tüm alt görevler tam sayılır)
//   FAILED         : pay += clamp(completedSubtasks, 0, N), payda += N
//   PENDING_PARTIAL: pay += c,  payda += c  (c = clamp; kalan alt görevler henüz "yapılmadı" sayılmaz)
//   PENDING / kayıtsız: katkı yok
// rate = round(pay / payda * 100); payda = 0 → rate = null (arayüzde "—")
// Dönüş birimleri ALT GÖREV'dir.  subtaskCount=1 görevlerde dönem = alt görev → eski davranışla birebir uyumlu.
export function calculateCompletionStats(records, subtaskCount = 1) {
  const N = Math.max(1, Math.round(Number(subtaskCount) || 1));
  let pay = 0;
  let payda = 0;

  for (const rec of records) {
    if (rec.status === 'SUCCESSFUL') {
      pay += N;
      payda += N;
    } else if (rec.status === 'FAILED') {
      const c = Math.max(0, Math.min(Math.round(Number(rec.completedSubtasks) || 0), N));
      pay += c;
      payda += N;
    } else if (rec.status === 'PENDING_PARTIAL') {
      const c = Math.max(0, Math.min(Math.round(Number(rec.completedSubtasks) || 0), N));
      pay += c;
      payda += c; // c=0 ise katkı yok
    }
    // PENDING / diğer: katkı yok
  }

  const rate = payda > 0 ? Math.round((pay / payda) * 100) : null;
  return { successCount: pay, failedCount: payda - pay, total: payda, rate };
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
    if (rec && (rec.status === 'SUCCESSFUL' || rec.status === 'FAILED')) {
      if (rec.status === 'SUCCESSFUL') successCount += 1;
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
