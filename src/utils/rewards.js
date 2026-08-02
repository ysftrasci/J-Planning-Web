export const PRIORITY_JP = {
  HIGH: 5,
  MEDIUM: 3,
  LOW: 1,
  ZERO: 0,
};

// Tek seferlik (ONCE) görevler için ayrı bir "zorluk" ölçeği kullanılır —
// bunlar tekrar eden alışkanlıklar değil, bitirilecek işler olduğu için
// Yüksek/Orta/Düşük ÖNCELİK yerine Kolay/Orta/Zor ZORLUK daha uygun.
// Streak/bonus kavramı tek seferlik görevlerde uygulanmaz (tekrar yok).
export const ONCE_DIFFICULTY_JP = {
  EASY: 1,
  MEDIUM: 2,
  HARD: 3,
  ZERO: 0,
};

export const STREAK_BONUS_JP = 2;
export const STREAK_BONUS_INTERVAL = 5; // her 5. günde bir bonus

// currentStreak: bu tamamlamadan SONRAKİ seri sayısı (örn. 5. gün tamamlandıysa 5)
// 5, 10, 15... günlerde bonus tetiklenir.
export function calculateStreakBonus(currentStreakAfterCompletion) {
  if (currentStreakAfterCompletion > 0 && currentStreakAfterCompletion % STREAK_BONUS_INTERVAL === 0) {
    return STREAK_BONUS_JP;
  }
  return 0;
}

export function calculateTaskJP(priority, currentStreakAfterCompletion) {
  const baseJp = PRIORITY_JP[priority] ?? PRIORITY_JP.MEDIUM;
  if (baseJp === 0) {
    return { baseJp: 0, bonus: 0, total: 0 };
  }
  const bonus = calculateStreakBonus(currentStreakAfterCompletion);
  return { baseJp, bonus, total: baseJp + bonus };
}

// Tek seferlik görevler için: sabit JP, hiç bonus yok.
export function calculateOnceTaskJP(difficulty) {
  const baseJp = ONCE_DIFFICULTY_JP[difficulty] ?? ONCE_DIFFICULTY_JP.MEDIUM;
  return { baseJp, bonus: 0, total: baseJp };
}

// Odaklanma seansı JP ödülü (kullanıcı kararı: 30dk=1, 45dk=3, 60dk ve üzeri=5 —
// çok uzun süreler ekstra ödüllendirilmez, çünkü aşırı odaklanmak yerine ara
// sıra mola vermek de önemli).
export function calculateFocusSessionJP(durationMinutes) {
  if (durationMinutes >= 60) return 5;
  if (durationMinutes >= 45) return 3;
  if (durationMinutes >= 30) return 1;
  return 0;
}
