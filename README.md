# WebGL Fractal Explorer

An interactive 2D fractal explorer running entirely in the browser, using WebGL for GPU-accelerated rendering and a JavaScript/Web Worker CPU path for high-precision refinement.

## Features

- **56 fractals** across 13 categories: Classic, Julia, Power, Folded, Perpendicular, Dynamic, Transcendental, Box Fold, Mandelbar, Rational, Basins, and Orbit Trap
- **Triple-single precision** coordinate arithmetic (~72 bits) in GLSL shaders, enabling zoom depths to ~10¹⁴×
- **CPU refinement mode** via Web Workers (up to 8 workers) with progressive multi-pass rendering
- **5 cosine color palettes** with adjustable cycle offset
- **Basin coloring** for Newton/Halley fractals (3- and 4-root variants)
- **Orbit trap coloring** with custom shapes (circle/cross, flower petals, lotus, rose)
- **Per-fractal view memory** — each fractal remembers your last camera position
- **Minimap** overview with live viewport indicator
- **URL sharing** — every view state is encodable as a link
- **Keyboard shortcuts** for fast navigation

## Fractal Catalog

| Category | Fractals |
|---|---|
| Classic | Mandelbrot Set, Burning Ship, Tricorn (Mandelbar) |
| Julia | Julia Set, Phoenix Julia × 2, Burning Ship Julia × 3, Dendrite Julia, San Marco Dragon Julia, Tricorn Julia, Celtic Julia, Buffalo Julia, Perpendicular Julia, Cubic Julia, Quartic Julia × 2, Douady Rabbit Julia, Glynn Julia × 2, Sine Julia × 2, Mandelbar Julia, Rational Julia Lace, Nova Julia Bloom, Orbit Trap Rose Julia |
| Power | Cubic Multibrot, Quartic Multibrot, Quintic Multibrot, Octic Multibrot |
| Folded | Celtic Mandelbrot, Buffalo, Celtic Heart, Cubic Burning Ship, Quartic Burning Ship |
| Perpendicular | Perpendicular Mandelbrot, Perpendicular Buffalo |
| Dynamic | Lambda Mandelbrot, Spider |
| Transcendental | Sine Mandelbrot, Cosine Mandelbrot |
| Box Fold | Mandelbox |
| Mandelbar | Cubic Mandelbar |
| Rational | Magnet Type I, Feather, Rational Mandelbrot Lace |
| Basins | Newton Cubic, Nova, Newton Quartic, Relaxed Newton Spiral, Relaxed Newton Storm, Halley Cubic |
| Orbit Trap | Orbit Trap Mandelbrot, Orbit Trap Flower, Orbit Trap Lotus |

## Controls

| Input | Action |
|---|---|
| Drag | Pan |
| Scroll / Pinch | Zoom in/out |
| `F` | Next fractal |
| `Shift+F` | Previous fractal |
| `P` | Cycle palette |
| `B` | Toggle basin/escape color mode |
| `R` | Reset view |
| `C` | Copy share link |

Additional controls in the HUD panel:
- **Fractal** — dropdown selector, grouped by category
- **Iterations** — 32–1024, step 8
- **Color** — palette cycle offset
- **Parameter** — Julia angle slider (for parameterised Julia sets)
- **Julia C** — real/imaginary inputs with randomise button (for fixed-seed Julia sets)
- **Refine** — toggle CPU high-precision overlay
- **Share** — copy current view as URL

## Implementation Notes

### GPU rendering

Each fractal is a standalone GLSL fragment shader compiled at startup. Pixel coordinates are reconstructed from triple-single-precision uniforms (`uX0`, `uY0`, `uScale`) to maintain floating-point accuracy at deep zooms.

Smooth colouring uses the standard log-iteration formula:

```
sm = iter - log2(max(1, log2(|z|²))) + 4
```

### CPU refinement

Enabled by the **Refine** button. A pool of up to 8 Web Workers renders the deep canvas in progressive passes (8 → 4 → 2 → 1 pixel blocks). The CPU path mirrors every GPU formula exactly, including basin root identification and orbit trap distances.

### Precision

- GPU: triple-single arithmetic (~72-bit mantissa, pixelation deferred to ~10¹⁴× zoom)
- CPU: native JavaScript `number` (64-bit double, ~15 significant digits)

## Getting Started

No build step required. Open `index.html` directly in any WebGL-capable browser, or serve the directory with any static file server:

```bash
npx serve .
# or
python -m http.server
```

## Browser Support

Requires WebGL 1.0 and `highp float` fragment shader precision. Supported in all modern desktop browsers (Chrome, Firefox, Safari, Edge).

## File Structure

```
index.html      — application shell and UI
fractals.js     — GLSL shaders, fractal registry, coloring utilities
app.js          — rendering loop, CPU workers, input handling, state management
styles.css      — HUD and layout styles
```
