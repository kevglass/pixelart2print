import { rgbToLab, type RGB } from './color';
import { rankPaints, suggestMix, type MixSuggestion, type PaintChoice, type PaintMatch } from './paintMatch';
import type { Paint } from './paints/armyPainter';
import { EMPTY, type PixelGrid } from './pixelArt';

export interface PaintGroup {
  /** 1-based number used on the chart, in painting order. */
  number: number;
  paint: Paint;
  /** The art colours this paint stands in for, most-used first. */
  sourceColours: RGB[];
  /** Match distance for the most-used source colour. */
  deltaE: number;
  pixelCount: number;
  alternatives: PaintMatch[];
  mix?: MixSuggestion;
}

export interface PaintPlan {
  width: number;
  height: number;
  /** Index into groups per cell, or EMPTY. */
  cells: Int32Array;
  groups: PaintGroup[];
  primer: { name: string; reason: string };
}

/**
 * Match each art colour to its nearest paint and group colours that share a
 * paint. Groups are numbered lightest first: light paints cover poorly, and
 * any overspill is then hidden by the darker colours painted afterwards.
 */
export function buildPaintPlan(grid: PixelGrid, choices: PaintChoice[]): PaintPlan {
  const counts = new Array<number>(grid.palette.length).fill(0);
  for (const c of grid.cells) if (c !== EMPTY) counts[c]++;

  const ranked = grid.palette.map((colour) => rankPaints(colour, choices));
  const byPaint = new Map<Paint, number[]>();
  ranked.forEach((r, i) => byPaint.set(r[0].paint, [...(byPaint.get(r[0].paint) ?? []), i]));

  const unordered = [...byPaint].map(([paint, colours]) => {
    colours.sort((a, b) => counts[b] - counts[a]);
    const main = colours[0];
    return {
      paint,
      sourceColours: colours.map((i) => grid.palette[i]),
      deltaE: ranked[main][0].deltaE,
      pixelCount: colours.reduce((s, i) => s + counts[i], 0),
      alternatives: ranked[main].slice(1, 3),
      // A mix only makes sense when the paint stands in for a single colour.
      mix: colours.length === 1 ? suggestMix(grid.palette[main], choices, ranked[main][0]) : undefined,
      lightness: rgbToLab(grid.palette[main]).L,
    };
  });
  unordered.sort((a, b) => b.lightness - a.lightness);

  const groupOfPaint = new Map(unordered.map((g, i) => [g.paint, i]));
  const cells = grid.cells.map((c) => (c === EMPTY ? EMPTY : groupOfPaint.get(ranked[c][0].paint)!));
  const groups: PaintGroup[] = unordered.map((g, i) => ({
    number: i + 1,
    paint: g.paint,
    sourceColours: g.sourceColours,
    deltaE: g.deltaE,
    pixelCount: g.pixelCount,
    alternatives: g.alternatives,
    mix: g.mix,
  }));

  return { width: grid.width, height: grid.height, cells, groups, primer: choosePrimer(grid, counts) };
}

// Army Painter Colour Primer sprays. Prime close to the overall value of the
// art so thin coats cover well.
function choosePrimer(grid: PixelGrid, counts: number[]): PaintPlan['primer'] {
  let total = 0;
  let sum = 0;
  grid.palette.forEach((c, i) => {
    sum += rgbToLab(c).L * counts[i];
    total += counts[i];
  });
  const avg = total ? sum / total : 50;
  if (avg >= 62) return { name: 'Colour Primer – Matt White', reason: 'the art is mostly light colours' };
  if (avg <= 35) return { name: 'Colour Primer – Matt Black', reason: 'the art is mostly dark colours' };
  return { name: 'Colour Primer – Uniform Grey', reason: 'the art mixes light and dark colours' };
}
