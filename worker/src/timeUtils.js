// J-Planning Worker — Saat dilimi yardımcıları
// Bildirim zamanlamaları ve günlük hatırlatıcı kullanıcının kendi saat dilimine göre çalışır.
// Worker UTC'de çalıştığı için "yerel saat → UTC an" dönüşümleri burada yapılır.

export const DEFAULT_TIME_ZONE = 'Europe/Istanbul';

const formatterCache = new Map();

function getFormatter(timeZone) {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** Geçersiz / boş saat dilimi gelirse varsayılana (Türkiye) döner. */
export function normalizeTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) return DEFAULT_TIME_ZONE;
  try {
    getFormatter(timeZone);
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** Verilen UTC anın o saat dilimindeki takvim parçaları. */
export function getZonedParts(ms, timeZone) {
  const parts = {};
  for (const p of getFormatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Saat diliminin o andaki UTC farkı (ms). Türkiye için +3 saat. */
export function getTimeZoneOffsetMs(ms, timeZone) {
  const p = getZonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Yerel takvim saati (y, m: 1-12, d, h, mi) → UTC an (ms). Yaz saati geçişleri için iki tur düzeltir. */
export function zonedTimeToUtcMs(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = getTimeZoneOffsetMs(guess, timeZone);
  let ms = guess - offset1;
  const offset2 = getTimeZoneOffsetMs(ms, timeZone);
  if (offset2 !== offset1) ms = guess - offset2;
  return ms;
}

/**
 * weekdays: 1 = Pazar ... 7 = Cumartesi (istemcideki WEEKDAYS ile aynı).
 * afterMs'den SONRAKİ ilk uygun anı (UTC ms) döndürür; uygun gün yoksa null.
 */
export function computeNextWeeklyFireAt(weekdays, hour, minute, timeZone, afterMs) {
  const days = Array.isArray(weekdays) ? weekdays : [];
  if (days.length === 0) return null;
  const today = getZonedParts(afterMs, timeZone);
  for (let i = 0; i <= 7; i++) {
    const cal = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    const weekday = cal.getUTCDay() + 1;
    if (!days.includes(weekday)) continue;
    const at = zonedTimeToUtcMs(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), hour, minute, timeZone);
    if (at > afterMs) return at;
  }
  return null;
}

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/** Her gün hour:00 için afterMs'den sonraki ilk an. */
export function computeNextDailyFireAt(hour, timeZone, afterMs) {
  return computeNextWeeklyFireAt(ALL_DAYS, hour, 0, timeZone, afterMs);
}
