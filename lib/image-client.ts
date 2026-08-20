// Browser-side image downscaling for the scan pipeline.
//
// Lives here rather than inside a component because two screens now feed the
// same /api/ocr endpoint: the batch uploader and the "already scanned?" check.
// Shrinking before the POST keeps the request small on a phone connection; the
// server re-shrinks with sharp regardless, so this is a bandwidth guard, not a
// correctness one.

const MAX_DIM = 1568;

async function bufferToBase64(buf: ArrayBuffer): Promise<string> {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Non-images (PDFs) pass through untouched — only their bytes are encoded.
export async function resizeToBase64(
  file: File,
): Promise<{ base64: string; mediaType: string }> {
  if (!file.type.startsWith("image/")) {
    return { base64: await bufferToBase64(await file.arrayBuffer()), mediaType: file.type || "application/octet-stream" };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("image decode failed"));
      i.src = url;
    });
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas 2d unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob>((res, rej) =>
      c.toBlob(
        (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
        "image/jpeg",
        0.85,
      ),
    );
    return { base64: await bufferToBase64(await blob.arrayBuffer()), mediaType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}
