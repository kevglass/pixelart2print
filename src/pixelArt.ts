import { rgbToLab, type Lab, type RGB } from './color';

// Structurally compatible with the DOM's ImageData so it can be used in tests.
export interface ImageLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export const EMPTY = -1;

export interface PixelGrid {
  width: number;
  height: number;
  /** Palette index per cell, row-major from the top-left, or EMPTY. */
  cells: Int32Array;
  palette: RGB[];
}

const ALPHA_THRESHOLD = 128;

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function pixelId(data: Uint8ClampedArray, i: number): number {
  // All transparent pixels count as the same "colour" regardless of RGB.
  if (data[i + 3] < ALPHA_THRESHOLD) return -1;
  return (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
}

/**
 * Pixel art is often shared upscaled (each art pixel drawn as an NxN block).
 * Every run of identical pixels along a row or column is then a multiple of N,
 * so the GCD of all run lengths recovers N. Returns 1 for unscaled art (or
 * anything noisy, like a JPEG).
 */
export function detectScale(img: ImageLike): number {
  const { width, height, data } = img;
  let g = 0;
  const addRun = (len: number) => {
    g = gcd(g, len);
  };
  for (let y = 0; y < height && g !== 1; y++) {
    let run = 1;
    for (let x = 1; x < width; x++) {
      if (pixelId(data, (y * width + x) * 4) === pixelId(data, (y * width + x - 1) * 4)) run++;
      else {
        addRun(run);
        run = 1;
      }
    }
    addRun(run);
  }
  for (let x = 0; x < width && g !== 1; x++) {
    let run = 1;
    for (let y = 1; y < height; y++) {
      if (pixelId(data, (y * width + x) * 4) === pixelId(data, ((y - 1) * width + x) * 4)) run++;
      else {
        addRun(run);
        run = 1;
      }
    }
    addRun(run);
  }
  return Math.max(1, g);
}

/** Sample the image into a grid of art pixels, taking the most common colour in each block. */
export function extractGrid(img: ImageLike, scale: number): PixelGrid {
  const { data } = img;
  const width = Math.max(1, Math.floor(img.width / scale));
  const height = Math.max(1, Math.floor(img.height / scale));
  const cells = new Int32Array(width * height);
  const palette: RGB[] = [];
  const paletteIndex = new Map<number, number>();
  const counts = new Map<number, number>();

  for (let gy = 0; gy < height; gy++) {
    for (let gx = 0; gx < width; gx++) {
      counts.clear();
      for (let y = gy * scale; y < Math.min((gy + 1) * scale, img.height); y++) {
        for (let x = gx * scale; x < Math.min((gx + 1) * scale, img.width); x++) {
          const id = pixelId(data, (y * img.width + x) * 4);
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      let bestId = -1;
      let bestCount = -1;
      for (const [id, n] of counts) {
        if (n > bestCount) {
          bestId = id;
          bestCount = n;
        }
      }
      if (bestId === -1) {
        cells[gy * width + gx] = EMPTY;
        continue;
      }
      let idx = paletteIndex.get(bestId);
      if (idx === undefined) {
        idx = palette.length;
        paletteIndex.set(bestId, idx);
        palette.push({ r: (bestId >> 16) & 255, g: (bestId >> 8) & 255, b: bestId & 255 });
      }
      cells[gy * width + gx] = idx;
    }
  }
  return { width, height, cells, palette };
}

export function countFilled(grid: PixelGrid): number {
  let n = 0;
  for (const c of grid.cells) if (c !== EMPTY) n++;
  return n;
}

export function hasTransparency(grid: PixelGrid): boolean {
  return grid.cells.some((c) => c === EMPTY);
}

/** True when the art looks like it sits on a solid background colour (no transparency, matching corners). */
export function looksLikeSolidBackground(grid: PixelGrid): boolean {
  if (hasTransparency(grid)) return false;
  const { width: w, height: h, cells } = grid;
  const corners = [cells[0], cells[w - 1], cells[(h - 1) * w], cells[h * w - 1]];
  return corners.every((c) => c === corners[0]);
}

/**
 * Remove the background: the top-left pixel's colour, flood-filled from the
 * image edges. Using a flood fill rather than removing the colour everywhere
 * keeps, say, white eyes on a white background.
 */
export function removeEdgeBackground(grid: PixelGrid): PixelGrid {
  const { width: w, height: h } = grid;
  const cells = grid.cells.slice();
  const bg = cells[0];
  if (bg === EMPTY) return grid;
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (cells[i] !== bg) return;
    cells[i] = EMPTY;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return compactPalette({ ...grid, cells });
}

/** Drop palette entries no cell uses. */
export function compactPalette(grid: PixelGrid): PixelGrid {
  const remap = new Map<number, number>();
  const palette: RGB[] = [];
  const cells = grid.cells.map((c) => {
    if (c === EMPTY) return EMPTY;
    let idx = remap.get(c);
    if (idx === undefined) {
      idx = palette.length;
      remap.set(c, idx);
      palette.push(grid.palette[c]);
    }
    return idx;
  });
  return { ...grid, cells, palette };
}

function labDist2(a: Lab, b: Lab): number {
  return (a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2;
}

/**
 * Reduce to at most maxColours using weighted k-means in Lab space. Each
 * cluster is represented by its most-used original colour rather than an
 * average, so the result keeps the artist's actual colours.
 */
export function reducePalette(grid: PixelGrid, maxColours: number): PixelGrid {
  const n = grid.palette.length;
  if (n <= maxColours) return grid;

  const counts = new Array<number>(n).fill(0);
  for (const c of grid.cells) if (c !== EMPTY) counts[c]++;
  const labs = grid.palette.map(rgbToLab);

  // Deterministic farthest-first seeding, weighted so that stray
  // anti-aliasing pixels don't each grab a cluster.
  const centres: Lab[] = [];
  let first = 0;
  for (let i = 1; i < n; i++) if (counts[i] > counts[first]) first = i;
  centres.push({ ...labs[first] });
  const minDist = labs.map((l) => labDist2(l, labs[first]));
  while (centres.length < maxColours) {
    let pick = -1;
    let bestScore = 0;
    for (let i = 0; i < n; i++) {
      const score = minDist[i] * Math.sqrt(counts[i]);
      if (score > bestScore) {
        bestScore = score;
        pick = i;
      }
    }
    if (pick < 0) break;
    centres.push({ ...labs[pick] });
    for (let i = 0; i < n; i++) minDist[i] = Math.min(minDist[i], labDist2(labs[i], labs[pick]));
  }

  const assign = new Array<number>(n).fill(0);
  for (let iter = 0; iter < 25; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      for (let k = 1; k < centres.length; k++) {
        if (labDist2(labs[i], centres[k]) < labDist2(labs[i], centres[best])) best = k;
      }
      if (best !== assign[i]) {
        assign[i] = best;
        changed = true;
      }
    }
    if (!changed && iter > 0) break;
    centres.forEach((centre, k) => {
      let w = 0;
      const acc = { L: 0, a: 0, b: 0 };
      for (let i = 0; i < n; i++) {
        if (assign[i] !== k) continue;
        w += counts[i];
        acc.L += labs[i].L * counts[i];
        acc.a += labs[i].a * counts[i];
        acc.b += labs[i].b * counts[i];
      }
      if (w > 0) {
        centre.L = acc.L / w;
        centre.a = acc.a / w;
        centre.b = acc.b / w;
      }
    });
  }

  // Represent each cluster by its most-used member colour.
  const representative = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const r = representative.get(assign[i]);
    if (r === undefined || counts[i] > counts[r]) representative.set(assign[i], i);
  }
  const cells = grid.cells.map((c) => (c === EMPTY ? EMPTY : representative.get(assign[c])!));
  return compactPalette({ ...grid, cells });
}
