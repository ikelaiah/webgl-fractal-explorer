# 🌀 WebGL Fractal Explorer ✨

[![Version](https://img.shields.io/badge/version-1.3.0-7df0c0?style=for-the-badge)](CHANGELOG.md)
[![WebGL](https://img.shields.io/badge/WebGL-1.0-2a7fff?style=for-the-badge&logo=webgl&logoColor=white)](https://www.khronos.org/webgl/)
[![No Build](https://img.shields.io/badge/no_build-static_HTML-f0b45a?style=for-the-badge)](#-run-locally)
[![License](https://img.shields.io/badge/license-MIT-8a5cf6?style=for-the-badge)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub_Pages-ffffff?style=for-the-badge&logo=github&logoColor=111111)](https://ikelaiah.github.io/webgl-fractal-explorer/)

[![JavaScript](https://img.shields.io/badge/JavaScript-ES2020-f7df1e?style=flat-square&logo=javascript&logoColor=111111)](app.js)
[![HTML5](https://img.shields.io/badge/HTML5-canvas-e34f26?style=flat-square&logo=html5&logoColor=white)](index.html)
[![CSS3](https://img.shields.io/badge/CSS3-responsive-1572b6?style=flat-square&logo=css3&logoColor=white)](styles.css)
[![Web Workers](https://img.shields.io/badge/Web_Workers-CPU_refinement-7df0c0?style=flat-square)](app.js)
[![Precision](https://img.shields.io/badge/precision-triple--single_~72bit-2a7fff?style=flat-square)](#-precision)
[![Fractals](https://img.shields.io/badge/fractals-65-ff8a2e?style=flat-square)](#-fractal-catalog)
[![Mobile](https://img.shields.io/badge/mobile-bottom_sheet_UI-14d1ff?style=flat-square)](styles.css)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-89f294?style=flat-square)](#-run-locally)

An interactive 2D fractal explorer that runs entirely in the browser. WebGL keeps navigation fast, while the JavaScript/Web Worker refinement layer adds crisp CPU and perturbation-assisted detail for deep zooms.

Explore dozens of fractal families, follow guided tours, compare formulas side-by-side, export PNGs, share exact camera states, and inspect the render pipeline without installing anything.

## ✨ Features

- 🌀 **65 fractals** across 12 categories: Classic, Julia, Power, Folded, Perpendicular, Dynamic, Transcendental, Box Fold, Mandelbar, Rational, Basins, and Orbit Trap
- 🔬 **Triple-single precision** coordinate arithmetic (~72 bits) in GLSL shaders, enabling zoom depths to ~10¹⁴×
- ⚡ **CPU refinement mode** via Web Workers (up to 30 workers, browser hint permitting) with progressive multi-pass rendering
- 🧪 **Perturbation-assisted Mandelbrot refinement** with diagnostics for reference orbit length and fallback sampling
- 🧭 **Guided tours** with curated stops, playback controls, and shareable route state
- 🪟 **Split-screen compare mode** with a shared camera and independent fractal/tone controls
- 📤 **PNG export** plus copyable active formulas and URL sharing
- 🎨 **5 accent palettes** with cosine, monotone, and duotone rendering styles plus adjustable cycle offset
- 🌈 **Basin coloring** for Newton/Halley fractals (3- and 4-root variants)
- 🎯 **Orbit trap coloring** with custom shapes (circle/cross, flower petals, lotus, rose)
- 🧭 **Per-fractal view memory** — each fractal remembers your last camera position
- 🗺️ **Minimap** overview with live viewport indicator
- 🔗 **URL sharing** — every view state is encodable as a link
- 📱 **Responsive HUD** with a desktop panel and mobile bottom-sheet layout
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
| `T` | Cycle tone style |
| `B` | Toggle basin/escape color mode |
| `X` | Toggle CPU refinement |
| `R` | Reset view |
| `C` | Copy share link |
| `H` | Hide/show controls panel |
| `W` / `A` / `S` / `D` or arrow keys | Pan |
| `+` / `-` | Zoom in/out |

Additional controls in the HUD panel:

- **Fractal** — dropdown selector, grouped by category
- **Iterations** — 32–512, step 8
- **Color** — palette cycle offset
- **Tone** — cosine palette, monotone, or duotone coloring
- **Parameter** — Julia angle slider (for parameterised Julia sets)
- **Julia C** — real/imaginary inputs with randomise button (for fixed-seed Julia sets)
- **Refine** — toggle CPU high-precision overlay
- **Share** — copy current view as URL
- **Export** — save the composed view as PNG
- **Tours** — pick curated routes and step or play through notable regions
- **Inspector** — read camera coordinates, render mode, perturbation health, and reference orbit status
- **Compare** — split the viewport between two fractals using the same camera

## 🛠️ Implementation Notes

### 🖥️ GPU rendering

Each fractal is a standalone GLSL fragment shader compiled at startup. Pixel coordinates are reconstructed from triple-single-precision uniforms (`uX0`, `uY0`, `uScale`) to maintain floating-point accuracy at deep zooms.

Smooth colouring uses the standard log-iteration formula, then maps that value through the selected tone style:

```
sm = iter - log2(max(1, log2(|z|²))) + 4
```

### 🧠 CPU refinement

Enabled by the **Refine** button. A browser-sized pool of Web Workers renders the deep canvas in progressive passes (4 → 2 → 1 pixel blocks). The CPU path mirrors every GPU formula exactly, including basin root identification and orbit trap distances.

Performance optimisations in the CPU inner loop:

- **Specialized per-formula escape functions** for Mandelbrot, Julia, and Burning Ship — the three hottest formulas get their own tight inner loops, eliminating the large branch tower on each iteration and letting V8 inline aggressively
- **Integer formula dispatch** — per-pixel `formula === "..."` string comparisons replaced with an integer `FORMULA_ID` switch
- **Cardioid/period-2 bulb early exit** for the classic Mandelbrot set, skipping the iteration loop for points provably inside
- **Periodicity detection** — a slow-moving reference point is compared against `z` every few iterations (with exponential back-off up to 512); interior points that enter a cycle exit immediately instead of burning the full iteration budget. Huge win on black regions at deep zoom
- **Zero-allocation hot loop** — escape samples and colours write into reusable scratch objects (`_SAMPLE`, `_COLOR`, `_BASIN_COLOR`) instead of allocating per pixel
- **Inlined `Math.abs` / `Math.hypot` / clamp** calls via ternary expressions
- **Init-once worker protocol** — the per-pass snapshot is sent to each worker once, not with every batch message, cutting postMessage payload by ~1000× on a full-frame pass

### 🔎 Deep-zoom drag preview

At zoom levels above 10⁴× the GPU pixel grid becomes visibly blocky. When **Refine** is on and a drag begins past this threshold, a coarse CPU render fires immediately on the drag-start viewport. The refined canvas is offset via CSS `transform: translate() scale()` as you drag or zoom — zero re-render cost — so the fractal shape stays visually anchored while the next full refinement catches up.

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
