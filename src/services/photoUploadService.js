// J-Planning — Profil Fotoğrafı İşleme Servisi (Web)
//
// Web ortamında kullanıcının seçtiği resmi HTML5 Canvas ile 120x120 piksellik
// kare formata getirir ve %40 kalitede JPEG Base64 Data URI üretir.
// Firestore'un doküman başına 1MB sınırı olduğu için bu boyut ve kalite
// veri kullanımını birkaç KB civarında tutar.

const TARGET_SIZE = 120;
const COMPRESS_QUALITY = 0.4;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export function validatePhotoFile(file) {
  if (!file) {
    return { valid: false, error: 'Fotoğraf dosyası seçilmedi.' };
  }
  if (file instanceof File || file instanceof Blob) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        error: 'Fotoğraf boyutu çok büyük (Maksimum 10MB yükleyebilirsiniz).',
      };
    }
    if (file.type && !file.type.startsWith('image/')) {
      return {
        valid: false,
        error: 'Lütfen geçerli bir resim dosyası seçin (JPG, PNG, WebP vb.).',
      };
    }
  }
  return { valid: true };
}

export function processProfilePhoto(fileOrSrc) {
  return new Promise((resolve, reject) => {
    if (fileOrSrc instanceof File || fileOrSrc instanceof Blob) {
      const check = validatePhotoFile(fileOrSrc);
      if (!check.valid) {
        return reject(new Error(check.error));
      }
    }

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

    img.onerror = () => {
      reject(new Error('Seçilen resim dosyası okunamadı veya biçimi bozuk.'));
    };

    if (typeof fileOrSrc === 'string') {
      img.src = fileOrSrc;
    } else if (fileOrSrc instanceof File || fileOrSrc instanceof Blob) {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target.result;
      };
      reader.onerror = () => {
        reject(new Error('Dosya okunurken bir hata oluştu.'));
      };
      reader.readAsDataURL(fileOrSrc);
    } else {
      reject(new Error('Geçersiz fotoğraf kaynağı.'));
    }
  });
}
