/**
 * Client-side image compression for AI vision requests.
 *
 * Every image is drawn to a canvas and exported as JPEG. This guarantees a
 * small payload regardless of source format (PNG, BMP, HEIC) or file size.
 * Images larger than MAX_DIM are scaled down proportionally first.
 *
 * Why always compress: the bug trigger is total JSON body size, not pixels.
 * A 1200×800 PNG at 5 MB would pass a pixel-only check but still break the
 * request on mobile devices.
 */

const AI_IMAGE_MAX_DIM = 1536;
const AI_IMAGE_QUALITY = 0.8;

/**
 * Compress (and optionally resize) an image file for AI vision.
 * Always returns a JPEG data URL — typically 100-400 KB per image.
 */
export function resizeImageForAi(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;

      let targetW = width;
      let targetH = height;

      if (width > AI_IMAGE_MAX_DIM || height > AI_IMAGE_MAX_DIM) {
        const scale = AI_IMAGE_MAX_DIM / Math.max(width, height);
        targetW = Math.round(width * scale);
        targetH = Math.round(height * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        // Canvas unavailable — fall back to raw file
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
        return;
      }

      ctx.drawImage(img, 0, 0, targetW, targetH);
      resolve(canvas.toDataURL('image/jpeg', AI_IMAGE_QUALITY));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };

    img.src = url;
  });
}
