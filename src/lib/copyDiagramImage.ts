/** Copy rendered diagram visuals (SVG/PNG) to the clipboard as image/png. */

export type CopyDiagramImageResult = "copied" | "downloaded" | "failed";

/** Decode a data: URL into a Blob (used for PlantUML PNG results). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl.trim());
  if (!m) throw new Error("Invalid data URL");
  const mime = m[1] || "application/octet-stream";
  const isBase64 = Boolean(m[2]);
  const data = m[3] ?? "";
  if (isBase64) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(data)], { type: mime });
}

function parseSvgLength(raw: string | null): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.endsWith("%")) return 0;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function resolveSvgSize(svg: SVGSVGElement): { width: number; height: number } {
  let width = parseSvgLength(svg.getAttribute("width"));
  let height = parseSvgLength(svg.getAttribute("height"));

  if ((!width || !height) && svg.viewBox?.baseVal) {
    const vb = svg.viewBox.baseVal;
    if (vb.width > 0 && vb.height > 0) {
      width = width || vb.width;
      height = height || vb.height;
    }
  }

  if (!width || !height) {
    const rect = svg.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      width = width || rect.width;
      height = height || rect.height;
    }
  }

  if (!width || !height) {
    try {
      const box = svg.getBBox();
      if (box.width > 0 && box.height > 0) {
        width = width || box.width;
        height = height || box.height;
      }
    } catch {
      // getBBox can throw for detached / display:none SVGs
    }
  }

  if (!width || !height) {
    throw new Error("Cannot determine SVG size for rasterization");
  }
  return { width, height };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load SVG for rasterization"));
    img.src = url;
  });
}

/** Rasterize an in-DOM SVG element to a PNG blob (2× for sharper paste). */
export async function svgElementToPngBlob(
  svg: SVGSVGElement,
  scale = 2,
): Promise<Blob> {
  const { width, height } = resolveSvgSize(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const xml = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
        "image/png",
      );
    });
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rasterize an already-decoded HTMLImageElement (e.g. PlantUML PNG). */
export async function imageElementToPngBlob(
  img: HTMLImageElement,
): Promise<Blob> {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) throw new Error("Image has no dimensions");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.drawImage(img, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
      "image/png",
    );
  });
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Write a PNG blob via ClipboardItem; returns false if unsupported/denied. */
export async function copyPngBlobToClipboard(blob: Blob): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.write) {
    return false;
  }
  if (typeof ClipboardItem === "undefined") return false;

  const pngBlob =
    blob.type === "image/png"
      ? blob
      : new Blob([await blob.arrayBuffer()], { type: "image/png" });

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": pngBlob }),
    ]);
    return true;
  } catch {
    // Safari often requires a Promise-wrapped blob.
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": Promise.resolve(pngBlob),
        }),
      ]);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Prefer clipboard image/png. If clipboard image write is unavailable,
 * fall back to downloading the PNG so the user still gets the raster.
 */
export async function copyDiagramImage(options: {
  svgElement?: SVGSVGElement | null;
  imageElement?: HTMLImageElement | null;
  pngDataUrl?: string | null;
  pngBlob?: Blob | null;
  downloadName?: string;
}): Promise<CopyDiagramImageResult> {
  try {
    let blob: Blob | null = options.pngBlob ?? null;

    if (!blob && options.pngDataUrl) {
      blob = dataUrlToBlob(options.pngDataUrl);
      if (blob.type !== "image/png") {
        blob = new Blob([await blob.arrayBuffer()], { type: "image/png" });
      }
    }

    if (!blob && options.imageElement) {
      blob = await imageElementToPngBlob(options.imageElement);
    }

    if (!blob && options.svgElement) {
      blob = await svgElementToPngBlob(options.svgElement);
    }

    if (!blob) return "failed";

    if (await copyPngBlobToClipboard(blob)) return "copied";

    triggerBlobDownload(blob, options.downloadName ?? "diagram.png");
    return "downloaded";
  } catch {
    return "failed";
  }
}
