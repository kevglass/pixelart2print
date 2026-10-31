import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BambuProject } from '../src/threemf.ts';

// Builds the project settings for a Bambu Studio 3MF from the local install:
// the printer, process and plate currently selected in Bambu Studio, plus the
// Generic PLA preset made for that printer, as the only filament.
//
// The settings are written out in full, the way Bambu Studio saves a project:
// each system preset resolved through its inheritance chain and include
// templates. Bambu Studio then recognises them as unmodified system presets.
// (A file naming the presets with no values in it is not enough: Bambu
// Studio's own loader and slicer crash on one.)

type Json = Record<string, unknown>;
type Kind = 'machine' | 'process' | 'filament';

// Index = Bambu Studio's BedType enum, as stored in curr_bed_type.
const BED_TYPES = ['Default Plate', 'Cool Plate', 'Engineering Plate', 'High Temp Plate', 'Textured PEI Plate', 'Supertack Plate'];

// Preset-file bookkeeping that isn't a setting.
const META_KEYS = new Set([
  'name', 'inherits', 'from', 'setting_id', 'instantiation', 'type', 'include', 'filament_id',
  'description', 'version', 'is_custom_defined', 'renamed_from',
  'compatible_printers', 'compatible_printers_condition', 'compatible_prints', 'compatible_prints_condition',
]);

// The single filament slot's colour: a plain light print to paint over.
const FILAMENT_COLOUR = '#FFFFFF';

export function bambuConfigDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'BambuStudio');
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'BambuStudio');
  return join(homedir(), '.config', 'BambuStudio');
}

function readJson(path: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined;
  } catch {
    return undefined;
  }
}

// System presets by name. File names don't always match preset names, so
// index by the name inside each file. Cached until Bambu Studio updates them.
let indexCache: { key: string; presets: Map<string, Json> } | undefined;

function systemPresets(dir: string): Map<string, Json> {
  const bbl = join(dir, 'system', 'BBL');
  const key = `${bbl}@${existsSync(`${bbl}.json`) ? statSync(`${bbl}.json`).mtimeMs : 0}`;
  if (indexCache?.key === key) return indexCache.presets;
  const presets = new Map<string, Json>();
  for (const kind of ['machine', 'process', 'filament'] as Kind[]) {
    const kindDir = join(bbl, kind);
    if (!existsSync(kindDir)) continue;
    for (const file of readdirSync(kindDir)) {
      if (!file.endsWith('.json')) continue;
      const preset = readJson(join(kindDir, file));
      if (typeof preset?.name === 'string') presets.set(`${kind}:${preset.name}`, preset);
    }
  }
  indexCache = { key, presets };
  return presets;
}

export function buildBambuProject(dir = bambuConfigDir()): BambuProject | { error: string } {
  const conf = readJson(join(dir, 'BambuStudio.conf'));
  if (!conf) return { error: 'Bambu Studio settings not found' };
  const app = (conf.app ?? {}) as Json;
  const selected = (conf.presets ?? {}) as Json;
  const version = typeof app.version === 'string' ? app.version : undefined;
  if (!version) return { error: 'Bambu Studio version not found' };

  const presets = systemPresets(dir);
  const get = (kind: Kind, name: string) => presets.get(`${kind}:${name}`);

  // A user preset stands in for its system parent.
  const toSystemName = (kind: Kind, name: unknown): string | undefined => {
    if (typeof name !== 'string') return undefined;
    if (get(kind, name)?.instantiation === 'true') return name;
    const userDir = join(dir, 'user');
    for (const account of existsSync(userDir) ? readdirSync(userDir) : []) {
      const parent = readJson(join(userDir, account, kind, `${name}.json`))?.inherits;
      if (typeof parent === 'string' && get(kind, parent)?.instantiation === 'true') return parent;
    }
    return undefined;
  };

  // Mirrors Bambu Studio's preset loading: the parent's settings, then any
  // include templates, then the preset's own values.
  const resolve = (kind: Kind, name: string, depth = 0): Json => {
    const preset = get(kind, name);
    if (!preset || depth > 20) return {};
    const settings: Json = typeof preset.inherits === 'string' ? resolve(kind, preset.inherits, depth + 1) : {};
    const include = preset.include;
    for (const template of typeof include === 'string' ? [include] : Array.isArray(include) ? include : []) {
      if (typeof template === 'string') Object.assign(settings, resolve(kind, template, depth + 1));
    }
    for (const [key, value] of Object.entries(preset)) if (!META_KEYS.has(key)) settings[key] = value;
    return settings;
  };
  const inherited = (kind: Kind, name: string, key: string): unknown => {
    for (let preset = get(kind, name), depth = 0; preset && depth < 20; depth++) {
      if (key in preset) return preset[key];
      preset = typeof preset.inherits === 'string' ? get(kind, preset.inherits) : undefined;
    }
    return undefined;
  };

  const printer = toSystemName('machine', selected.machine);
  if (!printer) return { error: 'No Bambu Lab printer selected in Bambu Studio' };
  const printProcess = toSystemName('process', selected.process);
  if (!printProcess) return { error: 'No system process preset selected in Bambu Studio' };

  // Prefer plain Generic PLA, then the per-printer variant, then High Speed
  // (the only Generic PLA some printers, like the P1P, get).
  const rank = (name: string) =>
    name === 'Generic PLA' ? 0 : name.startsWith('Generic PLA @') ? 1 : name.startsWith('Generic PLA High Speed') ? 2 : -1;
  const filament = [...presets.values()]
    .map((preset) => String(preset.name))
    .filter((name) => {
      if (rank(name) < 0 || get('filament', name)?.instantiation !== 'true') return false;
      const compatible = inherited('filament', name, 'compatible_printers');
      return Array.isArray(compatible) && compatible.includes(printer);
    })
    .sort((a, b) => rank(a) - rank(b))[0];
  if (!filament) return { error: `No Generic PLA preset found for ${printer}` };

  const settings: Json = {
    ...resolve('machine', printer),
    ...resolve('process', printProcess),
    ...resolve('filament', filament),
  };
  const variants = Array.isArray(settings.filament_extruder_variant) ? settings.filament_extruder_variant.length : 1;
  const nozzles = Array.isArray(settings.nozzle_diameter) ? settings.nozzle_diameter.length : 1;
  const bed = Number(app.curr_bed_type);
  const bedType = bed > 0 ? BED_TYPES[bed] : undefined;
  const filamentId = inherited('filament', filament, 'filament_id');

  Object.assign(settings, {
    name: 'project_settings',
    from: 'project',
    version,
    printer_settings_id: printer,
    print_settings_id: printProcess,
    filament_settings_id: [filament],
    filament_ids: typeof filamentId === 'string' ? [filamentId] : [],
    filament_colour: [FILAMENT_COLOUR],
    filament_multi_colour: [FILAMENT_COLOUR],
    default_filament_colour: [''],
    // One filament: its per-variant values all belong to filament 1.
    filament_self_index: Array(variants).fill('1'),
    filament_map: ['1'],
    flush_volumes_matrix: Array(nozzles).fill('0'),
    flush_volumes_vector: Array(nozzles * 2).fill('140'),
    // Empty entries (process, filament, printer) mean "unmodified system preset".
    inherits_group: ['', '', ''],
    different_settings_to_system: ['', '', ''],
    print_compatible_printers: [printer],
    ...(bedType ? { curr_bed_type: bedType } : {}),
  });

  return {
    version,
    printer,
    process: printProcess,
    filament,
    bedType,
    bedCentre: bedCentre(settings.printable_area),
    settings,
  };
}

/** Centre of a printable_area outline such as ["0x0", "256x0", "256x256", "0x256"]. */
function bedCentre(area: unknown): [number, number] | undefined {
  if (!Array.isArray(area)) return undefined;
  const points = area.map((p) => String(p).split('x').map(Number));
  if (!points.length || points.some((p) => p.length !== 2 || p.some(Number.isNaN))) return undefined;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
