export const compressImage = (file: File, maxDim: number = 2048, quality: number = 0.85): Promise<{ blob: Blob; width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let width = img.width;
      let height = img.height;
      
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas not supported"));
      
      // EXIF is automatically stripped when drawing to canvas
      ctx.drawImage(img, 0, 0, width, height);
      
      // Defaulting to webp for better compression, fallback to jpeg
      canvas.toBlob((blob) => {
        if (blob) {
          resolve({ blob, width, height });
        } else {
          // Fallback to jpeg if webp fails
          canvas.toBlob((blob2) => {
            if (blob2) resolve({ blob: blob2, width, height });
            else reject(new Error("Compression failed"));
          }, "image/jpeg", quality);
        }
      }, "image/webp", quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Image load failed"));
    };
    img.src = objectUrl;
  });
};
