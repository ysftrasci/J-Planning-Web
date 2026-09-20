// J-Planning Worker — Periyot ve Bitiş Zamanı Hesaplama Yardımcıları
// src/utils/period.js ile %100 uyumludur.

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
    const anchorMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const targetMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    const diffMonths = (targetMonth.getFullYear() - anchorMonth.getFullYear()) * 12 + (targetMonth.getMonth() - anchorMonth.getMonth());
    const periodIndex = Math.floor(diffMonths / intervalValue);
    const periodStart = new Date(anchorMonth.getFullYear(), anchorMonth.getMonth() + periodIndex * intervalValue, 1);
    return toDateStr(periodStart);
  }

  return toDateStr(d);
}

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
