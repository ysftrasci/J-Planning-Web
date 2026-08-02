// Periyot (DAILY/WEEKLY/MONTHLY/ONCE) hesaplama yardımcıları.
// Her periyot bir "periodKey" (YYYY-MM-DD) ile temsil edilir:
// - DAILY: o günün tarihi
// - WEEKLY: o haftanın pazartesi tarihi
// - MONTHLY: o ayın 1'i
// - ONCE: görevin oluşturulduğu tarih (tek seferlik, hiç tekrarlanmaz)

export function toDateStr(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseLocalDate(dateStr) {
  if (typeof dateStr === 'string' && dateStr.length >= 10) {
    const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(dateStr);
}

function getMonday(date) {
  const d = date instanceof Date ? date : new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.getFullYear(), d.getMonth(), diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function getPeriodKey(period, date = new Date()) {
  const d = date instanceof Date ? date : parseLocalDate(date);
  if (period === 'WEEKLY') {
    return toDateStr(getMonday(d));
  }
  if (period === 'MONTHLY') {
    const monthlyDate = new Date(d.getFullYear(), d.getMonth(), 1);
    return toDateStr(monthlyDate);
  }
  return toDateStr(d);
}

export function getPreviousPeriodKey(period, currentPeriodKey) {
  const d = parseLocalDate(currentPeriodKey);
  if (period === 'DAILY') {
    d.setDate(d.getDate() - 1);
  } else if (period === 'WEEKLY') {
    d.setDate(d.getDate() - 7);
  } else if (period === 'MONTHLY') {
    d.setMonth(d.getMonth() - 1);
  }
  return getPeriodKey(period, d);
}

// Bir periyodun bitiş zamanını (ms) döndürür — bu zaman geçince görev otomatik FAILED olur.
// ONCE görevlerde bitiş zamanı yoktur (asla otomatik başarısız olmaz) — çok
// uzak bir tarih (pratikte "hiç") döndürülür, processExpiredPeriods bu türü
// zaten ayrıca atladığı için bu değer normalde kullanılmaz.
export function getPeriodEndTimestamp(period, periodKey) {
  if (period === 'ONCE') {
    return Number.MAX_SAFE_INTEGER;
  }
  const d = parseLocalDate(periodKey);
  if (period === 'DAILY') {
    d.setDate(d.getDate() + 1);
  } else if (period === 'WEEKLY') {
    d.setDate(d.getDate() + 7);
  } else if (period === 'MONTHLY') {
    d.setMonth(d.getMonth() + 1);
  }
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 1.5 kuralı: geçmişe dönük düzeltme için 7 günlük (1 hafta) sınır kontrolü.
export function isWithinLateMarkWindow(periodEndTimestamp) {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - periodEndTimestamp <= SEVEN_DAYS_MS;
}

export function periodLabel(period) {
  if (period === 'WEEKLY') return 'Haftalık';
  if (period === 'MONTHLY') return 'Aylık';
  if (period === 'ONCE') return 'Tek Seferlik';
  return 'Günlük';
}
