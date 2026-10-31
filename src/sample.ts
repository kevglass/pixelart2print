import type { ImageLike } from './pixelArt';

// Small original sprites so the app has something to show on first load.
export const SAMPLE_SPRITES = {
  pumpkin: [
    '.......kk.......',
    '......kgGk......',
    '...kkkkgGkkkk...',
    '..kyoodoooodook.',
    '.kyyoodoooodoook',
    '.kyoodoooooodook',
    'koooffoodooffook',
    'kyooffoodooffodk',
    'kyoooooffoooodok',
    'kyofoooodooofodk',
    'kyoffffffffffodk',
    '.kooffoffoffook.',
    '.kdooodoooododdk',
    '..kkddooooodddk.',
    '....kkkkkkkkk...',
  ],
  ghost: [
    '....KKKK....',
    '..KKwwwwKK..',
    '.KwwwwwwwwK.',
    '.KwwwwwwwwK.',
    'KwwKKwwKKwwK',
    'KwwKKwwKKwwK',
    'KwpwwwwwwpwK',
    'KwwwwKKwwwwK',
    'KwwwwKKwwwwK',
    'KwwwwwwwwwwK',
    'KwwwwwwwwwwK',
    'KwwKwwwwKwwK',
    '.KK.KKKK.KK.',
  ],
};

const COLOURS: Record<string, [number, number, number]> = {
  k: [42, 26, 16],
  o: [240, 138, 36],
  d: [196, 88, 26],
  y: [255, 195, 90],
  g: [74, 143, 60],
  G: [46, 92, 42],
  f: [58, 22, 6],
  K: [43, 43, 58],
  w: [236, 236, 244],
  p: [244, 166, 184],
};

// Where each sprite sits on the sample sheet, in art pixels.
const SHEET = {
  width: 32,
  height: 17,
  placements: [
    { rows: SAMPLE_SPRITES.pumpkin, x: 1, y: 1 },
    { rows: SAMPLE_SPRITES.ghost, x: 19, y: 2 },
  ],
};

/** A two-sprite sheet on a transparent background, upscaled the way pixel art is usually shared. */
export function sampleSheet(scale = 10): ImageLike {
  const width = SHEET.width * scale;
  const height = SHEET.height * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  for (const { rows, x: ox, y: oy } of SHEET.placements) {
    rows.forEach((row, ry) => {
      [...row].forEach((ch, rx) => {
        const rgb = COLOURS[ch];
        if (!rgb) return;
        for (let y = (oy + ry) * scale; y < (oy + ry + 1) * scale; y++) {
          for (let x = (ox + rx) * scale; x < (ox + rx + 1) * scale; x++) data.set([...rgb, 255], (y * width + x) * 4);
        }
      });
    });
  }
  return { width, height, data };
}
