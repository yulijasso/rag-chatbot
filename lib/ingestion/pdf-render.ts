import "server-only";

import { PDFiumLibrary } from "@hyzyla/pdfium";
import sharp from "sharp";

// Reuse the (WASM) library across warm invocations — init costs ~60ms.
let libPromise: ReturnType<typeof PDFiumLibrary.init> | null = null;
function getLibrary() {
  if (!libPromise) {
    libPromise = PDFiumLibrary.init();
  }
  return libPromise;
}

/** Render one page (1-indexed) of a PDF buffer to a WebP image. */
export async function renderPageWebp(
  pdf: ArrayBuffer,
  pageNumber: number,
  scale = 2
): Promise<{ data: Buffer; width: number; height: number }> {
  const lib = await getLibrary();
  const doc = await lib.loadDocument(new Uint8Array(pdf));
  try {
    const page = doc.getPage(pageNumber - 1);
    const out = await page.render({
      scale,
      render: async ({ width, height, data }) => {
        // pdfium returns BGRA; swap B/R so sharp reads it as RGBA.
        for (let i = 0; i < data.length; i += 4) {
          const b = data[i];
          data[i] = data[i + 2];
          data[i + 2] = b;
        }
        return sharp(Buffer.from(data), {
          raw: { width, height, channels: 4 },
        })
          .webp({ quality: 80 })
          .toBuffer();
      },
    });
    return {
      data: Buffer.from(out.data),
      width: out.width,
      height: out.height,
    };
  } finally {
    doc.destroy();
  }
}

export type Word = { s: string; x: number; y: number; w: number; h: number };
export type PageWords = { width: number; height: number; words: Word[] };

/**
 * Extract a page's text as words with normalized (0..1) bounding boxes, using
 * unpdf's serverless pdf.js. Coordinates are normalized so the client can
 * overlay highlights on the rendered image at any display size.
 */
export async function extractPageWords(
  pdf: ArrayBuffer,
  pageNumber: number
): Promise<PageWords> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const page = await doc.getPage(pageNumber);
  // The viewport transform accounts for the page's CropBox offset, y-flip and
  // rotation — so highlights line up with the rendered image on any page,
  // including cropped/rotated textbook pages. We just normalize by its size.
  const viewport = page.getViewport({ scale: 1 });
  const pw = viewport.width;
  const ph = viewport.height;
  const tc = await page.getTextContent();

  const words: Word[] = [];
  for (const it of tc.items) {
    const item = it as {
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
    };
    if (!item.str || !item.transform) {
      continue;
    }
    const tx = item.transform;
    const fontH = Math.hypot(tx[1], tx[3]) || item.height || 0;
    const wpt = item.width ?? 0;
    // Map the glyph box (ascender..descender) from PDF space to image space.
    const [ax, ay] = viewport.convertToViewportPoint(tx[4], tx[5] + fontH);
    const [bx, by] = viewport.convertToViewportPoint(
      tx[4] + wpt,
      tx[5] - fontH * 0.22
    );
    const left = Math.min(ax, bx);
    const top = Math.min(ay, by);
    words.push({
      s: item.str,
      x: left / pw,
      y: top / ph,
      w: Math.abs(bx - ax) / pw,
      h: Math.abs(by - ay) / ph,
    });
  }
  return { width: pw, height: ph, words };
}

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Box the text items covered by any passage (normalized coordinates).
 *
 * PDF text items are typically whole lines/runs. A passage (a retrieved chunk)
 * spans many of them, and the stored chunk text never exactly equals the page's
 * text-layer concatenation (bullets, spacing, ligatures differ). So rather than
 * requiring a contiguous substring match, we highlight every line item whose
 * text is contained in a passage — robust across those extraction differences.
 */
export function matchRects(words: Word[], passages: string[]): Rect[] {
  const norms = passages
    .map((p) => p.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  if (norms.length === 0) {
    return [];
  }

  const rects: Rect[] = [];
  for (const w of words) {
    const s = w.s.replace(/\s+/g, " ").trim().toLowerCase();
    // Skip tiny tokens to avoid highlighting stray common words.
    if (s.length < 5) {
      continue;
    }
    if (norms.some((n) => n.includes(s))) {
      rects.push({ x: w.x, y: w.y, w: w.w, h: w.h });
    }
  }
  return rects;
}
