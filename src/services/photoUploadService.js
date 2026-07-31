// J-Planning — Profil Fotoğrafı İşleme Servisi (Web)
//
// Web ortamında kullanıcının seçtiği resmi HTML5 Canvas ile 120x120 piksellik
// kare formata getirir ve %40 kalitede JPEG Base64 Data URI üretir.
// Firestore'un doküman başına 1MB sınırı olduğu için bu boyut ve kalite
// veri kullanımını birkaç KB civarında tutar.

const TARGET_SIZE = 120;
const COMPRESS_QUALITY = 0.4;

export function processProfilePhoto(fileOrSrc) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = TARGET_SIZE;
        canvas.height = TARGET_SIZE;

        const ctx = canvas.getContext('2d');

        // Kare kırpma hesaplaması
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, TARGET_SIZE, TARGET_SIZE);

        const dataUrl = canvas.toDataURL('image/jpeg', COMPRESS_QUALITY);
        resolve(dataUrl);
      } catch (e) {
        reject(e);
      }
    };

    img.onerror = (err) => {
      reject(new Error('Fotoğraf işlenirken bir hata oluştu.'));
    };

    if (typeof fileOrSrc === 'string') {
      img.src = fileOrSrc;
    } else if (fileOrSrc instanceof File || fileOrSrc instanceof Blob) {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(fileOrSrc);
    } else {
      reject(new Error('Geçersiz fotoğraf kaynağı.'));
    }
  });
}
