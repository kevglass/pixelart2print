import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { hexToRgb, type RGB } from './color';
import { renderGuide } from './guide';
import { buildModel, type ModelParams, type ModelResult } from './model';
import { paintChoices } from './paintMatch';
import { buildPaintPlan, type PaintPlan } from './paintPlan';
import type { PaintRange } from './paints/armyPainter';
import {
  countFilled,
  detectScale,
  EMPTY,
  extractGrid,
  looksLikeSolidBackground,
  reducePalette,
  removeEdgeBackground,
  type ImageLike,
  type PixelGrid,
} from './pixelArt';
import { Preview, type PaintLookup, type PreviewMode } from './preview';
import { sampleSheet } from './sample';
import { SheetView } from './sheetView';
import { cropGrid, findSprites, type Rect } from './sprites';
import { toBinaryStl } from './stl';
import { to3mf, type BambuProject } from './threemf';
import './styles.css';

const MAX_CELLS = 160 * 160;
const EDGE: RGB = { r: 32, g: 32, b: 32 };

const wasmReady = Module({ locateFile: () => wasmUrl }).then((wasm) => {
  wasm.setup();
  return wasm;
});

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => Number($(id).value);

interface Source {
  name: string;
  image: ImageLike;
  detectedScale: number;
  /** The area being turned into a magnet, in image pixels. */
  selection: Rect;
  /** The whole image as art pixels, cached per scale and background setting. */
  sheet?: { key: string; grid: PixelGrid; sprites: Rect[] };
}

let source: Source | undefined;
let model: ModelResult | undefined;
let plan: PaintPlan | undefined;
let params: ModelParams | undefined;
let mode: PreviewMode = 'painted';
let generation = 0;
let pixelSizeTouched = false;

const preview = new Preview($('viewer'));
const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
const syncBackground = () => preview.setBackground(darkScheme.matches ? '#1b1d21' : '#eef0f3');
darkScheme.addEventListener('change', syncBackground);
syncBackground();

function readParams(): ModelParams {
  const count = $<HTMLSelectElement>('mag-count').value;
  return {
    pixelSize: num('pixel-size'),
    reliefHeight: num('relief'),
    grooveWidth: num('groove'),
    baseThickness: num('base'),
    backing: $<HTMLSelectElement>('backing').value as ModelParams['backing'],
    border: num('border'),
    mergeSameColour: $('merge').checked,
    magnet: {
      diameter: num('mag-d'),
      thickness: num('mag-t'),
      clearance: num('mag-clear'),
      count: count === 'auto' ? 'auto' : Number(count),
    },
  };
}

const currentScale = () => num('scale') || source!.detectedScale;

const toPixels = (r: Rect, scale: number): Rect => ({ x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale });
const toCells = (r: Rect, scale: number): Rect => ({
  x: Math.round(r.x / scale),
  y: Math.round(r.y / scale),
  w: Math.max(1, Math.round(r.w / scale)),
  h: Math.max(1, Math.round(r.h / scale)),
});

function sheetFor(src: Source) {
  const scale = currentScale();
  const removeBg = $('remove-bg').checked;
  const key = `${scale}|${removeBg}`;
  if (src.sheet?.key !== key) {
    let grid = extractGrid(src.image, scale);
    // Remove the background across the whole sheet, so the flood fill reaches
    // every gap between sprites rather than just the edges of the selection.
    if (removeBg) grid = removeEdgeBackground(grid);
    src.sheet = { key, grid, sprites: findSprites(grid) };
  }
  return src.sheet;
}

/** Index of the detected sprite that is exactly the current selection, or -1. */
function selectedSprite(src: Source): number {
  const scale = currentScale();
  const sel = src.selection;
  return sheetFor(src).sprites.findIndex((r) => {
    const p = toPixels(r, scale);
    return p.x === sel.x && p.y === sel.y && p.w === sel.w && p.h === sel.h;
  });
}

function select(rect: Rect) {
  if (!source) return;
  source.selection = rect;
  if (!pixelSizeTouched) {
    // Aim for roughly 70 mm on the longest side.
    const cells = toCells(rect, currentScale());
    const longest = Math.max(cells.w, cells.h);
    $('pixel-size').value = String(Math.min(8, Math.max(2.5, Math.round((70 / longest) * 2) / 2)));
  }
  update();
}

function step(direction: number) {
  if (!source) return;
  const { sprites } = sheetFor(source);
  if (!sprites.length) return;
  const current = selectedSprite(source);
  const next = current < 0 ? (direction > 0 ? 0 : sprites.length - 1) : (current + direction + sprites.length) % sprites.length;
  select(toPixels(sprites[next], currentScale()));
}

const sheetView = new SheetView($<HTMLCanvasElement>('sheet'), {
  onPick(x, y) {
    if (!source) return;
    const scale = currentScale();
    const hit = sheetFor(source).sprites.find((r) => {
      const p = toPixels(r, scale);
      return x >= p.x && y >= p.y && x < p.x + p.w && y < p.y + p.h;
    });
    if (hit) select(toPixels(hit, scale));
  },
  onDrag: select,
  onStep: step,
});

function setSource(name: string, image: ImageLike) {
  const detectedScale = detectScale(image);
  source = { name, image, detectedScale, selection: { x: 0, y: 0, w: image.width, h: image.height } };
  const scaleInput = $('scale');
  scaleInput.value = '';
  scaleInput.placeholder = 'auto';
  pixelSizeTouched = false;

  $('remove-bg').checked = looksLikeSolidBackground(extractGrid(image, detectedScale));
  sheetView.setImage(image);
  // On a sheet, start with the first sprite rather than the whole thing.
  const { sprites } = sheetFor(source);
  select(sprites.length > 1 ? toPixels(sprites[0], detectedScale) : source.selection);
}

/** Describes the selection for titles and file names. */
function selectionLabel(src: Source): { title: string; file: string } {
  const index = selectedSprite(src);
  const sprites = sheetFor(src).sprites.length;
  const { selection: s, image } = src;
  if (index >= 0 && sprites > 1) return { title: `sprite ${index + 1} of ${sprites}`, file: `-sprite${index + 1}` };
  if (s.x === 0 && s.y === 0 && s.w === image.width && s.h === image.height) return { title: 'whole image', file: '' };
  return { title: 'selection', file: '-selection' };
}

async function loadFile(file: Blob, name: string) {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    setSource(name.replace(/\.[^.]+$/, ''), ctx.getImageData(0, 0, bitmap.width, bitmap.height));
  } catch {
    showWarnings([`Couldn't read "${name}" as an image.`]);
  }
}

function setExportsEnabled(enabled: boolean) {
  document.querySelectorAll<HTMLButtonElement>('.export').forEach((b) => (b.disabled = !enabled));
}

function showWarnings(warnings: string[]) {
  $('warnings').replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement('li');
      li.textContent = w;
      return li;
    }),
  );
}

function paintLookup(p: PaintPlan, m: ModelParams): PaintLookup {
  const colours = p.groups.map((g) => hexToRgb(g.paint.hex));
  return {
    edge: EDGE,
    topZ: m.baseThickness + m.reliefHeight / 2,
    backZ: m.baseThickness - 0.1,
    colourAt(x, y) {
      const gx = Math.floor(x / m.pixelSize);
      const gy = p.height - 1 - Math.floor(y / m.pixelSize);
      if (gx < 0 || gy < 0 || gx >= p.width || gy >= p.height) return undefined;
      const g = p.cells[gy * p.width + gx];
      return g === EMPTY ? undefined : colours[g];
    },
  };
}

function showModel() {
  if (model && plan && params) preview.setModel(model, mode, paintLookup(plan, params));
}

let timer: number | undefined;
function update() {
  clearTimeout(timer);
  timer = window.setTimeout(regenerate, 120);
}

async function regenerate() {
  if (!source) return;
  const gen = ++generation;
  const warnings: string[] = [];
  try {
    const scale = currentScale();
    const sheet = sheetFor(source);
    sheetView.setSprites(sheet.sprites.map((r) => toPixels(r, scale)), scale);
    sheetView.setSelection(source.selection);
    const label = selectionLabel(source);
    $('sprite-label').textContent = sheet.sprites.length > 1 ? `${label.title[0].toUpperCase()}${label.title.slice(1)}` : '';
    document.querySelectorAll<HTMLButtonElement>('.sprite-step').forEach((b) => (b.disabled = sheet.sprites.length < 2));

    let grid = cropGrid(sheet.grid, toCells(source.selection, scale));
    const sourceColours = grid.palette.length;
    grid = reducePalette(grid, Math.max(2, num('max-colours') || 16));

    $('image-info').textContent =
      `${grid.width} × ${grid.height} pixels, ${sourceColours} colour${sourceColours === 1 ? '' : 's'}` +
      (sourceColours > grid.palette.length ? ` (reduced to ${grid.palette.length})` : '') +
      (scale > 1 ? `, scaled ×${scale}` : '');

    if (!countFilled(grid)) throw new Error('There are no pixels left to print. Is the whole image transparent or background?');
    if (grid.width * grid.height > MAX_CELLS) {
      throw new Error(
        `${grid.width} × ${grid.height} is a lot of pixels for a magnet. Select a smaller area above, or if this is upscaled pixel art, set the pixel scale by hand.`,
      );
    }

    let ranges = [...document.querySelectorAll<HTMLInputElement>('input[name=range]:checked')].map((i) => i.value as PaintRange);
    if (!ranges.length) {
      warnings.push('No paint range selected, so Warpaints Fanatic is used.');
      ranges = ['fanatic'];
    }
    const nextPlan = buildPaintPlan(grid, paintChoices({ ranges, includeMetallics: $('metallics').checked }));
    const nextParams = readParams();
    const wasm = await wasmReady;
    if (gen !== generation) return;
    const nextModel = buildModel(wasm, { width: grid.width, height: grid.height, cells: nextPlan.cells }, nextParams);

    plan = nextPlan;
    params = nextParams;
    model = nextModel;
    showModel();
    const size = model.max.map((v, i) => v - model!.min[i]);
    $('model-stats').textContent =
      `${size[0].toFixed(1)} × ${size[1].toFixed(1)} × ${size[2].toFixed(1)} mm · ` +
      `${model.magnets.length} magnet pocket${model.magnets.length === 1 ? '' : 's'} · ${(model.indices.length / 3).toLocaleString()} triangles`;
    setExportsEnabled(true);
    const title = label.title === 'whole image' ? source.name : `${source.name} (${label.title})`;
    renderGuide($('guide'), plan, { title, pixelSize: params.pixelSize, model, magnet: params.magnet });
    showWarnings([...warnings, ...model.warnings]);
  } catch (e) {
    if (gen !== generation) return;
    setExportsEnabled(false);
    showWarnings([...warnings, e instanceof Error ? e.message : String(e)]);
  }
}

// --- Wiring ------------------------------------------------------------------
document.querySelector('.controls')!.addEventListener('input', (e) => {
  const id = (e.target as HTMLElement).id;
  if (id === 'pixel-size') pixelSizeTouched = true;
  if (id !== 'file') update();
});
$('sprite-prev').addEventListener('click', () => step(-1));
$('sprite-next').addEventListener('click', () => step(1));
$('select-all').addEventListener('click', () => source && select({ x: 0, y: 0, w: source.image.width, h: source.image.height }));

$('file').addEventListener('change', () => {
  const file = $('file').files?.[0];
  if (file) loadFile(file, file.name);
});

const drop = $('drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file, file.name);
});
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
  const file = item?.getAsFile();
  if (file) loadFile(file, 'pasted-art');
});

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) =>
  button.addEventListener('click', () => {
    mode = button.dataset.mode as PreviewMode;
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === button));
    showModel();
  }),
);
$('view-front').addEventListener('click', () => model && preview.frame(model));
$('view-back').addEventListener('click', () => preview.showBack());

const fileBase = () =>
  `${(source?.name ?? 'pixel-art').replace(/[^\w-]+/g, '-').slice(0, 60)}${source ? selectionLabel(source).file : ''}-magnet`;

function saveFile(data: BlobPart, type: string, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Bambu Studio project settings (one Generic PLA filament, the printer and
// process selected in Bambu Studio) from the local server. Fetched on every
// export so changes made in Bambu Studio are picked up. Undefined when there's
// no Bambu Studio or no server (static hosting): the 3MF is then plain.
async function fetchBambuProject(): Promise<BambuProject | undefined> {
  try {
    const res = await fetch('api/bambu/project');
    const body = await res.json();
    $('bambu-info').textContent = res.ok
      ? `Bambu Studio 3MF: ${body.printer} · ${body.process} · ${body.filament} (one white filament)` +
        (body.bedType ? ` · ${body.bedType}` : '')
      : `Bambu Studio presets unavailable (${body.error}), so 3MF files take whatever filaments Bambu Studio has loaded.`;
    return res.ok ? body : undefined;
  } catch {
    return undefined;
  }
}

const make3mf = (bambu?: BambuProject) => to3mf(model!.positions, model!.indices, fileBase(), bambu) as Uint8Array<ArrayBuffer>;

$('download-stl').addEventListener('click', () => {
  if (model) saveFile(toBinaryStl(model.positions, model.indices, fileBase()), 'model/stl', `${fileBase()}.stl`);
});
$('download-3mf').addEventListener('click', async () => {
  if (model) saveFile(make3mf(await fetchBambuProject()), 'model/3mf', `${fileBase()}.3mf`);
});

// Bambu Studio opens models by downloading a .3mf from a URL (macOS registers
// bambustudioopen://, Windows and Linux bambustudio://open?file=). The local
// dev server hosts the file; see server/modelShare.ts.
$('open-bambu').addEventListener('click', async () => {
  if (!model) return;
  const filename = `${fileBase()}.3mf`;
  const data = make3mf(await fetchBambuProject());
  try {
    const res = await fetch(`api/models/${filename}`, { method: 'POST', body: data });
    if (!res.ok) throw new Error(String(res.status));
    const url = new URL((await res.json()).url, location.origin);
    // Bambu Studio only connects over IPv4, so don't hand it a name that may resolve to ::1.
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    const fileUrl = url.href;
    const isMac = /Mac/.test(navigator.userAgent);
    location.href = isMac
      ? `bambustudioopen://${encodeURIComponent(fileUrl)}`
      : `bambustudio://open?file=${encodeURIComponent(fileUrl)}`;
    showWarnings([
      'Sent to Bambu Studio. Newer versions ask whether to open a file "not from a trusted site": choose Yes, it comes from this app.',
    ]);
  } catch {
    // Hosted as static files with no server to fetch from: hand over the file instead.
    saveFile(data, 'model/3mf', filename);
    showWarnings([`Saved ${filename}. Open it with Bambu Studio (direct opening needs the app running via npm run dev or npm run preview).`]);
  }
});
$('print').addEventListener('click', () => window.print());

setSource('halloween', sampleSheet(10));
fetchBambuProject();
