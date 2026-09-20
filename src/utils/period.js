// Periyot (DAILY/WEEKLY/MONTHLY/ONCE) ve esnek aralık (intervalValue) hesaplama yardımcıları.
// Her periyot bir "periodKey" (YYYY-MM-DD) ile temsil edilir:
// - DAILY: o günün tarihi (intervalValue > 1 ise, createdAt çapasına göre periyodun başlangıç günü)
// - WEEKLY: o haftanın pazartesi tarihi (intervalValue > 1 ise, createdAt haftasının pazartesisine göre periyodun başlangıç haftası)
// - MONTHLY: o ayın 1'i (intervalValue > 1 ise, createdAt ayına göre N ayda bir 1. gün)
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

export function getMonday(date) {
  const d = date instanceof Date ? date : new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.getFullYear(), d.getMonth(), diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Hem task nesnesini hem de string/sayı parametrelerini destekleyen ortak ayrıştırıcı.
 */
export function parsePeriodConfig(periodOrTask, intervalParam = 1, anchorParam = null) {
  if (typeof periodOrTask === 'object' && periodOrTask !== null) {
    return {
      period: periodOrTask.period || 'DAILY',
      intervalValue: Math.max(1, parseInt(periodOrTask.intervalValue, 10) || 1),
      anchorDate: periodOrTask.createdAt ? new Date(periodOrTask.createdAt) : null,
    };
  }
  return {
    period: periodOrTask || 'DAILY',
    intervalValue: Math.max(1, parseInt(intervalParam, 10) || 1),
    anchorDate: anchorParam ? new Date(anchorParam) : null,
  };
}

export function getPeriodKey(periodOrTask, date = new Date()) {
  const { period, intervalValue, anchorDate } = parsePeriodConfig(periodOrTask);
  if (period === 'ONCE') {
    return 'ONCE';
  }
  const d = date instanceof Date ? date : parseLocalDate(date);

  // Standart (intervalValue = 1) veya çapa tarihi olmayan durum:
  // Mevcut hızlı hesaplama mantığıyla %100 uyumludur
  if (intervalValue <= 1 || !anchorDate) {
    if (period === 'WEEKLY') {
      return toDateStr(getMonday(d));
    }
    if (period === 'MONTHLY') {
      const monthlyDate = new Date(d.getFullYear(), d.getMonth(), 1);
      return toDateStr(monthlyDate);
    }
    return toDateStr(d);
  }

  // intervalValue > 1 ve anchorDate mevcut:
  if (period === 'DAILY') {
    const anchorMidnight = parseLocalDate(toDateStr(anchorDate));
    const targetMidnight = parseLocalDate(toDateStr(d));
    const diffDays = Math.round((targetMidnight.getTime() - anchorMidnight.getTime()) / (24 * 60 * 60 * 1000));
    const periodIndex = Math.floor(diffDays / intervalValue);
    const periodStart = new Date(anchorMidnight.getTime() + periodIndex * intervalValue * 24 * 60 * 60 * 1000);
    return toDateStr(periodStart);
  }

  if (period === 'WEEKLY') {
    const anchorMonday = getMonday(anchorDate);
    const targetMonday = getMonday(d);
    const diffWeeks = Math.round((targetMonday.getTime() - anchorMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const periodIndex = Math.floor(diffWeeks / intervalValue);
    const periodStart = new Date(anchorMonday.getTime() + periodIndex * intervalValue * 7 * 24 * 60 * 60 * 1000);
    return toDateStr(periodStart);
  }

  if (period === 'MONTHLY') {
    // Ay hesabı: 28-31 gün dalgalanmalarından etkilenmemek için ayın 1. günleri referans alınır.
    const anchorMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const targetMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    const diffMonths = (targetMonth.getFullYear() - anchorMonth.getFullYear()) * 12 + (targetMonth.getMonth() - anchorMonth.getMonth());
    const periodIndex = Math.floor(diffMonths / intervalValue);
    const periodStart = new Date(anchorMonth.getFullYear(), anchorMonth.getMonth() + periodIndex * intervalValue, 1);
    return toDateStr(periodStart);
  }

  return toDateStr(d);
}

export function getPreviousPeriodKey(periodOrTask, currentPeriodKey) {
  const config = parsePeriodConfig(periodOrTask);
  const { period, intervalValue } = config;
  if (period === 'ONCE') return 'ONCE';

  const d = parseLocalDate(currentPeriodKey);
  if (period === 'DAILY') {
    d.setDate(d.getDate() - intervalValue);
  } else if (period === 'WEEKLY') {
    d.setDate(d.getDate() - (intervalValue * 7));
  } else if (period === 'MONTHLY') {
    d.setMonth(d.getMonth() - intervalValue);
  }

  return getPeriodKey(periodOrTask, d);
}

// Bir periyodun bitiş zamanını (ms) döndürür — bu zaman geçince görev otomatik FAILED olur.
export function getPeriodEndTimestamp(periodOrTask, periodKey) {
  const { period, intervalValue } = parsePeriodConfig(periodOrTask);
  if (period === 'ONCE') {
    return Number.MAX_SAFE_INTEGER;
  }
  const d = parseLocalDate(periodKey);
  if (period === 'DAILY') {
    d.setDate(d.getDate() + intervalValue);
  } else if (period === 'WEEKLY') {
    d.setDate(d.getDate() + (intervalValue * 7));
  } else if (period === 'MONTHLY') {
    d.setMonth(d.getMonth() + intervalValue);
  }
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 1.5 kuralı: geçmişe dönük düzeltme için 7 günlük (1 hafta) sınır kontrolü.
export function isWithinLateMarkWindow(periodEndTimestamp) {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - periodEndTimestamp <= SEVEN_DAYS_MS;
}

export function periodLabel(periodOrTask, intervalValueParam = 1) {
  const { period, intervalValue } = parsePeriodConfig(periodOrTask, intervalValueParam);
  if (period === 'ONCE') return 'Tek Seferlik';
  if (intervalValue === 1) {
    if (period === 'WEEKLY') return 'Haftalık';
    if (period === 'MONTHLY') return 'Aylık';
    return 'Günlük';
  }
  if (period === 'WEEKLY') return `Her ${intervalValue} haftada bir`;
  if (period === 'MONTHLY') return `Her ${intervalValue} ayda bir`;
  return `Her ${intervalValue} günde bir`;
}

export function formatPeriodFrequency(periodOrTask, subtaskCount = 1) {
  const { period, intervalValue } = parsePeriodConfig(periodOrTask);
  const count = Math.max(1, Number(subtaskCount) || 1);
  if (period === 'ONCE') return 'Tek seferlik';
  const countStr = `${count} kez`;
  if (intervalValue === 1) {
    if (period === 'WEEKLY') return `Her hafta ${countStr}`;
    if (period === 'MONTHLY') return `Her ay ${countStr}`;
    return `Her gün ${countStr}`;
  }
  if (period === 'WEEKLY') return `Her ${intervalValue} haftada ${countStr}`;
  if (period === 'MONTHLY') return `Her ${intervalValue} ayda ${countStr}`;
  return `Her ${intervalValue} günde ${countStr}`;
}
