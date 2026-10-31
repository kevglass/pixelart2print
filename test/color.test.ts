import { describe, expect, it } from 'vitest';
import { deltaE2000, hexToRgb, mixColours, rgbToHex, rgbToLab } from '../src/color';

describe('colour', () => {
  // Reference pairs from Sharma, Wu & Dalal, "The CIEDE2000 Color-Difference Formula".
  it.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ])('deltaE2000 %j vs %j', (a, b, expected) => {
    const [L1, a1, b1] = a as number[];
    const [L2, a2, b2] = b as number[];
    expect(deltaE2000({ L: L1, a: a1, b: b1 }, { L: L2, a: a2, b: b2 })).toBeCloseTo(expected, 4);
  });

  it('converts sRGB to Lab', () => {
    const white = rgbToLab({ r: 255, g: 255, b: 255 });
    expect(white.L).toBeCloseTo(100, 2);
    expect(Math.abs(white.a)).toBeLessThan(0.01);
    const red = rgbToLab({ r: 255, g: 0, b: 0 });
    expect(red.L).toBeCloseTo(53.24, 1);
    expect(red.a).toBeCloseTo(80.09, 1);
  });

  it('round-trips hex', () => {
    expect(rgbToHex(hexToRgb('#A32F26'))).toBe('#A32F26');
  });

  it('mixes subtractively, so dark paint dominates', () => {
    expect(rgbToHex(mixColours([hexToRgb('#000000'), hexToRgb('#FFFFFF')], [1, 1]))).toBe('#595959');
    expect(rgbToHex(mixColours([hexToRgb('#808080'), hexToRgb('#808080')], [2, 1]))).toBe('#808080');
    // Yellow + cyan -> green, as with pigments.
    const green = mixColours([hexToRgb('#FFFF00'), hexToRgb('#00FFFF')], [1, 1]);
    expect(green.g).toBe(255);
    expect(green.r).toBeLessThan(100);
    expect(green.b).toBeLessThan(100);
  });
});
