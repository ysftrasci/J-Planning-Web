// J-Planning — Türkçe Ek Uyumu Yardımcısı
// İsmin son sesli ve sessiz harflerine göre yönelme (-e/-a) ve ayrılma (-den/-dan)
// eklerini kesme işaretiyle doğru şekilde üretir.

const FRONT_VOWELS = new Set(['e', 'i', 'ö', 'ü', 'E', 'İ', 'Ö', 'Ü']);
const BACK_VOWELS = new Set(['a', 'ı', 'o', 'u', 'A', 'I', 'O', 'U']);
const ALL_VOWELS = new Set([...FRONT_VOWELS, ...BACK_VOWELS]);
const HARD_CONSONANTS = new Set(['f', 's', 't', 'k', 'ç', 'ş', 'h', 'p', 'F', 'S', 'T', 'K', 'Ç', 'Ş', 'H', 'P']);

function findLastVowel(str) {
  for (let i = str.length - 1; i >= 0; i--) {
    if (ALL_VOWELS.has(str[i])) {
      return str[i];
    }
  }
  return null;
}

/**
 * İsme yönelme hali eki (-e / -a / -ye / -ya) ekler.
 * Örnekler:
 *   Ahmet -> Ahmet'e
 *   Ayşe  -> Ayşe'ye
 *   Murat -> Murat'a
 *   Emre  -> Emre'ye
 *   Deniz -> Deniz'e
 *   Can   -> Can'a
 */
export function appendDativeSuffix(name, fallback = 'Arkadaşına') {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return fallback;
  }
  const clean = name.trim();
  const lastChar = clean[clean.length - 1];
  const lastVowel = findLastVowel(clean);

  const isFront = lastVowel ? FRONT_VOWELS.has(lastVowel) : true;
  const vowelChoice = isFront ? 'e' : 'a';

  if (ALL_VOWELS.has(lastChar)) {
    return `${clean}'y${vowelChoice}`;
  }
  return `${clean}'${vowelChoice}`;
}

/**
 * İsme ayrılma hali eki (-den / -dan / -ten / -tan) ekler.
 * Örnekler:
 *   Ahmet -> Ahmet'ten
 *   Ayşe  -> Ayşe'den
 *   Murat -> Murat'tan
 *   Emre  -> Emre'den
 *   Deniz -> Deniz'den
 *   Can   -> Can'dan
 */
export function appendAblativeSuffix(name, fallback = 'Arkadaşından') {
  if (!name || typeof name !== 'string' || !name.trim()) {
    return fallback;
  }
  const clean = name.trim();
  const lastChar = clean[clean.length - 1];
  const lastVowel = findLastVowel(clean);

  const isFront = lastVowel ? FRONT_VOWELS.has(lastVowel) : true;
  const vowelChoice = isFront ? 'e' : 'a';
  const consonantChoice = HARD_CONSONANTS.has(lastChar) ? 't' : 'd';

  return `${clean}'${consonantChoice}${vowelChoice}n`;
}

/**
 * Sayılara bulunma (-de / -da / -te / -ta / -sinde / -sında) eki getirir.
 * "X'inde / X'ında" veya "X'te / X'de" kalıbı için:
 * Örn: 0'ında, 1'inde, 2'sinde, 3'ünde, 4'ünde, 5'inde, 6'sında, 7'sinde, 8'inde, 9'unda, 10'unda, 20'sinde, vb.
 */
export function formatNumberLocativeSuffix(n) {
  const num = Number(n);
  if (isNaN(num)) return `${n}'de`;

  // Son basamak veya onlar basamağına göre Türkçe okunuş
  const map = {
    0: "0'ında",
    1: "1'inde",
    2: "2'sinde",
    3: "3'ünde",
    4: "4'ünde",
    5: "5'inde",
    6: "6'sında",
    7: "7'sinde",
    8: "8'inde",
    9: "9'unda",
    10: "10'unda",
    20: "20'sinde",
    30: "30'unda",
    40: "40'ında",
    50: "50'sinde",
    60: "60'ında",
    70: "70'inde",
    80: "80'inde",
    90: "90'ında",
    100: "100'ünde",
  };

  if (map[num] !== undefined) {
    return map[num];
  }

  // 11-19, 21-29 gibi ara sayılar için son rakam belirleyicidir
  const lastDigit = num % 10;
  if (lastDigit !== 0) {
    const digitSuffix = {
      1: "'inde",
      2: "'sinde",
      3: "'ünde",
      4: "'ünde",
      5: "'inde",
      6: "'sında",
      7: "'sinde",
      8: "'inde",
      9: "'unda",
    }[lastDigit];
    return `${num}${digitSuffix}`;
  }

  return `${num}'inde`;
}
