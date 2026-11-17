import type { Page } from '@playwright/test';

/**
 * How much "scenery" a screenshot has: the share of pixels that differ clearly from the pixel
 * 6 px to their right. An empty background scores ~0, a few dots ~1%, a grown scene 5% or more.
 * Cheap, needs no reference image, and does not break when the artwork changes slightly.
 */
export async function sceneryScore(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.drawImage(bmp, 0, 0);
    const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
    let edges = 0;
    let total = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width - 6; x += 2) {
        const i = (y * width + x) * 4;
        const j = i + 24;
        const d =
          Math.abs((data[i] ?? 0) - (data[j] ?? 0)) +
          Math.abs((data[i + 1] ?? 0) - (data[j + 1] ?? 0)) +
          Math.abs((data[i + 2] ?? 0) - (data[j + 2] ?? 0));
        if (d > 36) edges++;
        total++;
      }
    }
    return edges / total;
  }, png.toString('base64'));
}
