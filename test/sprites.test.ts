import { describe, expect, it } from 'vitest';
import { countFilled, EMPTY, extractGrid, type PixelGrid } from '../src/pixelArt';
import { SAMPLE_SPRITES, sampleSheet } from '../src/sample';
import { cropGrid, findSprites } from '../src/sprites';

function gridFrom(rows: string[]): PixelGrid {
  const keys = [...new Set(rows.join('').replace(/\./g, ''))];
  const cells = new Int32Array([...rows.join('')].map((ch) => (ch === '.' ? EMPTY : keys.indexOf(ch))));
  return { width: rows[0].length, height: rows.length, cells, palette: keys.map((_, i) => ({ r: i, g: 0, b: 0 })) };
}

describe('sprite sheets', () => {
  it('finds the sprites on the sample sheet', () => {
    const sheet = extractGrid(sampleSheet(10), 10);
    expect(findSprites(sheet)).toEqual([
      { x: 1, y: 1, w: 16, h: 15 },
      { x: 19, y: 2, w: 12, h: 13 },
    ]);
  });

  it('keeps detached bits inside a sprite and orders sprites in rows', () => {
    const sprites = findSprites(
      gridFrom([
        'aaa...bb..',
        'a.a...bb..',
        'aca.......',
        'aaa..d....',
        '.........x',
        'ee....ff..',
        'ee....ff..',
      ]),
    );
    expect(sprites).toEqual([
      { x: 0, y: 0, w: 3, h: 4 }, // 'c' sits inside 'a'
      { x: 6, y: 0, w: 2, h: 2 },
      { x: 0, y: 5, w: 2, h: 2 },
      { x: 6, y: 5, w: 2, h: 2 },
    ]); // lone 'd' and 'x' pixels are dropped
  });

  it('returns nothing for a grid with no sprites', () => {
    expect(findSprites(gridFrom(['...', '...']))).toEqual([]);
  });

  it('crops to a rectangle and drops unused colours', () => {
    const sheet = extractGrid(sampleSheet(1), 1);
    const ghost = cropGrid(sheet, { x: 19, y: 2, w: 12, h: 13 });
    expect(ghost.width).toBe(12);
    expect(ghost.height).toBe(13);
    expect(ghost.palette).toHaveLength(3);
    expect(countFilled(ghost)).toBe(SAMPLE_SPRITES.ghost.join('').replace(/\./g, '').length);
  });

  it('clamps crops to the grid', () => {
    const crop = cropGrid(gridFrom(['ab', 'cd']), { x: 1, y: 1, w: 5, h: 5 });
    expect(crop.width).toBe(1);
    expect(crop.height).toBe(1);
  });
});
