import type { ImageLike } from './pixelArt';
import type { Rect } from './sprites';

export interface SheetEvents {
  /** A click without dragging, in image pixels. */
  onPick(x: number, y: number): void;
  /** A dragged rectangle in image pixels, snapped to the art-pixel grid. */
  onDrag(rect: Rect): void;
  /** Arrow keys: previous (-1) or next (+1) sprite. */
  onStep(direction: number): void;
}

const MAX_HEIGHT = 320; // CSS px
const DRAG_THRESHOLD = 4; // CSS px before a press counts as a drag

const contains = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** Shows the whole uploaded image, its detected sprites and the current selection. */
export class SheetView {
  private source?: HTMLCanvasElement;
  private sprites: Rect[] = [];
  private selection?: Rect;
  private snap = 1;
  private hover = -1;
  private zoom = 1; // CSS px per image px
  private drag?: { x: number; y: number; clientX: number; clientY: number; rect?: Rect };

  constructor(
    private canvas: HTMLCanvasElement,
    private events: SheetEvents,
  ) {
    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
    canvas.addEventListener('pointerleave', () => this.setHover(-1));
    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        events.onStep(e.key === 'ArrowLeft' ? -1 : 1);
      }
    });
    new ResizeObserver(() => this.render()).observe(canvas.parentElement!);
  }

  setImage(image: ImageLike) {
    const copy = document.createElement('canvas');
    copy.width = image.width;
    copy.height = image.height;
    copy.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
    this.source = copy;
    this.render();
  }

  /** Sprite boxes in image pixels, and the size of one art pixel to snap drags to. */
  setSprites(sprites: Rect[], snap: number) {
    this.sprites = sprites;
    this.snap = snap;
    this.hover = -1;
    this.render();
  }

  setSelection(rect: Rect) {
    this.selection = rect;
    this.render();
  }

  private toImage(e: PointerEvent): [number, number] {
    const bounds = this.canvas.getBoundingClientRect();
    const w = this.source?.width ?? 1;
    const h = this.source?.height ?? 1;
    return [
      Math.min(w - 1e-6, Math.max(0, (e.clientX - bounds.left) / this.zoom)),
      Math.min(h - 1e-6, Math.max(0, (e.clientY - bounds.top) / this.zoom)),
    ];
  }

  private snapped(ax: number, ay: number, bx: number, by: number): Rect {
    const s = this.snap;
    const x0 = Math.floor(Math.min(ax, bx) / s) * s;
    const y0 = Math.floor(Math.min(ay, by) / s) * s;
    const x1 = Math.min(this.source!.width, (Math.floor(Math.max(ax, bx) / s) + 1) * s);
    const y1 = Math.min(this.source!.height, (Math.floor(Math.max(ay, by) / s) + 1) * s);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private pointerDown(e: PointerEvent) {
    if (!this.source || e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.toImage(e);
    this.drag = { x, y, clientX: e.clientX, clientY: e.clientY };
  }

  private pointerMove(e: PointerEvent) {
    const [x, y] = this.toImage(e);
    if (!this.drag) {
      this.setHover(this.sprites.findIndex((r) => contains(r, x, y)));
      return;
    }
    const moved = Math.hypot(e.clientX - this.drag.clientX, e.clientY - this.drag.clientY) > DRAG_THRESHOLD;
    if (moved || this.drag.rect) {
      this.drag.rect = this.snapped(this.drag.x, this.drag.y, x, y);
      this.render();
    }
  }

  private pointerUp(e: PointerEvent) {
    const drag = this.drag;
    this.drag = undefined;
    if (!drag) return;
    if (drag.rect) this.events.onDrag(drag.rect);
    else this.events.onPick(...this.toImage(e));
  }

  private setHover(index: number) {
    if (index === this.hover) return;
    this.hover = index;
    this.canvas.style.cursor = index >= 0 ? 'pointer' : 'crosshair';
    this.render();
  }

  private render() {
    const src = this.source;
    if (!src) return;
    const available = this.canvas.parentElement!.clientWidth;
    if (!available) return;
    this.zoom = Math.min(available / src.width, MAX_HEIGHT / src.height);
    const cssW = src.width * this.zoom;
    const cssH = src.height * this.zoom;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);

    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const style = getComputedStyle(this.canvas);
    const accent = style.getPropertyValue('--accent').trim() || '#d2571a';

    // Checkerboard behind transparent pixels.
    const tile = 8;
    for (let y = 0; y < cssH; y += tile) {
      for (let x = 0; x < cssW; x += tile) {
        ctx.fillStyle = ((x + y) / tile) % 2 ? style.getPropertyValue('--checker-a') : style.getPropertyValue('--checker-b');
        ctx.fillRect(x, y, tile, tile);
      }
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, cssW, cssH);

    const z = this.zoom;
    const box = (r: Rect, inset: number) => [r.x * z + inset, r.y * z + inset, r.w * z - inset * 2, r.h * z - inset * 2] as const;

    const selection = this.drag?.rect ?? this.selection;
    if (selection) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.rect(0, 0, cssW, cssH);
      ctx.rect(...box(selection, 0));
      ctx.fill('evenodd');
    }

    ctx.strokeStyle = accent;
    this.sprites.forEach((r, i) => {
      ctx.globalAlpha = i === this.hover ? 1 : 0.55;
      ctx.lineWidth = i === this.hover ? 2 : 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(...box(r, 0.5));
    });
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    if (selection) {
      ctx.lineWidth = 2;
      ctx.strokeRect(...box(selection, 1));
    }
  }
}
