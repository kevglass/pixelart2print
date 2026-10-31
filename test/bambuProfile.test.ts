import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildBambuProject } from '../server/bambuProfile';
import { to3mf, type BambuProject } from '../src/threemf';

const PRINTER = 'Test Printer 0.4 nozzle';

// A miniature Bambu Studio install: settings, system presets and one user preset.
function fakeInstall(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bambu-'));
  const write = (path: string, json: unknown) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(json));
  };
  write('BambuStudio.conf', {
    app: { version: '02.06.00.51', curr_bed_type: '4' },
    presets: { machine: PRINTER, process: 'My tweaked process', filaments: ['Bambu PLA Matte', 'Bambu PLA Matte'] },
  });
  write('user/123/process/My tweaked process.json', { name: 'My tweaked process', inherits: '0.20mm Test', wall_loops: '5' });

  const sys = 'system/BBL';
  write(`${sys}/machine/common.json`, {
    name: 'fdm_test_common', instantiation: 'false', nozzle_diameter: ['0.4'], printable_area: ['0x0', '200x0', '200x180', '0x180'],
  });
  write(`${sys}/machine/printer.json`, {
    name: PRINTER, inherits: 'fdm_test_common', instantiation: 'true', setting_id: 'GM1', printer_model: 'Test Printer',
  });
  write(`${sys}/process/p.json`, { name: '0.20mm Test', instantiation: 'true', layer_height: '0.2', wall_loops: '2' });

  write(`${sys}/filament/template.json`, {
    name: 'fdm_filament_template_dual', instantiation: 'false',
    filament_extruder_variant: ['Direct Drive Standard', 'Direct Drive High Flow'], nozzle_temperature: ['200', '200'], filament_flow_ratio: ['0.95', '0.95'],
  });
  write(`${sys}/filament/base.json`, {
    name: 'Generic PLA @base', instantiation: 'false', filament_id: 'GFL99', filament_type: ['PLA'], nozzle_temperature: ['190', '190'],
  });
  // Plain Generic PLA exists but isn't for this printer.
  write(`${sys}/filament/plain.json`, { name: 'Generic PLA', inherits: 'Generic PLA @base', instantiation: 'true', compatible_printers: ['Other'] });
  write(`${sys}/filament/variant.json`, {
    name: 'Generic PLA @Test', inherits: 'Generic PLA @base', include: ['fdm_filament_template_dual'], instantiation: 'true',
    compatible_printers: [PRINTER], nozzle_temperature: ['215', '215'],
  });
  write(`${sys}/filament/hs.json`, { name: 'Generic PLA High Speed @Test', inherits: 'Generic PLA @base', instantiation: 'true', compatible_printers: [PRINTER] });
  write(`${sys}/filament/silk.json`, { name: 'Generic PLA Silk @Test', inherits: 'Generic PLA @base', instantiation: 'true', compatible_printers: [PRINTER] });
  return dir;
}

describe('Bambu Studio project settings', () => {
  const project = buildBambuProject(fakeInstall()) as BambuProject;

  it('uses the selected printer, the system parent of a user process, and Generic PLA for that printer', () => {
    expect(project).toMatchObject({
      version: '02.06.00.51',
      printer: PRINTER,
      process: '0.20mm Test',
      filament: 'Generic PLA @Test',
      bedType: 'Textured PEI Plate',
      bedCentre: [100, 90],
    });
  });

  it('resolves presets like Bambu Studio: parent, then include templates, then own values', () => {
    const s = project.settings;
    expect(s.nozzle_diameter).toEqual(['0.4']); // from the printer's parent
    expect(s.printer_model).toBe('Test Printer');
    expect(s.wall_loops).toBe('2'); // the system process, not the user's tweak
    expect(s.filament_flow_ratio).toEqual(['0.95', '0.95']); // from the include
    expect(s.nozzle_temperature).toEqual(['215', '215']); // own value beats base and include
    expect(s.filament_type).toEqual(['PLA']);
    for (const meta of ['inherits', 'include', 'setting_id', 'instantiation', 'compatible_printers']) expect(s).not.toHaveProperty(meta);
  });

  it('describes exactly one filament, sized for the nozzle variants', () => {
    const s = project.settings;
    expect(s.filament_settings_id).toEqual(['Generic PLA @Test']);
    expect(s.filament_ids).toEqual(['GFL99']);
    expect(s.filament_colour).toEqual(['#FFFFFF']);
    expect(s.filament_self_index).toEqual(['1', '1']);
    expect(s.filament_map).toEqual(['1']);
    expect(s.inherits_group).toEqual(['', '', '']);
    expect(s.different_settings_to_system).toEqual(['', '', '']);
    expect(s).toMatchObject({ printer_settings_id: PRINTER, print_settings_id: '0.20mm Test', curr_bed_type: 'Textured PEI Plate' });
  });

  it('reports a missing install', () => {
    expect(buildBambuProject(mkdtempSync(join(tmpdir(), 'empty-')))).toEqual({ error: 'Bambu Studio settings not found' });
  });

  it('writes the project into the 3MF', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]);
    const files = unzipSync(to3mf(positions, indices, 'magnet', project));
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model).toContain('<metadata name="Application">BambuStudio-02.06.00.51</metadata>');
    expect(model).toContain('transform="1 0 0 0 1 0 0 0 1 100 90 0"');
    expect(JSON.parse(strFromU8(files['Metadata/project_settings.config']))).toEqual(project.settings);
  });
});
