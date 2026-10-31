import { deltaE2000, hexToRgb, mixColours, rgbToLab, type Lab, type RGB } from './color';
import { ARMY_PAINTER_PAINTS, type Paint, type PaintRange } from './paints/armyPainter';

export interface PaintChoice {
  paint: Paint;
  rgb: RGB;
  lab: Lab;
}

export interface PaintMatch {
  paint: Paint;
  deltaE: number;
}

export interface MixSuggestion {
  parts: { paint: Paint; parts: number }[];
  result: RGB;
  deltaE: number;
}

export interface MatchOptions {
  ranges: PaintRange[];
  includeMetallics: boolean;
}

export type MatchQuality = 'excellent' | 'good' | 'fair' | 'poor';

export function paintChoices({ ranges, includeMetallics }: MatchOptions): PaintChoice[] {
  return ARMY_PAINTER_PAINTS.filter((p) => ranges.includes(p.range) && (includeMetallics || !p.metallic)).map(
    (paint) => {
      const rgb = hexToRgb(paint.hex);
      return { paint, rgb, lab: rgbToLab(rgb) };
    },
  );
}

// Closest paints first.
export function rankPaints(colour: RGB, choices: PaintChoice[]): PaintMatch[] {
  const lab = rgbToLab(colour);
  return choices
    .map((c) => ({ paint: c.paint, deltaE: deltaE2000(lab, c.lab) }))
    .sort((a, b) => a.deltaE - b.deltaE);
}

export function matchQuality(deltaE: number): MatchQuality {
  if (deltaE < 2) return 'excellent';
  if (deltaE < 5) return 'good';
  if (deltaE < 10) return 'fair';
  return 'poor';
}

const MIX_RATIOS: [number, number][] = [
  [1, 1],
  [2, 1],
  [3, 1],
];

// When no single pot is close, look for a simple two-paint mix that gets
// noticeably nearer. Only pairs from the nearest candidates are considered,
// which keeps it fast and avoids absurd suggestions like "white + black".
export function suggestMix(colour: RGB, choices: PaintChoice[], best: PaintMatch): MixSuggestion | undefined {
  if (best.deltaE < 5) return undefined;
  const lab = rgbToLab(colour);
  const ranked = rankPaints(colour, choices).slice(0, 12);
  const byPaint = new Map(choices.map((c) => [c.paint, c]));
  let bestMix: MixSuggestion | undefined;
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      const a = byPaint.get(ranked[i].paint)!;
      const b = byPaint.get(ranked[j].paint)!;
      for (const [pa, pb] of MIX_RATIOS) {
        for (const [x, y, px, py] of [
          [a, b, pa, pb],
          [b, a, pa, pb],
        ] as const) {
          if (px === py && x === b) continue; // 1:1 is symmetric
          const result = mixColours([x.rgb, y.rgb], [px, py]);
          const deltaE = deltaE2000(lab, rgbToLab(result));
          if (!bestMix || deltaE < bestMix.deltaE) {
            bestMix = {
              parts: [
                { paint: x.paint, parts: px },
                { paint: y.paint, parts: py },
              ],
              result,
              deltaE,
            };
          }
        }
      }
    }
  }
  if (bestMix && bestMix.deltaE < best.deltaE - 2 && bestMix.deltaE < best.deltaE * 0.75) return bestMix;
  return undefined;
}
