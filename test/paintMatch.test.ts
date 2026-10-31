import { describe, expect, it } from 'vitest';
import { hexToRgb } from '../src/color';
import { paintChoices, rankPaints, suggestMix } from '../src/paintMatch';
import { ARMY_PAINTER_PAINTS } from '../src/paints/armyPainter';

describe('paint matching', () => {
  const fanatic = paintChoices({ ranges: ['fanatic'], includeMetallics: false });

  it('only includes the requested ranges, without metallics by default', () => {
    expect(fanatic.length).toBeGreaterThan(150);
    expect(fanatic.every((c) => c.paint.range === 'fanatic' && !c.paint.metallic)).toBe(true);
  });

  it('matches a paint to itself', () => {
    const paint = ARMY_PAINTER_PAINTS.find((p) => p.name === 'Pure Red' && p.range === 'fanatic')!;
    const [best] = rankPaints(hexToRgb(paint.hex), fanatic);
    expect(best.paint).toBe(paint);
    expect(best.deltaE).toBe(0);
  });

  it('only suggests a mix when it clearly beats the nearest pot', () => {
    const colour = hexToRgb('#FF00FF'); // nothing in the range is this saturated
    const [best] = rankPaints(colour, fanatic);
    const mix = suggestMix(colour, fanatic, best);
    if (mix) expect(mix.deltaE).toBeLessThan(best.deltaE - 2);
    const exact = rankPaints(hexToRgb('#A32F26'), fanatic)[0];
    if (exact.deltaE < 5) expect(suggestMix(hexToRgb('#A32F26'), fanatic, exact)).toBeUndefined();
  });
});
