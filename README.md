# pixelart2print

Turn a piece of pixel art into a 3D-printable fridge magnet plus a painting guide for Army Painter paints.

- **Model:** a single-colour print where every pixel is a raised tile with a shallow groove between neighbours, and a pocket in the back for a disc magnet. Export it as STL or 3MF, or send it straight to Bambu Studio.
- **Painting guide:** matches each colour in the art to the closest Army Painter Warpaints paint. It gives you a numbered paint-by-numbers chart, a step for each colour in painting order, a primer suggestion, and advice on magnets, sealing and printing. You can print it or save it as a PDF.

Everything runs in the browser. Geometry is built with [manifold-3d](https://github.com/elalish/manifold), so the output is always a watertight, manifold mesh.

## Getting started

```sh
npm install
npm run dev       # http://localhost:5200
```

Drop, paste or choose an image or sprite sheet. A small sample sheet (a pumpkin and a ghost) loads on first start.

| Command | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck and build static files into `dist/` |
| `npm run preview` | Serve the built app, including the Bambu Studio bridge |
| `npm test` | Unit tests (colour maths, pixel extraction, geometry, exports) |
| `npm run build:paints` | Regenerate the paint list from the source dataset |

### Open in Bambu Studio

Bambu Studio opens models from a link, but only by downloading a `.3mf` from an http(s) URL. A file made in the browser doesn't have one, so the dev and preview servers include a small endpoint ([server/modelShare.ts](server/modelShare.ts)). The page uploads the 3MF to it, then launches `bambustudioopen://…` on macOS or `bambustudio://open?file=…` on Windows and Linux.

- Bambu Studio's downloader only connects over IPv4, so the servers listen on `127.0.0.1`. On macOS, Node would otherwise bind `localhost` to IPv6 only and the import fails.
- Newer versions of Bambu Studio ask whether to open a file "not from a trusted site", because only MakerWorld is trusted. Choose **Yes**.
- Each download is logged in the `npm run dev` terminal.

**One filament: Generic PLA.** A plain 3MF opens with whatever filament slots Bambu Studio has loaded. So when Bambu Studio is installed, the server writes the 3MF as a Bambu Studio project ([server/bambuProfile.ts](server/bambuProfile.ts)) with a single white **Generic PLA** filament.
- It uses the printer, process and plate currently selected in Bambu Studio, and the Generic PLA preset made for that printer (on a P1P, that's "Generic PLA High Speed").
- If you've selected a user preset, its system parent is used instead.
- The settings are written in full, resolved from Bambu Studio's own system presets, the way Bambu Studio saves projects. Bambu Studio then sees them as unmodified system presets.
- A project file that only names the presets is not enough: Bambu Studio's loader and slicer crash on one.
- The presets in use are shown under the preview. Both the **3MF** button and **Open in Bambu Studio** use them.
- Without Bambu Studio, or when hosted as static files, the 3MF is plain, and the button downloads it instead.

## Using it

**Pixel art input.** PNG or GIF with exact colours works best; JPEG noise is read as extra colours.
- **Sprite sheets:** the whole image is shown above the 3D preview, with each detected sprite outlined. Click a sprite to make a magnet from it, step through them with ◀ ▶ or the arrow keys, or drag to select any area (the selection snaps to the art's pixel grid). *Whole image* uses everything. The first sprite is selected when a sheet loads.
- Sprites are found as separate groups of pixels on a transparent or removed background. Sprites that touch are treated as one, so drag a selection to separate them.
- Art that has been upscaled (each art pixel drawn as an N×N block) is detected automatically. You can override this with *Pixel scale*.
- Transparent pixels are left out of the model.
- For art on a solid background, *Remove solid background* flood-fills from the edges, so enclosed areas of the same colour (white eyes on a white background, for example) are kept.
- *Max paints* merges similar colours (k-means in Lab space) if the art has more colours than you want to buy.

**Model settings** (defaults in brackets):

| Setting | Default | |
|---|---|---|
| Pixel size | auto, ~70 mm longest side | Size of one art pixel |
| Pixel height | 1 mm | How far tiles stand above the groove floor |
| Groove width | 0.6 mm | At least 0.4 mm for FDM |
| Base thickness | 4 mm | From the back to the groove floor; must leave about 0.8 mm above the magnet |
| Backing | Follow the art | Or a rectangle |
| Border | 0 mm | Rounded rim around the art; joins separate islands |
| No grooves between same colour | off | Merges same-colour areas into one tile |
| Magnet | 10 × 3 mm, auto count, 0.15 mm clearance | One magnet up to 8 cm, two up to 13 cm, then four |

Pixels that touch only at a corner are bridged in the base so the magnet prints as one piece. The app warns you if parts are still separate, if the magnet doesn't fit, or if the material above the pocket is too thin.

## The painting guide

Colours are matched with **CIEDE2000** (ΔE): under 2 is near-identical, 2–5 is close, 5–10 is noticeably different, and over 10 is a different colour.
- **Warpaints Fanatic** (the current range) is used by default. Classic Warpaints can be added.
- Speedpaints, washes and metallics are excluded, because they don't give a flat, opaque pixel colour. Metallics can be switched back on.
- When no single pot is close, the guide suggests a simple two-paint mix. It estimates the result with a subtractive, geometric-mean model, so treat it as a starting point and test on a palette.

Paint colour data comes from [Arcturus5404/miniature-paints](https://github.com/Arcturus5404/miniature-paints) (MIT, © 2022 Rick Fleuren). The hex values are approximations of the bottled paint, so check them against the real pots.

Paints are numbered **lightest first**. Light colours cover poorly, and any overspill is then hidden by the darker colours that follow.

## Magnets

- **Type:** neodymium (NdFeB) discs, grade N35–N52. A 10 × 3 mm N35 disc pulls about 2 kg, far more than a 10–40 g print needs. On a fridge door the sideways grip is what counts, and it's a fraction of that pull but still plenty. Larger pieces get extra magnets so they don't spin when bumped.
- **Sizes:** 10 × 2 mm or 10 × 3 mm for most pieces; 12 × 3 mm for big ones. Ferrite (ceramic) magnets are cheaper but much weaker, so they would need a far larger pocket.
- **Where to buy:**
  - UK: [First4Magnets](https://www.first4magnets.com), [Magnet Expert](https://www.magnetexpert.com)
  - EU: [supermagnete](https://www.supermagnete.de)
  - US: [K&J Magnetics](https://www.kjmagnetics.com)
  - Bulk packs on Amazon or eBay are fine for this. Sizes vary by ±0.1 mm, so measure one with calipers and adjust *Fit clearance*.
- **Fitting:** superglue gel or 5-minute epoxy. Polarity doesn't matter on a steel fridge.
- **Safety:** swallowed neodymium magnets (especially two or more) can cause serious internal injuries. Glue them in well, and keep loose magnets away from children and pets.

## Sealing

Fridge magnets get handled, so seal them once the paint has dried overnight.

- **Army Painter Anti-Shine Matt Varnish** (spray) keeps the flat pixel look.
- For extra toughness, apply **Gloss Varnish** first, then matt on top.
- Spray on a dry day: matt varnish can frost (turn cloudy) in humid air.
- Brush-on water-based polyurethane (such as Polycrylic) is very hard-wearing. Keep coats thin so the grooves stay open.
- Allow 24 hours to cure.

## Printing tips

- **Orientation:** print face up. The magnet pocket opens onto the plate, so no supports are needed.
- **Settings:** white or light grey PLA, 0.12–0.16 mm layers, and 4 or more top layers. Turn on ironing for smooth, flat tiles.
- **Nozzle:** a 0.4 mm nozzle handles 0.6 mm grooves. For small pixels, use a 0.2 mm nozzle or resin.
- **Priming:** use Army Painter Colour Primer. The guide picks Matt White, Uniform Grey or Matt Black from the overall lightness of the art.

## Project layout

```
src/
  main.ts            UI wiring
  pixelArt.ts        image → pixel grid: scale detection, background removal, palette reduction
  sprites.ts         sprite detection on sheets, cropping
  sheetView.ts       source image view: sprite outlines, click/drag selection
  color.ts           sRGB/Lab, CIEDE2000, paint mixing estimate
  paintMatch.ts      nearest paints, mix suggestions
  paintPlan.ts       group colours by paint, painting order, primer choice
  model.ts           geometry (manifold-3d): outline, grooved tiles, magnet placement
  stl.ts, threemf.ts exporters
  preview.ts         three.js viewer with painted/printed modes
  guide.ts           painting guide (printable)
  paints/            generated Army Painter colour data
server/modelShare.ts dev/preview middleware that hosts models for Bambu Studio
server/bambuProfile.ts Bambu Studio project settings (one Generic PLA filament) from the local install
scripts/             paint data generator
test/                vitest suites
```
