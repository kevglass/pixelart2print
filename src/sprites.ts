import { compactPalette, EMPTY, type PixelGrid } from './pixelArt';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Box extends Rect {
  cells: number;
}

// Touching or overlapping, counting boxes that sit edge to edge.
function touches(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
    cells: a.cells + b.cells,
  };
}

/**
 * Bounding boxes (in grid cells) of the separate sprites on a sheet, in
 * reading order. A sprite is an 8-connected group of non-empty cells; groups
 * whose boxes overlap or touch are merged, so detached bits inside a sprite's
 * outline stay with it. Lone stray pixels are ignored.
 */
export function findSprites(grid: PixelGrid): Rect[] {
  const { width: w, height: h, cells } = grid;
  const seen = new Uint8Array(w * h);
  let boxes: Box[] = [];
  const stack: number[] = [];

  for (let start = 0; start < cells.length; start++) {
    if (cells[start] === EMPTY || seen[start]) continue;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i - x) / w;
      count++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (cells[n] === EMPTY || seen[n]) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, cells: count });
  }

  // Merging can make a box grow into one already checked, so repeat until stable.
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; ) {
        if (touches(boxes[i], boxes[j])) {
          boxes[i] = union(boxes[i], boxes[j]);
          boxes.splice(j, 1);
          merged = true;
          j = i + 1;
        } else j++;
      }
    }
  }
  boxes = boxes.filter((b) => b.cells > 1);
  return readingOrder(boxes).map(({ x, y, w, h }) => ({ x, y, w, h }));
}

/** Rows top to bottom (a box joins a row if it starts above the row's lowest edge), then left to right. */
function readingOrder<T extends Rect>(boxes: T[]): T[] {
  const byTop = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: T[][] = [];
  let rowBottom = -Infinity;
  for (const box of byTop) {
    if (!rows.length || box.y >= rowBottom) {
      rows.push([box]);
      rowBottom = box.y + box.h;
    } else {
      rows[rows.length - 1].push(box);
      rowBottom = Math.max(rowBottom, box.y + box.h);
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

/** The cells inside rect (clamped to the grid), with an unused-colour-free palette. */
export function cropGrid(grid: PixelGrid, rect: Rect): PixelGrid {
  const x0 = Math.max(0, Math.min(grid.width - 1, rect.x));
  const y0 = Math.max(0, Math.min(grid.height - 1, rect.y));
  const width = Math.max(1, Math.min(grid.width - x0, rect.w));
  const height = Math.max(1, Math.min(grid.height - y0, rect.h));
  const cells = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    cells.set(grid.cells.subarray((y0 + y) * grid.width + x0, (y0 + y) * grid.width + x0 + width), y * width);
  }
  return compactPalette({ width, height, cells, palette: grid.palette });
}
