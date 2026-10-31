/** Binary STL from an indexed triangle mesh (counter-clockwise winding, mm). */
export function toBinaryStl(positions: Float32Array, indices: Uint32Array, name = 'pixelart2print'): ArrayBuffer {
  const triCount = indices.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode(name.slice(0, 80));
  new Uint8Array(buffer, 0, 80).set(header);
  view.setUint32(80, triCount, true);

  let o = 84;
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (const v of [nx, ny, nz]) {
      view.setFloat32(o, v, true);
      o += 4;
    }
    for (const i of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        view.setFloat32(o, positions[i + k], true);
        o += 4;
      }
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buffer;
}
