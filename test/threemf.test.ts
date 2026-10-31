import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { to3mf } from '../src/threemf';

describe('3MF export', () => {
  // A unit tetrahedron, offset away from the origin.
  const positions = new Float32Array([10, 10, 5, 11, 10, 5, 10, 11, 5, 10, 10, 6]);
  const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]);

  it('packages a millimetre mesh centred on the plate', () => {
    const files = unzipSync(to3mf(positions, indices, 'Tom & "Jerry"'));
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('name="Tom &amp; &quot;Jerry&quot;"');
    expect(model.match(/<vertex /g)).toHaveLength(4);
    expect(model.match(/<triangle /g)).toHaveLength(4);
    // Footprint centred on the object origin, resting on z = 0.
    expect(model).toContain('<vertex x="-0.5" y="-0.5" z="0"/>');
    expect(model).toContain('transform="1 0 0 0 1 0 0 0 1 90 90 0"');
  });
});
