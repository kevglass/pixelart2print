import { describe, expect, it } from 'vitest';
import { countFilled, detectScale, EMPTY, extractGrid, looksLikeSolidBackground, reducePalette, removeEdgeBackground } from '../src/pixelArt';
import { SAMPLE_SPRITES, sampleSheet } from '../src/sample';

const filledIn = (rows: string[]) => rows.join('').replace(/\./g, '').length;

describe('pixel art extraction', () => {
  it('sample sprites are rectangular', () => {
    for (const rows of Object.values(SAMPLE_SPRITES)) expect(new Set(rows.map((r) => r.length)).size).toBe(1);
  });

  it('detects the upscale factor', () => {
    expect(detectScale(sampleSheet(10))).toBe(10);
    expect(detectScale(sampleSheet(1))).toBe(1);
    expect(detectScale(sampleSheet(6))).toBe(6);
  });

  it('extracts the grid and palette', () => {
    const grid = extractGrid(sampleSheet(10), 10);
    expect(grid.width).toBe(32);
    expect(grid.height).toBe(17);
    expect(grid.palette.length).toBe(10);
    expect(grid.cells[0]).toBe(EMPTY);
    expect(countFilled(grid)).toBe(filledIn(SAMPLE_SPRITES.pumpkin) + filledIn(SAMPLE_SPRITES.ghost));
  });

  it('removes only the edge-connected background', () => {
    // Opaque 5x5 white image with a black ring enclosing a white centre.
    const rows = ['wwwww', 'wkkkw', 'wkwkw', 'wkkkw', 'wwwww'];
    const data = new Uint8ClampedArray(25 * 4);
    rows.join('').split('').forEach((ch, i) => data.set(ch === 'w' ? [255, 255, 255, 255] : [0, 0, 0, 255], i * 4));
    const grid = extractGrid({ width: 5, height: 5, data }, 1);
    expect(looksLikeSolidBackground(grid)).toBe(true);
    const cut = removeEdgeBackground(grid);
    expect(countFilled(cut)).toBe(9);
    expect(cut.palette.length).toBe(2); // white centre survives
  });

  it('reduces the palette to the most-used colours', () => {
    const grid = extractGrid(sampleSheet(1), 1);
    const reduced = reducePalette(grid, 3);
    expect(reduced.palette.length).toBe(3);
    expect(countFilled(reduced)).toBe(countFilled(grid));
    for (const colour of reduced.palette) expect(grid.palette).toContainEqual(colour);
  });
});
