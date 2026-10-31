import type { CrossSection, Manifold, ManifoldToplevel, SimplePolygon, Vec2 } from 'manifold-3d';
import { EMPTY } from './pixelArt';

export interface MagnetParams {
  /** Magnet disc diameter, mm. */
  diameter: number;
  /** Magnet disc thickness, mm. */
  thickness: number;
  /** Extra room around the magnet (radial) and below it (depth), mm. */
  clearance: number;
  count: number | 'auto';
}

export interface ModelParams {
  /** Size of one art pixel, mm. */
  pixelSize: number;
  /** From the back of the magnet to the bottom of the grooves, mm. */
  baseThickness: number;
  /** How far each pixel stands above the groove floor, mm. */
  reliefHeight: number;
  grooveWidth: number;
  /** Follow the outline of the art, or a plain rectangle behind it. */
  backing: 'silhouette' | 'rectangle';
  /** Extra backing around the art at groove-floor height, mm. */
  border: number;
  /** Skip the groove between neighbouring pixels of the same colour. */
  mergeSameColour: boolean;
  magnet: MagnetParams;
}

export const DEFAULT_PARAMS: ModelParams = {
  pixelSize: 4,
  baseThickness: 4,
  reliefHeight: 1,
  grooveWidth: 0.6,
  backing: 'silhouette',
  border: 0,
  mergeSameColour: false,
  magnet: { diameter: 10, thickness: 3, clearance: 0.15, count: 'auto' },
};

export interface ModelInput {
  width: number;
  height: number;
  /** Colour id per cell (row-major from the top-left), or EMPTY. */
  cells: Int32Array;
}

export interface MagnetPlacement {
  x: number;
  y: number;
}

export interface ModelResult {
  /** xyz per vertex, mm. Art occupies x in [0, width*pixelSize], y in [0, height*pixelSize]; +z faces the viewer. */
  positions: Float32Array;
  indices: Uint32Array;
  min: [number, number, number];
  max: [number, number, number];
  magnets: MagnetPlacement[];
  pocketDepth: number;
  pieces: number;
  warnings: string[];
}

const MIN_SKIN = 0.8; // solid material between the magnet and the grooves
const MAGNET_WALL = 1.5; // solid material around the pocket
const MAGNET_SPACING = 3; // gap between neighbouring pockets
const OVERLAP = 0.01; // avoid coplanar faces between unioned parts

function rect(x0: number, y0: number, x1: number, y1: number): SimplePolygon {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

export function buildModel(wasm: ManifoldToplevel, input: ModelInput, params: ModelParams): ModelResult {
  const { CrossSection, Manifold } = wasm;
  const { width: w, height: h, cells } = input;
  const P = params.pixelSize;
  const half = params.grooveWidth / 2;
  const warnings: string[] = [];

  // Image rows run top-down; model y runs up.
  const colour = (gx: number, gy: number) => (gx < 0 || gy < 0 || gx >= w || gy >= h ? EMPTY : cells[gy * w + gx]);
  const filled = (gx: number, gy: number) => colour(gx, gy) !== EMPTY;
  const yOf = (gy: number) => (h - 1 - gy) * P;

  const garbage: { delete(): void }[] = [];
  const keep = <T extends CrossSection | Manifold>(o: T): T => {
    garbage.push(o);
    return o;
  };

  try {
    // --- 2D outline of the backing ---------------------------------------
    let outline: CrossSection;
    if (params.backing === 'rectangle') {
      outline = keep(new CrossSection([rect(0, 0, w * P, h * P)]));
    } else {
      const polys: SimplePolygon[] = [];
      const bridge = Math.max(1, P * 0.35) / 2;
      for (let gy = 0; gy < h; gy++) {
        for (let gx = 0; gx < w; gx++) {
          if (!filled(gx, gy)) continue;
          polys.push(rect(gx * P, yOf(gy), (gx + 1) * P, yOf(gy) + P));
          // Pixels touching only at a corner would print as separate parts
          // joined by a zero-width edge; bridge them with a small square.
          for (const dx of [-1, 1]) {
            if (filled(gx + dx, gy - 1) && !filled(gx + dx, gy) && !filled(gx, gy - 1)) {
              const cx = dx === 1 ? (gx + 1) * P : gx * P;
              const cy = yOf(gy) + P;
              polys.push(rect(cx - bridge, cy - bridge, cx + bridge, cy + bridge));
            }
          }
        }
      }
      outline = keep(new CrossSection(polys, 'Positive'));
    }
    if (params.border > 0) outline = keep(outline.offset(params.border, 'Round', 2, 48));

    const parts = outline.decompose();
    const pieces = parts.length;
    parts.forEach((p) => p.delete());
    if (pieces > 1) {
      warnings.push(
        `The outline is ${pieces} separate pieces. Add a border, or switch to a rectangular backing, to join them.`,
      );
    }

    // --- Raised pixel caps -------------------------------------------------
    // Each pixel is inset by half a groove on every side that faces another
    // pixel (unless merging same-coloured neighbours); outer edges stay flush.
    const caps: SimplePolygon[] = [];
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const c = colour(gx, gy);
        if (c === EMPTY) continue;
        const grooveTo = (dx: number, dy: number) => {
          const n = colour(gx + dx, gy + dy);
          return n !== EMPTY && !(params.mergeSameColour && n === c);
        };
        const L = !grooveTo(-1, 0);
        const R = !grooveTo(1, 0);
        const T = !grooveTo(0, -1);
        const B = !grooveTo(0, 1);
        // A corner is notched when the diagonal neighbour is filled but both
        // orthogonal ones are empty, so caps never meet at a single point.
        const pinch = (dx: number, dy: number) => filled(gx + dx, gy + dy) && !filled(gx + dx, gy) && !filled(gx, gy + dy);
        const TL = T && L && !pinch(-1, -1);
        const TR = T && R && !pinch(1, -1);
        const BL = B && L && !pinch(-1, 1);
        const BR = B && R && !pinch(1, 1);

        const x0 = gx * P;
        const x1 = x0 + P;
        const y0 = yOf(gy);
        const y1 = y0 + P;
        const xi0 = x0 + half;
        const xi1 = x1 - half;
        const yi0 = y0 + half;
        const yi1 = y1 - half;
        if (B) caps.push(rect(BL ? x0 : xi0, y0, BR ? x1 : xi1, yi0));
        caps.push(rect(L ? x0 : xi0, yi0, R ? x1 : xi1, yi1));
        if (T) caps.push(rect(TL ? x0 : xi0, yi1, TR ? x1 : xi1, y1));
      }
    }
    const capSection = keep(new CrossSection(caps, 'Positive'));

    const body = keep(outline.extrude(params.baseThickness));
    const capSolid = keep(
      keep(capSection.extrude(params.reliefHeight + OVERLAP)).translate([0, 0, params.baseThickness - OVERLAP]),
    );
    let solid = keep(body.add(capSolid));

    // --- Magnet pockets ------------------------------------------------------
    const m = params.magnet;
    const pocketRadius = m.diameter / 2 + m.clearance;
    const pocketDepth = m.thickness + m.clearance;
    const magnets = placeMagnets(outline, input, params, pocketRadius, keep);
    if (magnets.length) {
      const holes = magnets.map((p) =>
        keep(keep(Manifold.cylinder(pocketDepth + OVERLAP, pocketRadius, pocketRadius, 64)).translate([p.x, p.y, -OVERLAP])),
      );
      solid = keep(solid.subtract(keep(Manifold.union(holes))));
    } else {
      warnings.push(
        `A ${m.diameter} mm magnet doesn't fit inside the outline with a ${MAGNET_WALL} mm wall. Use a smaller magnet, a larger pixel size or a border.`,
      );
    }
    const wanted = m.count === 'auto' ? autoMagnetCount(input, params) : m.count;
    if (magnets.length && magnets.length < wanted) {
      warnings.push(`Only ${magnets.length} of ${wanted} magnets fit without overlapping.`);
    }

    const skin = params.baseThickness - pocketDepth;
    if (skin < MIN_SKIN) {
      warnings.push(
        `Only ${skin.toFixed(2)} mm of material above the magnet pocket. Increase the base thickness to at least ${(pocketDepth + MIN_SKIN).toFixed(1)} mm.`,
      );
    }
    if (params.grooveWidth < 0.4) {
      warnings.push('Grooves narrower than 0.4 mm usually close up on FDM printers (resin is fine).');
    }
    if (P - params.grooveWidth < 1.5) {
      warnings.push('Pixels are very small relative to the grooves, so they will be hard to print and paint.');
    }

    const mesh = solid.getMesh();
    const stride = mesh.numProp;
    const vertCount = mesh.vertProperties.length / stride;
    const positions = new Float32Array(vertCount * 3);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < vertCount; v++) {
      for (let k = 0; k < 3; k++) {
        const val = mesh.vertProperties[v * stride + k];
        positions[v * 3 + k] = val;
        if (val < min[k]) min[k] = val;
        if (val > max[k]) max[k] = val;
      }
    }
    return {
      positions,
      indices: new Uint32Array(mesh.triVerts),
      min,
      max,
      magnets,
      pocketDepth,
      pieces,
      warnings,
    };
  } finally {
    garbage.forEach((o) => o.delete());
  }
}

/** One magnet for small pieces; more for big ones so they don't spin when bumped. */
export function autoMagnetCount(input: ModelInput, params: ModelParams): number {
  const longest = Math.max(input.width, input.height) * params.pixelSize + params.border * 2;
  if (longest <= 80) return 1;
  if (longest <= 130) return 2;
  return 4;
}

function pointInPolygons(x: number, y: number, polys: SimplePolygon[]): boolean {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * Pick pocket centres: positions where the whole pocket plus a wall fits
 * inside the outline (found by shrinking the outline), as close as possible
 * to the art's centre of mass, or to the centres of n balanced regions when
 * using several magnets.
 */
function placeMagnets(
  outline: CrossSection,
  input: ModelInput,
  params: ModelParams,
  pocketRadius: number,
  keep: <T extends CrossSection | Manifold>(o: T) => T,
): MagnetPlacement[] {
  const count = params.magnet.count === 'auto' ? autoMagnetCount(input, params) : params.magnet.count;
  if (count < 1) return [];
  const safe = keep(outline.offset(-(pocketRadius + MAGNET_WALL), 'Round', 2, 48));
  if (safe.isEmpty()) return [];
  const polys = safe.toPolygons();
  const { min, max } = safe.bounds();

  const area = (max[0] - min[0]) * (max[1] - min[1]);
  const step = Math.max(0.5, Math.sqrt(area / 20000));
  const candidates: Vec2[] = [];
  for (let y = min[1]; y <= max[1]; y += step) {
    for (let x = min[0]; x <= max[0]; x += step) {
      if (pointInPolygons(x, y, polys)) candidates.push([x, y]);
    }
  }
  if (!candidates.length) return [];

  const P = params.pixelSize;
  const points: Vec2[] = [];
  for (let gy = 0; gy < input.height; gy++) {
    for (let gx = 0; gx < input.width; gx++) {
      if (input.cells[gy * input.width + gx] !== EMPTY) points.push([(gx + 0.5) * P, (input.height - gy - 0.5) * P]);
    }
  }
  const targets = clusterCentres(points, count);

  const minSeparation = 2 * pocketRadius + MAGNET_SPACING;
  const chosen: MagnetPlacement[] = [];
  for (const [tx, ty] of targets) {
    let best: Vec2 | undefined;
    let bestD = Infinity;
    for (const c of candidates) {
      if (chosen.some((p) => Math.hypot(p.x - c[0], p.y - c[1]) < minSeparation)) continue;
      const d = (c[0] - tx) ** 2 + (c[1] - ty) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) chosen.push({ x: best[0], y: best[1] });
  }
  return chosen;
}

/** Deterministic k-means; returns centres ordered by cluster size, largest first. */
function clusterCentres(points: Vec2[], k: number): Vec2[] {
  const mean = (pts: Vec2[]): Vec2 => [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];
  if (!points.length) return [];
  if (k === 1) return [mean(points)];

  const centres: Vec2[] = [];
  const centroid = mean(points);
  // Farthest-first seeding from the centroid.
  let seed = points[0];
  for (const p of points) if (dist2(p, centroid) > dist2(seed, centroid)) seed = p;
  centres.push([...seed]);
  while (centres.length < k) {
    let far = points[0];
    let farD = -1;
    for (const p of points) {
      const d = Math.min(...centres.map((c) => dist2(p, c)));
      if (d > farD) {
        farD = d;
        far = p;
      }
    }
    centres.push([...far]);
  }

  let groups: Vec2[][] = [];
  for (let iter = 0; iter < 30; iter++) {
    groups = centres.map(() => []);
    for (const p of points) {
      let best = 0;
      for (let i = 1; i < centres.length; i++) if (dist2(p, centres[i]) < dist2(p, centres[best])) best = i;
      groups[best].push(p);
    }
    groups.forEach((g, i) => {
      if (g.length) centres[i] = mean(g);
    });
  }
  return centres.map((c, i) => ({ c, n: groups[i].length })).sort((a, b) => b.n - a.n).map((e) => e.c);
}

function dist2(a: Vec2, b: Vec2): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}
