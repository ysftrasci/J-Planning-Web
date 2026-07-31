// J-Planning — Odaklanma Modu Ses Servisi (Web)
//
// Web için HTML5 Audio API kullanılıyor. Kullanıcı bir arka plan sesi seçerse,
// o ses döngü halinde (loop) çalar; "Ses Yok" seçilirse hiçbir şey çalınmaz.
// Ses dosyaları public/assets/sounds/ klasöründe bulunur. Bir dosya eksikse
// veya tarayıcı oynatma hatası verirse sessizce devam eder (zamanlayıcıyı engellemez).

const SOUND_PATHS = {
  white_noise: '/assets/sounds/white-noise.mp3',
  summer_night_camp: '/assets/sounds/summer-night-camp.mp3',
  ocean_waves: '/assets/sounds/ocean-waves.mp3',
  rain: '/assets/sounds/rain.mp3',
  budgie: '/assets/sounds/budgie.mp3',
  fireplace: '/assets/sounds/fireplace.mp3',
};

let currentAudio = null;

export async function playFocusSound(soundKey) {
  await stopFocusSound();
  if (!soundKey || soundKey === 'none') return;

  const path = SOUND_PATHS[soundKey];
  if (!path) return;

  try {
    const audio = new Audio(path);
    audio.loop = true;
    audio.volume = 0.7;
    currentAudio = audio;
    await audio.play().catch(() => {
      // Dosya eksikse veya otogörsel/otomatik oynatma engeline takılırsa
      // sessizce yutulur.
      currentAudio = null;
    });
  } catch (e) {
    currentAudio = null;
  }
}

export async function stopFocusSound() {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch (e) {
      // Yoksay
    }
    currentAudio = null;
  }
}

export function isFocusSoundAvailable(soundKey) {
  return !!SOUND_PATHS[soundKey];
}
