const MAX_EDGE = 1920;
const MAX_SHORT = 1080;

/**
 * Reads an image file, re-draws it on a canvas (which discards all EXIF/GPS
 * metadata) and downscales it to max 1080p before returning a JPEG blob.
 */
export async function sanitizeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const scale = Math.min(1, MAX_EDGE / longEdge, MAX_SHORT / shortEdge);
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82),
  );
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("encode");
  return blob;
}
