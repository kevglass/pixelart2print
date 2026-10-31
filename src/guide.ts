import { contrastText, hexToRgb, rgbToHex, rgbToLab } from './color';
import { matchQuality } from './paintMatch';
import type { PaintGroup, PaintPlan } from './paintPlan';
import { RANGE_LABELS, type Paint } from './paints/armyPainter';
import { EMPTY } from './pixelArt';
import type { MagnetParams, ModelResult } from './model';

export interface GuideInfo {
  title: string;
  pixelSize: number;
  model?: ModelResult;
  magnet: MagnetParams;
}

type Child = Node | string | false | null | undefined;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function swatch(hex: string, label?: string): HTMLElement {
  return el('span', { class: 'swatch', style: `background:${hex}`, title: label ?? hex });
}

function paintLabel(paint: Paint): string {
  return `${paint.name}${paint.code ? ` (${paint.code})` : ''}`;
}

function numberBadge(group: PaintGroup): HTMLElement {
  const rgb = hexToRgb(group.paint.hex);
  return el('span', { class: 'num', style: `background:${group.paint.hex};color:${contrastText(rgb)}` }, String(group.number));
}

export function renderGuide(container: HTMLElement, plan: PaintPlan, info: GuideInfo) {
  container.replaceChildren();
  const { groups } = plan;
  const magnets = info.model?.magnets.length ?? 0;
  const sizeText = info.model
    ? `${(info.model.max[0] - info.model.min[0]).toFixed(0)} × ${(info.model.max[1] - info.model.min[1]).toFixed(0)} × ${(info.model.max[2] - info.model.min[2]).toFixed(1)} mm`
    : '';
  const ranges = [...new Set(groups.map((g) => RANGE_LABELS[g.paint.range]))].join(' + ');
  const darkest = [...groups].sort((a, b) => rgbToLab(hexToRgb(a.paint.hex)).L - rgbToLab(hexToRgb(b.paint.hex)).L)[0];
  const edgePaint = darkest && rgbToLab(hexToRgb(darkest.paint.hex)).L < 20 ? darkest.paint.name : 'Matt Black';

  container.append(
    el(
      'header',
      { class: 'guide-header' },
      el('img', { class: 'guide-art', src: artDataUrl(plan, null, 8), alt: 'Pixel art' }),
      el(
        'div',
        {},
        el('h2', {}, `Painting guide: ${info.title}`),
        el(
          'p',
          { class: 'muted' },
          `${plan.width} × ${plan.height} pixels · ${sizeText} · ${groups.length} paint${groups.length === 1 ? '' : 's'} from Army Painter ${ranges}`,
        ),
      ),
    ),
  );

  // --- Shopping list ---------------------------------------------------------
  const rows = groups.map((g) => {
    const quality = matchQuality(g.deltaE);
    const notes: Child[] = [];
    if (g.sourceColours.length > 1) notes.push(el('div', {}, `Covers ${g.sourceColours.length} similar colours in the art.`));
    if (g.mix) {
      notes.push(
        el(
          'div',
          {},
          'Closer mix: ',
          ...g.mix.parts.flatMap((p, i) => [i ? ' + ' : '', `${p.parts} part${p.parts > 1 ? 's' : ''} ${p.paint.name}`]),
          ` ≈ `,
          swatch(rgbToHex(g.mix.result)),
          ` (ΔE ${g.mix.deltaE.toFixed(1)}; test on a palette first)`,
        ),
      );
    }
    if (quality === 'fair' || quality === 'poor') {
      notes.push(el('div', { class: 'muted' }, 'Also close: ', g.alternatives.map((a) => `${paintLabel(a.paint)} (ΔE ${a.deltaE.toFixed(1)})`).join(', ')));
    }
    return el(
      'tr',
      { 'data-group': String(g.number) },
      el('td', {}, numberBadge(g)),
      el('td', { class: 'swatches' }, ...g.sourceColours.slice(0, 4).map((c) => swatch(rgbToHex(c), 'Art colour ' + rgbToHex(c))), el('span', { class: 'arrow' }, '→'), swatch(g.paint.hex, g.paint.name)),
      el('td', {}, el('strong', {}, paintLabel(g.paint)), el('div', { class: 'muted' }, RANGE_LABELS[g.paint.range])),
      el('td', {}, el('span', { class: `quality ${quality}` }, quality), el('div', { class: 'muted' }, `ΔE ${g.deltaE.toFixed(1)}`)),
      el('td', { class: 'right' }, String(g.pixelCount)),
      el('td', { class: 'notes' }, ...notes),
    );
  });

  container.append(
    el(
      'section',
      {},
      el('h3', {}, 'Paints'),
      el(
        'table',
        { class: 'paint-table' },
        el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Art → paint'), el('th', {}, 'Army Painter paint'), el('th', {}, 'Match'), el('th', { class: 'right' }, 'Pixels'), el('th', {}, 'Notes'))),
        el('tbody', {}, ...rows),
      ),
      el(
        'p',
        { class: 'muted small' },
        'ΔE is the CIEDE2000 colour difference: under 2 is near-identical, 2–5 close, 5–10 noticeably different, and over 10 a different colour. Paint colours are on-screen approximations, so check them against the real pots. Click a row to highlight it on the chart.',
      ),
      el(
        'h4',
        {},
        'Also needed',
      ),
      el(
        'ul',
        { class: 'checklist' },
        el('li', {}, el('strong', {}, `Army Painter ${plan.primer.name}`), ` spray, because ${plan.primer.reason}.`),
        el('li', {}, el('strong', {}, edgePaint), ' for the sides and, optionally, the grooves.'),
        el('li', {}, el('strong', {}, 'Army Painter Anti-Shine Matt Varnish'), ' spray (or Gloss Varnish for a shiny, tougher finish).'),
        el('li', {}, `${magnets || 1} × neodymium disc magnet${magnets > 1 ? 's' : ''}, ${info.magnet.diameter} × ${info.magnet.thickness} mm, plus superglue gel or 5-minute epoxy.`),
        el('li', {}, 'A size 0–1 detail brush, a pot of water, and a wet palette or tile.'),
      ),
    ),
  );

  // --- Chart -----------------------------------------------------------------
  const chart = buildChart(plan);
  const highlightStyle = el('style', {});
  let highlighted = 0;
  const highlight = (n: number) => {
    highlighted = highlighted === n ? 0 : n;
    highlightStyle.textContent = highlighted ? `.chart g.cell:not(.g${highlighted}) { opacity: .15 }` : '';
    container.querySelectorAll('[data-group]').forEach((r) => r.classList.toggle('active', r.getAttribute('data-group') === String(highlighted)));
  };
  container.addEventListener('click', (e) => {
    const target = (e.target as Element).closest('[data-group]');
    if (target) highlight(Number(target.getAttribute('data-group')));
  });

  container.append(
    el(
      'section',
      { class: 'page-break' },
      el('h3', {}, 'Colour chart'),
      el('p', { class: 'muted small' }, 'Each pixel shows the number of its paint. Columns are numbered left to right, and rows top to bottom.'),
      highlightStyle,
      chart,
      el('div', { class: 'legend' }, ...groups.map((g) => el('span', { class: 'legend-item', 'data-group': String(g.number) }, numberBadge(g), g.paint.name))),
    ),
  );

  // --- Steps -----------------------------------------------------------------
  const primerIsWhite = plan.primer.name.includes('White');
  const colourSteps = groups.map((g) => {
    const L = rgbToLab(hexToRgb(g.paint.hex)).L;
    const tips: string[] = [];
    if (L > 70 && !primerIsWhite) tips.push('Light colour: build it up in 2–3 thin coats.');
    if (g.mix) tips.push(`For a closer match, mix ${g.mix.parts.map((p) => `${p.parts} ${p.paint.name}`).join(' : ')}.`);
    return el(
      'li',
      { class: 'colour-step', 'data-group': String(g.number) },
      el('img', { src: artDataUrl(plan, g.number - 1, 6), alt: `Pixels for paint ${g.number}` }),
      el(
        'div',
        {},
        el('div', {}, numberBadge(g), ' ', el('strong', {}, g.paint.name), ` — ${g.pixelCount} pixel${g.pixelCount === 1 ? '' : 's'}`),
        ...tips.map((t) => el('div', { class: 'muted small' }, t)),
      ),
    );
  });

  container.append(
    el(
      'section',
      { class: 'page-break' },
      el('h3', {}, 'Step by step'),
      el(
        'ol',
        { class: 'steps' },
        el('li', {}, el('strong', {}, 'Prepare the print. '), 'Trim any stringing, and clear the grooves with a hobby knife or a needle. Wash resin prints in IPA and fully cure them before you paint.'),
        el('li', {}, el('strong', {}, 'Prime. '), `Spray ${plan.primer.name} in two light passes from about 20–30 cm, in a warm, dry room. Let it dry for at least an hour.`),
        el(
          'li',
          {},
          el('strong', {}, 'Sides and grooves. '),
          `Paint the outer sides ${edgePaint}. For a crisp "pixel grid" look, run thinned ${edgePaint} into the grooves too. Don't worry about touching the pixel tops, as they get painted next.`,
        ),
        el(
          'li',
          {},
          el('strong', {}, 'Pixel tops, lightest colour first. '),
          'Use thin paint (add a drop of water) and two coats rather than one thick one. Pull the paint to the edge of each pixel without letting it run into the groove. Darker colours painted later hide small slips.',
          el('ol', { class: 'colour-steps' }, ...colourSteps),
        ),
        el('li', {}, el('strong', {}, 'Touch up. '), `Fix any overspill with the neighbouring pixel's colour, and re-line the grooves if needed.`),
        el(
          'li',
          {},
          el('strong', {}, 'Seal. '),
          'Leave the paint to dry overnight. Then apply two light coats of Anti-Shine Matt Varnish (for the most durable finish, use Gloss Varnish first and matt on top). Let it cure for 24 hours.',
        ),
        el(
          'li',
          {},
          el('strong', {}, 'Fit the magnet. '),
          `Scuff the pocket${magnets > 1 ? 's' : ''} lightly, add a small drop of superglue gel or epoxy, press the magnet${magnets > 1 ? 's' : ''} in flush, and leave to cure.`,
        ),
      ),
    ),
  );

  container.append(tipsSection(info));
}

function buildChart(plan: PaintPlan): SVGElement {
  const cell = 20;
  const margin = 22;
  const { width: w, height: h, groups } = plan;
  const root = svg('svg', {
    class: 'chart',
    viewBox: `0 0 ${w * cell + margin} ${h * cell + margin}`,
    // Keep small sprites from blowing up to fill the page.
    style: `max-width: ${(w * cell + margin) * 1.6}px`,
    role: 'img',
    'aria-label': 'Numbered colour chart',
  });
  const labelEvery = w > 40 || h > 40 ? 5 : 1;
  for (let x = 0; x < w; x++) {
    if ((x + 1) % labelEvery && x) continue;
    const t = svg('text', { x: margin + x * cell + cell / 2, y: margin - 7, class: 'axis' });
    t.textContent = String(x + 1);
    root.append(t);
  }
  for (let y = 0; y < h; y++) {
    if ((y + 1) % labelEvery && y) continue;
    const t = svg('text', { x: margin - 5, y: margin + y * cell + cell / 2 + 3.5, class: 'axis', 'text-anchor': 'end' });
    t.textContent = String(y + 1);
    root.append(t);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gi = plan.cells[y * w + x];
      const px = margin + x * cell;
      const py = margin + y * cell;
      if (gi === EMPTY) {
        root.append(svg('rect', { x: px, y: py, width: cell, height: cell, class: 'empty' }));
        continue;
      }
      const g = groups[gi];
      const group = svg('g', { class: `cell g${g.number}` });
      group.append(svg('rect', { x: px, y: py, width: cell, height: cell, fill: g.paint.hex, stroke: '#0003', 'stroke-width': 0.5 }));
      const t = svg('text', { x: px + cell / 2, y: py + cell / 2 + 3.5, fill: contrastText(hexToRgb(g.paint.hex)), 'text-anchor': 'middle', class: 'cell-num' });
      t.textContent = String(g.number);
      group.append(t);
      root.append(group);
    }
  }
  return root;
}

/** The art in paint colours, or one group highlighted against grey. */
function artDataUrl(plan: PaintPlan, onlyGroup: number | null, scale: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = plan.width * scale;
  canvas.height = plan.height * scale;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < plan.height; y++) {
    for (let x = 0; x < plan.width; x++) {
      const gi = plan.cells[y * plan.width + x];
      if (gi === EMPTY) continue;
      ctx.fillStyle = onlyGroup === null || gi === onlyGroup ? plan.groups[gi].paint.hex : '#E4E4E4';
      ctx.fillRect(x * scale, y * scale, scale, scale);
      if (onlyGroup !== null && gi !== onlyGroup) {
        ctx.fillStyle = '#CFCFCF';
        ctx.fillRect(x * scale, y * scale, scale, 1);
        ctx.fillRect(x * scale, y * scale, 1, scale);
      }
    }
  }
  return canvas.toDataURL('image/png');
}

function tipsSection(info: GuideInfo): HTMLElement {
  const { diameter: d, thickness: t } = info.magnet;
  const p = (...c: Child[]) => el('p', {}, ...c);
  const link = (href: string, text: string) => el('a', { href, target: '_blank', rel: 'noopener' }, text);
  return el(
    'section',
    { class: 'page-break tips' },
    el('h3', {}, 'Magnets'),
    p(
      `The model has a pocket for a ${d} × ${t} mm disc magnet. Neodymium (NdFeB) discs of grade N35 to N52 are ideal: a 10 × 3 mm N35 disc pulls with roughly 2 kg, far more than a 10–40 g printed magnet needs. On a fridge door it's the sideways grip that matters, which is a fraction of that pull, but it's still plenty. Pieces longer than about 8 cm get two or more magnets automatically, so they don't spin when someone bumps them.`,
    ),
    p(
      'Where to buy: in the UK, ',
      link('https://www.first4magnets.com', 'First4Magnets'),
      ' and ',
      link('https://www.magnetexpert.com', 'Magnet Expert'),
      '; in the EU, ',
      link('https://www.supermagnete.de', 'supermagnete'),
      '; in the US, ',
      link('https://www.kjmagnetics.com', 'K&J Magnetics'),
      '. Bulk packs of 10 × 2 mm or 10 × 3 mm discs on Amazon or eBay are cheap and fine for this. Their sizes vary, so measure one with calipers and adjust the pocket clearance.',
    ),
    p('Glue the magnet in with superglue gel or 5-minute epoxy. Polarity doesn’t matter on a steel fridge.'),
    p(
      el('strong', {}, 'Safety: '),
      'neodymium magnets are dangerous if swallowed, especially two or more. Glue them in securely, and keep loose magnets and finished pieces away from small children and pets.',
    ),
    el('h3', {}, 'Sealing'),
    p(
      'Fridge magnets get handled a lot, so seal them. Army Painter Anti-Shine Matt Varnish (spray) keeps the flat pixel look. For more durability, apply Gloss Varnish first and then matt on top, since gloss is the tougher coat. Spray on a dry day: matt varnish can turn cloudy ("frost") in high humidity.',
    ),
    p(
      'Brush-on water-based polyurethane (such as Polycrylic) is a very hard-wearing alternative. Use thin coats so the grooves don’t fill. Give any varnish 24 hours before handling.',
    ),
    el('h3', {}, 'Printing'),
    el(
      'ul',
      {},
      el('li', {}, 'Print face up: the magnet pocket opens onto the build plate, so no supports are needed.'),
      el('li', {}, 'Use white or light grey PLA, 0.12–0.16 mm layers, and at least 4 top layers. Turn on ironing for the top surfaces to get smooth, flat pixels that are easy to paint.'),
      el('li', {}, `A 0.4 mm nozzle copes with grooves of 0.6 mm or more; use a 0.2–0.25 mm nozzle (or resin) for smaller pixels. Check the slicer preview to make sure the grooves are open.`),
      el('li', {}, `If the magnet is a tight fit, raise the clearance by 0.05–0.1 mm. If it's loose, glue fills the gap. ${info.pixelSize ? `Each pixel is ${info.pixelSize} mm.` : ''}`),
    ),
  );
}
