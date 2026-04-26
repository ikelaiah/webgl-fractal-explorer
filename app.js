"use strict";

// Main runtime for the explorer. The fast preview is rendered by WebGL, while
// the optional "Refine" overlay re-renders the settled viewport on the CPU for
// deeper zooms and formula parity checks.

const canvas = document.getElementById("fractal");
const deepCanvas = document.getElementById("deepFractal");
const minimap = document.getElementById("minimap");
const gl = canvas.getContext("webgl", {
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
});
const deepCtx = deepCanvas.getContext("2d", { alpha: true });
const miniCtx = minimap.getContext("2d");
const minimapBase = document.createElement("canvas");
const minimapBaseCtx = minimapBase.getContext("2d");

if (!gl) {
  document.body.innerHTML = '<main class="fallback">WebGL is not available in this browser.</main>';
  throw new Error("WebGL unavailable");
}

// ─── WebGL helpers ────────────────────────────────────────────────────────────

function compileShader(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(msg || "Shader compile failed");
  }
  return sh;
}

function buildProgram(fragSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(msg || "Program link failed");
  }
  return prog;
}

const programs = FRACTALS.map(() => null);

function getProgram(idx) {
  // Shaders are compiled lazily so adding many fractals does not make startup
  // pay for every program before the user visits it.
  if (programs[idx]) return programs[idx];
  const prog = buildProgram(FRACTALS[idx].src);
  programs[idx] = {
    prog,
    loc: {
      pos:    gl.getAttribLocation(prog,  "aPos"),
      res:    gl.getUniformLocation(prog, "uRes"),
      x0:     gl.getUniformLocation(prog, "uX0"),
      y0:     gl.getUniformLocation(prog, "uY0"),
      scale:  gl.getUniformLocation(prog, "uScale"),
      iter:   gl.getUniformLocation(prog, "uIter"),
      palette:gl.getUniformLocation(prog, "uPalette"),
      cycle:  gl.getUniformLocation(prog, "uCycle"),
      juliaC: gl.getUniformLocation(prog, "uJuliaC"),
      colorMode: gl.getUniformLocation(prog, "uColorMode"),
      colorStyle: gl.getUniformLocation(prog, "uColorStyle"),
    },
  };
  return programs[idx];
}

const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1,
]), gl.STATIC_DRAW);

// ─── DOM ──────────────────────────────────────────────────────────────────────

const ui = {
  shell:       document.querySelector(".shell"),
  fractalName: document.getElementById("fractalName"),
  zoomReadout: document.getElementById("zoomReadout"),
  fpsReadout:  document.getElementById("fpsReadout"),
  iterReadout: document.getElementById("iterReadout"),
  modeReadout: document.getElementById("modeReadout"),
  fractalSelect: document.getElementById("fractalSelect"),
  fractalSearch: document.getElementById("fractalSearch"),
  btnFavoriteFractal: document.getElementById("btnFavoriteFractal"),
  btnClearFractalSearch: document.getElementById("btnClearFractalSearch"),
  fractalSearchMeta: document.getElementById("fractalSearchMeta"),
  compareDivider: document.getElementById("compareDivider"),
  formulaDisplay: document.getElementById("formulaDisplay"),
  composerMode: document.getElementById("composerMode"),
  composerStack: document.getElementById("composerStack"),
  composerSummary: document.getElementById("composerSummary"),
  btnComposerUse: document.getElementById("btnComposerUse"),
  btnComposerReset: document.getElementById("btnComposerReset"),
  iterations:  document.getElementById("iterations"),
  colorStyle:  document.getElementById("colorStyle"),
  colorCycle:  document.getElementById("colorCycle"),
  juliaRow:    document.getElementById("juliaRow"),
  juliaAngle:  document.getElementById("juliaAngle"),
  fixedJuliaRow: document.getElementById("fixedJuliaRow"),
  juliaReal:   document.getElementById("juliaReal"),
  juliaImag:   document.getElementById("juliaImag"),
  btnRandomJulia: document.getElementById("btnRandomJulia"),
  btnPrevFractal: document.getElementById("btnPrevFractal"),
  btnNextFractal: document.getElementById("btnNextFractal"),
  btnPalette:  document.getElementById("btnPalette"),
  btnColorMode: document.getElementById("btnColorMode"),
  btnRefine:   document.getElementById("btnRefine"),
  btnReset:    document.getElementById("btnReset"),
  btnExport:   document.getElementById("btnExport"),
  btnCopyFormula: document.getElementById("btnCopyFormula"),
  btnShare:    document.getElementById("btnShare"),
  btnCompareToggle: document.getElementById("btnCompareToggle"),
  compareFractalSelect: document.getElementById("compareFractalSelect"),
  compareColorStyle: document.getElementById("compareColorStyle"),
  btnComparePalette: document.getElementById("btnComparePalette"),
  btnCompareColorMode: document.getElementById("btnCompareColorMode"),
  compareSummary: document.getElementById("compareSummary"),
  tourMeta:    document.getElementById("tourMeta"),
  tourSelect:  document.getElementById("tourSelect"),
  tourStopTitle: document.getElementById("tourStopTitle"),
  tourStopIndex: document.getElementById("tourStopIndex"),
  tourStopNote: document.getElementById("tourStopNote"),
  btnTourPrev: document.getElementById("btnTourPrev"),
  btnTourPlay: document.getElementById("btnTourPlay"),
  btnTourNext: document.getElementById("btnTourNext"),
  inspectX: document.getElementById("inspectX"),
  inspectY: document.getElementById("inspectY"),
  inspectMode: document.getElementById("inspectMode"),
  inspectFamily: document.getElementById("inspectFamily"),
  inspectPerturb: document.getElementById("inspectPerturb"),
  inspectOrbit: document.getElementById("inspectOrbit"),
  inspectSummary: document.getElementById("inspectSummary"),
  btnHideHud:  document.getElementById("btnHideHud"),
  btnShowHud:  document.getElementById("btnShowHud"),
  btnSheetHandle: document.getElementById("btnSheetHandle"),
  btnMobilePrev: document.getElementById("btnMobilePrev"),
  btnMobileNext: document.getElementById("btnMobileNext"),
  btnMobilePalette: document.getElementById("btnMobilePalette"),
  btnMobileRefine: document.getElementById("btnMobileRefine"),
  btnMobileControls: document.getElementById("btnMobileControls"),
  mobileTabs:  Array.from(document.querySelectorAll(".mobile-tab")),
  iterValue:   document.getElementById("iterValue"),
  hud:         document.querySelector(".hud"),
};

FRACTALS.forEach((fractal, idx) => {
  const option = document.createElement("option");
  option.value = String(idx);
  option.textContent = fractal.name;
  ui.compareFractalSelect.appendChild(option);
});
let fractalNavOrder = FRACTALS.map((_, idx) => idx);
const COMPOSER_FRACTAL_INDEX = FRACTALS.findIndex(fractal => fractal.formula === "composer");

for (let slot = 0; slot < 4; slot++) {
  const label = document.createElement("label");
  label.className = "composer-step";
  const span = document.createElement("span");
  span.textContent = `Step ${slot + 1}`;
  const select = document.createElement("select");
  select.className = "composer-op";
  select.dataset.slot = String(slot);
  select.setAttribute("aria-label", `Composer step ${slot + 1}`);
  COMPOSER_OPERATION_DEFS.forEach(op => {
    const option = document.createElement("option");
    option.value = op.id;
    option.textContent = op.label;
    select.appendChild(option);
  });
  label.appendChild(span);
  label.appendChild(select);
  ui.composerStack.appendChild(label);
}

// ─── State ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "fractal2d_v1";
const LEGACY_VIEWS_STORAGE_KEY = STORAGE_KEY + "_views";
const SESSION_SCHEMA_VERSION = 3;
const MIN_ITER = 32;
const MAX_ITER = 512;
const DEFAULT_ITER = 64;
const CAMERA_EASE = 12;
const CAMERA_SETTLE_EPS = 32 * Number.EPSILON;
const RESET_VIEW_PADDING = 1.08;
const MINIMAP_ITER = 128;
const CPU_DPR = Math.min(window.devicePixelRatio || 1, 2);
const CPU_FRAME_BUDGET_MS = 10;
const CPU_REFINE_DELAY_MS = 180;
const CPU_PASSES = [4, 2, 1];
const CPU_RESERVED_LOGICAL_CORES = 2;
const CPU_FALLBACK_LOGICAL_CORES = 4;
const CPU_MAX_WORKERS = 30;
const CPU_WORKER_BATCH_BLOCKS = 16384;
const CPU_PREVIEW_ZOOM_THRESHOLD = 1e4;
const PERTURB_MIN_ZOOM = 1e7;
const COLOR_MODE_ESCAPE = 0;
const COLOR_MODE_BASIN = 1;
const MOBILE_QUERY = window.matchMedia("(max-width: 720px)");
const COLOR_STYLE_PALETTE = 0;
const COLOR_STYLE_MONOTONE = 1;
const COLOR_STYLE_DUOTONE = 2;
const TOUR_ADVANCE_DELAY_MS = 3200;
const TOUR_STOP_SETTLE_MS = 700;

const state = {
  // Camera movement uses a current value plus a target value. Input changes the
  // target immediately; the render loop eases the current camera toward it.
  fractalIdx: 0,
  palette: 0,
  colorMode: COLOR_MODE_ESCAPE,
  colorStyle: COLOR_STYLE_PALETTE,
  cpuRefine: false,
  centerX: FRACTALS[0].center[0],
  centerY: FRACTALS[0].center[1],
  pixelScale: 0,
  targetCenterX: FRACTALS[0].center[0],
  targetCenterY: FRACTALS[0].center[1],
  targetPixelScale: 0,
  dragging: false,
  dragStartX: 0, dragStartY: 0,
  dragStartCX: 0, dragStartCY: 0,
  fpsFrames: 0,
  fpsTime: performance.now(),
  lastTime: performance.now(),
  juliaParams: {},
  savedViews: {},
  favoriteFractals: {},
  compare: {
    enabled: false,
    lockCamera: true,
    fractalIdx: 0,
    palette: 0,
    colorMode: COLOR_MODE_ESCAPE,
    colorStyle: COLOR_STYLE_PALETTE,
  },
  composer: normalizeComposerConfig(COMPOSER_DEFAULT),
  tour: {
    id: "",
    stop: 0,
    playing: false,
  },
};

const TOURS = Object.freeze([
  {
    id: "mandelbrot-classics",
    name: "Mandelbrot Essentials",
    stops: [
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Mandelbrot Set"),
        cx: -0.5, cy: 0.0, ps: 0.004725,
        iterations: 64, colorCycle: 0.18, colorStyle: COLOR_STYLE_PALETTE,
        title: "Whole Set",
        note: "Start with the full silhouette before diving into repeated edge structure.",
      },
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Mandelbrot Set"),
        cx: -0.743643887037151, cy: 0.13182590420533, ps: 3.2e-6,
        iterations: 448, colorCycle: 0.42, colorStyle: COLOR_STYLE_PALETTE,
        title: "Seahorse Valley",
        note: "A classic stop where spirals and branching filaments make self-similarity easy to read.",
      },
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Mandelbrot Set"),
        cx: -1.25066, cy: 0.02012, ps: 7.8e-6,
        iterations: 512, colorCycle: 0.66, colorStyle: COLOR_STYLE_DUOTONE,
        title: "Elephant Valley",
        note: "This edge region packs dense tendrils into a narrow band and rewards slower inspection.",
      },
    ],
  },
  {
    id: "burning-ship-contrast",
    name: "Burning Ship Highlights",
    stops: [
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Burning Ship"),
        cx: -0.5, cy: -0.5, ps: 0.004725,
        iterations: 96, colorCycle: 0.12, colorStyle: COLOR_STYLE_PALETTE,
        title: "Whole Ship",
        note: "The overall outline already shows how the absolute-value fold changes the family compared with Mandelbrot.",
      },
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Burning Ship"),
        cx: -1.7443359375, cy: -0.017451171875, ps: 3.7e-6,
        iterations: 480, colorCycle: 0.54, colorStyle: COLOR_STYLE_DUOTONE,
        title: "Embroidery Edge",
        note: "Layered folds create a harsher, more architectural boundary than the smoother Mandelbrot filaments.",
      },
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Burning Ship"),
        cx: -1.769383179, cy: -0.04531251, ps: 1.8e-6,
        iterations: 512, colorCycle: 0.88, colorStyle: COLOR_STYLE_MONOTONE,
        title: "Needle Cluster",
        note: "A stop chosen for the vertical shard growth that gives the Burning Ship its recognizable silhouette.",
      },
    ],
  },
  {
    id: "newton-basins",
    name: "Newton Basin Tour",
    stops: [
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Newton Cubic Basins"),
        cx: 0.0, cy: 0.0, ps: 0.00459,
        iterations: 192, colorMode: COLOR_MODE_BASIN, colorCycle: 0, colorStyle: COLOR_STYLE_PALETTE,
        title: "Root Territories",
        note: "Begin with the clear three-way split before zooming into the unstable basin boundaries.",
      },
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Nova Basins"),
        cx: -0.15, cy: 0.05, ps: 0.0024,
        iterations: 256, colorMode: COLOR_MODE_BASIN, colorCycle: 0.27, colorStyle: COLOR_STYLE_PALETTE,
        title: "Nova Bloom",
        note: "Nova adds richer filaments and makes the solver dynamics feel less rigid than plain Newton.",
      },
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Halley Cubic Basins"),
        cx: 0.0, cy: 0.0, ps: 0.0032,
        iterations: 240, colorMode: COLOR_MODE_BASIN, colorCycle: 0.61, colorStyle: COLOR_STYLE_DUOTONE,
        title: "Halley Boundary",
        note: "Halley sharpens the attraction boundaries and makes the basin transitions feel almost crystalline.",
      },
    ],
  },
  {
    id: "julia-showcase",
    name: "Julia Showcase",
    stops: [
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Douady Rabbit Julia"),
        cx: 0.0, cy: 0.0, ps: 0.0030,
        iterations: 192, colorCycle: 0.30, colorStyle: COLOR_STYLE_PALETTE,
        title: "Rabbit Boundary",
        note: "A fixed quadratic seed with a compact, readable boundary and strong local repetition.",
      },
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "San Marco Dragon Julia"),
        cx: 0.0, cy: 0.0, ps: 0.0030,
        iterations: 224, colorCycle: 0.58, colorStyle: COLOR_STYLE_DUOTONE,
        title: "Dragon Spine",
        note: "This seed shows how a small change in c reshapes the same quadratic rule into a long folded spine.",
      },
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Glynn Julia - Rosette"),
        cx: 0.0, cy: 0.0, ps: 0.0026,
        iterations: 224, colorCycle: 0.76, colorStyle: COLOR_STYLE_PALETTE,
        title: "Rosette Symmetry",
        note: "The fractional-power Julia formula gives softer lobes than integer-power Julia sets.",
      },
    ],
  },
  {
    id: "orbit-trap-gallery",
    name: "Orbit Trap Gallery",
    stops: [
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Orbit Trap Flower"),
        cx: -0.5, cy: 0.0, ps: 0.004725,
        iterations: 128, colorCycle: 0.12, colorStyle: COLOR_STYLE_PALETTE,
        title: "Flower Trap",
        note: "Orbit-trap coloring reveals petal distance fields inside the familiar Mandelbrot orbit.",
      },
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Orbit Trap Lotus"),
        cx: -0.45, cy: 0.0, ps: 0.0042,
        iterations: 160, colorCycle: 0.36, colorStyle: COLOR_STYLE_DUOTONE,
        title: "Lotus Layers",
        note: "Layered radial traps make the exterior bands feel more structural and ornamental.",
      },
      {
        fractalIdx: FRACTALS.findIndex(f => f.name === "Orbit Trap Web"),
        cx: -0.5, cy: 0.0, ps: 0.004725,
        iterations: 144, colorCycle: 0.64, colorStyle: COLOR_STYLE_PALETTE,
        title: "Web Field",
        note: "A grid-and-ring trap makes crossing contours visible without changing the underlying escape formula.",
      },
    ],
  },
]);
const TOUR_MAP = new Map(TOURS.map(tour => [tour.id, tour]));
const tourPlayback = {
  lastSettledAt: 0,
  lastAdvancedAt: 0,
};
TOURS.forEach(tour => {
  const option = document.createElement("option");
  option.value = tour.id;
  option.textContent = tour.name;
  ui.tourSelect.appendChild(option);
});

const activePointers = new Map();
const gesture = {
  pinchStartDist: 0,
  pinchStartScale: 0,
  pinchAnchorX: 0,
  pinchAnchorY: 0,
};

function normalizeColorStyle(value) {
  const parsed = parseInt(value, 10);
  if (parsed === COLOR_STYLE_MONOTONE || parsed === COLOR_STYLE_DUOTONE) return parsed;
  return COLOR_STYLE_PALETTE;
}

function clampFractalIndex(value) {
  return Math.max(0, Math.min(parseInt(value, 10) || 0, FRACTALS.length - 1));
}

function parseStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function cloneViewsMap(views) {
  const result = {};
  if (!views || typeof views !== "object") return result;
  for (const [key, value] of Object.entries(views)) {
    if (!value || typeof value !== "object") continue;
    const cx = parseFloat(value.cx);
    const cy = parseFloat(value.cy);
    const ps = parseFloat(value.ps);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(ps) || ps <= 0) continue;
    result[key] = { cx, cy, ps };
  }
  return result;
}

function cloneFavoriteMap(favorites) {
  const result = {};
  const source = Array.isArray(favorites)
    ? favorites
    : favorites && typeof favorites === "object"
      ? Object.keys(favorites).filter(key => favorites[key])
      : [];
  source.forEach(value => {
    const normalized = String(value).trim();
    if (/^\d+$/.test(normalized)) {
      const idx = parseInt(normalized, 10);
      if (idx < 0 || idx >= FRACTALS.length) return;
      result[idx] = true;
    }
  });
  return result;
}

function isFavoriteFractal(idx = state.fractalIdx) {
  return !!state.favoriteFractals[clampFractalIndex(idx)];
}

function getFractalSearchQuery() {
  return (ui.fractalSearch?.value || "").trim().toLowerCase();
}

function fractalMatchesSearch(fractal, idx, query) {
  if (!query) return true;
  const text = [
    fractal.name,
    fractal.category,
    fractal.formula,
    fractal.formulaText,
    fractal.explanationText,
  ].join(" ").toLowerCase();
  return text.includes(query) || String(idx + 1) === query;
}

function addFractalOptionGroup(label, indexes, usedIndexes) {
  const group = document.createElement("optgroup");
  group.label = label;
  indexes.forEach(idx => {
    if (usedIndexes.has(idx)) return;
    const fractal = FRACTALS[idx];
    const option = document.createElement("option");
    option.value = String(idx);
    option.textContent = fractal.name;
    group.appendChild(option);
    usedIndexes.add(idx);
  });
  if (group.children.length) ui.fractalSelect.appendChild(group);
}

function renderFractalOptions() {
  const query = getFractalSearchQuery();
  const matches = FRACTALS
    .map((fractal, idx) => ({ fractal, idx }))
    .filter(({ fractal, idx }) => fractalMatchesSearch(fractal, idx, query))
    .map(entry => entry.idx);
  const used = new Set();
  const activeMatches = matches.includes(state.fractalIdx);
  ui.fractalSelect.replaceChildren();

  if (!activeMatches) {
    addFractalOptionGroup("--- ACTIVE ---", [state.fractalIdx], used);
  }
  addFractalOptionGroup("--- SAVED ---", matches.filter(idx => isFavoriteFractal(idx)), used);

  const categories = new Map();
  matches.forEach(idx => {
    if (used.has(idx)) return;
    const category = FRACTALS[idx].category;
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(idx);
  });
  categories.forEach((indexes, category) => addFractalOptionGroup(`--- ${category.toUpperCase()} ---`, indexes, used));

  fractalNavOrder = Array.from(ui.fractalSelect.querySelectorAll("option"))
    .map(option => parseInt(option.value, 10))
    .filter(Number.isInteger);
  if (!fractalNavOrder.length) fractalNavOrder = [state.fractalIdx];

  ui.fractalSelect.value = String(state.fractalIdx);
  if (ui.fractalSearchMeta) {
    ui.fractalSearchMeta.textContent = query
      ? `${matches.length} of ${FRACTALS.length}`
      : `${FRACTALS.length} total`;
  }
  if (ui.btnClearFractalSearch) ui.btnClearFractalSearch.disabled = !query;
  updateFavoriteButton();
}

function updateFavoriteButton() {
  if (!ui.btnFavoriteFractal) return;
  const saved = isFavoriteFractal();
  ui.btnFavoriteFractal.textContent = saved ? "Saved" : "Save";
  ui.btnFavoriteFractal.classList.toggle("active", saved);
  ui.btnFavoriteFractal.setAttribute("aria-pressed", String(saved));
}

function buildSessionSnapshot() {
  // Keep one explicit session object so future features such as compare mode,
  // tours, and richer sharing can reuse the same schema instead of inventing
  // parallel storage formats.
  return {
    version: SESSION_SCHEMA_VERSION,
    active: {
      fractalIdx: state.fractalIdx,
      palette: state.palette,
      colorMode: state.colorMode,
      colorStyle: state.colorStyle,
      cpuRefine: state.cpuRefine,
      view: {
        cx: state.targetCenterX,
        cy: state.targetCenterY,
        ps: state.targetPixelScale,
      },
      controls: {
        iterations: parseInt(ui.iterations.value, 10) || DEFAULT_ITER,
        colorCycle: parseFloat(ui.colorCycle.value) || 0,
        juliaAngle: parseFloat(ui.juliaAngle.value) || 0,
      },
      juliaParams: state.juliaParams,
    },
    views: cloneViewsMap(state.savedViews),
    favorites: Object.keys(state.favoriteFractals)
      .map(key => parseInt(key, 10))
      .filter(Number.isInteger)
      .sort((a, b) => a - b),
    compare: {
      enabled: !!state.compare.enabled,
      lockCamera: state.compare.lockCamera !== false,
      fractalIdx: clampFractalIndex(state.compare.fractalIdx),
      palette: Math.max(0, Math.min(parseInt(state.compare.palette, 10) || 0, 4)),
      colorMode: parseInt(state.compare.colorMode, 10) === COLOR_MODE_BASIN ? COLOR_MODE_BASIN : COLOR_MODE_ESCAPE,
      colorStyle: normalizeColorStyle(state.compare.colorStyle),
    },
    composer: normalizeComposerConfig(state.composer),
    tour: {
      id: typeof state.tour.id === "string" ? state.tour.id : "",
      stop: Math.max(0, parseInt(state.tour.stop, 10) || 0),
      playing: !!state.tour.playing,
    },
  };
}

function applySessionSnapshot(snapshot, options = {}) {
  const data = snapshot && typeof snapshot === "object" ? snapshot : {};
  const active = data.active && typeof data.active === "object" ? data.active : data;
  const controls = active.controls && typeof active.controls === "object" ? active.controls : active;
  const view = active.view && typeof active.view === "object"
    ? active.view
    : { cx: active.cx, cy: active.cy, ps: active.ps };
  const compare = data.compare && typeof data.compare === "object" ? data.compare : {};
  const composer = data.composer && typeof data.composer === "object" ? data.composer : {};
  const tour = data.tour && typeof data.tour === "object" ? data.tour : {};

  if (active.fractalIdx !== undefined) state.fractalIdx = clampFractalIndex(active.fractalIdx);
  if (active.palette !== undefined) state.palette = Math.max(0, Math.min(parseInt(active.palette, 10) || 0, 4));
  if (active.colorMode !== undefined) {
    state.colorMode = parseInt(active.colorMode, 10) === COLOR_MODE_BASIN ? COLOR_MODE_BASIN : COLOR_MODE_ESCAPE;
  }
  if (active.colorStyle !== undefined) state.colorStyle = normalizeColorStyle(active.colorStyle);
  if (active.cpuRefine !== undefined) state.cpuRefine = !!active.cpuRefine;
  if (controls.iterations !== undefined) {
    ui.iterations.value = Math.max(MIN_ITER, Math.min(parseInt(controls.iterations, 10) || DEFAULT_ITER, MAX_ITER));
  }
  if (controls.colorCycle !== undefined) ui.colorCycle.value = String(controls.colorCycle);
  if (controls.juliaAngle !== undefined) ui.juliaAngle.value = String(controls.juliaAngle);
  if (active.juliaParams && typeof active.juliaParams === "object") state.juliaParams = active.juliaParams;
  if (view.cx !== undefined) state.centerX = parseFloat(view.cx) || 0;
  if (view.cy !== undefined) state.centerY = parseFloat(view.cy) || 0;
  if (view.ps !== undefined) state.pixelScale = parseFloat(view.ps) || 0;

  state.savedViews = cloneViewsMap(data.views);
  if (Object.prototype.hasOwnProperty.call(data, "favorites")) {
    state.favoriteFractals = cloneFavoriteMap(data.favorites);
  }
  state.compare = {
    enabled: !!compare.enabled,
    lockCamera: compare.lockCamera !== false,
    fractalIdx: clampFractalIndex(compare.fractalIdx),
    palette: Math.max(0, Math.min(parseInt(compare.palette, 10) || 0, 4)),
    colorMode: parseInt(compare.colorMode, 10) === COLOR_MODE_BASIN ? COLOR_MODE_BASIN : COLOR_MODE_ESCAPE,
    colorStyle: normalizeColorStyle(compare.colorStyle),
  };
  state.composer = normalizeComposerConfig(composer);
  syncComposerFractal({ recompile: false });
  state.tour = {
    id: typeof tour.id === "string" ? tour.id : "",
    stop: Math.max(0, parseInt(tour.stop, 10) || 0),
    playing: !!tour.playing,
  };

  if (!options.skipSyncTarget) syncTargetToCurrent();
}

function buildShareStateSnapshot() {
  const session = buildSessionSnapshot();
  return {
    version: session.version,
    active: session.active,
    compare: session.compare,
    composer: session.composer,
    tour: session.tour,
  };
}

function sessionSnapshotToParams(snapshot) {
  // Version the share schema now so compare mode and tours can extend it later
  // without breaking older links.
  const active = snapshot.active || {};
  const view = active.view || {};
  const controls = active.controls || {};
  const params = new URLSearchParams({
    sv: String(snapshot.version || SESSION_SCHEMA_VERSION),
    f: String(active.fractalIdx ?? 0),
    pa: String(active.palette ?? 0),
    cm: String(active.colorMode ?? COLOR_MODE_ESCAPE),
    cs: String(active.colorStyle ?? COLOR_STYLE_PALETTE),
    cx: Number(view.cx || 0).toFixed(15),
    cy: Number(view.cy || 0).toFixed(15),
    ps: Number(view.ps || 0).toExponential(6),
    it: String(controls.iterations ?? DEFAULT_ITER),
    cc: String(controls.colorCycle ?? 0),
    ja: String(controls.juliaAngle ?? 0),
  });
  if (active.juliaParams && FRACTALS[clampFractalIndex(active.fractalIdx)].juliaParam) {
    const fixed = active.juliaParams[active.fractalIdx];
    if (Array.isArray(fixed) && fixed.length >= 2) {
      params.set("jr", Number(fixed[0]).toFixed(6));
      params.set("ji", Number(fixed[1]).toFixed(6));
    }
  }
  if (snapshot.compare && snapshot.compare.enabled) {
    params.set("cmp", "1");
    params.set("clf", String(snapshot.compare.fractalIdx));
    params.set("clp", String(snapshot.compare.palette));
    params.set("clm", String(snapshot.compare.colorMode));
    params.set("cls", String(snapshot.compare.colorStyle));
    if (snapshot.compare.lockCamera === false) params.set("clock", "0");
  }
  if (snapshot.composer) {
    const composer = normalizeComposerConfig(snapshot.composer);
    params.set("cmo", composer.mode);
    params.set("cop", composer.ops.join(","));
  }
  if (snapshot.tour && snapshot.tour.id) {
    params.set("tour", snapshot.tour.id);
    params.set("stop", String(snapshot.tour.stop));
  }
  return params.toString();
}

function paramsToSessionSnapshot(search) {
  const p = new URLSearchParams(search);
  if (![...p.keys()].length) return null;

  const fractalIdx = p.has("f") ? clampFractalIndex(p.get("f")) : 0;
  const snapshot = {
    version: parseInt(p.get("sv"), 10) || 1,
    active: {
      fractalIdx,
      palette: p.has("pa") ? Math.max(0, Math.min(parseInt(p.get("pa"), 10) || 0, 4)) : 0,
      colorMode: p.has("cm") && parseInt(p.get("cm"), 10) === COLOR_MODE_BASIN ? COLOR_MODE_BASIN : COLOR_MODE_ESCAPE,
      colorStyle: p.has("cs") ? normalizeColorStyle(p.get("cs")) : COLOR_STYLE_PALETTE,
      view: {
        cx: p.has("cx") ? (parseFloat(p.get("cx")) || 0) : undefined,
        cy: p.has("cy") ? (parseFloat(p.get("cy")) || 0) : undefined,
        ps: p.has("ps") ? (parseFloat(p.get("ps")) || 0) : undefined,
      },
      controls: {
        iterations: p.has("it") ? Math.max(MIN_ITER, Math.min(parseInt(p.get("it"), 10) || DEFAULT_ITER, MAX_ITER)) : DEFAULT_ITER,
        colorCycle: p.has("cc") ? p.get("cc") : 0,
        juliaAngle: p.has("ja") ? p.get("ja") : 0,
      },
      juliaParams: {},
    },
    compare: {
      enabled: p.get("cmp") === "1",
      lockCamera: p.get("clock") !== "0",
      fractalIdx: p.has("clf") ? clampFractalIndex(p.get("clf")) : fractalIdx,
      palette: p.has("clp") ? Math.max(0, Math.min(parseInt(p.get("clp"), 10) || 0, 4)) : 0,
      colorMode: p.has("clm") && parseInt(p.get("clm"), 10) === COLOR_MODE_BASIN ? COLOR_MODE_BASIN : COLOR_MODE_ESCAPE,
      colorStyle: p.has("cls") ? normalizeColorStyle(p.get("cls")) : COLOR_STYLE_PALETTE,
    },
    composer: normalizeComposerConfig({
      mode: p.get("cmo") || undefined,
      ops: p.has("cop") ? p.get("cop").split(",") : undefined,
    }),
    tour: {
      id: p.get("tour") || "",
      stop: Math.max(0, parseInt(p.get("stop"), 10) || 0),
      playing: false,
    },
    views: {},
  };

  if (p.has("jr") && p.has("ji") && FRACTALS[fractalIdx].juliaParam) {
    const jr = parseFloat(p.get("jr"));
    const ji = parseFloat(p.get("ji"));
    if (Number.isFinite(jr) && Number.isFinite(ji)) {
      snapshot.active.juliaParams[fractalIdx] = [clampJuliaParam(jr), clampJuliaParam(ji)];
    }
  }
  return snapshot;
}

let minimapDirty = true;
const cpuRender = {
  // CPU refinement is a progressive block renderer. It first paints large
  // blocks for a quick preview, then repeats with smaller blocks until pixel
  // precision is reached.
  dirty: true,
  running: false,
  complete: false,
  dirtySince: performance.now(),
  generation: 0,
  activeGeneration: 0,
  imageData: null,
  pixels: null,
  passIndex: 0,
  blockIndex: 0,
  cols: 0,
  rows: 0,
  step: 1,
  snapshot: null,
  paintedSnapshot: null,
  workers: [],
  workerUrl: "",
  pendingBatches: 0,
  nextBatchBlock: 0,
  totalBlocks: 0,
  lastPaint: 0,
  useWorkers: false,
  previewOnly: false,
  backend: "cpu",
  diagnostics: {
    totalSamples: 0,
    fallbackSamples: 0,
    referenceOrbitLength: 0,
  },
};

function viewBoundsForFractal(idx = state.fractalIdx) {
  // Most fractals fit a square extent, but wide formulas such as Mandelbox can
  // override the initial camera with explicit bounds.
  const f = FRACTALS[idx] || FRACTALS[0];
  const bounds = f.bounds || {};
  const center = Array.isArray(bounds.center) ? bounds.center : f.center;
  const width = Number.isFinite(bounds.width) && bounds.width > 0 ? bounds.width : f.scale;
  const height = Number.isFinite(bounds.height) && bounds.height > 0 ? bounds.height : f.scale;
  return { cx: center[0], cy: center[1], width, height };
}

function resetView(idx) {
  const bounds = viewBoundsForFractal(idx ?? state.fractalIdx);
  const w = Math.max(canvas.width || 800, 1);
  const h = Math.max(canvas.height || 600, 1);
  const pixelScale = Math.max(bounds.width / w, bounds.height / h) * RESET_VIEW_PADDING;
  setCameraTarget(bounds.cx, bounds.cy, pixelScale, true);
}

function setCameraTarget(cx, cy, pixelScale, immediate = false) {
  // All camera mutations flow through this function so the CPU overlay can be
  // invalidated whenever the view changes.
  const fallbackBounds = viewBoundsForFractal(state.fractalIdx);
  const fallback = Math.max(
    fallbackBounds.width / Math.max(canvas.width || 800, 1),
    fallbackBounds.height / Math.max(canvas.height || 600, 1)
  ) * RESET_VIEW_PADDING;
  const nextX = Number.isFinite(cx) ? cx : FRACTALS[state.fractalIdx].center[0];
  const nextY = Number.isFinite(cy) ? cy : FRACTALS[state.fractalIdx].center[1];
  const nextScale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : fallback;
  const centerChanged = immediate && (
    state.centerX !== nextX ||
    state.centerY !== nextY ||
    state.pixelScale !== nextScale
  );
  const changed = nextX !== state.targetCenterX ||
    nextY !== state.targetCenterY ||
    nextScale !== state.targetPixelScale;
  state.targetCenterX = nextX;
  state.targetCenterY = nextY;
  state.targetPixelScale = nextScale;
  if (immediate) {
    state.centerX = state.targetCenterX;
    state.centerY = state.targetCenterY;
    state.pixelScale = state.targetPixelScale;
  }
  if (changed || centerChanged) markDeepDirty(false);
}

function syncTargetToCurrent() {
  setCameraTarget(state.centerX, state.centerY, state.pixelScale, true);
}

function cameraSettleTolerance(center, target, viewWidth) {
  const numericFloor = Math.max(1, Math.abs(center), Math.abs(target)) * CAMERA_SETTLE_EPS;
  return Math.max(viewWidth * 1e-7, numericFloor);
}

function nudgeCamera(dt) {
  // Easing in log(scale) space makes zoom animation feel linear to the eye.
  if (!state.targetPixelScale) return;
  if (!state.pixelScale) {
    syncTargetToCurrent();
    return;
  }

  const alpha = 1 - Math.exp(-dt * CAMERA_EASE);
  state.centerX += (state.targetCenterX - state.centerX) * alpha;
  state.centerY += (state.targetCenterY - state.centerY) * alpha;

  const currentLog = Math.log(state.pixelScale);
  const targetLog = Math.log(state.targetPixelScale);
  state.pixelScale = Math.exp(currentLog + (targetLog - currentLog) * alpha);

  const viewWidth = Math.max(state.pixelScale * canvas.width, Number.MIN_VALUE);
  const xTolerance = cameraSettleTolerance(state.centerX, state.targetCenterX, viewWidth);
  const yTolerance = cameraSettleTolerance(state.centerY, state.targetCenterY, viewWidth);
  if (Math.abs(state.targetCenterX - state.centerX) < xTolerance &&
      Math.abs(state.targetCenterY - state.centerY) < yTolerance &&
      Math.abs(Math.log(state.pixelScale / state.targetPixelScale)) < 1e-5) {
    syncTargetToCurrent();
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function saveSettings() {
  // Persist one session blob so upcoming features can share the same storage
  // contract instead of maintaining separate per-feature keys.
  try {
    saveViewForCurrentFractal();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSessionSnapshot()));
  } catch { /* quota */ }
}

function loadSettings() {
  try {
    const session = parseStoredJson(STORAGE_KEY, null);
    if (session && typeof session === "object" && (session.version || session.active || session.views)) {
      applySessionSnapshot(session, { skipSyncTarget: true });
    } else {
      // Legacy migration path from the pre-session schema.
      const legacySettings = session && typeof session === "object" ? session : {};
      const legacyViews = parseStoredJson(LEGACY_VIEWS_STORAGE_KEY, {});
      applySessionSnapshot({
        version: 1,
        active: {
          fractalIdx: legacySettings.fractalIdx,
          palette: legacySettings.palette,
          colorMode: legacySettings.colorMode,
          colorStyle: legacySettings.colorStyle,
          cpuRefine: legacySettings.cpuRefine,
          view: legacyViews[legacySettings.fractalIdx],
          controls: {
            iterations: legacySettings.iterations,
            colorCycle: legacySettings.colorCycle,
            juliaAngle: legacySettings.juliaAngle,
          },
          juliaParams: legacySettings.juliaParams,
        },
        views: legacyViews,
      }, { skipSyncTarget: true });
    }
    const savedView = state.savedViews[state.fractalIdx];
    if (savedView) setCameraTarget(savedView.cx, savedView.cy, savedView.ps, true);
    else if (!state.pixelScale) resetView(state.fractalIdx);
    if (getZoom() < CPU_PREVIEW_ZOOM_THRESHOLD) state.cpuRefine = false;
  } catch { /* ignore */ }
}

function saveViewForCurrentFractal() {
  state.savedViews[state.fractalIdx] = {
    cx: state.targetCenterX,
    cy: state.targetCenterY,
    ps: state.targetPixelScale,
  };
}

function restoreViewForFractal(idx) {
  resetView(idx);
  const view = state.savedViews[idx];
  if (view) setCameraTarget(view.cx, view.cy, view.ps, true);
  markMinimapDirty();
}

// ─── URL share ────────────────────────────────────────────────────────────────

function stateToParams() {
  // Share links intentionally encode the target camera, not the eased current
  // camera, so copied links match where the user is navigating.
  return sessionSnapshotToParams(buildShareStateSnapshot());
}

function loadFromParams() {
  const snapshot = paramsToSessionSnapshot(window.location.search);
  if (!snapshot) return;
  applySessionSnapshot(snapshot, { skipSyncTarget: true });
  syncTargetToCurrent();
  markMinimapDirty();
}

function getActiveTour() {
  return TOUR_MAP.get(state.tour.id) || null;
}

function getActiveTourStop() {
  const tour = getActiveTour();
  if (!tour || !tour.stops.length) return null;
  const index = Math.max(0, Math.min(state.tour.stop, tour.stops.length - 1));
  return tour.stops[index];
}

function getCompareFractal() {
  return FRACTALS[clampFractalIndex(state.compare.fractalIdx)] || FRACTALS[0];
}

function isComposerFractal(idx = state.fractalIdx) {
  return idx === COMPOSER_FRACTAL_INDEX || FRACTALS[idx]?.formula === "composer";
}

function syncComposerFractal(options = {}) {
  if (COMPOSER_FRACTAL_INDEX < 0) return;
  const recompile = options.recompile !== false;
  const config = normalizeComposerConfig(state.composer);
  state.composer = config;
  const fractal = FRACTALS[COMPOSER_FRACTAL_INDEX];
  fractal.composer = config;
  fractal.src = buildComposerFractalSource(config);
  fractal.formulaText = buildComposerFormulaText(config);
  fractal.explanationText = "A generated formula assembled from safe primitives. It renders on the GPU from the active composer stack.";
  if (recompile && programs[COMPOSER_FRACTAL_INDEX]) {
    gl.deleteProgram(programs[COMPOSER_FRACTAL_INDEX].prog);
    programs[COMPOSER_FRACTAL_INDEX] = null;
  }
}

function syncComposerControls() {
  const config = normalizeComposerConfig(state.composer);
  ui.composerMode.value = config.mode;
  ui.composerStack.querySelectorAll(".composer-op").forEach(select => {
    const slot = parseInt(select.dataset.slot, 10) || 0;
    select.value = config.ops[slot] || "empty";
  });
  ui.composerSummary.textContent = buildComposerFormulaText(config);
  const active = isComposerFractal();
  ui.btnComposerUse.textContent = active ? "Active" : "Use";
  ui.btnComposerUse.classList.toggle("active", active);
}

function setComposerConfig(next) {
  state.composer = normalizeComposerConfig({
    ...state.composer,
    ...next,
  });
  syncComposerFractal();
  if (isComposerFractal()) {
    markMinimapDirty();
    markDeepDirty(true);
  }
  saveSettings();
}

function useComposerFractal() {
  if (COMPOSER_FRACTAL_INDEX < 0) return;
  syncComposerFractal();
  if (!isComposerFractal()) {
    selectFractal(COMPOSER_FRACTAL_INDEX);
  } else {
    markDeepDirty(true);
    saveSettings();
  }
}

function resetComposerConfig() {
  state.composer = normalizeComposerConfig(COMPOSER_DEFAULT);
  syncComposerFractal();
  if (isComposerFractal()) {
    markMinimapDirty();
    markDeepDirty(true);
  }
  saveSettings();
}

function stopTourPlayback(save = true) {
  if (!state.tour.playing) return;
  state.tour.playing = false;
  if (save) saveSettings();
}

function applyTourStop(index, options = {}) {
  const tour = getActiveTour();
  if (!tour || !tour.stops.length) return;
  const stopIndex = Math.max(0, Math.min(index, tour.stops.length - 1));
  const stop = tour.stops[stopIndex];
  state.tour.stop = stopIndex;
  tourPlayback.lastSettledAt = 0;
  tourPlayback.lastAdvancedAt = performance.now();

  if (stop.fractalIdx !== state.fractalIdx) {
    selectFractal(stop.fractalIdx, { preserveTour: true });
  }
  setCameraTarget(stop.cx, stop.cy, stop.ps, options.immediate === true);
  markMinimapDirty();
  markDeepDirty(true);
  if (!options.skipSave) saveSettings();
}

function selectTour(tourId, options = {}) {
  if (!tourId || !TOUR_MAP.has(tourId)) {
    state.tour.id = "";
    state.tour.stop = 0;
    stopTourPlayback(false);
    ui.tourSelect.value = "";
    if (!options.skipSave) saveSettings();
    return;
  }
  state.tour.id = tourId;
  state.tour.stop = Math.max(0, Math.min(options.stop ?? state.tour.stop, TOUR_MAP.get(tourId).stops.length - 1));
  if (!options.keepPlaying) state.tour.playing = false;
  ui.tourSelect.value = tourId;
  applyTourStop(state.tour.stop, { immediate: options.immediate, skipSave: options.skipSave });
}

function stepTour(direction) {
  const tour = getActiveTour();
  if (!tour || !tour.stops.length) return;
  const nextIndex = (state.tour.stop + direction + tour.stops.length) % tour.stops.length;
  applyTourStop(nextIndex);
}

function toggleTourPlayback() {
  const tour = getActiveTour();
  if (!tour || tour.stops.length < 2) return;
  state.tour.playing = !state.tour.playing;
  if (state.tour.playing) {
    tourPlayback.lastSettledAt = 0;
    tourPlayback.lastAdvancedAt = performance.now();
  }
  saveSettings();
}

function updateTourPlayback(now) {
  if (!state.tour.playing) return;
  const tour = getActiveTour();
  if (!tour || tour.stops.length < 2) {
    stopTourPlayback();
    return;
  }
  if (!isCameraSettled() || state.dragging || activePointers.size) {
    tourPlayback.lastSettledAt = 0;
    return;
  }
  if (!tourPlayback.lastSettledAt) {
    tourPlayback.lastSettledAt = now;
    return;
  }
  if (now - tourPlayback.lastSettledAt < TOUR_STOP_SETTLE_MS) return;
  if (now - tourPlayback.lastAdvancedAt < TOUR_ADVANCE_DELAY_MS) return;
  stepTour(1);
}

// ─── Resize ───────────────────────────────────────────────────────────────────

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(canvas.clientWidth  * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    if (!state.pixelScale) resetView();
  }
  const deepW = Math.max(1, Math.floor(deepCanvas.clientWidth * CPU_DPR));
  const deepH = Math.max(1, Math.floor(deepCanvas.clientHeight * CPU_DPR));
  if (deepCanvas.width !== deepW || deepCanvas.height !== deepH) {
    deepCanvas.width = deepW;
    deepCanvas.height = deepH;
    markDeepDirty(true);
  }
}

function renderViewport() {
  // Converts the active camera into the world-space rectangle used by both GPU
  // uniforms and CPU refinement snapshots.
  return renderViewportForView({
    width: canvas.width,
    height: canvas.height,
    centerX: state.centerX,
    centerY: state.centerY,
    pixelScale: state.pixelScale,
  });
}

function renderViewportForView(view) {
  const width = Math.max(view.width, 1);
  const height = Math.max(view.height, 1);
  const worldWidth = width * view.pixelScale;
  const worldHeight = height * view.pixelScale;
  const x0 = view.centerX - worldWidth * 0.5;
  const y0 = view.centerY - worldHeight * 0.5;
  return {
    width,
    height,
    worldWidth,
    worldHeight,
    x0,
    y0,
    y1: y0 + worldHeight,
    pixelScale: state.pixelScale,
  };
}

// ─── Julia C ──────────────────────────────────────────────────────────────────

function juliaC() {
  // Interactive Julia sets use a circular parameter path; preset Julia variants
  // use fixed values from the fractal registry instead.
  const a = parseFloat(ui.juliaAngle.value);
  return [0.7885 * Math.cos(a), 0.7885 * Math.sin(a)];
}

function clampJuliaParam(value) {
  return Math.max(-1.5, Math.min(1.5, value));
}

function fixedJuliaParam(idx = state.fractalIdx) {
  const saved = state.juliaParams[idx];
  const base = FRACTALS[idx].juliaParam || [0, 0];
  if (Array.isArray(saved) && saved.length >= 2) {
    const real = parseFloat(saved[0]);
    const imag = parseFloat(saved[1]);
    if (Number.isFinite(real) && Number.isFinite(imag)) {
      return [clampJuliaParam(real), clampJuliaParam(imag)];
    }
  }
  return [base[0], base[1]];
}

function getRenderJuliaC(idx = state.fractalIdx) {
  if (FRACTALS[idx].juliaParam) return fixedJuliaParam(idx);
  return juliaC();
}

function syncJuliaParamInputs() {
  const f = FRACTALS[state.fractalIdx];
  if (!f.juliaParam || document.activeElement === ui.juliaReal || document.activeElement === ui.juliaImag) return;
  const [real, imag] = fixedJuliaParam();
  ui.juliaReal.value = real.toFixed(3);
  ui.juliaImag.value = imag.toFixed(3);
}

// ─── Sync UI ──────────────────────────────────────────────────────────────────

function updateUI() {
  const f = FRACTALS[state.fractalIdx];
  const tour = getActiveTour();
  const stop = getActiveTourStop();
  const compareFractal = getCompareFractal();
  const compareSupportsBasin = (compareFractal.meta.colorModes || []).includes("basin");
  ui.fractalName.textContent = f.name;
  ui.fractalSelect.value = String(state.fractalIdx);
  updateFavoriteButton();
  ui.compareFractalSelect.value = String(compareFractal ? FRACTALS.indexOf(compareFractal) : 0);
  ui.compareColorStyle.value = String(state.compare.colorStyle);
  ui.formulaDisplay.value = getActiveFormulaText(f);
  syncComposerControls();
  ui.tourSelect.value = tour ? tour.id : "";
  ui.colorStyle.value = String(state.colorStyle);
  ui.juliaRow.style.display  = f.julia ? "" : "none";
  ui.fixedJuliaRow.style.display = f.juliaParam && (!isComposerFractal() || state.composer.mode === "julia") ? "" : "none";
  syncJuliaParamInputs();
  ui.iterReadout.textContent = getRenderIterations();
  ui.modeReadout.textContent = getRenderModeLabel();
  ui.btnRefine.textContent = f.meta.gpuOnly ? "GPU Only" : (state.cpuRefine ? "Refine ON" : "Refine");
  ui.btnRefine.title = f.meta.gpuOnly
    ? "CPU refinement is unavailable for generated formulas"
    : state.cpuRefine
      ? `Toggle CPU refinement (${getCpuWorkerCount()} workers on this device)`
      : "Toggle CPU refinement";
  ui.btnRefine.classList.toggle("active", state.cpuRefine && !f.meta.gpuOnly);
  ui.btnRefine.disabled = state.compare.enabled || !!f.meta.gpuOnly;
  ui.btnMobileRefine.textContent = f.meta.gpuOnly ? "GPU Only" : (state.cpuRefine ? "Refine ON" : "Refine");
  ui.btnMobileRefine.title = ui.btnRefine.title;
  ui.btnMobileRefine.classList.toggle("active", state.cpuRefine && !f.meta.gpuOnly);
  ui.btnMobileRefine.disabled = ui.btnRefine.disabled;
  ui.btnPalette.textContent = state.colorStyle === COLOR_STYLE_PALETTE ? "Palette" : "Accent";
  ui.btnMobilePalette.textContent = ui.btnPalette.textContent;
  const supportsBasinMode = (f.meta.colorModes || []).includes("basin");
  if (!supportsBasinMode && state.colorMode === COLOR_MODE_BASIN) state.colorMode = COLOR_MODE_ESCAPE;
  if (!compareSupportsBasin && state.compare.colorMode === COLOR_MODE_BASIN) state.compare.colorMode = COLOR_MODE_ESCAPE;
  ui.btnColorMode.disabled = !supportsBasinMode;
  ui.btnColorMode.textContent = state.colorMode === COLOR_MODE_BASIN ? "Basin" : "Escape";
  ui.btnColorMode.classList.toggle("active", state.colorMode === COLOR_MODE_BASIN);
  ui.zoomReadout.textContent = formatZoom(getZoom());
  ui.tourMeta.textContent = tour ? `${tour.stops.length} stops` : "No tour selected";
  ui.tourStopTitle.textContent = stop ? stop.title : "Pick a tour";
  ui.tourStopIndex.textContent = tour ? `${state.tour.stop + 1} / ${tour.stops.length}` : "0 / 0";
  ui.tourStopNote.textContent = stop
    ? stop.note
    : "Curated routes will guide you through interesting regions and keep the current stop shareable.";
  ui.btnTourPrev.disabled = !tour;
  ui.btnTourNext.disabled = !tour;
  ui.btnTourPlay.disabled = !tour || tour.stops.length < 2;
  ui.btnTourPlay.textContent = state.tour.playing ? "Pause" : "Play";
  ui.btnTourPlay.classList.toggle("active", state.tour.playing);
  ui.inspectX.textContent = formatCoordinate(state.targetCenterX);
  ui.inspectY.textContent = formatCoordinate(state.targetCenterY);
  ui.inspectMode.textContent = getInspectorModeLabel(f);
  ui.inspectFamily.textContent = f.category;
  ui.inspectPerturb.textContent = getPerturbationHealthLabel();
  ui.inspectOrbit.textContent = formatReferenceOrbitLength();
  ui.inspectSummary.textContent = getInspectorSummary(f, stop);
  ui.compareDivider.hidden = !state.compare.enabled;
  ui.btnCompareToggle.textContent = state.compare.enabled ? "On" : "Off";
  ui.btnCompareToggle.classList.toggle("active", state.compare.enabled);
  ui.btnComparePalette.textContent = state.compare.colorStyle === COLOR_STYLE_PALETTE ? "Palette" : "Accent";
  ui.btnCompareColorMode.disabled = !compareSupportsBasin;
  ui.btnCompareColorMode.textContent = state.compare.colorMode === COLOR_MODE_BASIN ? "Basin" : "Escape";
  ui.btnCompareColorMode.classList.toggle("active", state.compare.colorMode === COLOR_MODE_BASIN);
  ui.compareSummary.textContent = state.compare.enabled
    ? `Left: ${f.name}. Right: ${compareFractal.name}. Shared camera, split-screen GPU compare. CPU refine is paused while compare is active.`
    : "Split-screen compare uses the same camera on both halves so formulas and coloring can be judged directly.";
}

function formatZoom(zoom) {
  if (!Number.isFinite(zoom) || zoom <= 0) return "1×";
  if (zoom >= 1e9) return zoom.toExponential(2).replace("+", "") + "×";
  if (zoom >= 1e6) return (zoom / 1e6).toFixed(2) + "M×";
  if (zoom >= 1000) return (zoom / 1000).toFixed(1) + "k×";
  return zoom.toFixed(zoom < 10 ? 2 : 0) + "×";
}

function getRenderModeLabel() {
  if (state.compare.enabled) return "GPU Split";
  if (FRACTALS[state.fractalIdx].meta.gpuOnly) return "GPU";
  if (!state.cpuRefine || !deepCtx) return "GPU";
  if (cpuRender.running) {
    if (cpuRender.backend === "perturbMandelbrot") {
      return cpuRender.useWorkers ? `Perturb x${cpuRender.workers.length}` : "Perturb...";
    }
    return cpuRender.useWorkers ? `CPU x${cpuRender.workers.length}` : "CPU...";
  }
  if (cpuRender.complete && !cpuRender.dirty) {
    return cpuRender.backend === "perturbMandelbrot" ? "Perturb" : "CPU";
  }
  return "GPU";
}

function formatCoordinate(value) {
  const abs = Math.abs(value);
  if (!Number.isFinite(value)) return "0";
  if (abs >= 1000 || (abs > 0 && abs < 1e-4)) return value.toExponential(6).replace("+", "");
  return value.toFixed(9).replace(/0+$/, "").replace(/\.$/, "");
}

function formatJuliaComponent(value) {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toExponential(2);
  if (abs >= 1) return value.toFixed(3);
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function getInspectorModeLabel(fractal = FRACTALS[state.fractalIdx]) {
  if (fractal.meta.newton) {
    return state.colorMode === COLOR_MODE_BASIN ? `Basins (${fractal.meta.basinRoots} roots)` : "Newton escape";
  }
  if (fractal.meta.orbitTrap) return "Orbit trap";
  if (fractal.julia || fractal.juliaParam) return "Julia family";
  return state.colorMode === COLOR_MODE_BASIN ? "Basin" : "Escape";
}

function getInspectorSummary(fractal = FRACTALS[state.fractalIdx], stop = getActiveTourStop()) {
  const backend = getRenderModeLabel();
  const base = fractal.explanationText || "This fractal uses iterative orbit behavior to separate stable and unstable regions.";
  if (fractal.meta.gpuOnly) {
    return `${base} Renderer: GPU only. CPU refinement and perturbation are unavailable for generated formulas.`;
  }
  const perturb = getPerturbationSummary();
  if (stop) {
    return `${stop.note} Renderer: ${backend}. ${perturb} ${base}`;
  }
  return `${base} Renderer: ${backend}. ${perturb}`;
}

function currentViewSupportsPerturbation() {
  return FRACTALS[state.fractalIdx].formula === "mandelbrot";
}

function currentViewSupportsCpuRefinement() {
  return !FRACTALS[state.fractalIdx].meta.gpuOnly;
}

function isPerturbationArmed() {
  return currentViewSupportsPerturbation() && getZoom() >= PERTURB_MIN_ZOOM;
}

function getPerturbationSummary() {
  if (isActivePerturbationRender()) {
    const { totalSamples, fallbackSamples, referenceOrbitLength } = cpuRender.diagnostics;
    const fallbackRate = totalSamples > 0 ? (fallbackSamples / totalSamples) * 100 : 0;
    return `Reference orbit length ${referenceOrbitLength || 0}. Fallback rate ${fallbackRate.toFixed(fallbackRate >= 10 ? 1 : 2)}%.`;
  }
  if (!currentViewSupportsPerturbation()) return "Perturbation is unavailable for this formula in v1.0.";
  if (isPerturbationArmed()) return "Perturbation is armed and will engage on the next CPU refinement pass.";
  return "Perturbation activates only for Mandelbrot at deeper zoom.";
}

function isActivePerturbationRender() {
  return cpuRender.backend === "perturbMandelbrot" && !cpuRender.dirty && !state.compare.enabled && state.cpuRefine;
}

function getPerturbationHealthLabel() {
  if (isActivePerturbationRender()) {
    const { totalSamples, fallbackSamples } = cpuRender.diagnostics;
    if (totalSamples <= 0) return "Starting";
    const rate = fallbackSamples / totalSamples;
    if (rate <= 0.01) return "Stable";
    if (rate <= 0.05) return "Light fallback";
    if (rate <= 0.15) return "Mixed fallback";
    return "Heavy fallback";
  }
  if (isPerturbationArmed()) return "Armed";
  if (currentViewSupportsPerturbation()) return "Standby";
  return "Inactive";
}

function formatReferenceOrbitLength() {
  return isActivePerturbationRender()
    ? String(cpuRender.diagnostics.referenceOrbitLength || 0)
    : isPerturbationArmed()
      ? "Pending"
      : "N/A";
}

function resetCpuDiagnostics(snapshot) {
  cpuRender.backend = snapshot.backend || "cpu";
  cpuRender.diagnostics.totalSamples = 0;
  cpuRender.diagnostics.fallbackSamples = 0;
  cpuRender.diagnostics.referenceOrbitLength = snapshot.referenceOrbit ? snapshot.referenceOrbit.length : 0;
}

function recordCpuDiagnostics(totalSamples, fallbackSamples) {
  cpuRender.diagnostics.totalSamples += totalSamples;
  cpuRender.diagnostics.fallbackSamples += fallbackSamples;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "fractal";
}

function buildExportFilename() {
  const fractal = FRACTALS[state.fractalIdx];
  const tour = getActiveTour();
  const stop = getActiveTourStop();
  const parts = [
    "fractals",
    slugify(fractal.name),
  ];
  if (tour) parts.push(slugify(tour.name));
  if (stop) parts.push(`stop-${state.tour.stop + 1}`);
  parts.push(`zoom-${slugify(formatZoom(getZoom()))}`);
  return parts.join("_") + ".png";
}

function exportCompositeCanvas() {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const exportCtx = exportCanvas.getContext("2d", { alpha: false });
  if (!exportCtx) return null;

  exportCtx.fillStyle = "#020405";
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  exportCtx.drawImage(canvas, 0, 0);

  if (state.cpuRefine && deepCanvas.width && deepCanvas.height) {
    exportCtx.drawImage(deepCanvas, 0, 0, exportCanvas.width, exportCanvas.height);
  }
  if (state.compare.enabled) {
    const mid = Math.floor(exportCanvas.width * 0.5);
    exportCtx.fillStyle = "rgba(125, 240, 192, 0.95)";
    exportCtx.fillRect(Math.max(0, mid - 1), 0, 2, exportCanvas.height);
  }
  return exportCanvas;
}

function getActiveFormulaText(fractal = FRACTALS[state.fractalIdx]) {
  const base = fractal.formulaText || "Formula metadata pending";
  if (fractal.formula === "composer" && state.composer.mode !== "julia") return base;
  if (!fractal.julia && !fractal.juliaParam) return base;
  const [real, imag] = getRenderJuliaC(FRACTALS.indexOf(fractal));
  const imagSign = imag < 0 ? "-" : "+";
  return `${base}\nc = ${formatJuliaComponent(real)} ${imagSign} ${formatJuliaComponent(Math.abs(imag))}i`;
}

function getZoom() {
  return FRACTALS[state.fractalIdx].scale / (state.pixelScale * Math.max(canvas.width, 1));
}

function getRenderIterations() {
  const requested = parseInt(ui.iterations.value, 10) || DEFAULT_ITER;
  const zoom = Math.max(1, getZoom());
  const zoomBoost = Math.floor(Math.log2(zoom) * 32);
  return Math.max(MIN_ITER, Math.min(MAX_ITER, requested + zoomBoost));
}

function drawScene(scene, viewportRect) {
  const { prog, loc } = getProgram(scene.fractalIdx);
  const viewport = renderViewportForView({
    width: viewportRect.width,
    height: viewportRect.height,
    centerX: scene.centerX,
    centerY: scene.centerY,
    pixelScale: scene.pixelScale,
  });
  const [x0Hi, x0Mid, x0Lo] = tsSplit(viewport.x0);
  const [y0Hi, y0Mid, y0Lo] = tsSplit(viewport.y0);

  gl.viewport(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
  gl.scissor(viewportRect.x, viewportRect.y, viewportRect.width, viewportRect.height);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(loc.pos);
  gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(loc.res, viewport.width, viewport.height);
  gl.uniform3f(loc.x0, x0Hi, x0Mid, x0Lo);
  gl.uniform3f(loc.y0, y0Hi, y0Mid, y0Lo);
  gl.uniform1f(loc.scale, viewport.pixelScale);
  gl.uniform1i(loc.iter, scene.iterations);
  gl.uniform1f(loc.palette, scene.palette);
  gl.uniform1f(loc.cycle, scene.colorCycle);
  gl.uniform2f(loc.juliaC, scene.juliaC[0], scene.juliaC[1]);
  gl.uniform1i(loc.colorMode, scene.colorMode);
  gl.uniform1i(loc.colorStyle, scene.colorStyle);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// ─── Minimap ─────────────────────────────────────────────────────────────────

function markMinimapDirty() {
  minimapDirty = true;
}

function resizeMinimap() {
  if (!miniCtx || !minimapBaseCtx) return false;
  const rect = minimap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (minimap.width !== w || minimap.height !== h) {
    minimap.width = w;
    minimap.height = h;
    minimapBase.width = w;
    minimapBase.height = h;
    minimapDirty = true;
  }
  return true;
}

function cosinePalette(t, paletteIdx, colorStyle = COLOR_STYLE_PALETTE) {
  // Keep this palette math in sync with the GLSL cospalette/colorize helpers so
  // the minimap and CPU overlay resemble the WebGL render.
  return writeStyleColor(t, paletteIdx, colorStyle);
}

function formulaMeta(formula) {
  return FORMULA_META[formula] || {};
}

function supportsBasinColor(formula) {
  return (formulaMeta(formula).basinRoots || 0) > 0;
}

function cubicRootId(zx, zy) {
  const roots = [
    [1, 0],
    [-0.5, Math.sqrt(3) * 0.5],
    [-0.5, -Math.sqrt(3) * 0.5],
  ];
  let best = 0;
  let bestDist = Infinity;
  roots.forEach(([rx, ry], idx) => {
    const dx = zx - rx;
    const dy = zy - ry;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      best = idx;
      bestDist = dist;
    }
  });
  return best;
}

function quarticRootId(zx, zy) {
  const roots = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ];
  let best = 0;
  let bestDist = Infinity;
  roots.forEach(([rx, ry], idx) => {
    const dx = zx - rx;
    const dy = zy - ry;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      best = idx;
      bestDist = dist;
    }
  });
  return best;
}

function quinticRootId(zx, zy) {
  let best = 0, bestDist = Infinity;
  for (let k = 0; k < 5; k++) {
    const angle = (Math.PI * 2 * k) / 5;
    const dx = zx - Math.cos(angle);
    const dy = zy - Math.sin(angle);
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) { best = k; bestDist = dist; }
  }
  return best;
}

function basinRootId(formula, zx, zy) {
  const roots = formulaMeta(formula).basinRoots;
  if (roots === 5) return quinticRootId(zx, zy);
  if (roots === 4) return quarticRootId(zx, zy);
  return cubicRootId(zx, zy);
}

const BASIN_BASES = new Uint8Array([
  245, 87, 56,
  46, 184, 255,
  199, 235, 71,
  194, 110, 255,
  250, 204, 46,
]);
const _BASIN_COLOR = [0, 0, 0];

function basinColor(root, iter, maxIter, cycle = 0) {
  const idx = (root >= 0 && root < 5) ? root * 3 : 0;
  const m = maxIter > 0 ? maxIter : 1;
  const k = iter / m;
  const shade = 0.28 + 0.72 * Math.pow(1 - (k > 1 ? 1 : k), 0.7);
  const ring = 0.86 + 0.14 * Math.cos(Math.PI * 2 * (iter * 0.08 + cycle));
  const scale = shade * ring;
  _BASIN_COLOR[0] = Math.round(BASIN_BASES[idx] * scale);
  _BASIN_COLOR[1] = Math.round(BASIN_BASES[idx + 1] * scale);
  _BASIN_COLOR[2] = Math.round(BASIN_BASES[idx + 2] * scale);
  return _BASIN_COLOR;
}

function previewComposerEscape(x, y, jc) {
  const config = normalizeComposerConfig(state.composer);
  let zx = config.mode === "julia" ? x : 0;
  let zy = config.mode === "julia" ? y : 0;
  const cx = config.mode === "julia" ? jc[0] : x;
  const cy = config.mode === "julia" ? jc[1] : y;

  for (let n = 0; n < MINIMAP_ITER; n++) {
    for (const op of config.ops) {
      const x2 = zx * zx;
      const y2 = zy * zy;
      const xy = zx * zy;
      if (op === "squareAddC") {
        zx = x2 - y2 + cx;
        zy = 2 * xy + cy;
      } else if (op === "cubeAddC") {
        zx = zx * (x2 - 3 * y2) + cx;
        zy = zy * (3 * x2 - y2) + cy;
      } else if (op === "absFold") {
        zx = Math.abs(zx);
        zy = Math.abs(zy);
      } else if (op === "conjugate") {
        zy = -zy;
      } else if (op === "sinAddC") {
        const ox = zx;
        const yy = Math.max(-8, Math.min(8, zy));
        zx = Math.sin(ox) * Math.cosh(yy) + cx;
        zy = Math.cos(ox) * Math.sinh(yy) + cy;
      } else if (op === "cosAddC") {
        const ox = zx;
        const yy = Math.max(-8, Math.min(8, zy));
        zx = Math.cos(ox) * Math.cosh(yy) + cx;
        zy = -Math.sin(ox) * Math.sinh(yy) + cy;
      } else if (op === "expAddC") {
        const ex = Math.exp(Math.max(-8, Math.min(8, zx)));
        const ey = Math.max(-8, Math.min(8, zy));
        zx = ex * Math.cos(ey) + cx;
        zy = ex * Math.sin(ey) + cy;
      } else if (op === "rationalLace") {
        const z2x = x2 - y2;
        const z2y = 2 * xy;
        const dr = 1 + 0.35 * z2x;
        const di = 0.35 * z2y;
        const den = Math.max(dr * dr + di * di, 1e-8);
        zx = z2x + (cx * dr + cy * di) / den;
        zy = z2y + (cy * dr - cx * di) / den;
      } else if (op === "boxFold") {
        let bx = Math.max(-1, Math.min(1, zx)) * 2 - zx;
        let by = Math.max(-1, Math.min(1, zy)) * 2 - zy;
        const r2 = bx * bx + by * by;
        if (r2 < 0.25) {
          bx *= 4; by *= 4;
        } else if (r2 < 1) {
          bx /= r2; by /= r2;
        }
        zx = 2 * bx + cx;
        zy = 2 * by + cy;
      } else if (op === "newtonCubic") {
        const z2x = x2 - y2;
        const z2y = 2 * xy;
        const z3x = z2x * zx - z2y * zy;
        const z3y = z2x * zy + z2y * zx;
        const den = Math.max(9 * (z2x * z2x + z2y * z2y), 1e-8);
        const nr = z3x - 1;
        const ni = z3y;
        const dr = 3 * z2x;
        const di = 3 * z2y;
        const qx = (nr * dr + ni * di) / den;
        const qy = (ni * dr - nr * di) / den;
        zx = zx - qx + 0.18 * cx;
        zy = zy - qy + 0.18 * cy;
      }
    }
    if (!Number.isFinite(zx) || !Number.isFinite(zy)) return n;
    if (zx * zx + zy * zy > 256) return n;
  }
  return MINIMAP_ITER;
}

function previewEscape(fractalIdx, x, y) {
  // Lightweight CPU sampler used for the minimap. The full CPU refinement path
  // below has more specialized hot loops, but this generic version is easier to
  // keep broad enough for every formula.
  const formula = FRACTALS[fractalIdx].formula || "mandelbrot";
  const meta = formulaMeta(formula);
  const jc = getRenderJuliaC(fractalIdx);
  if (formula === "composer") return previewComposerEscape(x, y, jc);
  let zx = 0, zy = 0, cx = x, cy = y, px = 0, py = 0, trap = Infinity;

  if (meta.initial === "julia") {
    zx = x; zy = y; cx = jc[0]; cy = jc[1];
  } else if (meta.initial === "phoenix") {
    zx = x; zy = y; cx = -0.5 + 0.32 * jc[0]; cy = 0.32 * jc[1];
  } else if (meta.initial === "lambda") {
    zx = 0.5; zy = 0; cx = x; cy = y;
  } else if (meta.initial === "point") {
    zx = x; zy = y;
  }

  for (let n = 0; n < MINIMAP_ITER; n++) {
    let nx, ny;
    const x2 = zx * zx;
    const y2 = zy * zy;
    const xy = zx * zy;

    if (formula === "burningShip" || formula === "burningJulia") {
      const ax = Math.abs(zx), ay = Math.abs(zy);
      nx = ax * ax - ay * ay + cx;
      ny = 2 * ax * ay + cy;
    } else if (formula === "tricorn" || formula === "tricornJulia" || formula === "mandelbarJulia") {
      nx = x2 - y2 + cx;
      ny = -2 * xy + cy;
    } else if (formula === "cubic" || formula === "cubicJulia") {
      nx = zx * (x2 - 3 * y2) + cx;
      ny = zy * (3 * x2 - y2) + cy;
    } else if (formula === "cubicMandelbar") {
      nx = zx * (x2 - 3 * y2) + cx;
      ny = -zy * (3 * x2 - y2) + cy;
    } else if (formula === "cubicCeltic") {
      const z3x = zx * (x2 - 3 * y2);
      const z3y = zy * (3 * x2 - y2);
      nx = Math.abs(z3x) + cx;
      ny = z3y + cy;
    } else if (formula === "cubicBuffalo") {
      const z3x = zx * (x2 - 3 * y2);
      const z3y = zy * (3 * x2 - y2);
      nx = Math.abs(z3x) + cx;
      ny = -Math.abs(z3y) + cy;
    } else if (formula === "quartic" || formula === "quarticJulia") {
      const qx = x2 - y2;
      const qy = 2 * xy;
      nx = qx * qx - qy * qy + cx;
      ny = 2 * qx * qy + cy;
    } else if (formula === "celtic" || formula === "celticJulia") {
      nx = Math.abs(x2 - y2) + cx;
      ny = 2 * xy + cy;
    } else if (formula === "buffalo" || formula === "buffaloJulia") {
      nx = Math.abs(x2 - y2) + cx;
      ny = -Math.abs(2 * xy) + cy;
    } else if (formula === "phoenix") {
      nx = x2 - y2 + cx - 0.45 * px;
      ny = 2 * xy + cy;
      px = zx; py = zy;
    } else if (formula === "perpendicularMandelbrot" || formula === "perpendicularJulia") {
      nx = x2 - y2 + cx;
      ny = -2 * Math.abs(zx) * zy + cy;
    } else if (formula === "celticHeart") {
      nx = Math.abs(x2 - y2) + cx;
      ny = -2 * xy + cy;
    } else if (formula === "perpendicularBuffalo") {
      nx = Math.abs(x2 - y2) + cx;
      ny = -2 * Math.abs(xy) + cy;
    } else if (formula === "quintic") {
      const x4 = x2 * x2;
      const y4 = y2 * y2;
      nx = zx * (x4 - 10 * x2 * y2 + 5 * y4) + cx;
      ny = zy * (5 * x4 - 10 * x2 * y2 + y4) + cy;
    } else if (formula === "lambda") {
      const pr = zx * (1 - zx) + y2;
      const pi = zy * (1 - 2 * zx);
      nx = cx * pr - cy * pi;
      ny = cx * pi + cy * pr;
    } else if (formula === "spider") {
      nx = x2 - y2 + cx;
      ny = 2 * xy + cy;
      cx = cx * 0.5 + nx;
      cy = cy * 0.5 + ny;
    } else if (formula === "burningCubic") {
      const ax = Math.abs(zx), ay = Math.abs(zy);
      const ax2 = ax * ax;
      const ay2 = ay * ay;
      nx = ax * (ax2 - 3 * ay2) + cx;
      ny = ay * (3 * ax2 - ay2) + cy;
    } else if (formula === "burningQuartic") {
      const ax = Math.abs(zx), ay = Math.abs(zy);
      const qx = ax * ax - ay * ay;
      const qy = 2 * ax * ay;
      nx = qx * qx - qy * qy + cx;
      ny = 2 * qx * qy + cy;
    } else if (formula === "octic") {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const z4x = z2x * z2x - z2y * z2y;
      const z4y = 2 * z2x * z2y;
      nx = z4x * z4x - z4y * z4y + cx;
      ny = 2 * z4x * z4y + cy;
    } else if (formula === "glynnJulia") {
      const r = Math.pow(Math.hypot(zx, zy), 1.5);
      const a = Math.atan2(zy, zx) * 1.5;
      nx = Math.cos(a) * r + cx;
      ny = Math.sin(a) * r + cy;
    } else if (formula === "cosine") {
      const yy = Math.max(-8, Math.min(8, zy));
      nx = Math.cos(zx) * Math.cosh(yy) + cx;
      ny = -Math.sin(zx) * Math.sinh(yy) + cy;
    } else if (formula === "sine" || formula === "sineJulia") {
      const yy = Math.max(-8, Math.min(8, zy));
      nx = Math.sin(zx) * Math.cosh(yy) + cx;
      ny = Math.cos(zx) * Math.sinh(yy) + cy;
    } else if (formula === "magnet") {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const nr = z2x + cx - 1;
      const ni = z2y + cy;
      const dr = 2 * zx + cx - 2;
      const di = 2 * zy + cy;
      const den = Math.max(dr * dr + di * di, 1e-8);
      const qx = (nr * dr + ni * di) / den;
      const qy = (ni * dr - nr * di) / den;
      nx = qx * qx - qy * qy;
      ny = 2 * qx * qy;
      if ((nx - 1) * (nx - 1) + ny * ny < 1e-8) return n;
    } else if (formula === "feather") {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const z3x = z2x * zx - z2y * zy;
      const z3y = z2x * zy + z2y * zx;
      const dr = 1 + z2x;
      const di = z2y;
      const den = Math.max(dr * dr + di * di, 1e-8);
      nx = (z3x * dr + z3y * di) / den + cx;
      ny = (z3y * dr - z3x * di) / den + cy;
    } else if (formula === "rationalJuliaLace") {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const dr = z2x + 0.22;
      const di = z2y;
      const den = Math.max(dr * dr + di * di, 1e-8);
      nx = z2x + (cx * dr + cy * di) / den;
      ny = z2y + (cy * dr - cx * di) / den;
    } else if (formula === "novaJuliaBloom") {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const z3x = z2x * zx - z2y * zy;
      const z3y = z2x * zy + z2y * zx;
      const nr = z3x - 1;
      const ni = z3y;
      const dr = 3 * z2x;
      const di = 3 * z2y;
      const den = Math.max(dr * dr + di * di, 1e-8);
      const qx = (nr * dr + ni * di) / den;
      const qy = (ni * dr - nr * di) / den;
      const rx = 0.78;
      const ry = 0.28;
      nx = zx - (rx * qx - ry * qy) + cx;
      ny = zy - (rx * qy + ry * qx) + cy;
      if (qx * qx + qy * qy < 1e-12) return n;
    } else if (formula === "rationalMandelbrotLace") {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const dr = z2x + 0.18;
      const di = z2y + 0.06;
      const den = Math.max(dr * dr + di * di, 1e-8);
      nx = z2x + (0.22 * dr - 0.11 * di) / den + cx;
      ny = z2y + (-0.11 * dr - 0.22 * di) / den + cy;
    } else if (
      formula === "orbitTrapMandelbrot" ||
      formula === "orbitTrapFlower" ||
      formula === "orbitTrapLotus" ||
      formula === "orbitTrapRoseJulia"
    ) {
      nx = x2 - y2 + cx;
      ny = 2 * xy + cy;
      if (formula === "orbitTrapFlower") {
        const a = Math.atan2(ny, nx);
        const petals = Math.abs(Math.hypot(nx, ny) - (0.35 + 0.12 * Math.cos(6 * a)));
        const ring = Math.abs(Math.hypot(nx + 0.18, ny - 0.08) - 0.28);
        const axis = Math.min(Math.abs(nx + 0.18), Math.abs(ny - 0.08));
        trap = Math.min(trap, petals, ring, axis);
      } else if (formula === "orbitTrapLotus") {
        const a = Math.atan2(ny, nx);
        const r = Math.hypot(nx, ny);
        const outer = Math.abs(r - (0.42 + 0.11 * Math.cos(8 * a)));
        const inner = Math.abs(r - (0.18 + 0.07 * Math.cos(5 * a + 0.8)));
        const stem = Math.min(Math.abs(nx * 0.65 + ny * 0.35), Math.abs(nx * 0.65 - ny * 0.35));
        trap = Math.min(trap, outer, inner, stem);
      } else if (formula === "orbitTrapRoseJulia") {
        const a = Math.atan2(ny, nx);
        const r = Math.hypot(nx, ny);
        const rose = Math.abs(r - (0.34 + 0.14 * Math.cos(7 * a)));
        const ring = Math.abs(Math.hypot(nx - 0.16, ny + 0.10) - 0.24);
        const vein = Math.min(Math.abs(nx + 0.22 * Math.sin(3 * a)), Math.abs(ny - 0.18 * Math.cos(4 * a)));
        trap = Math.min(trap, rose, ring, vein);
      } else {
        const circle = Math.abs(Math.hypot(nx - 0.25, ny) - 0.45);
        const cross = Math.min(Math.abs(nx), Math.abs(ny));
        const diagonal = Math.abs(nx + ny) * 0.70710678118;
        trap = Math.min(trap, circle, cross, diagonal);
      }
    } else if (meta.newton) {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const z3x = z2x * zx - z2y * zy;
      const z3y = z2x * zy + z2y * zx;
      let qx, qy;
      if (formula === "newtonQuartic") {
        const z4x = z2x * z2x - z2y * z2y;
        const z4y = 2 * z2x * z2y;
        const nr = z4x - 1;
        const ni = z4y;
        const dr = 4 * z3x;
        const di = 4 * z3y;
        const den = Math.max(dr * dr + di * di, 1e-8);
        qx = (nr * dr + ni * di) / den;
        qy = (ni * dr - nr * di) / den;
      } else if (formula === "halleyCubic") {
        const fr = z3x - 1;
        const fi = z3y;
        const fpr = 3 * z2x;
        const fpi = 3 * z2y;
        const fppr = 6 * zx;
        const fppi = 6 * zy;
        const ffpR = fr * fpr - fi * fpi;
        const ffpI = fr * fpi + fi * fpr;
        const fp2R = fpr * fpr - fpi * fpi;
        const fp2I = 2 * fpr * fpi;
        const ffppR = fr * fppr - fi * fppi;
        const ffppI = fr * fppi + fi * fppr;
        const nr = 2 * ffpR;
        const ni = 2 * ffpI;
        const dr = 2 * fp2R - ffppR;
        const di = 2 * fp2I - ffppI;
        const den = Math.max(dr * dr + di * di, 1e-8);
        qx = (nr * dr + ni * di) / den;
        qy = (ni * dr - nr * di) / den;
      } else {
        const nr = z3x - 1;
        const ni = z3y;
        const dr = 3 * z2x;
        const di = 3 * z2y;
        const den = Math.max(dr * dr + di * di, 1e-8);
        qx = (nr * dr + ni * di) / den;
        qy = (ni * dr - nr * di) / den;
      }
      if (formula === "novaBasins" || formula === "newtonRelaxSpiral" || formula === "newtonRelaxStorm") {
        const relaxX = 0.85;
        const relaxY = 0.35;
        const rx = formula === "newtonRelaxSpiral" ? 0.60 : (formula === "newtonRelaxStorm" ? -0.30 : relaxX);
        const ry = formula === "newtonRelaxSpiral" ? 0.60 : (formula === "newtonRelaxStorm" ? 0.90 : relaxY);
        nx = zx - (rx * qx - ry * qy);
        ny = zy - (rx * qy + ry * qx);
      } else {
        nx = zx - qx;
        ny = zy - qy;
      }
      if (qx * qx + qy * qy < 1e-12) return n;
    } else if (formula === "mandelbox") {
      let bx = Math.max(-1, Math.min(1, zx)) * 2 - zx;
      let by = Math.max(-1, Math.min(1, zy)) * 2 - zy;
      const r2 = bx * bx + by * by;
      if (r2 < 0.25) {
        bx *= 4; by *= 4;
      } else if (r2 < 1) {
        bx /= r2; by /= r2;
      }
      nx = 2 * bx + cx;
      ny = 2 * by + cy;
    } else {
      nx = x2 - y2 + cx;
      ny = 2 * xy + cy;
    }

    zx = nx; zy = ny;
    if (!Number.isFinite(zx) || !Number.isFinite(zy)) return n;
    if (zx * zx + zy * zy > 256) return n;
  }
  return MINIMAP_ITER;
}

function renderMinimapBackground() {
  if (!resizeMinimap()) return;
  const w = minimapBase.width;
  const h = minimapBase.height;
  const image = minimapBaseCtx.createImageData(w, h);
  const bounds = viewBoundsForFractal(state.fractalIdx);
  const formula = FRACTALS[state.fractalIdx].formula || "mandelbrot";
  const meta = formulaMeta(formula);
  const specialMinimap = (state.colorMode === COLOR_MODE_BASIN && supportsBasinColor(formula)) ||
    meta.orbitTrap;
  const cycle = parseFloat(ui.colorCycle.value) || 0;
  const jc = getRenderJuliaC();
  const left = bounds.cx - bounds.width * 0.5;
  const top = bounds.cy + bounds.height * 0.5;

  for (let py = 0; py < h; py++) {
    const y = top - (py / Math.max(h - 1, 1)) * bounds.height;
    for (let px = 0; px < w; px++) {
      const x = left + (px / Math.max(w - 1, 1)) * bounds.width;
      const sample = specialMinimap ? cpuEscape(formula, x, y, MINIMAP_ITER, jc) : null;
      const iter = sample ? sample.iter : previewEscape(state.fractalIdx, x, y);
      const offset = (py * w + px) * 4;
      if (sample) {
        const [r, g, b] = cpuColor(sample, MINIMAP_ITER, state.palette, cycle, state.colorMode, state.colorStyle);
        image.data[offset] = Math.round(r * 0.82);
        image.data[offset + 1] = Math.round(g * 0.82);
        image.data[offset + 2] = Math.round(b * 0.82);
      } else if (iter >= MINIMAP_ITER) {
        image.data[offset] = 2;
        image.data[offset + 1] = 5;
        image.data[offset + 2] = 7;
      } else {
        const t = iter / MINIMAP_ITER + cycle * 0.08;
        const [r, g, b] = cosinePalette(t, state.palette, state.colorStyle);
        image.data[offset] = Math.round(r * 0.82);
        image.data[offset + 1] = Math.round(g * 0.82);
        image.data[offset + 2] = Math.round(b * 0.82);
      }
      image.data[offset + 3] = 255;
    }
  }

  minimapBaseCtx.putImageData(image, 0, 0);
  minimapDirty = false;
}

function mapWorldToMinimap(x, y) {
  const bounds = viewBoundsForFractal(state.fractalIdx);
  return {
    x: ((x - (bounds.cx - bounds.width * 0.5)) / bounds.width) * minimap.width,
    y: (((bounds.cy + bounds.height * 0.5) - y) / bounds.height) * minimap.height,
  };
}

function drawMinimapViewport() {
  const wWorld = canvas.width * state.pixelScale;
  const hWorld = canvas.height * state.pixelScale;
  const topLeft = mapWorldToMinimap(state.centerX - wWorld * 0.5, state.centerY + hWorld * 0.5);
  const bottomRight = mapWorldToMinimap(state.centerX + wWorld * 0.5, state.centerY - hWorld * 0.5);
  const x = Math.min(topLeft.x, bottomRight.x);
  const y = Math.min(topLeft.y, bottomRight.y);
  const w = Math.abs(bottomRight.x - topLeft.x);
  const h = Math.abs(bottomRight.y - topLeft.y);
  const cx = (topLeft.x + bottomRight.x) * 0.5;
  const cy = (topLeft.y + bottomRight.y) * 0.5;

  miniCtx.save();
  miniCtx.strokeStyle = "rgba(125, 240, 192, 0.95)";
  miniCtx.fillStyle = "rgba(125, 240, 192, 0.12)";
  miniCtx.lineWidth = Math.max(1.5, minimap.width / 96);
  if (w >= 5 && h >= 5) {
    miniCtx.fillRect(x, y, w, h);
    miniCtx.strokeRect(x, y, w, h);
  } else {
    const r = Math.max(5, minimap.width / 22);
    miniCtx.beginPath();
    miniCtx.moveTo(cx - r, cy);
    miniCtx.lineTo(cx + r, cy);
    miniCtx.moveTo(cx, cy - r);
    miniCtx.lineTo(cx, cy + r);
    miniCtx.stroke();
    miniCtx.beginPath();
    miniCtx.arc(cx, cy, Math.max(2, r * 0.28), 0, Math.PI * 2);
    miniCtx.fill();
  }
  miniCtx.restore();
}

function drawMinimap() {
  if (!miniCtx || !minimapBaseCtx) return;
  resizeMinimap();
  if (minimapDirty) renderMinimapBackground();
  miniCtx.clearRect(0, 0, minimap.width, minimap.height);
  miniCtx.drawImage(minimapBase, 0, 0);
  drawMinimapViewport();
}

// ─── CPU refinement ───────────────────────────────────────────────────────────
//
// The GPU render is always the interactive base layer. When the camera stops,
// this subsystem paints a 2D canvas over it using the same formulas in JS. The
// generation/pass fields let old worker replies be ignored after a new camera
// move, fractal switch, or settings change.

function markDeepDirty(clear = false) {
  if (cpuRender.running && (clear || !cpuRender.previewOnly)) cancelCpuWorkers();
  cpuRender.dirty = true;
  cpuRender.complete = false;
  cpuRender.dirtySince = performance.now();
  if (clear || !cpuRender.previewOnly) {
    cpuRender.generation++;
    cpuRender.running = false;
  }
  if (clear) clearDeepOverlay();
  else if (!shouldRetainDeepOverlay()) clearDeepOverlay();
}

function clearDeepOverlay() {
  if (deepCtx) deepCtx.clearRect(0, 0, deepCanvas.width, deepCanvas.height);
  cpuRender.paintedSnapshot = null;
  if (deepCanvas) deepCanvas.style.transform = "";
}

function presentCpuImageData() {
  cpuRender.paintedSnapshot = cpuRender.snapshot;
  updateDeepOverlayTransform();
  deepCtx.putImageData(cpuRender.imageData, 0, 0);
}

function deepSnapshotZoom(snapshot) {
  if (!snapshot || !snapshot.pixelScale) return 0;
  return FRACTALS[snapshot.fractalIdx || 0].scale / (snapshot.pixelScale * Math.max(canvas.width, 1));
}

function shouldRetainDeepOverlay() {
  if (!deepCtx || !state.cpuRefine || state.compare.enabled || !currentViewSupportsCpuRefinement()) return false;
  if (!cpuRender.paintedSnapshot || cpuRender.paintedSnapshot.fractalIdx !== state.fractalIdx) return false;
  const retainedZoom = deepSnapshotZoom(cpuRender.paintedSnapshot);
  return Math.max(getZoom(), retainedZoom) >= CPU_PREVIEW_ZOOM_THRESHOLD;
}

function updateDeepOverlayTransform() {
  if (!deepCtx) return;
  if (!shouldRetainDeepOverlay()) {
    deepCanvas.style.transform = "";
    return;
  }

  const snapshot = cpuRender.paintedSnapshot;
  const scale = snapshot.pixelScale / Math.max(state.pixelScale, Number.MIN_VALUE);
  const tx = (snapshot.centerX - state.centerX) / state.pixelScale + canvas.width * 0.5 - scale * canvas.width * 0.5;
  const ty = (state.centerY - snapshot.centerY) / state.pixelScale + canvas.height * 0.5 - scale * canvas.height * 0.5;

  deepCanvas.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
}

function isCameraSettled() {
  if (!state.pixelScale || !state.targetPixelScale) return false;
  const viewWidth = Math.max(state.pixelScale * canvas.width, Number.MIN_VALUE);
  const xTolerance = cameraSettleTolerance(state.centerX, state.targetCenterX, viewWidth);
  const yTolerance = cameraSettleTolerance(state.centerY, state.targetCenterY, viewWidth);
  return Math.abs(state.targetCenterX - state.centerX) < xTolerance &&
    Math.abs(state.targetCenterY - state.centerY) < yTolerance &&
    Math.abs(Math.log(state.pixelScale / state.targetPixelScale)) < 1e-5;
}

function cancelCpuWorkers() {
  cpuRender.workers.forEach(entry => entry.worker.terminate());
  cpuRender.workers = [];
  cpuRender.pendingBatches = 0;
  cpuRender.useWorkers = false;
}

function getCpuWorkerCount() {
  // `hardwareConcurrency` is only a browser hint, but it is the closest
  // browser-safe signal we get for sizing worker pools automatically.
  const reportedCores = Math.max(
    1,
    Math.floor(navigator.hardwareConcurrency || CPU_FALLBACK_LOGICAL_CORES)
  );
  const reservedCores = reportedCores <= CPU_RESERVED_LOGICAL_CORES
    ? 0
    : Math.min(CPU_RESERVED_LOGICAL_CORES, Math.floor(reportedCores / 4));
  const workerBudget = reportedCores - reservedCores;
  return Math.max(1, Math.min(CPU_MAX_WORKERS, workerBudget));
}

function cpuWorkerSource() {
  // Workers are built from selected main-thread functions. If a CPU formula
  // helper changes, make sure it is included here or worker refinement will
  // diverge from the main-thread fallback.
  const sharedFunctions = [
    formulaMeta,
    supportsBasinColor,
    cubicRootId,
    quarticRootId,
    quinticRootId,
    basinRootId,
    basinColor,
    paletteBaseIndex,
    toneBaseIndex,
    smooth01,
    writeCosineColor,
    writeToneColor,
    writeStyleColor,
    mandelbrotInSet,
    escapeMandelbrot,
    escapeJulia,
    escapeBurningShip,
    cpuEscape,
    perturbEscapeMandelbrot,
    cpuColor,
  ].map(fn => fn.toString()).join("\n\n");

  return `
const COLOR_MODE_ESCAPE = ${COLOR_MODE_ESCAPE};
const COLOR_MODE_BASIN = ${COLOR_MODE_BASIN};
const COLOR_STYLE_PALETTE = ${COLOR_STYLE_PALETTE};
const COLOR_STYLE_MONOTONE = ${COLOR_STYLE_MONOTONE};
const COLOR_STYLE_DUOTONE = ${COLOR_STYLE_DUOTONE};
const FORMULA_META = ${JSON.stringify(FORMULA_META)};
const FORMULA_ID = ${JSON.stringify(FORMULA_ID)};
const TWO_PI = Math.PI * 2;
const PALETTE_SHIFTS = new Float64Array([
  0.00, 0.18, 0.36,
  0.46, 0.08, 0.02,
  0.04, 0.30, 0.22,
  0.28, 0.02, 0.38,
  0.38, 0.28, 0.04,
]);
const TONE_COLORS = new Uint8Array([
   20, 209, 255, 138,  34, 255,
  255, 138,  46, 250,  46, 102,
   89, 242, 148,   5, 143, 250,
  209, 117, 255,  20, 163, 255,
  245, 219,  61, 250,  87,  41,
]);
const TRAP_STYLE_FLOWER = { tScale: 0.17, s0: 0.16, s1: 0.36, s2: 0.66, baseMix: 0.32, glowEdge: 0.18 };
const TRAP_STYLE_LOTUS  = { tScale: 0.16, s0: 0.08, s1: 0.34, s2: 0.70, baseMix: 0.30, glowEdge: 0.20 };
const TRAP_STYLE_ROSE   = { tScale: 0.19, s0: 0.22, s1: 0.48, s2: 0.76, baseMix: 0.34, glowEdge: 0.17 };
const TRAP_STYLE_DEFAULT = { tScale: 0.18, s0: 0.02, s1: 0.32, s2: 0.58, baseMix: 0.35, glowEdge: 0.16 };
const BASIN_BASES = new Uint8Array([
  245, 87, 56,
  46, 184, 255,
  199, 235, 71,
  194, 110, 255,
  250, 204, 46,
]);
const _SAMPLE = { iter: 0, zx: 0, zy: 0, root: undefined, trap: Infinity, trapKind: undefined, mag2: 0 };
const _COLOR = [0, 0, 0];
const _BASIN_COLOR = [0, 0, 0];
const PERIOD_EPS = 1e-16;

${sharedFunctions}

let _snap = null, _step = 0, _cols = 0, _totalBlocks = 0, _generation = -1, _passIndex = -1;

self.onmessage = event => {
  const d = event.data;

  if (d.type === "init") {
    _snap = d.snapshot;
    _step = d.step;
    _cols = d.cols;
    _totalBlocks = d.totalBlocks;
    _generation = d.generation;
    _passIndex = d.passIndex;
    return;
  }

  const { startBlock, count } = d;
  const actualCount = Math.min(count, _totalBlocks - startBlock);
  const colors = new Uint8ClampedArray(actualCount * 4);
  let fallbackSamples = 0;

  for (let i = 0; i < actualCount; i++) {
    const blockIndex = startBlock + i;
    const col = blockIndex % _cols;
    const row = Math.floor(blockIndex / _cols);
    const xStart = col * _step;
    const yStart = row * _step;
    const sampleX = Math.min(xStart + _step * 0.5, _snap.width - 0.5);
    const sampleY = Math.min(yStart + _step * 0.5, _snap.height - 0.5);
    const worldX = _snap.x0 + sampleX * _snap.scaleX;
    const worldY = _snap.y1 - sampleY * _snap.scaleY;
    const sample = _snap.backend === "perturbMandelbrot"
      ? perturbEscapeMandelbrot(_snap.referenceOrbit, worldX, worldY, _snap.iter)
      : cpuEscape(_snap.formula, worldX, worldY, _snap.iter, _snap.juliaC);
    if (_snap.backend === "perturbMandelbrot" && sample && sample.fallback) fallbackSamples++;
    const color = cpuColor(
      sample,
      _snap.iter,
      _snap.palette,
      _snap.cycle,
      _snap.colorMode,
      _snap.colorStyle
    );
    const p = i * 4;
    colors[p] = color[0];
    colors[p + 1] = color[1];
    colors[p + 2] = color[2];
    colors[p + 3] = 255;
  }

  self.postMessage(
    { generation: _generation, passIndex: _passIndex, startBlock, colors, totalSamples: actualCount, fallbackSamples },
    [colors.buffer]
  );
};
`;
}

function ensureCpuWorkers() {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") return false;
  if (cpuRender.workers.length) return true;

  try {
    if (!cpuRender.workerUrl) {
      cpuRender.workerUrl = URL.createObjectURL(new Blob([cpuWorkerSource()], { type: "application/javascript" }));
    }
    const workerCount = getCpuWorkerCount();
    for (let i = 0; i < workerCount; i++) {
      const entry = { worker: new Worker(cpuRender.workerUrl), busy: false };
      entry.worker.onmessage = event => onCpuWorkerMessage(entry, event.data);
      entry.worker.onerror = err => {
        console.error("CPU worker failed", err);
        cancelCpuWorkers();
        if (cpuRender.running && !cpuRender.dirty) {
          cpuRender.useWorkers = false;
          requestAnimationFrame(() => processCpuRenderMain(cpuRender.activeGeneration));
        }
      };
      cpuRender.workers.push(entry);
    }
    return true;
  } catch (err) {
    console.warn("CPU workers unavailable; falling back to main-thread refinement.", err);
    cancelCpuWorkers();
    return false;
  }
}

const FORMULA_ID = {
  // Numeric dispatch keeps the CPU hot loop away from repeated string
  // comparisons. Related formulas share IDs when their iteration body matches.
  mandelbrot: 0, julia: 1,
  burningShip: 2, burningJulia: 2,
  tricorn: 3, tricornJulia: 3, mandelbarJulia: 3,
  cubic: 4, cubicJulia: 4,
  cubicMandelbar: 5,
  quartic: 6, quarticJulia: 6,
  celtic: 7, celticJulia: 7,
  buffalo: 8, buffaloJulia: 8,
  phoenix: 9,
  perpendicularMandelbrot: 10, perpendicularJulia: 10,
  celticHeart: 11,
  perpendicularBuffalo: 12,
  quintic: 13,
  lambda: 14,
  spider: 15,
  burningCubic: 16,
  burningQuartic: 17,
  octic: 18,
  glynnJulia: 19,
  cosine: 20,
  sine: 21, sineJulia: 21,
  magnet: 22,
  feather: 23,
  rationalJuliaLace: 24,
  novaJuliaBloom: 25,
  rationalMandelbrotLace: 26,
  orbitTrapMandelbrot: 27,
  orbitTrapFlower: 28,
  orbitTrapLotus: 29,
  orbitTrapRoseJulia: 30,
  mandelbox: 31,
  expMandelbrot: 32,
  magnetII: 33,
  perpendicularBurningShip: 34,
  zubietaJulia: 35,
  orbitTrapStar: 36,
  orbitTrapWeb: 37,
  cubicCeltic: 38,
  cubicBuffalo: 39,
  newtonCubic: 40,
  newtonQuartic: 41,
  halleyCubic: 42,
  novaBasins: 43,
  newtonRelaxSpiral: 44,
  newtonRelaxStorm: 45,
  newtonQuintic: 46,
};

function mandelbrotInSet(cx, cy) {
  const q = (cx - 0.25) * (cx - 0.25) + cy * cy;
  if (q * (q + (cx - 0.25)) <= 0.25 * cy * cy) return true;
  const dx = cx + 1;
  if (dx * dx + cy * cy <= 0.0625) return true;
  return false;
}

const _SAMPLE = { iter: 0, zx: 0, zy: 0, root: undefined, trap: Infinity, trapKind: undefined, mag2: 0 };

const PERIOD_EPS = 1e-16;

function escapeMandelbrot(cx, cy, maxIter) {
  if (mandelbrotInSet(cx, cy)) {
    _SAMPLE.iter = maxIter; _SAMPLE.zx = 0; _SAMPLE.zy = 0;
    _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined; _SAMPLE.mag2 = 0;
    return _SAMPLE;
  }
  let zx = 0, zy = 0;
  let rx = 0, ry = 0;
  let refresh = 8, since = 0;
  for (let n = 0; n < maxIter; n++) {
    const x2 = zx * zx;
    const y2 = zy * zy;
    const mag2 = x2 + y2;
    if (mag2 > 256) {
      _SAMPLE.iter = n; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
      _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined; _SAMPLE.mag2 = mag2;
      return _SAMPLE;
    }
    const ny = 2 * zx * zy + cy;
    zx = x2 - y2 + cx;
    zy = ny;
    const dx = zx - rx, dy = zy - ry;
    if (dx * dx + dy * dy < PERIOD_EPS) {
      _SAMPLE.iter = maxIter; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
      _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined;
      _SAMPLE.mag2 = zx * zx + zy * zy;
      return _SAMPLE;
    }
    if (++since >= refresh) { rx = zx; ry = zy; since = 0; if (refresh < 512) refresh *= 2; }
  }
  _SAMPLE.iter = maxIter; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
  _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined;
  _SAMPLE.mag2 = zx * zx + zy * zy;
  return _SAMPLE;
}

function escapeJulia(x, y, cx, cy, maxIter) {
  let zx = x, zy = y;
  let rx = x, ry = y;
  let refresh = 8, since = 0;
  for (let n = 0; n < maxIter; n++) {
    const x2 = zx * zx;
    const y2 = zy * zy;
    const mag2 = x2 + y2;
    if (mag2 > 256) {
      _SAMPLE.iter = n; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
      _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined; _SAMPLE.mag2 = mag2;
      return _SAMPLE;
    }
    const ny = 2 * zx * zy + cy;
    zx = x2 - y2 + cx;
    zy = ny;
    const dx = zx - rx, dy = zy - ry;
    if (dx * dx + dy * dy < PERIOD_EPS) {
      _SAMPLE.iter = maxIter; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
      _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined;
      _SAMPLE.mag2 = zx * zx + zy * zy;
      return _SAMPLE;
    }
    if (++since >= refresh) { rx = zx; ry = zy; since = 0; if (refresh < 512) refresh *= 2; }
  }
  _SAMPLE.iter = maxIter; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
  _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined;
  _SAMPLE.mag2 = zx * zx + zy * zy;
  return _SAMPLE;
}

function escapeBurningShip(cx, cy, maxIter) {
  let zx = 0, zy = 0;
  let rx = 0, ry = 0;
  let refresh = 8, since = 0;
  for (let n = 0; n < maxIter; n++) {
    const ax = zx < 0 ? -zx : zx;
    const ay = zy < 0 ? -zy : zy;
    const x2 = ax * ax;
    const y2 = ay * ay;
    const mag2 = x2 + y2;
    if (mag2 > 256) {
      _SAMPLE.iter = n; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
      _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined; _SAMPLE.mag2 = mag2;
      return _SAMPLE;
    }
    zx = x2 - y2 + cx;
    zy = 2 * ax * ay + cy;
    const dx = zx - rx, dy = zy - ry;
    if (dx * dx + dy * dy < PERIOD_EPS) {
      _SAMPLE.iter = maxIter; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
      _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined;
      _SAMPLE.mag2 = zx * zx + zy * zy;
      return _SAMPLE;
    }
    if (++since >= refresh) { rx = zx; ry = zy; since = 0; if (refresh < 512) refresh *= 2; }
  }
  _SAMPLE.iter = maxIter; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
  _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined;
  _SAMPLE.mag2 = zx * zx + zy * zy;
  return _SAMPLE;
}

function cpuEscape(formula, x, y, maxIter, jc) {
  const fid = FORMULA_ID[formula] !== undefined ? FORMULA_ID[formula] : -1;
  if (fid === 0) return escapeMandelbrot(x, y, maxIter);
  if (fid === 1) return escapeJulia(x, y, jc[0], jc[1], maxIter);
  if (fid === 2 && formula === "burningShip") return escapeBurningShip(x, y, maxIter);

  const meta = formulaMeta(formula);
  const hasBasin = (meta.basinRoots || 0) > 0;
  const isNewton = !!meta.newton;
  let zx = 0, zy = 0, cx = x, cy = y, px = 0, trap = Infinity;
  const trapKind = meta.orbitTrap ? formula : undefined;

  if (meta.initial === "julia") {
    zx = x; zy = y; cx = jc[0]; cy = jc[1];
  } else if (meta.initial === "phoenix") {
    zx = x; zy = y; cx = -0.5 + 0.32 * jc[0]; cy = 0.32 * jc[1];
  } else if (meta.initial === "lambda") {
    zx = 0.5; zy = 0; cx = x; cy = y;
  } else if (meta.initial === "point") {
    zx = x; zy = y;
  }

  // Periodicity check is safe only when the map is c-static, not a basin, not an orbit trap,
  // and doesn't use history (phoenix). Newton/basin paths have their own convergence check.
  const useCycle = !isNewton && !hasBasin && !trapKind && meta.initial !== "phoenix" && fid !== 15;
  let refX = zx, refY = zy, refresh = 8, since = 0;

  for (let n = 0; n < maxIter; n++) {
    let nx, ny;
    const x2 = zx * zx;
    const y2 = zy * zy;
    const xy = zx * zy;

    if (fid === 2) {
      const ax = zx < 0 ? -zx : zx;
      const ay = zy < 0 ? -zy : zy;
      nx = ax * ax - ay * ay + cx;
      ny = 2 * ax * ay + cy;
    } else if (fid === 3) {
      nx = x2 - y2 + cx;
      ny = -2 * xy + cy;
    } else if (fid === 4) {
      nx = zx * (x2 - 3 * y2) + cx;
      ny = zy * (3 * x2 - y2) + cy;
    } else if (fid === 5) {
      nx = zx * (x2 - 3 * y2) + cx;
      ny = -zy * (3 * x2 - y2) + cy;
    } else if (fid === 38) {
      const z3x = zx * (x2 - 3 * y2);
      const z3y = zy * (3 * x2 - y2);
      nx = (z3x < 0 ? -z3x : z3x) + cx;
      ny = z3y + cy;
    } else if (fid === 39) {
      const z3x = zx * (x2 - 3 * y2);
      const z3y = zy * (3 * x2 - y2);
      nx = (z3x < 0 ? -z3x : z3x) + cx;
      ny = -(z3y < 0 ? -z3y : z3y) + cy;
    } else if (fid === 6) {
      const qx = x2 - y2;
      const qy = 2 * xy;
      nx = qx * qx - qy * qy + cx;
      ny = 2 * qx * qy + cy;
    } else if (fid === 7) {
      nx = (x2 - y2 < 0 ? -(x2 - y2) : (x2 - y2)) + cx;
      ny = 2 * xy + cy;
    } else if (fid === 8) {
      const d = x2 - y2;
      nx = (d < 0 ? -d : d) + cx;
      const t8 = 2 * xy;
      ny = -(t8 < 0 ? -t8 : t8) + cy;
    } else if (fid === 9) {
      nx = x2 - y2 + cx - 0.45 * px;
      ny = 2 * xy + cy;
      px = zx;
    } else if (fid === 10) {
      nx = x2 - y2 + cx;
      ny = -2 * (zx < 0 ? -zx : zx) * zy + cy;
    } else if (fid === 11) {
      const d = x2 - y2;
      nx = (d < 0 ? -d : d) + cx;
      ny = -2 * xy + cy;
    } else if (fid === 12) {
      const d = x2 - y2;
      nx = (d < 0 ? -d : d) + cx;
      ny = -2 * (xy < 0 ? -xy : xy) + cy;
    } else if (fid === 13) {
      const x4 = x2 * x2;
      const y4 = y2 * y2;
      nx = zx * (x4 - 10 * x2 * y2 + 5 * y4) + cx;
      ny = zy * (5 * x4 - 10 * x2 * y2 + y4) + cy;
    } else if (fid === 14) {
      const pr = zx * (1 - zx) + y2;
      const pi = zy * (1 - 2 * zx);
      nx = cx * pr - cy * pi;
      ny = cx * pi + cy * pr;
    } else if (fid === 15) {
      nx = x2 - y2 + cx;
      ny = 2 * xy + cy;
      cx = cx * 0.5 + nx;
      cy = cy * 0.5 + ny;
    } else if (fid === 16) {
      const ax = zx < 0 ? -zx : zx;
      const ay = zy < 0 ? -zy : zy;
      const ax2 = ax * ax;
      const ay2 = ay * ay;
      nx = ax * (ax2 - 3 * ay2) + cx;
      ny = ay * (3 * ax2 - ay2) + cy;
    } else if (fid === 17) {
      const ax = zx < 0 ? -zx : zx;
      const ay = zy < 0 ? -zy : zy;
      const qx = ax * ax - ay * ay;
      const qy = 2 * ax * ay;
      nx = qx * qx - qy * qy + cx;
      ny = 2 * qx * qy + cy;
    } else if (fid === 18) {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const z4x = z2x * z2x - z2y * z2y;
      const z4y = 2 * z2x * z2y;
      nx = z4x * z4x - z4y * z4y + cx;
      ny = 2 * z4x * z4y + cy;
    } else if (fid === 19) {
      const r = Math.pow(Math.sqrt(x2 + y2), 1.5);
      const a = Math.atan2(zy, zx) * 1.5;
      nx = Math.cos(a) * r + cx;
      ny = Math.sin(a) * r + cy;
    } else if (fid === 20) {
      const yy = zy < -8 ? -8 : (zy > 8 ? 8 : zy);
      const ey = Math.exp(yy);
      const eny = Math.exp(-yy);
      const ch = 0.5 * (ey + eny);
      const sh = 0.5 * (ey - eny);
      nx = Math.cos(zx) * ch + cx;
      ny = -Math.sin(zx) * sh + cy;
    } else if (fid === 21) {
      const yy = zy < -8 ? -8 : (zy > 8 ? 8 : zy);
      const ey = Math.exp(yy);
      const eny = Math.exp(-yy);
      const ch = 0.5 * (ey + eny);
      const sh = 0.5 * (ey - eny);
      nx = Math.sin(zx) * ch + cx;
      ny = Math.cos(zx) * sh + cy;
    } else if (fid === 22) {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const nr = z2x + cx - 1;
      const ni = z2y + cy;
      const dr = 2 * zx + cx - 2;
      const di = 2 * zy + cy;
      const den = dr * dr + di * di > 1e-8 ? dr * dr + di * di : 1e-8;
      const qx = (nr * dr + ni * di) / den;
      const qy = (ni * dr - nr * di) / den;
      nx = qx * qx - qy * qy;
      ny = 2 * qx * qy;
      if ((nx - 1) * (nx - 1) + ny * ny < 1e-8) {
        _SAMPLE.iter = n; _SAMPLE.zx = nx; _SAMPLE.zy = ny;
        _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined;
        _SAMPLE.mag2 = nx * nx + ny * ny;
        return _SAMPLE;
      }
    } else if (fid === 23) {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const z3x = z2x * zx - z2y * zy;
      const z3y = z2x * zy + z2y * zx;
      const dr = 1 + z2x;
      const di = z2y;
      const den = dr * dr + di * di > 1e-8 ? dr * dr + di * di : 1e-8;
      nx = (z3x * dr + z3y * di) / den + cx;
      ny = (z3y * dr - z3x * di) / den + cy;
    } else if (fid === 24) {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const dr = z2x + 0.22;
      const di = z2y;
      const den = dr * dr + di * di > 1e-8 ? dr * dr + di * di : 1e-8;
      nx = z2x + (cx * dr + cy * di) / den;
      ny = z2y + (cy * dr - cx * di) / den;
    } else if (fid === 25) {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const z3x = z2x * zx - z2y * zy;
      const z3y = z2x * zy + z2y * zx;
      const nr = z3x - 1;
      const ni = z3y;
      const dr = 3 * z2x;
      const di = 3 * z2y;
      const den = dr * dr + di * di > 1e-8 ? dr * dr + di * di : 1e-8;
      const qx = (nr * dr + ni * di) / den;
      const qy = (ni * dr - nr * di) / den;
      nx = zx - (0.78 * qx - 0.28 * qy) + cx;
      ny = zy - (0.78 * qy + 0.28 * qx) + cy;
      if (qx * qx + qy * qy < 1e-12) {
        _SAMPLE.iter = n; _SAMPLE.zx = nx; _SAMPLE.zy = ny;
        _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined;
        _SAMPLE.mag2 = nx * nx + ny * ny;
        return _SAMPLE;
      }
    } else if (fid === 26) {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const dr = z2x + 0.18;
      const di = z2y + 0.06;
      const den = dr * dr + di * di > 1e-8 ? dr * dr + di * di : 1e-8;
      nx = z2x + (0.22 * dr - 0.11 * di) / den + cx;
      ny = z2y + (-0.11 * dr - 0.22 * di) / den + cy;
    } else if (fid >= 27 && fid <= 30) {
      nx = x2 - y2 + cx;
      ny = 2 * xy + cy;
      if (fid === 28) {
        const a = Math.atan2(ny, nx);
        const r = Math.sqrt(nx * nx + ny * ny);
        const pv = r - (0.35 + 0.12 * Math.cos(6 * a));
        const petals = pv < 0 ? -pv : pv;
        const rx = nx + 0.18, ry = ny - 0.08;
        const rv = Math.sqrt(rx * rx + ry * ry) - 0.28;
        const ring = rv < 0 ? -rv : rv;
        const ax1 = rx < 0 ? -rx : rx;
        const ay1 = ry < 0 ? -ry : ry;
        const axis = ax1 < ay1 ? ax1 : ay1;
        const m = petals < ring ? (petals < axis ? petals : axis) : (ring < axis ? ring : axis);
        if (m < trap) trap = m;
      } else if (fid === 29) {
        const a = Math.atan2(ny, nx);
        const r = Math.sqrt(nx * nx + ny * ny);
        const ov = r - (0.42 + 0.11 * Math.cos(8 * a));
        const outer = ov < 0 ? -ov : ov;
        const iv = r - (0.18 + 0.07 * Math.cos(5 * a + 0.8));
        const inner = iv < 0 ? -iv : iv;
        const s1 = nx * 0.65 + ny * 0.35;
        const s2 = nx * 0.65 - ny * 0.35;
        const s1a = s1 < 0 ? -s1 : s1;
        const s2a = s2 < 0 ? -s2 : s2;
        const stem = s1a < s2a ? s1a : s2a;
        const m = outer < inner ? (outer < stem ? outer : stem) : (inner < stem ? inner : stem);
        if (m < trap) trap = m;
      } else if (fid === 30) {
        const a = Math.atan2(ny, nx);
        const r = Math.sqrt(nx * nx + ny * ny);
        const rv = r - (0.34 + 0.14 * Math.cos(7 * a));
        const rose = rv < 0 ? -rv : rv;
        const rx = nx - 0.16, ry = ny + 0.10;
        const riv = Math.sqrt(rx * rx + ry * ry) - 0.24;
        const ring = riv < 0 ? -riv : riv;
        const v1 = nx + 0.22 * Math.sin(3 * a);
        const v2 = ny - 0.18 * Math.cos(4 * a);
        const v1a = v1 < 0 ? -v1 : v1;
        const v2a = v2 < 0 ? -v2 : v2;
        const vein = v1a < v2a ? v1a : v2a;
        const m = rose < ring ? (rose < vein ? rose : vein) : (ring < vein ? ring : vein);
        if (m < trap) trap = m;
      } else {
        const cxv = nx - 0.25;
        const cv = Math.sqrt(cxv * cxv + ny * ny) - 0.45;
        const circle = cv < 0 ? -cv : cv;
        const ax1 = nx < 0 ? -nx : nx;
        const ay1 = ny < 0 ? -ny : ny;
        const cross = ax1 < ay1 ? ax1 : ay1;
        const dv = nx + ny;
        const diagonal = (dv < 0 ? -dv : dv) * 0.70710678118;
        const m = circle < cross ? (circle < diagonal ? circle : diagonal) : (cross < diagonal ? cross : diagonal);
        if (m < trap) trap = m;
      }
    } else if (isNewton) {
      const z2x = x2 - y2;
      const z2y = 2 * xy;
      const z3x = z2x * zx - z2y * zy;
      const z3y = z2x * zy + z2y * zx;
      let qx, qy;
      if (fid === 46) {
        const z4x = z2x * z2x - z2y * z2y;
        const z4y = 2 * z2x * z2y;
        const z5x = z4x * zx - z4y * zy;
        const z5y = z4x * zy + z4y * zx;
        const nr = z5x - 1;
        const ni = z5y;
        const dr = 5 * z4x;
        const di = 5 * z4y;
        const d2 = dr * dr + di * di;
        const den = d2 > 1e-8 ? d2 : 1e-8;
        qx = (nr * dr + ni * di) / den;
        qy = (ni * dr - nr * di) / den;
      } else if (fid === 41) {
        const z4x = z2x * z2x - z2y * z2y;
        const z4y = 2 * z2x * z2y;
        const nr = z4x - 1;
        const ni = z4y;
        const dr = 4 * z3x;
        const di = 4 * z3y;
        const d2 = dr * dr + di * di;
        const den = d2 > 1e-8 ? d2 : 1e-8;
        qx = (nr * dr + ni * di) / den;
        qy = (ni * dr - nr * di) / den;
      } else if (fid === 42) {
        const fr = z3x - 1;
        const fi = z3y;
        const fpr = 3 * z2x;
        const fpi = 3 * z2y;
        const fppr = 6 * zx;
        const fppi = 6 * zy;
        const ffpR = fr * fpr - fi * fpi;
        const ffpI = fr * fpi + fi * fpr;
        const fp2R = fpr * fpr - fpi * fpi;
        const fp2I = 2 * fpr * fpi;
        const ffppR = fr * fppr - fi * fppi;
        const ffppI = fr * fppi + fi * fppr;
        const nr = 2 * ffpR;
        const ni = 2 * ffpI;
        const dr = 2 * fp2R - ffppR;
        const di = 2 * fp2I - ffppI;
        const d2 = dr * dr + di * di;
        const den = d2 > 1e-8 ? d2 : 1e-8;
        qx = (nr * dr + ni * di) / den;
        qy = (ni * dr - nr * di) / den;
      } else {
        const nr = z3x - 1;
        const ni = z3y;
        const dr = 3 * z2x;
        const di = 3 * z2y;
        const d2 = dr * dr + di * di;
        const den = d2 > 1e-8 ? d2 : 1e-8;
        qx = (nr * dr + ni * di) / den;
        qy = (ni * dr - nr * di) / den;
      }
      if (fid === 43 || fid === 44 || fid === 45) {
        const rx = fid === 44 ? 0.60 : (fid === 45 ? -0.30 : 0.85);
        const ry = fid === 44 ? 0.60 : (fid === 45 ? 0.90 : 0.35);
        nx = zx - (rx * qx - ry * qy);
        ny = zy - (rx * qy + ry * qx);
      } else {
        nx = zx - qx;
        ny = zy - qy;
      }
      if (qx * qx + qy * qy < 1e-12) {
        _SAMPLE.iter = n; _SAMPLE.zx = nx; _SAMPLE.zy = ny;
        _SAMPLE.root = basinRootId(formula, nx, ny); _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined;
        _SAMPLE.mag2 = nx * nx + ny * ny;
        return _SAMPLE;
      }
    } else if (fid === 31) {
      const clx = zx < -1 ? -1 : (zx > 1 ? 1 : zx);
      const cly = zy < -1 ? -1 : (zy > 1 ? 1 : zy);
      let bx = clx * 2 - zx;
      let by = cly * 2 - zy;
      const r2 = bx * bx + by * by;
      if (r2 < 0.25) {
        bx *= 4; by *= 4;
      } else if (r2 < 1) {
        bx /= r2; by /= r2;
      }
      nx = 2 * bx + cx;
      ny = 2 * by + cy;
    } else if (fid === 32) {
      const eyc = zy < -8 ? -8 : (zy > 8 ? 8 : zy);
      const ex = Math.exp(zx < -8 ? -8 : (zx > 8 ? 8 : zx));
      nx = ex * Math.cos(eyc) + cx;
      ny = ex * Math.sin(eyc) + cy;
    } else if (fid === 33) {
      const z2x = x2 - y2, z2y = 2 * xy;
      const z3x = z2x * zx - z2y * zy, z3y = z2x * zy + z2y * zx;
      // (c-1) and (c-2)
      const cm1x = cx - 1, cm1y = cy;
      const cm2x = cx - 2, cm2y = cy;
      // (c-1)(c-2)
      const pp = cm1x * cm2x - cm1y * cm2y, pq = cm1x * cm2y + cm1y * cm2x;
      // numerator: z³ + 3(c-1)z + (c-1)(c-2)
      const nrx = z3x + 3 * (cm1x * zx - cm1y * zy) + pp;
      const nry = z3y + 3 * (cm1x * zy + cm1y * zx) + pq;
      // denominator: 3z² + 3(c-2)z + (c-1)(c-2) + 1
      const drx = 3 * z2x + 3 * (cm2x * zx - cm2y * zy) + pp + 1;
      const dry = 3 * z2y + 3 * (cm2x * zy + cm2y * zx) + pq;
      const den33 = Math.max(drx * drx + dry * dry, 1e-8);
      const qx = (nrx * drx + nry * dry) / den33;
      const qy = (nry * drx - nrx * dry) / den33;
      nx = qx * qx - qy * qy;
      ny = 2 * qx * qy;
      if ((nx - 1) * (nx - 1) + ny * ny < 1e-6) {
        _SAMPLE.iter = n; _SAMPLE.zx = nx; _SAMPLE.zy = ny;
        _SAMPLE.root = undefined; _SAMPLE.trap = Infinity; _SAMPLE.trapKind = undefined;
        _SAMPLE.mag2 = nx * nx + ny * ny;
        return _SAMPLE;
      }
    } else if (fid === 34) {
      nx = x2 - y2 + cx;
      ny = -2 * (zx < 0 ? -zx : zx) * zy + cy;
    } else if (fid === 35) {
      const z2x = x2 - y2, z2y = 2 * xy;
      const z3x = z2x * zx - z2y * zy, z3y = z2x * zy + z2y * zx;
      const den35 = Math.max(z3x * z3x + z3y * z3y, 1e-8);
      nx = z2x - (cx * z3x + cy * z3y) / den35;
      ny = z2y - (cy * z3x - cx * z3y) / den35;
    } else if (fid === 36) {
      nx = x2 - y2 + cx;
      ny = 2 * xy + cy;
      const a36 = Math.atan2(ny, nx);
      const r36 = Math.sqrt(nx * nx + ny * ny);
      const spineA = Math.abs(r36 - (0.40 + 0.22 * Math.abs(Math.cos(5 * a36))));
      const hubA = Math.abs(r36 - 0.12);
      const sx = nx < 0 ? -nx : nx, sy = ny < 0 ? -ny : ny;
      const sd1a = Math.abs((nx - ny) * 0.70710678118);
      const sd2a = Math.abs((nx + ny) * 0.70710678118);
      const spoke = Math.min(sx < sy ? sx : sy, sd1a < sd2a ? sd1a : sd2a);
      const m = Math.min(spineA, hubA, spoke * 0.6);
      if (m < trap) trap = m;
    } else if (fid === 37) {
      nx = x2 - y2 + cx;
      ny = 2 * xy + cy;
      const fx = (((nx * 1.5) % 1) + 1) % 1 - 0.5;
      const fy = (((ny * 1.5) % 1) + 1) % 1 - 0.5;
      const fxa = fx < 0 ? -fx : fx, fya = fy < 0 ? -fy : fy;
      const grid = fxa < fya ? fxa : fya;
      const r37 = Math.sqrt(nx * nx + ny * ny);
      const circ = Math.abs(r37 - 0.5);
      const m = Math.min(grid * 0.9, circ);
      if (m < trap) trap = m;
    } else {
      nx = x2 - y2 + cx;
      ny = 2 * xy + cy;
    }

    zx = nx; zy = ny;
    if (useCycle) {
      const dx = zx - refX, dy = zy - refY;
      if (dx * dx + dy * dy < PERIOD_EPS) {
        _SAMPLE.iter = maxIter; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
        _SAMPLE.root = undefined; _SAMPLE.trap = trap; _SAMPLE.trapKind = trapKind;
        _SAMPLE.mag2 = zx * zx + zy * zy; _SAMPLE.fallback = false;
        return _SAMPLE;
      }
      if (++since >= refresh) { refX = zx; refY = zy; since = 0; if (refresh < 512) refresh *= 2; }
    }
    const mag2 = zx * zx + zy * zy;
    if (!Number.isFinite(mag2)) {
      _SAMPLE.iter = n; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
      _SAMPLE.root = hasBasin ? basinRootId(formula, zx, zy) : undefined;
      _SAMPLE.trap = trap; _SAMPLE.trapKind = trapKind; _SAMPLE.mag2 = 1e9; _SAMPLE.fallback = false;
      return _SAMPLE;
    }
    if (mag2 > 256) {
      _SAMPLE.iter = n; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
      _SAMPLE.root = hasBasin ? basinRootId(formula, zx, zy) : undefined;
      _SAMPLE.trap = trap; _SAMPLE.trapKind = trapKind; _SAMPLE.mag2 = mag2; _SAMPLE.fallback = false;
      return _SAMPLE;
    }
  }

  _SAMPLE.iter = maxIter; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
  _SAMPLE.root = hasBasin ? basinRootId(formula, zx, zy) : undefined;
  _SAMPLE.trap = trap; _SAMPLE.trapKind = trapKind; _SAMPLE.mag2 = zx * zx + zy * zy; _SAMPLE.fallback = false;
  return _SAMPLE;
}

function shouldUsePerturbationBackend(snapshot) {
  // This first perturbation slice is intentionally narrow: only Mandelbrot uses
  // it, and only once the zoom is deep enough that the old per-pixel escape
  // path is wasting precision on redoing the same reference orbit for every
  // sample. Unsupported formulas stay on the existing CPU backend.
  return snapshot.formula === "mandelbrot" && isPerturbationArmed();
}

function buildReferenceOrbit(cx, cy, maxIter) {
  // The reference orbit is the one "full" Mandelbrot orbit we compute for the
  // viewport center. Perturbation then asks every nearby pixel to evolve only
  // its small delta away from that orbit instead of redoing the whole sequence.
  const orbitX = new Float64Array(maxIter + 1);
  const orbitY = new Float64Array(maxIter + 1);
  let zx = 0;
  let zy = 0;
  orbitX[0] = 0;
  orbitY[0] = 0;
  let length = 1;

  for (let n = 0; n < maxIter; n++) {
    const x2 = zx * zx;
    const y2 = zy * zy;
    const ny = 2 * zx * zy + cy;
    zx = x2 - y2 + cx;
    zy = ny;
    orbitX[n + 1] = zx;
    orbitY[n + 1] = zy;
    length = n + 2;
    if (!Number.isFinite(zx) || !Number.isFinite(zy) || zx * zx + zy * zy > 256) break;
  }

  return {
    cx,
    cy,
    length,
    orbitX,
    orbitY,
  };
}

function perturbEscapeMandelbrot(reference, worldX, worldY, maxIter) {
  // Delta iteration evolves dc-relative coordinates:
  //   z = Z_ref + dz
  //   dz(n+1) = 2*Z_ref(n)*dz(n) + dz(n)^2 + dc
  // This lets one high-cost reference orbit serve many nearby pixels.
  const dcx = worldX - reference.cx;
  const dcy = worldY - reference.cy;
  let dzx = 0;
  let dzy = 0;

  for (let n = 0; n < maxIter; n++) {
    const refZx = reference.orbitX[n];
    const refZy = reference.orbitY[n];
    const zx = refZx + dzx;
    const zy = refZy + dzy;
    const mag2 = zx * zx + zy * zy;
    if (!Number.isFinite(mag2)) {
      const fallback = cpuEscape("mandelbrot", worldX, worldY, maxIter, [0, 0]);
      fallback.fallback = true;
      return fallback;
    }
    if (mag2 > 256) {
      _SAMPLE.iter = n;
      _SAMPLE.zx = zx;
      _SAMPLE.zy = zy;
      _SAMPLE.root = undefined;
      _SAMPLE.trap = Infinity;
      _SAMPLE.trapKind = undefined;
      _SAMPLE.mag2 = mag2;
      _SAMPLE.fallback = false;
      return _SAMPLE;
    }
    if (n + 1 >= reference.length) break;

    const dz2x = dzx * dzx - dzy * dzy;
    const dz2y = 2 * dzx * dzy;
    const linX = 2 * (refZx * dzx - refZy * dzy);
    const linY = 2 * (refZx * dzy + refZy * dzx);
    dzx = linX + dz2x + dcx;
    dzy = linY + dz2y + dcy;

    // If the delta stops being "small", the perturbation approximation is no
    // longer worth trusting. Falling back keeps deep-zoom glitches localized.
    if (!Number.isFinite(dzx) || !Number.isFinite(dzy) || dzx * dzx + dzy * dzy > 16) {
      const fallback = cpuEscape("mandelbrot", worldX, worldY, maxIter, [0, 0]);
      fallback.fallback = true;
      return fallback;
    }
  }

  const finalZx = reference.orbitX[Math.max(0, reference.length - 1)] + dzx;
  const finalZy = reference.orbitY[Math.max(0, reference.length - 1)] + dzy;
  _SAMPLE.iter = maxIter;
  _SAMPLE.zx = finalZx;
  _SAMPLE.zy = finalZy;
  _SAMPLE.root = undefined;
  _SAMPLE.trap = Infinity;
  _SAMPLE.trapKind = undefined;
  _SAMPLE.mag2 = finalZx * finalZx + finalZy * finalZy;
  _SAMPLE.fallback = false;
  return _SAMPLE;
}

const PALETTE_SHIFTS = new Float64Array([
  0.00, 0.18, 0.36,
  0.46, 0.08, 0.02,
  0.04, 0.30, 0.22,
  0.28, 0.02, 0.38,
  0.38, 0.28, 0.04,
]);
const TONE_COLORS = new Uint8Array([
   20, 209, 255, 138,  34, 255,
  255, 138,  46, 250,  46, 102,
   89, 242, 148,   5, 143, 250,
  209, 117, 255,  20, 163, 255,
  245, 219,  61, 250,  87,  41,
]);
const TRAP_STYLE_FLOWER = { tScale: 0.17, s0: 0.16, s1: 0.36, s2: 0.66, baseMix: 0.32, glowEdge: 0.18 };
const TRAP_STYLE_LOTUS  = { tScale: 0.16, s0: 0.08, s1: 0.34, s2: 0.70, baseMix: 0.30, glowEdge: 0.20 };
const TRAP_STYLE_ROSE   = { tScale: 0.19, s0: 0.22, s1: 0.48, s2: 0.76, baseMix: 0.34, glowEdge: 0.17 };
const TRAP_STYLE_DEFAULT = { tScale: 0.18, s0: 0.02, s1: 0.32, s2: 0.58, baseMix: 0.35, glowEdge: 0.16 };
const _COLOR = [0, 0, 0];
const TWO_PI = Math.PI * 2;

function paletteBaseIndex(paletteIdx) {
  return (paletteIdx >= 0 && paletteIdx < 5) ? paletteIdx * 3 : 0;
}

function toneBaseIndex(paletteIdx) {
  return (paletteIdx >= 0 && paletteIdx < 5) ? paletteIdx * 6 : 0;
}

function smooth01(value) {
  const v = value < 0 ? 0 : (value > 1 ? 1 : value);
  return v * v * (3 - 2 * v);
}

function writeCosineColor(t, paletteIdx, mix = 1) {
  const base = paletteBaseIndex(paletteIdx);
  _COLOR[0] = Math.round((0.5 + 0.5 * Math.cos(TWO_PI * (t + PALETTE_SHIFTS[base]))) * 255 * mix);
  _COLOR[1] = Math.round((0.5 + 0.5 * Math.cos(TWO_PI * (t + PALETTE_SHIFTS[base + 1]))) * 255 * mix);
  _COLOR[2] = Math.round((0.5 + 0.5 * Math.cos(TWO_PI * (t + PALETTE_SHIFTS[base + 2]))) * 255 * mix);
  return _COLOR;
}

function writeToneColor(t, paletteIdx, colorStyle, mix = 1) {
  const base = toneBaseIndex(paletteIdx);
  const v = smooth01((t - 0.08) / 0.92);
  const energy = Math.pow(v, 1.35);
  const darkR = 0, darkG = 2, darkB = 5;
  const aR = TONE_COLORS[base], aG = TONE_COLORS[base + 1], aB = TONE_COLORS[base + 2];

  if (colorStyle === COLOR_STYLE_MONOTONE) {
    const shade = (0.22 + 0.78 * v) * mix;
    _COLOR[0] = Math.round((darkR + (aR - darkR) * energy) * shade);
    _COLOR[1] = Math.round((darkG + (aG - darkG) * energy) * shade);
    _COLOR[2] = Math.round((darkB + (aB - darkB) * energy) * shade);
    return _COLOR;
  }

  const bR = TONE_COLORS[base + 3], bG = TONE_COLORS[base + 4], bB = TONE_COLORS[base + 5];
  const split = smooth01((v - 0.34) / 0.62);
  const glow = smooth01((v - 0.70) / 0.30) * 0.45;
  const r = bR + (aR - bR) * split;
  const g = bG + (aG - bG) * split;
  const b = bB + (aB - bB) * split;
  _COLOR[0] = Math.round(Math.min(255, (darkR + (r - darkR) * energy + r * glow) * mix));
  _COLOR[1] = Math.round(Math.min(255, (darkG + (g - darkG) * energy + g * glow) * mix));
  _COLOR[2] = Math.round(Math.min(255, (darkB + (b - darkB) * energy + b * glow) * mix));
  return _COLOR;
}

function writeStyleColor(t, paletteIdx, colorStyle, mix = 1) {
  if (colorStyle === COLOR_STYLE_MONOTONE || colorStyle === COLOR_STYLE_DUOTONE) {
    return writeToneColor(t, paletteIdx, colorStyle, mix);
  }
  return writeCosineColor(t, paletteIdx, mix);
}

function cpuColor(sample, maxIter, paletteIdx, cycle, colorMode = COLOR_MODE_ESCAPE, colorStyle = COLOR_STYLE_PALETTE) {
  if (colorMode === COLOR_MODE_BASIN && sample.root !== undefined) {
    return basinColor(sample.root, sample.iter, maxIter, cycle);
  }
  if (Number.isFinite(sample.trap)) {
    const tk = sample.trapKind;
    const ts = tk === "orbitTrapFlower" ? TRAP_STYLE_FLOWER
             : tk === "orbitTrapLotus" ? TRAP_STYLE_LOTUS
             : tk === "orbitTrapRoseJulia" ? TRAP_STYLE_ROSE
             : TRAP_STYLE_DEFAULT;
    const trap = sample.trap;
    let t = -Math.log(trap > 1e-6 ? trap : 1e-6) * ts.tScale + cycle * 0.18;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    let g = (ts.glowEdge - trap) / ts.glowEdge;
    g = g < 0 ? 0 : (g > 1 ? 1 : g);
    const glow = g * g * (3 - 2 * g);
    const mix = ts.baseMix + (1 - ts.baseMix) * glow;
    if (colorStyle === COLOR_STYLE_MONOTONE || colorStyle === COLOR_STYLE_DUOTONE) {
      return writeToneColor(t, paletteIdx, colorStyle, mix);
    }
    _COLOR[0] = Math.round((0.5 + 0.5 * Math.cos(TWO_PI * (t + ts.s0))) * 255 * mix);
    _COLOR[1] = Math.round((0.5 + 0.5 * Math.cos(TWO_PI * (t + ts.s1))) * 255 * mix);
    _COLOR[2] = Math.round((0.5 + 0.5 * Math.cos(TWO_PI * (t + ts.s2))) * 255 * mix);
    return _COLOR;
  }
  if (sample.iter >= maxIter) {
    if (colorStyle === COLOR_STYLE_MONOTONE || colorStyle === COLOR_STYLE_DUOTONE) {
      _COLOR[0] = 0; _COLOR[1] = 2; _COLOR[2] = 7;
    } else {
      _COLOR[0] = 0; _COLOR[1] = 0; _COLOR[2] = 0;
    }
    return _COLOR;
  }
  const mag2 = sample.mag2;
  const logMag = Math.log2(mag2);
  const sm = sample.iter - Math.log2(logMag > 1 ? logMag : 1) + 4;
  const raw = sm / maxIter;
  const t = (colorStyle === COLOR_STYLE_MONOTONE || colorStyle === COLOR_STYLE_DUOTONE) ? raw + cycle * 0.08 : raw + cycle;
  return writeStyleColor(t, paletteIdx, colorStyle);
}

function makeCpuSnapshot() {
  // Snapshot everything a CPU pass needs so asynchronous workers are insulated
  // from later UI/camera mutations.
  const viewport = renderViewport();
  const snapshot = {
    fractalIdx: state.fractalIdx,
    formula: FRACTALS[state.fractalIdx].formula || "mandelbrot",
    centerX: state.centerX,
    centerY: state.centerY,
    pixelScale: state.pixelScale,
    palette: state.palette,
    colorMode: state.colorMode,
    colorStyle: state.colorStyle,
    cycle: parseFloat(ui.colorCycle.value) || 0,
    iter: getRenderIterations(),
    width: deepCanvas.width,
    height: deepCanvas.height,
    x0: viewport.x0,
    y1: viewport.y1,
    scaleX: viewport.worldWidth / Math.max(deepCanvas.width, 1),
    scaleY: viewport.worldHeight / Math.max(deepCanvas.height, 1),
    juliaC: getRenderJuliaC(),
  };
  snapshot.backend = shouldUsePerturbationBackend(snapshot) ? "perturbMandelbrot" : "cpu";
  snapshot.referenceOrbit = snapshot.backend === "perturbMandelbrot"
    ? buildReferenceOrbit(state.centerX, state.centerY, snapshot.iter)
    : null;
  return snapshot;
}

function startCpuRender() {
  // Full refinement runs after input settles and progresses through all block
  // sizes in CPU_PASSES.
  if (!deepCtx || !state.cpuRefine || !currentViewSupportsCpuRefinement() || !deepCanvas.width || !deepCanvas.height) return;
  if (getZoom() < CPU_PREVIEW_ZOOM_THRESHOLD) return;
  if (cpuRender.running) cancelCpuWorkers();
  const generation = ++cpuRender.generation;
  cpuRender.running = true;
  cpuRender.dirty = false;
  cpuRender.complete = false;
  cpuRender.previewOnly = false;
  cpuRender.activeGeneration = generation;
  cpuRender.imageData = deepCtx.createImageData(deepCanvas.width, deepCanvas.height);
  cpuRender.pixels = cpuRender.imageData.data;
  cpuRender.passIndex = 0;
  cpuRender.blockIndex = 0;
  cpuRender.snapshot = makeCpuSnapshot();
  resetCpuDiagnostics(cpuRender.snapshot);
  cpuRender.lastPaint = 0;
  cpuRender.useWorkers = ensureCpuWorkers();
  setupCpuPass();
  if (cpuRender.useWorkers) { initCpuWorkers(); dispatchCpuWorkerBatches(); }
  else requestAnimationFrame(() => processCpuRenderMain(generation));
}

function startCpuPreview() {
  // During very deep drags, paint only the first coarse pass and move that image
  // with CSS. This gives visual continuity without recomputing every pointermove.
  if (!deepCtx || !state.cpuRefine || !currentViewSupportsCpuRefinement() || !deepCanvas.width || !deepCanvas.height) return;
  if (!shouldRetainDeepOverlay() && getZoom() < CPU_PREVIEW_ZOOM_THRESHOLD) return;
  if (cpuRender.running) cancelCpuWorkers();
  const generation = ++cpuRender.generation;
  cpuRender.running = true;
  cpuRender.dirty = false;
  cpuRender.complete = false;
  cpuRender.previewOnly = true;
  cpuRender.activeGeneration = generation;
  cpuRender.imageData = deepCtx.createImageData(deepCanvas.width, deepCanvas.height);
  cpuRender.pixels = cpuRender.imageData.data;
  cpuRender.passIndex = 0;
  cpuRender.blockIndex = 0;
  cpuRender.snapshot = makeCpuSnapshot();
  resetCpuDiagnostics(cpuRender.snapshot);
  cpuRender.lastPaint = 0;
  cpuRender.useWorkers = ensureCpuWorkers();
  setupCpuPass();
  if (cpuRender.useWorkers) { initCpuWorkers(); dispatchCpuWorkerBatches(); }
  else requestAnimationFrame(() => processCpuRenderMain(generation));
}

function setupCpuPass() {
  // Each pass samples one color per square block. Later passes shrink the block
  // size until step=1, which writes one color per pixel.
  cpuRender.step = CPU_PASSES[cpuRender.passIndex];
  cpuRender.cols = Math.ceil(cpuRender.snapshot.width / cpuRender.step);
  cpuRender.rows = Math.ceil(cpuRender.snapshot.height / cpuRender.step);
  cpuRender.blockIndex = 0;
  cpuRender.nextBatchBlock = 0;
  cpuRender.pendingBatches = 0;
  cpuRender.totalBlocks = cpuRender.cols * cpuRender.rows;
}

function paintCpuBlock(blockIndex) {
  // Main-thread fallback path: compute one block and fill every pixel inside it.
  const snap = cpuRender.snapshot;
  const step = cpuRender.step;
  const col = blockIndex % cpuRender.cols;
  const row = Math.floor(blockIndex / cpuRender.cols);
  const xStart = col * step;
  const yStart = row * step;
  const xEnd = Math.min(xStart + step, snap.width);
  const yEnd = Math.min(yStart + step, snap.height);
  const sampleX = Math.min(xStart + step * 0.5, snap.width - 0.5);
  const sampleY = Math.min(yStart + step * 0.5, snap.height - 0.5);
  const worldX = snap.x0 + sampleX * snap.scaleX;
  const worldY = snap.y1 - sampleY * snap.scaleY;
  const sample = snap.backend === "perturbMandelbrot"
    ? perturbEscapeMandelbrot(snap.referenceOrbit, worldX, worldY, snap.iter)
    : cpuEscape(snap.formula, worldX, worldY, snap.iter, snap.juliaC);
  if (snap.backend === "perturbMandelbrot") {
    recordCpuDiagnostics(1, sample && sample.fallback ? 1 : 0);
  }
  const color = cpuColor(
    sample,
    snap.iter,
    snap.palette,
    snap.cycle,
    snap.colorMode,
    snap.colorStyle
  );

  for (let y = yStart; y < yEnd; y++) {
    let p = (y * snap.width + xStart) * 4;
    for (let x = xStart; x < xEnd; x++) {
      cpuRender.pixels[p++] = color[0];
      cpuRender.pixels[p++] = color[1];
      cpuRender.pixels[p++] = color[2];
      cpuRender.pixels[p++] = 255;
    }
  }
}

function paintCpuColorBatch(startBlock, colors) {
  // Worker path: workers return compact RGBA colors per block; the main thread
  // expands them into the ImageData buffer.
  const snap = cpuRender.snapshot;
  const step = cpuRender.step;
  const count = colors.length / 4;

  if (step === 1) {
    cpuRender.pixels.set(colors, startBlock * 4);
    return;
  }

  for (let i = 0; i < count; i++) {
    const blockIndex = startBlock + i;
    const col = blockIndex % cpuRender.cols;
    const row = Math.floor(blockIndex / cpuRender.cols);
    const xStart = col * step;
    const yStart = row * step;
    const xEnd = Math.min(xStart + step, snap.width);
    const yEnd = Math.min(yStart + step, snap.height);
    const colorOffset = i * 4;

    for (let y = yStart; y < yEnd; y++) {
      let p = (y * snap.width + xStart) * 4;
      for (let x = xStart; x < xEnd; x++) {
        cpuRender.pixels[p++] = colors[colorOffset];
        cpuRender.pixels[p++] = colors[colorOffset + 1];
        cpuRender.pixels[p++] = colors[colorOffset + 2];
        cpuRender.pixels[p++] = 255;
      }
    }
  }
}

function initCpuWorkers() {
  const initMsg = {
    type: "init",
    generation: cpuRender.activeGeneration,
    passIndex: cpuRender.passIndex,
    snapshot: cpuRender.snapshot,
    step: cpuRender.step,
    cols: cpuRender.cols,
    totalBlocks: cpuRender.totalBlocks,
  };
  for (const entry of cpuRender.workers) {
    entry.worker.postMessage(initMsg);
  }
}

function dispatchCpuWorkerBatches() {
  if (!cpuRender.running || (cpuRender.dirty && !cpuRender.previewOnly) || !state.cpuRefine) return;

  for (const entry of cpuRender.workers) {
    if (entry.busy || cpuRender.nextBatchBlock >= cpuRender.totalBlocks) continue;
    const startBlock = cpuRender.nextBatchBlock;
    const count = Math.min(CPU_WORKER_BATCH_BLOCKS, cpuRender.totalBlocks - startBlock);
    cpuRender.nextBatchBlock += count;
    cpuRender.pendingBatches++;
    entry.busy = true;
    entry.worker.postMessage({ startBlock, count });
  }

  finishCpuWorkerPassIfDone();
}

function onCpuWorkerMessage(entry, data) {
  entry.busy = false;
  cpuRender.pendingBatches = Math.max(0, cpuRender.pendingBatches - 1);

  // Stale replies are normal when a user moves before a pass finishes.
  if (data.generation !== cpuRender.activeGeneration ||
      data.passIndex !== cpuRender.passIndex ||
      !cpuRender.running ||
      (cpuRender.dirty && !cpuRender.previewOnly) ||
      !state.cpuRefine) return;

  recordCpuDiagnostics(data.totalSamples || 0, data.fallbackSamples || 0);
  paintCpuColorBatch(data.startBlock, data.colors);
  const now = performance.now();
  if (now - cpuRender.lastPaint > 32 || cpuRender.pendingBatches === 0) {
    presentCpuImageData();
    cpuRender.lastPaint = now;
  }

  dispatchCpuWorkerBatches();
}

function finishCpuWorkerPassIfDone() {
  if (cpuRender.nextBatchBlock < cpuRender.totalBlocks || cpuRender.pendingBatches > 0) return;
  presentCpuImageData();
  cpuRender.passIndex++;
  if (cpuRender.passIndex >= CPU_PASSES.length || cpuRender.previewOnly) {
    cpuRender.running = false;
    cpuRender.complete = !cpuRender.previewOnly;
    return;
  }
  setupCpuPass();
  initCpuWorkers();
  dispatchCpuWorkerBatches();
}

function processCpuRenderMain(generation) {
  if (generation !== cpuRender.activeGeneration ||
      !cpuRender.running ||
      (cpuRender.dirty && !cpuRender.previewOnly) ||
      !state.cpuRefine) return;
  const started = performance.now();
  const totalBlocks = cpuRender.cols * cpuRender.rows;

  while (performance.now() - started < CPU_FRAME_BUDGET_MS) {
    paintCpuBlock(cpuRender.blockIndex++);
    if (cpuRender.blockIndex >= totalBlocks) {
      presentCpuImageData();
      cpuRender.passIndex++;
      if (cpuRender.passIndex >= CPU_PASSES.length || cpuRender.previewOnly) {
        cpuRender.running = false;
        cpuRender.complete = !cpuRender.previewOnly;
        return;
      }
      setupCpuPass();
      break;
    }
  }

  presentCpuImageData();
  requestAnimationFrame(() => processCpuRenderMain(generation));
}

function maybeStartCpuRender(now) {
  // Delay refinement until the camera and pointers are idle; otherwise the CPU
  // would waste time painting frames that are immediately invalidated.
  if (state.compare.enabled) return;
  if (!state.cpuRefine || !currentViewSupportsCpuRefinement() || !deepCtx || !cpuRender.dirty) return;
  if (getZoom() < CPU_PREVIEW_ZOOM_THRESHOLD) return;
  if (cpuRender.running && !cpuRender.previewOnly) return;
  if (now - cpuRender.dirtySince < CPU_REFINE_DELAY_MS) return;
  if (state.dragging || activePointers.size || !isCameraSettled()) return;
  startCpuRender();
}

// ─── Input handlers ───────────────────────────────────────────────────────────

function canvasPixelFromClient(clientX, clientY) {
  // Pointer events arrive in CSS pixels; rendering math needs backing-store
  // pixels because the canvas may be scaled for devicePixelRatio.
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / Math.max(rect.width, 1);
  const sy = canvas.height / Math.max(rect.height, 1);
  return {
    x: (clientX - rect.left) * sx,
    y: (clientY - rect.top) * sy,
  };
}

function worldAtClient(clientX, clientY, cx = state.targetCenterX, cy = state.targetCenterY, scale = state.targetPixelScale) {
  // Convert a screen point into fractal coordinates for anchored zoom and pinch.
  const p = canvasPixelFromClient(clientX, clientY);
  return {
    x: (p.x - canvas.width * 0.5) * scale + cx,
    y: (canvas.height * 0.5 - p.y) * scale + cy,
  };
}

function anchorTargetAtClient(clientX, clientY, worldX, worldY, scale) {
  // Adjust the camera so the chosen world coordinate remains under the pointer
  // after a scale change.
  const p = canvasPixelFromClient(clientX, clientY);
  setCameraTarget(
    worldX - (p.x - canvas.width * 0.5) * scale,
    worldY - (canvas.height * 0.5 - p.y) * scale,
    scale
  );
}

function zoomTargetAtClient(clientX, clientY, factor) {
  startCpuPreview();
  const anchor = worldAtClient(clientX, clientY);
  anchorTargetAtClient(clientX, clientY, anchor.x, anchor.y, state.targetPixelScale * factor);
}

function pointerList() {
  return Array.from(activePointers.values());
}

function pointerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointerMidpoint(a, b) {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

function beginPanFromPointer(p) {
  state.dragging = true;
  state.dragStartX = p.x;
  state.dragStartY = p.y;
  state.dragStartCX = state.targetCenterX;
  state.dragStartCY = state.targetCenterY;
  startCpuPreview();
}

function beginPinch() {
  // Store the world point under the pinch midpoint so two-finger zoom feels
  // locked to the user's fingers.
  const points = pointerList();
  if (points.length < 2) return;
  const a = points[0], b = points[1];
  const mid = pointerMidpoint(a, b);
  const anchor = worldAtClient(mid.x, mid.y);
  state.dragging = false;
  gesture.pinchStartDist = Math.max(pointerDistance(a, b), 1);
  gesture.pinchStartScale = state.targetPixelScale;
  gesture.pinchAnchorX = anchor.x;
  gesture.pinchAnchorY = anchor.y;
  startCpuPreview();
}

function updatePinch() {
  const points = pointerList();
  if (points.length < 2) return;
  const a = points[0], b = points[1];
  const mid = pointerMidpoint(a, b);
  const dist = Math.max(pointerDistance(a, b), 1);
  const nextScale = gesture.pinchStartScale * gesture.pinchStartDist / dist;
  anchorTargetAtClient(mid.x, mid.y, gesture.pinchAnchorX, gesture.pinchAnchorY, nextScale);
}

function toggleFavoriteFractal(idx = state.fractalIdx) {
  const key = String(clampFractalIndex(idx));
  if (state.favoriteFractals[key]) delete state.favoriteFractals[key];
  else state.favoriteFractals[key] = true;
  renderFractalOptions();
  saveSettings();
}

function switchFractal(direction = 1) {
  const currentNavIdx = fractalNavOrder.indexOf(state.fractalIdx);
  const navIdx = currentNavIdx >= 0 ? currentNavIdx : 0;
  const nextNavIdx = (navIdx + direction + fractalNavOrder.length) % fractalNavOrder.length;
  selectFractal(fractalNavOrder[nextNavIdx]);
}

function selectFractal(idx, options = {}) {
  // Preserve the current fractal's view before switching, then restore the next
  // fractal's own saved view if one exists.
  if (idx === state.fractalIdx) return;
  saveViewForCurrentFractal();
  state.fractalIdx = idx;
  if (!options.preserveTour && state.tour.id) {
    state.tour.id = "";
    state.tour.stop = 0;
    state.tour.playing = false;
    ui.tourSelect.value = "";
  }
  const modes = FRACTALS[state.fractalIdx].meta.colorModes || ["escape"];
  if (modes.includes("basin")) state.colorMode = COLOR_MODE_BASIN;
  else state.colorMode = COLOR_MODE_ESCAPE;
  restoreViewForFractal(state.fractalIdx);
  renderFractalOptions();
  markDeepDirty(true);
  saveSettings();
}

function isMobileLayout() {
  return MOBILE_QUERY.matches;
}

function syncMobileShellState() {
  const sheetOpen = isMobileLayout() && !ui.hud.hidden && ui.hud.dataset.mobileState === "open";
  ui.shell.classList.toggle("mobile-sheet-open", sheetOpen);
}

function setMobileSheetState(nextState) {
  const open = nextState === "open";
  ui.hud.dataset.mobileState = open ? "open" : "compact";
  ui.btnSheetHandle.setAttribute("aria-expanded", String(open));
  ui.btnSheetHandle.setAttribute("aria-label", open ? "Collapse mobile controls" : "Expand mobile controls");
  ui.btnMobileControls.setAttribute("aria-expanded", String(open));
  ui.btnMobileControls.textContent = open ? "Close" : "Controls";
  syncMobileShellState();
}

function toggleMobileSheet() {
  setMobileSheetState(ui.hud.dataset.mobileState === "open" ? "compact" : "open");
}

function setMobileTab(tab) {
  const validTab = ui.mobileTabs.some(button => button.dataset.mobileTabTarget === tab) ? tab : "explore";
  ui.hud.dataset.mobileTab = validTab;
  ui.mobileTabs.forEach(button => {
    const active = button.dataset.mobileTabTarget === validTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function syncMobileLayout() {
  if (isMobileLayout() && ui.hud.dataset.mobileState !== "open") {
    setMobileSheetState("compact");
  } else {
    syncMobileShellState();
  }
}

function toggleHud() {
  const hidden = !ui.hud.hidden;
  ui.hud.hidden = hidden;
  ui.btnShowHud.hidden = !hidden;
  if (!hidden && isMobileLayout()) setMobileSheetState("compact");
  else syncMobileShellState();
}

function toggleRefine() {
  if (!currentViewSupportsCpuRefinement()) {
    clearDeepOverlay();
    return;
  }
  state.cpuRefine = !state.cpuRefine;
  markDeepDirty(true);
  if (!state.cpuRefine) clearDeepOverlay();
  saveSettings();
}

function toggleColorMode() {
  if (!(FRACTALS[state.fractalIdx].meta.colorModes || []).includes("basin")) {
    state.colorMode = COLOR_MODE_ESCAPE;
    saveSettings();
    return;
  }
  state.colorMode = state.colorMode === COLOR_MODE_BASIN ? COLOR_MODE_ESCAPE : COLOR_MODE_BASIN;
  markMinimapDirty();
  markDeepDirty(true);
  saveSettings();
}

function toggleCompareMode() {
  state.compare.enabled = !state.compare.enabled;
  if (state.compare.enabled) {
    state.tour.playing = false;
    if (state.cpuRefine) clearDeepOverlay();
  }
  markDeepDirty(true);
  saveSettings();
}

function setCompareFractal(idx) {
  state.compare.fractalIdx = clampFractalIndex(idx);
  const compareFractal = getCompareFractal();
  if (!((compareFractal.meta.colorModes || []).includes("basin"))) {
    state.compare.colorMode = COLOR_MODE_ESCAPE;
  }
  markDeepDirty(true);
  saveSettings();
}

function toggleCompareColorMode() {
  const compareFractal = getCompareFractal();
  if (!((compareFractal.meta.colorModes || []).includes("basin"))) {
    state.compare.colorMode = COLOR_MODE_ESCAPE;
    saveSettings();
    return;
  }
  state.compare.colorMode = state.compare.colorMode === COLOR_MODE_BASIN ? COLOR_MODE_ESCAPE : COLOR_MODE_BASIN;
  markDeepDirty(true);
  saveSettings();
}

function setFixedJuliaParam(real, imag, syncInputs = true) {
  if (!FRACTALS[state.fractalIdx].juliaParam) return;
  const next = [clampJuliaParam(real), clampJuliaParam(imag)];
  state.juliaParams[state.fractalIdx] = next;
  if (syncInputs) {
    ui.juliaReal.value = next[0].toFixed(3);
    ui.juliaImag.value = next[1].toFixed(3);
  }
  markMinimapDirty();
  markDeepDirty(true);
  saveSettings();
}

function updateFixedJuliaParamFromInputs() {
  const real = parseFloat(ui.juliaReal.value);
  const imag = parseFloat(ui.juliaImag.value);
  if (!Number.isFinite(real) || !Number.isFinite(imag)) return;
  setFixedJuliaParam(real, imag, false);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomizeJuliaSeed() {
  const f = FRACTALS[state.fractalIdx];
  if (!f.juliaParam) return;
  const real = f.formula === "burningJulia"
    ? randomBetween(-0.95, 0.25)
    : randomBetween(-0.9, 0.45);
  const imag = f.formula === "burningJulia"
    ? randomBetween(-1.2, -0.2)
    : randomBetween(-0.9, 0.9);
  setFixedJuliaParam(real, imag);
}

function share() {
  const url = location.origin + location.pathname + "?" + stateToParams();
  navigator.clipboard.writeText(url).then(() => {
    ui.btnShare.textContent = "Copied!";
    setTimeout(() => { ui.btnShare.textContent = "Share"; }, 1800);
  }).catch(() => window.prompt("Copy link:", url));
}

function copyFormula() {
  const formula = getActiveFormulaText();
  navigator.clipboard.writeText(formula).then(() => {
    ui.btnCopyFormula.textContent = "Copied!";
    setTimeout(() => { ui.btnCopyFormula.textContent = "Copy"; }, 1800);
  }).catch(() => window.prompt("Copy formula:", formula));
}

function exportView() {
  const exportCanvas = exportCompositeCanvas();
  if (!exportCanvas) {
    window.alert("Export is unavailable in this browser.");
    return;
  }
  const link = document.createElement("a");
  link.href = exportCanvas.toDataURL("image/png");
  link.download = buildExportFilename();
  link.click();
  ui.btnExport.textContent = "Exported";
  setTimeout(() => { ui.btnExport.textContent = "Export"; }, 1800);
}

canvas.addEventListener("pointerdown", e => {
  markDeepDirty(true);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  if (activePointers.size >= 2) beginPinch();
  else beginPanFromPointer({ x: e.clientX, y: e.clientY });
  e.preventDefault();
});

canvas.addEventListener("pointermove", e => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size >= 2) {
    updatePinch();
    return;
  }
  if (!state.dragging) return;
  const dx = e.clientX - state.dragStartX;
  const dy = e.clientY - state.dragStartY;
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / Math.max(rect.width, 1);
  const sy = canvas.height / Math.max(rect.height, 1);
  setCameraTarget(
    state.dragStartCX - dx * sx * state.targetPixelScale,
    state.dragStartCY + dy * sy * state.targetPixelScale,
    state.targetPixelScale
  );
});

function endPointer(e) {
  activePointers.delete(e.pointerId);
  state.dragging = false;
  try { canvas.releasePointerCapture(e.pointerId); } catch { /* pointer already released */ }
  const remaining = pointerList();
  if (remaining.length >= 2) beginPinch();
  else if (remaining.length === 1) beginPanFromPointer(remaining[0]);
  saveSettings();
}

canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const factor = Math.pow(1.0015, e.deltaY);
  zoomTargetAtClient(e.clientX, e.clientY, factor);
  saveSettings();
}, { passive: false });

const keys = {};
window.addEventListener("keydown", e => {
  keys[e.code] = true;
  if (e.code === "KeyF") switchFractal(e.shiftKey ? -1 : 1);
  if (e.code === "KeyP") { state.palette = (state.palette + 1) % 5; markMinimapDirty(); markDeepDirty(true); saveSettings(); }
  if (e.code === "KeyT") { state.colorStyle = (state.colorStyle + 1) % 3; markMinimapDirty(); markDeepDirty(true); saveSettings(); }
  if (e.code === "KeyB") toggleColorMode();
  if (e.code === "KeyX") toggleRefine();
  if (e.code === "KeyH") toggleHud();
  if (e.code === "KeyR") { resetView(); saveSettings(); }
  if (e.code === "KeyC") share();
});
window.addEventListener("keyup", e => { keys[e.code] = false; });

ui.btnPrevFractal.addEventListener("click", () => switchFractal(-1));
ui.btnNextFractal.addEventListener("click", () => switchFractal(1));
ui.fractalSelect.addEventListener("change", () => {
  const idx = parseInt(ui.fractalSelect.value, 10);
  if (Number.isInteger(idx) && idx >= 0 && idx < FRACTALS.length) selectFractal(idx);
});
ui.fractalSearch.addEventListener("input", renderFractalOptions);
ui.btnClearFractalSearch.addEventListener("click", () => {
  ui.fractalSearch.value = "";
  renderFractalOptions();
  ui.fractalSearch.focus();
});
ui.btnFavoriteFractal.addEventListener("click", () => toggleFavoriteFractal());
ui.btnPalette.addEventListener("click", () => { state.palette = (state.palette + 1) % 5; markMinimapDirty(); markDeepDirty(true); saveSettings(); });
ui.btnMobilePrev.addEventListener("click", () => switchFractal(-1));
ui.btnMobileNext.addEventListener("click", () => switchFractal(1));
ui.btnMobilePalette.addEventListener("click", () => { state.palette = (state.palette + 1) % 5; markMinimapDirty(); markDeepDirty(true); saveSettings(); });
ui.btnMobileRefine.addEventListener("click", toggleRefine);
ui.btnMobileControls.addEventListener("click", () => setMobileSheetState(ui.hud.dataset.mobileState === "open" ? "compact" : "open"));
ui.btnSheetHandle.addEventListener("click", toggleMobileSheet);
ui.mobileTabs.forEach(button => {
  button.addEventListener("click", () => {
    setMobileTab(button.dataset.mobileTabTarget);
    setMobileSheetState("open");
  });
});
ui.colorStyle.addEventListener("change", () => {
  state.colorStyle = normalizeColorStyle(ui.colorStyle.value);
  markMinimapDirty();
  markDeepDirty(true);
  saveSettings();
});
ui.btnColorMode.addEventListener("click", toggleColorMode);
ui.btnRefine.addEventListener("click", toggleRefine);
ui.btnHideHud.addEventListener("click", toggleHud);
ui.btnShowHud.addEventListener("click", toggleHud);
ui.btnReset.addEventListener("click",   () => { resetView(); saveSettings(); });
ui.btnExport.addEventListener("click",  exportView);
ui.btnComposerUse.addEventListener("click", useComposerFractal);
ui.btnComposerReset.addEventListener("click", resetComposerConfig);
ui.composerMode.addEventListener("change", () => setComposerConfig({ mode: ui.composerMode.value }));
ui.composerStack.addEventListener("change", event => {
  if (!event.target.classList.contains("composer-op")) return;
  const ops = normalizeComposerConfig(state.composer).ops.slice();
  const slot = Math.max(0, Math.min(parseInt(event.target.dataset.slot, 10) || 0, ops.length - 1));
  ops[slot] = event.target.value;
  setComposerConfig({ ops });
});
ui.btnCompareToggle.addEventListener("click", toggleCompareMode);
ui.compareFractalSelect.addEventListener("change", () => setCompareFractal(ui.compareFractalSelect.value));
ui.compareColorStyle.addEventListener("change", () => {
  state.compare.colorStyle = normalizeColorStyle(ui.compareColorStyle.value);
  markDeepDirty(true);
  saveSettings();
});
ui.btnComparePalette.addEventListener("click", () => {
  state.compare.palette = (state.compare.palette + 1) % 5;
  markDeepDirty(true);
  saveSettings();
});
ui.btnCompareColorMode.addEventListener("click", toggleCompareColorMode);
ui.btnCopyFormula.addEventListener("click", copyFormula);
ui.btnShare.addEventListener("click",   share);
ui.tourSelect.addEventListener("change", () => selectTour(ui.tourSelect.value, { immediate: true }));
ui.btnTourPrev.addEventListener("click", () => stepTour(-1));
ui.btnTourPlay.addEventListener("click", toggleTourPlayback);
ui.btnTourNext.addEventListener("click", () => stepTour(1));
["iterations","colorCycle","juliaAngle"].forEach(id => {
  ui[id].addEventListener("input", () => {
    if (id === "iterations") ui.iterValue.textContent = ui.iterations.value;
    else markMinimapDirty();
    markDeepDirty(true);
    saveSettings();
  });
});
["juliaReal","juliaImag"].forEach(id => {
  ui[id].addEventListener("input", updateFixedJuliaParamFromInputs);
});
ui.btnRandomJulia.addEventListener("click", randomizeJuliaSeed);
window.addEventListener("resize", () => { resize(); syncMobileLayout(); markDeepDirty(true); });
if (MOBILE_QUERY.addEventListener) {
  MOBILE_QUERY.addEventListener("change", syncMobileLayout);
} else {
  MOBILE_QUERY.addListener(syncMobileLayout);
}

// ─── Keyboard pan/zoom ────────────────────────────────────────────────────────

function applyKeyboard(dt) {
  const panSpeed  = state.targetPixelScale * canvas.width * dt * 0.6;
  const zoomSpeed = Math.pow(2, dt * 1.5);
  let cx = state.targetCenterX;
  let cy = state.targetCenterY;
  let ps = state.targetPixelScale;
  if (keys["ArrowLeft"]  || keys["KeyA"]) cx -= panSpeed;
  if (keys["ArrowRight"] || keys["KeyD"]) cx += panSpeed;
  if (keys["ArrowUp"]    || keys["KeyW"]) cy += panSpeed;
  if (keys["ArrowDown"]  || keys["KeyS"]) cy -= panSpeed;
  if (keys["Equal"] || keys["NumpadAdd"])      ps /= zoomSpeed;
  if (keys["Minus"] || keys["NumpadSubtract"]) ps *= zoomSpeed;
  setCameraTarget(cx, cy, ps);
}

// ─── Triple-single split ──────────────────────────────────────────────────────

function tsSplit(x) {
  // WebGL 1.0 uniforms are 32-bit floats. Splitting the coordinate into three
  // floats lets the shader reconstruct a higher-precision world origin.
  const hi  = Math.fround(x);
  const mid = Math.fround(x - hi);
  const lo  = Math.fround(x - hi - mid);
  return [hi, mid, lo];
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(now) {
  // Frame order: update dimensions/input/camera, draw the GPU base layer, draw
  // lightweight overlays, then optionally kick off deferred CPU refinement.
  resize();
  const dt = Math.min(0.05, (now - state.lastTime) * 0.001);
  state.lastTime = now;

  applyKeyboard(dt);
  nudgeCamera(dt);
  updateDeepOverlayTransform();

  state.fpsFrames++;
  if (now - state.fpsTime > 500) {
    ui.fpsReadout.textContent = String(Math.round(state.fpsFrames * 1000 / (now - state.fpsTime)));
    state.fpsFrames = 0;
    state.fpsTime   = now;
  }

  updateUI();
  updateTourPlayback(now);

  gl.enable(gl.SCISSOR_TEST);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  if (state.compare.enabled) {
    const halfWidth = Math.max(1, Math.floor(canvas.width * 0.5));
    const rightWidth = Math.max(1, canvas.width - halfWidth);
    drawScene({
      fractalIdx: state.fractalIdx,
      centerX: state.centerX,
      centerY: state.centerY,
      pixelScale: state.pixelScale,
      iterations: getRenderIterations(),
      palette: state.palette,
      colorCycle: parseFloat(ui.colorCycle.value),
      juliaC: getRenderJuliaC(),
      colorMode: state.colorMode,
      colorStyle: state.colorStyle,
    }, {
      x: 0,
      y: 0,
      width: halfWidth,
      height: canvas.height,
    });
    drawScene({
      fractalIdx: state.compare.fractalIdx,
      centerX: state.centerX,
      centerY: state.centerY,
      pixelScale: state.pixelScale,
      iterations: getRenderIterations(),
      palette: state.compare.palette,
      colorCycle: parseFloat(ui.colorCycle.value),
      juliaC: getRenderJuliaC(state.compare.fractalIdx),
      colorMode: state.compare.colorMode,
      colorStyle: state.compare.colorStyle,
    }, {
      x: halfWidth,
      y: 0,
      width: rightWidth,
      height: canvas.height,
    });
    if (deepCtx) {
      clearDeepOverlay();
    }
  } else {
    drawScene({
      fractalIdx: state.fractalIdx,
      centerX: state.centerX,
      centerY: state.centerY,
      pixelScale: state.pixelScale,
      iterations: getRenderIterations(),
      palette: state.palette,
      colorCycle: parseFloat(ui.colorCycle.value),
      juliaC: getRenderJuliaC(),
      colorMode: state.colorMode,
      colorStyle: state.colorStyle,
    }, {
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
    });
  }
  gl.disable(gl.SCISSOR_TEST);
  drawMinimap();
  maybeStartCpuRender(now);
  requestAnimationFrame(render);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

resize();
resetView(0);
loadSettings();
loadFromParams();
renderFractalOptions();
if (state.tour.id && TOUR_MAP.has(state.tour.id)) {
  selectTour(state.tour.id, { stop: state.tour.stop, immediate: true, skipSave: true, keepPlaying: state.tour.playing });
}
if (!state.pixelScale) resetView();
ui.iterValue.textContent = ui.iterations.value;
setMobileTab(ui.hud.dataset.mobileTab || "explore");
syncMobileLayout();

requestAnimationFrame(render);
