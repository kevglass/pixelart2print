import Module from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { buildModel, DEFAULT_PARAMS, type ModelInput, type ModelParams } from '../src/model';
import { EMPTY, extractGrid } from '../src/pixelArt';
import { sampleSheet } from '../src/sample';
import { cropGrid, findSprites } from '../src/sprites';
import { toBinaryStl } from '../src/stl';

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

// Every edge must be shared by exactly two triangles with opposite winding.
function expectWatertight(indices: Uint32Array) {
  const edges = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k];
      const b = indices[t + ((k + 1) % 3)];
      const key = `${a},${b}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of edges) {
    const [a, b] = key.split(',');
    expect(n).toBe(1);
    expect(edges.get(`${b},${a}`)).toBe(1);
  }
}

function inputFrom(rows: string[]): ModelInput {
  const cells = new Int32Array(rows.join('').split('').map((ch) => (ch === '.' ? EMPTY : ch.charCodeAt(0))));
  return { width: rows[0].length, height: rows.length, cells };
}

const params = (over: Partial<ModelParams> = {}): ModelParams => ({ ...DEFAULT_PARAMS, ...over });

describe('model', () => {
  it('builds a watertight single-piece magnet from the sample', () => {
    const sheet = extractGrid(sampleSheet(10), 10);
    const grid = cropGrid(sheet, findSprites(sheet)[0]);
    const result = buildModel(wasm, grid, params());
    expectWatertight(result.indices);
    expect(result.pieces).toBe(1);
    expect(result.magnets).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    expect(result.max[0] - result.min[0]).toBeCloseTo(16 * 4, 3);
    expect(result.max[1] - result.min[1]).toBeCloseTo(15 * 4, 3);
    expect(result.max[2]).toBeCloseTo(DEFAULT_PARAMS.baseThickness + DEFAULT_PARAMS.reliefHeight, 3);
  });

  it('cuts grooves between pixels but leaves outer edges flush', () => {
    const solid = buildModel(wasm, inputFrom(['ab']), params({ magnet: { ...DEFAULT_PARAMS.magnet, count: 0 } }));
    const top = DEFAULT_PARAMS.baseThickness + DEFAULT_PARAMS.reliefHeight;
    // Volume via the divergence theorem.
    let vol = 0;
    const p = solid.positions;
    for (let t = 0; t < solid.indices.length; t += 3) {
      const [a, b, c] = [solid.indices[t] * 3, solid.indices[t + 1] * 3, solid.indices[t + 2] * 3];
      vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    }
    const groove = DEFAULT_PARAMS.grooveWidth * 4 * DEFAULT_PARAMS.reliefHeight;
    expect(vol).toBeCloseTo(8 * 4 * top - groove, 2);
  });

  it('merges same-coloured neighbours when asked', () => {
    const noMagnet = { ...DEFAULT_PARAMS.magnet, count: 0 };
    const grooved = buildModel(wasm, inputFrom(['aa']), params({ magnet: noMagnet }));
    const merged = buildModel(wasm, inputFrom(['aa']), params({ magnet: noMagnet, mergeSameColour: true }));
    expect(merged.indices.length).toBeLessThan(grooved.indices.length);
  });

  it('bridges pixels that only touch diagonally', () => {
    const result = buildModel(wasm, inputFrom(['a..', '.a.', '..a']), params({ magnet: { ...DEFAULT_PARAMS.magnet, count: 0 } }));
    expect(result.pieces).toBe(1);
    expectWatertight(result.indices);
  });

  it('reports separate pieces and missing magnet room', () => {
    const result = buildModel(wasm, inputFrom(['a.a']), params());
    expect(result.pieces).toBe(2);
    expect(result.magnets).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('places several magnets apart from each other', () => {
    const rows = Array.from({ length: 10 }, () => 'a'.repeat(40));
    const result = buildModel(wasm, inputFrom(rows), params());
    expect(result.magnets).toHaveLength(4);
    expectWatertight(result.indices);
  });

  it('writes binary STL', () => {
    const result = buildModel(wasm, inputFrom(['ab', 'ba']), params({ magnet: { ...DEFAULT_PARAMS.magnet, count: 0 } }));
    const stl = toBinaryStl(result.positions, result.indices);
    expect(stl.byteLength).toBe(84 + (result.indices.length / 3) * 50);
    expect(new DataView(stl).getUint32(80, true)).toBe(result.indices.length / 3);
  });
});
