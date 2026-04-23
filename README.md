# WebGL Fractal Explorer ✨

An interactive 2D fractal playground that runs entirely in the browser. It uses WebGL for fast GPU rendering, plus a JavaScript/Web Worker CPU refinement path for crisp deep-zoom detail.

## ✨ Features

- 🌀 **65 fractals** across 12 categories: Classic, Julia, Power, Folded, Perpendicular, Dynamic, Transcendental, Box Fold, Mandelbar, Rational, Basins, and Orbit Trap
- 🔬 **Triple-single precision** coordinate arithmetic (~72 bits) in GLSL shaders, enabling zoom depths to ~10¹⁴×
- ⚡ **CPU refinement mode** via Web Workers (up to 8 workers) with progressive multi-pass rendering
- 🎨 **5 cosine color palettes** with adjustable cycle offset
- 🌈 **Basin coloring** for Newton/Halley fractals (3- and 4-root variants)
- 🎯 **Orbit trap coloring** with custom shapes (circle/cross, flower petals, lotus, rose)
- 🧭 **Per-fractal view memory** — each fractal remembers your last camera position
- 🗺️ **Minimap** overview with live viewport indicator
- 🔗 **URL sharing** — every view state is encodable as a link
- ⌨️ **Keyboard shortcuts** for fast navigation

## 🧬 Fractal Catalog

| Category | Fractals |
|---|---|
| Classic | Mandelbrot Set, Burning Ship, Tricorn (Mandelbar) |
| Julia | Julia Set, Phoenix Julia × 2, Burning Ship Julia × 3, Dendrite Julia, San Marco Dragon Julia, Tricorn Julia, Celtic Julia, Buffalo Julia, Perpendicular Julia, Cubic Julia, Quartic Julia × 3, Douady Rabbit Julia, Glynn Julia × 2, Sine Julia × 2, Mandelbar Julia, Rational Julia Lace, Nova Julia Bloom, Zubieta Julia × 2 |
| Power | Cubic Multibrot, Quartic Multibrot, Quintic Multibrot, Octic Multibrot |
| Folded | Celtic Mandelbrot, Buffalo, Celtic Heart, Cubic Burning Ship, Quartic Burning Ship |
| Perpendicular | Perpendicular Mandelbrot, Perpendicular Buffalo, Perpendicular Burning Ship |
| Dynamic | Lambda Mandelbrot, Spider |
| Transcendental | Sine Mandelbrot, Cosine Mandelbrot, Exponential Mandelbrot |
| Box Fold | Mandelbox |
| Mandelbar | Cubic Mandelbar |
| Rational | Magnet Type I, Magnet Type II, Feather, Rational Mandelbrot Lace |
| Basins | Newton Cubic, Nova, Newton Quartic, Relaxed Newton Spiral, Relaxed Newton Storm, Halley Cubic, Newton Quintic |
| Orbit Trap | Orbit Trap Mandelbrot, Orbit Trap Flower, Orbit Trap Lotus, Orbit Trap Rose Julia, Orbit Trap Star, Orbit Trap Web |

## 🎮 Controls

| Input | Action |
|---|---|
| Drag | Pan |
| Scroll / Pinch | Zoom in/out |
| `F` | Next fractal |
| `Shift+F` | Previous fractal |
| `P` | Cycle palette |
| `B` | Toggle basin/escape color mode |
| `X` | Toggle CPU refinement |
| `R` | Reset view |
| `C` | Copy share link |
| `H` | Hide/show controls panel |
| `W` / `A` / `S` / `D` or arrow keys | Pan |
| `+` / `-` | Zoom in/out |

Additional controls in the HUD panel:

- **Fractal** — dropdown selector, grouped by category
- **Iterations** — 32–1024, step 8
- **Color** — palette cycle offset
- **Parameter** — Julia angle slider (for parameterised Julia sets)
- **Julia C** — real/imaginary inputs with randomise button (for fixed-seed Julia sets)
- **Refine** — toggle CPU high-precision overlay
- **Share** — copy current view as URL

## 🛠️ Implementation Notes

### 🖥️ GPU rendering

Each fractal is a standalone GLSL fragment shader compiled at startup. Pixel coordinates are reconstructed from triple-single-precision uniforms (`uX0`, `uY0`, `uScale`) to maintain floating-point accuracy at deep zooms.

Smooth colouring uses the standard log-iteration formula:

```
sm = iter - log2(max(1, log2(|z|²))) + 4
```

### 🧠 CPU refinement

Enabled by the **Refine** button. A pool of up to 8 Web Workers renders the deep canvas in progressive passes (8 → 4 → 2 → 1 pixel blocks). The CPU path mirrors every GPU formula exactly, including basin root identification and orbit trap distances.

Performance optimisations in the CPU inner loop:

- **Specialized per-formula escape functions** for Mandelbrot, Julia, and Burning Ship — the three hottest formulas get their own tight inner loops, eliminating the large branch tower on each iteration and letting V8 inline aggressively
- **Integer formula dispatch** — per-pixel `formula === "..."` string comparisons replaced with an integer `FORMULA_ID` switch
- **Cardioid/period-2 bulb early exit** for the classic Mandelbrot set, skipping the iteration loop for points provably inside
- **Periodicity detection** — a slow-moving reference point is compared against `z` every few iterations (with exponential back-off up to 512); interior points that enter a cycle exit immediately instead of burning the full iteration budget. Huge win on black regions at deep zoom
- **Zero-allocation hot loop** — escape samples and colours write into reusable scratch objects (`_SAMPLE`, `_COLOR`, `_BASIN_COLOR`) instead of allocating per pixel
- **Inlined `Math.abs` / `Math.hypot` / clamp** calls via ternary expressions
- **Init-once worker protocol** — the per-pass snapshot is sent to each worker once, not with every batch message, cutting postMessage payload by ~1000× on a full-frame pass

### 🔎 Deep-zoom drag preview

At zoom levels above 10⁵× the GPU pixel grid becomes visibly blocky. When **Refine** is on and a drag begins past this threshold, a coarse pass-0 (8 px blocks) CPU render fires immediately on the drag-start viewport. The preview canvas is offset via CSS `transform: translate()` as you drag — zero re-render cost — so the fractal shape slides with the pointer. The translate is held in place after pointer-up, then cleared the moment the full 4-pass refinement paints its first frame, eliminating the stale-frame flash.

### 📐 Precision

- GPU: triple-single arithmetic (~72-bit mantissa, pixelation deferred to ~10¹⁴× zoom)
- CPU: native JavaScript `number` (64-bit double, ~15 significant digits)

## 🚀 Run Locally

Clone the project:

```bash
git clone https://github.com/ikelaiah/webgl-fractal-explorer.git
cd webgl-fractal-explorer
```

No build step required. Open `index.html` directly in any WebGL-capable browser, or serve the directory with any static file server:

```bash
npx serve .
# or
python -m http.server
```

Then open the local URL shown by the server. For `python -m http.server`, the default is:

```text
http://localhost:8000
```

## 🌍 Live Demo

The app is published with GitHub Pages:

```text
https://ikelaiah.github.io/webgl-fractal-explorer/
```

## 🌐 Browser Support

Requires WebGL 1.0 and `highp float` fragment shader precision. Supported in all modern desktop browsers (Chrome, Firefox, Safari, Edge).

## 📁 File Structure

```
index.html      — application shell and UI
fractals.js     — GLSL shaders, fractal registry, coloring utilities
app.js          — rendering loop, CPU workers, input handling, state management
styles.css      — HUD and layout styles
```
