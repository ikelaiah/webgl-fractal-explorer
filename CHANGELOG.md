# Changelog

All notable changes to WebGL Fractal Explorer are documented here.

## [1.3.7] — 2026-04-26

### Performance and UX

- Added catalog search for quicker fractal switching across the larger registry
- Added saved fractals with session persistence and a dedicated Saved dropdown group
- Kept filtered next/previous navigation aligned with the visible catalog results

### Catalog Polish

- Added Julia Showcase and Orbit Trap Gallery tours for more curated entry points into existing fractals
- Updated catalog counts and documentation for 68 fractals

### Fractals

- Added Cubic Celtic and Cubic Buffalo shader-native formulas
- Added matching minimap and CPU refinement branches for the new formulas

## [1.3.6] — 2026-04-25

### Mobile UI

- Added a compact mobile control dock with quick fractal, palette, refine, and controls actions
- Added an expandable mobile bottom sheet with Explore, Formula, Tours, and Inspect tabs
- Reduced mobile viewport competition by hiding the minimap while the expanded sheet is open
- Kept shallow reloads and zooms on the GPU path by disabling default CPU refinement below the deep-zoom threshold and clearing stale CPU overlays during camera changes
- Bumped static asset query versions to avoid stale mobile CSS/JS on hosted builds

## [1.3.5] — 2026-04-25

### Formula Composer

- Added a GPU-rendered Composed Formula entry to the fractal catalog
- Added a controlled formula stack UI with Mandelbrot/Julia start modes and four operation slots
- Added safe composer primitives for powers, absolute folds, conjugation, transcendental maps, rational division, box fold, and Newton update
- Added Composer Use and Reset controls, including shader recompilation and state persistence
- Composer configuration is included in saved sessions and share URLs
- Minimap preview now supports composed formulas
- CPU refinement is clearly disabled for generated formulas until arbitrary stack compilation is supported on the CPU path
- Composer UI now explicitly labels generated formulas as GPU-only

### Documentation

- Updated README version badge to 1.3.5
- Updated README feature list and catalog for 66 fractals across 13 categories
- Versioned static CSS and JS asset URLs to avoid stale GitHub Pages cache mixes

## [1.3.0] — 2026-04-25

### Exploration workflow

- Guided tours with curated stops, playback controls, shareable route state, and automatic camera moves
- Inspector panel for current coordinates, fractal family, render mode, perturbation state, reference orbit, and active stop notes
- Split-screen compare mode with a shared camera, independent fractal and tone controls, and a visible divider
- PNG export for the current composed view and copyable formula display

### Rendering

- Perturbation diagnostics for Mandelbrot deep zooms, including fallback sample tracking and reference orbit reporting
- Deep CPU/Perturb overlay retention while panning and zooming so refined imagery remains transformed until replacement pixels are ready
- CPU worker sizing now preserves useful parallelism on browsers that report small `hardwareConcurrency` values instead of dropping two-core reports to `x1`
- CPU preview rendering now continues to paint while the app still marks the camera dirty for the next full settled refinement

### Fractals and colour

- Monotone and duotone tone styles in addition to palette colouring
- Additional fractals and formula corrections, including the Magnet Type II fix

### UI

- HUD redesigned for desktop and mobile with bounded internal scrolling, compact desktop grids, and a mobile bottom-sheet layout
- Minimap, tips, readouts, form rows, and buttons tuned for smaller screens and touch targets
- README and planning docs refreshed for the newer explorer workflow

## [1.2.0] — 2026-04-23

### Deep-zoom drag preview

- At zoom ≥ 10⁵× with Refine on, dragging triggers an immediate pass-0 CPU render of the drag-start viewport so a recognisable fractal shape is visible instead of swimming GPU pixels
- Preview canvas is offset via CSS `transform: translate()` during drag — zero re-render cost
- Translate is held after pointer-up to avoid a stale-frame snap-back flash; cleared when the first frame of the full 4-pass refinement lands
- `CPU_PREVIEW_ZOOM_THRESHOLD = 1e5` constant for easy tuning

## [1.1.0] — 2026-04-23

### Performance

- Specialized `escapeMandelbrot`, `escapeJulia`, `escapeBurningShip` functions for the three hottest formulas — tight dedicated inner loops with no per-iteration branch tower
- Periodicity detection (slow reference point with exponential back-off to 512) short-circuits interior points in Mandelbrot, Julia, Burning Ship, and the generic non-basin/non-trap paths — large speed-up on dark regions at deep zoom
- Integer formula dispatch replaces per-iteration string comparisons in `cpuEscape`
- Mandelbrot cardioid/period-2 bulb early-exit skips the iteration loop for interior points
- Zero-allocation hot loop: reusable `_SAMPLE`, `_COLOR`, `_BASIN_COLOR` scratch objects eliminate per-pixel garbage
- Inlined `Math.abs`, `Math.hypot`, and clamp operations via ternary expressions
- `cpuColor` palette and trap-style tables hoisted to module scope; `.map()` allocations removed
- Init-once CPU worker protocol: per-pass snapshot sent once per worker instead of per batch, cutting postMessage payload by ~1000× on a full-frame pass
- Batched worker dispatch (16,384 blocks per message) reduces round-trip overhead without blocking the main thread on paint

### UI

- Hide/show HUD panel (× button in header, ☰ restore button, `H` keyboard shortcut)
- Iteration slider displays live value
- `Refine ON` state label when CPU refinement is active
- Seven-column button grid with consistent sizing; ellipsis on overflow
- Mobile layout: tips bar repositioned above the minimap, 4-column button grid

## [1.0.0] — 2026-04-23

Initial release.

### Fractals (56 total)

**Classic**
- Mandelbrot Set
- Burning Ship
- Tricorn (Mandelbar)

**Julia**
- Julia Set (interactive parameter)
- Phoenix Julia (interactive + Bloom preset)
- Burning Ship Julia — Rift, Ember, Wake
- Dendrite Julia
- San Marco Dragon Julia
- Tricorn Julia
- Celtic Julia
- Buffalo Julia
- Perpendicular Julia
- Cubic Julia
- Quartic Julia — Dahlia, Clover
- Douady Rabbit Julia
- Glynn Julia, Glynn Julia — Rosette
- Sine Julia, Sine Julia — Veil
- Mandelbar Julia
- Rational Julia Lace
- Nova Julia Bloom
- Orbit Trap Rose Julia

**Power**
- Cubic Multibrot (z³ + c)
- Quartic Multibrot (z⁴ + c)
- Quintic Multibrot (z⁵ + c)
- Octic Multibrot (z⁸ + c)

**Folded**
- Celtic Mandelbrot
- Buffalo
- Celtic Heart
- Cubic Burning Ship
- Quartic Burning Ship

**Perpendicular**
- Perpendicular Mandelbrot
- Perpendicular Buffalo

**Dynamic**
- Lambda Mandelbrot (z ← c·z·(1−z))
- Spider (z ← z²+c; c ← c/2+z)

**Transcendental**
- Sine Mandelbrot (z ← sin(z)+c)
- Cosine Mandelbrot (z ← cos(z)+c)

**Box Fold**
- Mandelbox

**Mandelbar**
- Cubic Mandelbar (conjugate cube)

**Rational**
- Magnet Type I
- Feather (z³/(1+z²)+c)
- Rational Mandelbrot Lace

**Basins**
- Newton Cubic Basins
- Nova Basins (relaxed Newton, relax=(0.85+0.35i))
- Newton Quartic Basins
- Relaxed Newton Spiral (relax=(0.60+0.60i))
- Relaxed Newton Storm (relax=(−0.30+0.90i))
- Halley Cubic Basins

**Orbit Trap**
- Orbit Trap Mandelbrot (circle + cross + diagonal)
- Orbit Trap Flower (petals + ring + axis)
- Orbit Trap Lotus (outer + inner + stem)

### Rendering

- WebGL 1.0 GPU path with per-fractal GLSL fragment shaders
- Triple-single-precision coordinate arithmetic in shaders (~72-bit mantissa, ~10¹⁴× zoom depth)
- Smooth iteration colouring: `sm = iter − log₂(max(1, log₂(|z|²))) + 4`
- 5 cosine colour palettes with adjustable cycle offset
- Basin colouring for Newton/Halley fractals (3-root and 4-root variants)
- Orbit trap colouring with per-trap custom shape distances
- CPU refinement via Web Workers (up to 8 workers, progressive 8→4→2→1 pixel passes)
- CPU path mirrors all GPU formulas exactly for pixel-perfect refinement

### UI

- HUD panel: fractal selector (grouped by category), iteration range (32–1024), colour cycle, Julia parameter controls, mode readouts
- Minimap overview (136–168 px) with live viewport indicator
- Keyboard shortcuts: F (next), Shift+F (prev), P (palette), B (basin toggle), R (reset), C (share)
- Mouse/touch: drag to pan, scroll/pinch to zoom
- Per-fractal view state persisted to `localStorage`
- URL share encoding (fractal, palette, color mode, center, scale, iterations, cycle, Julia C)
- FPS and effective-iteration readouts
- Julia C randomise button
