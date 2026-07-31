// J-Planning — Konfeti Efekti Yardımcısı
import confetti from 'canvas-confetti';

export function triggerConfetti() {
  try {
    confetti({
      particleCount: 70,
      spread: 60,
      origin: { y: 0.7 },
      colors: ['#E06D8C', '#38BDF8', '#10B981', '#F59E0B', '#A855F7'],
      disableForReducedMotion: true,
    });
  } catch (e) {
    // Canvas desteklenmeyen ortamlarda sessizce yut
  }
}
