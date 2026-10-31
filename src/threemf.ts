import { strToU8, zipSync } from 'fflate';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

// Centre of the smallest Bambu Lab plate (A1 mini, 180 x 180 mm), so the
// object lands on the bed whichever printer is selected.
const PLATE_CENTRE = 90;

/**
 * A Bambu Studio project for the 3MF, built from the local install by
 * server/bambuProfile.ts. With it the 3MF opens with exactly one filament,
 * rather than inheriting whatever filament slots happen to be loaded.
 */
export interface BambuProject {
  /** Bambu Studio version, e.g. "02.06.00.51". */
  version: string;
  /** System preset names, for display. */
  printer: string;
  process: string;
  filament: string;
  /** e.g. "Textured PEI Plate". */
  bedType?: string;
  /** Centre of the printer's bed, mm. */
  bedCentre?: [number, number];
  /** The complete Metadata/project_settings.config contents. */
  settings: Record<string, unknown>;
}

const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

const fmt = (v: number) => String(Math.round(v * 1e5) / 1e5);

/**
 * A 3MF package with one mesh object, in millimetres, sitting centred on the
 * plate. Plain core-spec 3MF, or a Bambu Studio project when given presets.
 */
export function to3mf(positions: Float32Array, indices: Uint32Array, name: string, bambu?: BambuProject): Uint8Array {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3], positions[i]);
    max[i % 3] = Math.max(max[i % 3], positions[i]);
  }
  // Put the object's origin at the centre of its footprint, on z = 0.
  const offset = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];

  const parts: string[] = [];
  for (let v = 0; v < positions.length; v += 3) {
    parts.push(
      `<vertex x="${fmt(positions[v] - offset[0])}" y="${fmt(positions[v + 1] - offset[1])}" z="${fmt(positions[v + 2] - offset[2])}"/>`,
    );
  }
  const vertices = parts.join('\n');
  parts.length = 0;
  for (let t = 0; t < indices.length; t += 3) {
    parts.push(`<triangle v1="${indices[t]}" v2="${indices[t + 1]}" v3="${indices[t + 2]}"/>`);
  }
  const triangles = parts.join('\n');

  const title = escapeXml(name);
  // Bambu Studio only reads project settings from files it thinks it wrote.
  const application = bambu
    ? `<metadata name="Application">BambuStudio-${escapeXml(bambu.version)}</metadata>
<metadata name="BambuStudio:3mfVersion">1</metadata>`
    : `<metadata name="Application">pixelart2print</metadata>`;
  const [cx, cy] = bambu?.bedCentre ?? [PLATE_CENTRE, PLATE_CENTRE];
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"${bambu ? ' xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"' : ''}>
<metadata name="Title">${title}</metadata>
${application}
<resources>
<object id="1" type="model" name="${title}">
<mesh>
<vertices>
${vertices}
</vertices>
<triangles>
${triangles}
</triangles>
</mesh>
</object>
</resources>
<build>
<item objectid="1" transform="1 0 0 0 1 0 0 0 1 ${fmt(cx)} ${fmt(cy)} 0"/>
</build>
</model>`;

  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(model),
    ...(bambu ? { 'Metadata/project_settings.config': strToU8(JSON.stringify(bambu.settings, null, 4)) } : {}),
  });
}
