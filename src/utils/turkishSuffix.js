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
