"use strict";

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
  fractalName: document.getElementById("fractalName"),
  zoomReadout: document.getElementById("zoomReadout"),
  fpsReadout:  document.getElementById("fpsReadout"),
  iterReadout: document.getElementById("iterReadout"),
  modeReadout: document.getElementById("modeReadout"),
  fractalSelect: document.getElementById("fractalSelect"),
  iterations:  document.getElementById("iterations"),
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
  btnShare:    document.getElementById("btnShare"),
  btnHideHud:  document.getElementById("btnHideHud"),
  btnShowHud:  document.getElementById("btnShowHud"),
  iterValue:   document.getElementById("iterValue"),
  hud:         document.querySelector(".hud"),
};

const fractalOptionGroups = new Map();
FRACTALS.forEach((fractal, idx) => {
  let group = fractalOptionGroups.get(fractal.category);
  if (!group) {
    group = document.createElement("optgroup");
    group.label = `--- ${fractal.category.toUpperCase()} ---`;
    fractalOptionGroups.set(fractal.category, group);
    ui.fractalSelect.appendChild(group);
  }
  const option = document.createElement("option");
  option.value = String(idx);
  option.textContent = fractal.name;
  group.appendChild(option);
});
const fractalNavOrder = Array.from(fractalOptionGroups.values())
  .flatMap(group => Array.from(group.children, option => parseInt(option.value, 10)));

// ─── State ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "fractal2d_v1";
const MIN_ITER = 32;
const MAX_ITER = 1024;
const DEFAULT_ITER = 256;
const CAMERA_EASE = 12;
const CAMERA_SETTLE_EPS = 32 * Number.EPSILON;
const RESET_VIEW_PADDING = 1.08;
const MINIMAP_ITER = 56;
const CPU_DPR = 1;
const CPU_FRAME_BUDGET_MS = 10;
const CPU_REFINE_DELAY_MS = 180;
const CPU_PASSES = [8, 4, 2, 1];
const CPU_MAX_WORKERS = 8;
const CPU_WORKER_COUNT_OVERRIDE = 8;
const CPU_WORKER_BATCH_BLOCKS = 16384;
const CPU_PREVIEW_ZOOM_THRESHOLD = 1e5;
const COLOR_MODE_ESCAPE = 0;
const COLOR_MODE_BASIN = 1;

const state = {
  fractalIdx: 0,
  palette: 0,
  colorMode: COLOR_MODE_ESCAPE,
  cpuRefine: true,
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
};

const activePointers = new Map();
const gesture = {
  pinchStartDist: 0,
  pinchStartScale: 0,
  pinchAnchorX: 0,
  pinchAnchorY: 0,
};

let minimapDirty = true;
const cpuRender = {
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
  workers: [],
  workerUrl: "",
  pendingBatches: 0,
  nextBatchBlock: 0,
  totalBlocks: 0,
  lastPaint: 0,
  useWorkers: false,
  previewOnly: false,
};

function viewBoundsForFractal(idx = state.fractalIdx) {
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
  if (changed || centerChanged) markDeepDirty(true);
}

function syncTargetToCurrent() {
  setCameraTarget(state.centerX, state.centerY, state.pixelScale, true);
}

function cameraSettleTolerance(center, target, viewWidth) {
  const numericFloor = Math.max(1, Math.abs(center), Math.abs(target)) * CAMERA_SETTLE_EPS;
  return Math.max(viewWidth * 1e-7, numericFloor);
}

function nudgeCamera(dt) {
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
  try {
    const views = JSON.parse(localStorage.getItem(STORAGE_KEY + "_views") || "{}");
    views[state.fractalIdx] = { cx: state.targetCenterX, cy: state.targetCenterY, ps: state.targetPixelScale };
    localStorage.setItem(STORAGE_KEY + "_views", JSON.stringify(views));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      fractalIdx: state.fractalIdx,
      palette:    state.palette,
      colorMode:  state.colorMode,
      iterations: ui.iterations.value,
      colorCycle: ui.colorCycle.value,
      juliaAngle: ui.juliaAngle.value,
      cpuRefine: state.cpuRefine,
      juliaParams: state.juliaParams,
    }));
  } catch { /* quota */ }
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (s.fractalIdx !== undefined) state.fractalIdx = Math.max(0, Math.min(parseInt(s.fractalIdx, 10) || 0, FRACTALS.length - 1));
    if (s.palette    !== undefined) state.palette    = Math.max(0, Math.min(parseInt(s.palette, 10) || 0, 4));
    if (s.colorMode  !== undefined) state.colorMode  = parseInt(s.colorMode, 10) === COLOR_MODE_BASIN ? COLOR_MODE_BASIN : COLOR_MODE_ESCAPE;
    if (s.iterations) ui.iterations.value = Math.max(MIN_ITER, Math.min(parseInt(s.iterations, 10) || DEFAULT_ITER, MAX_ITER));
    if (s.colorCycle) ui.colorCycle.value = s.colorCycle;
    if (s.juliaAngle) ui.juliaAngle.value = s.juliaAngle;
    if (s.cpuRefine !== undefined) state.cpuRefine = !!s.cpuRefine;
    if (s.juliaParams && typeof s.juliaParams === "object") state.juliaParams = s.juliaParams;
    const views = JSON.parse(localStorage.getItem(STORAGE_KEY + "_views") || "{}");
    const v = views[state.fractalIdx];
    if (v) setCameraTarget(v.cx, v.cy, v.ps, true);
    else resetView(state.fractalIdx);
  } catch { /* ignore */ }
}

function saveViewForCurrentFractal() {
  try {
    const views = JSON.parse(localStorage.getItem(STORAGE_KEY + "_views") || "{}");
    views[state.fractalIdx] = { cx: state.targetCenterX, cy: state.targetCenterY, ps: state.targetPixelScale };
    localStorage.setItem(STORAGE_KEY + "_views", JSON.stringify(views));
  } catch { /* quota */ }
}

function restoreViewForFractal(idx) {
  resetView(idx);
  try {
    const views = JSON.parse(localStorage.getItem(STORAGE_KEY + "_views") || "{}");
    const v = views[idx];
    if (v) setCameraTarget(v.cx, v.cy, v.ps, true);
  } catch { /* ignore */ }
  markMinimapDirty();
}

// ─── URL share ────────────────────────────────────────────────────────────────

function stateToParams() {
  const params = new URLSearchParams({
    f:  state.fractalIdx,
    pa: state.palette,
    cm: state.colorMode,
    cx: state.targetCenterX.toFixed(15),
    cy: state.targetCenterY.toFixed(15),
    ps: state.targetPixelScale.toExponential(6),
    it: ui.iterations.value,
    cc: ui.colorCycle.value,
    ja: ui.juliaAngle.value,
  });
  if (FRACTALS[state.fractalIdx].juliaParam) {
    const [jr, ji] = getRenderJuliaC();
    params.set("jr", jr.toFixed(6));
    params.set("ji", ji.toFixed(6));
  }
  return params.toString();
}

function loadFromParams() {
  const p = new URLSearchParams(window.location.search);
  if (p.has("f"))  state.fractalIdx = Math.max(0, Math.min(parseInt(p.get("f"), 10) || 0, FRACTALS.length - 1));
  if (p.has("pa")) state.palette    = Math.max(0, Math.min(parseInt(p.get("pa"), 10) || 0, 4));
  if (p.has("cm")) state.colorMode  = parseInt(p.get("cm"), 10) === COLOR_MODE_BASIN ? COLOR_MODE_BASIN : COLOR_MODE_ESCAPE;
  if (p.has("cx")) state.centerX    = parseFloat(p.get("cx")) || 0;
  if (p.has("cy")) state.centerY    = parseFloat(p.get("cy")) || 0;
  if (p.has("ps")) state.pixelScale = parseFloat(p.get("ps")) || 0;
  if (p.has("it")) ui.iterations.value = Math.max(MIN_ITER, Math.min(parseInt(p.get("it"), 10) || DEFAULT_ITER, MAX_ITER));
  if (p.has("cc")) ui.colorCycle.value = p.get("cc");
  if (p.has("ja")) ui.juliaAngle.value = p.get("ja");
  if (p.has("jr") && p.has("ji") && FRACTALS[state.fractalIdx].juliaParam) {
    const jr = parseFloat(p.get("jr"));
    const ji = parseFloat(p.get("ji"));
    if (Number.isFinite(jr) && Number.isFinite(ji)) {
      state.juliaParams[state.fractalIdx] = [clampJuliaParam(jr), clampJuliaParam(ji)];
    }
  }
  syncTargetToCurrent();
  markMinimapDirty();
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
  const width = Math.max(canvas.width, 1);
  const height = Math.max(canvas.height, 1);
  const worldWidth = width * state.pixelScale;
  const worldHeight = height * state.pixelScale;
  const x0 = state.centerX - worldWidth * 0.5;
  const y0 = state.centerY - worldHeight * 0.5;
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
  ui.fractalName.textContent = f.name;
  ui.fractalSelect.value = String(state.fractalIdx);
  ui.juliaRow.style.display  = f.julia ? "" : "none";
  ui.fixedJuliaRow.style.display = f.juliaParam ? "" : "none";
  syncJuliaParamInputs();
  ui.iterReadout.textContent = getRenderIterations();
  ui.modeReadout.textContent = getRenderModeLabel();
  ui.btnRefine.textContent = state.cpuRefine ? "Refine ON" : "Refine";
  ui.btnRefine.classList.toggle("active", state.cpuRefine);
  const supportsBasinMode = (f.meta.colorModes || []).includes("basin");
  if (!supportsBasinMode && state.colorMode === COLOR_MODE_BASIN) state.colorMode = COLOR_MODE_ESCAPE;
  ui.btnColorMode.disabled = !supportsBasinMode;
  ui.btnColorMode.textContent = state.colorMode === COLOR_MODE_BASIN ? "Basin" : "Escape";
  ui.btnColorMode.classList.toggle("active", state.colorMode === COLOR_MODE_BASIN);
  ui.zoomReadout.textContent = formatZoom(getZoom());
}

function formatZoom(zoom) {
  if (!Number.isFinite(zoom) || zoom <= 0) return "1×";
  if (zoom >= 1e9) return zoom.toExponential(2).replace("+", "") + "×";
  if (zoom >= 1e6) return (zoom / 1e6).toFixed(2) + "M×";
  if (zoom >= 1000) return (zoom / 1000).toFixed(1) + "k×";
  return zoom.toFixed(zoom < 10 ? 2 : 0) + "×";
}

function getRenderModeLabel() {
  if (!state.cpuRefine || !deepCtx) return "GPU";
  if (cpuRender.running) return cpuRender.useWorkers
    ? `x${cpuRender.workers.length} CPU`
    : "CPU...";
  if (cpuRender.complete && !cpuRender.dirty) return "CPU";
  return "GPU";
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

function cosinePalette(t, paletteIdx) {
  const shifts = [
    [0.00, 0.18, 0.36],
    [0.46, 0.08, 0.02],
    [0.04, 0.30, 0.22],
    [0.28, 0.02, 0.38],
    [0.38, 0.28, 0.04],
  ][paletteIdx] || [0.00, 0.18, 0.36];
  return shifts.map(shift => Math.round((0.5 + 0.5 * Math.cos(Math.PI * 2 * (t + shift))) * 255));
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

function basinRootId(formula, zx, zy) {
  return formulaMeta(formula).basinRoots === 4 ? quarticRootId(zx, zy) : cubicRootId(zx, zy);
}

const BASIN_BASES = new Uint8Array([
  245, 87, 56,
  46, 184, 255,
  199, 235, 71,
  194, 110, 255,
]);
const _BASIN_COLOR = [0, 0, 0];

function basinColor(root, iter, maxIter, cycle = 0) {
  const idx = (root >= 0 && root < 4) ? root * 3 : 0;
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

function previewEscape(fractalIdx, x, y) {
  const formula = FRACTALS[fractalIdx].formula || "mandelbrot";
  const meta = formulaMeta(formula);
  const jc = getRenderJuliaC(fractalIdx);
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
        const [r, g, b] = cpuColor(sample, MINIMAP_ITER, state.palette, cycle, state.colorMode);
        image.data[offset] = Math.round(r * 0.82);
        image.data[offset + 1] = Math.round(g * 0.82);
        image.data[offset + 2] = Math.round(b * 0.82);
      } else if (iter >= MINIMAP_ITER) {
        image.data[offset] = 2;
        image.data[offset + 1] = 5;
        image.data[offset + 2] = 7;
      } else {
        const t = iter / MINIMAP_ITER + cycle * 0.08;
        const [r, g, b] = cosinePalette(t, state.palette);
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

function markDeepDirty(clear = false) {
  if (cpuRender.running && !cpuRender.previewOnly) cancelCpuWorkers();
  cpuRender.dirty = true;
  cpuRender.complete = false;
  cpuRender.dirtySince = performance.now();
  if (!cpuRender.previewOnly) {
    cpuRender.generation++;
    cpuRender.running = false;
  }
  if (clear && !cpuRender.previewOnly && deepCtx) deepCtx.clearRect(0, 0, deepCanvas.width, deepCanvas.height);
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
  if (CPU_WORKER_COUNT_OVERRIDE > 0) return Math.min(CPU_MAX_WORKERS, CPU_WORKER_COUNT_OVERRIDE);
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(CPU_MAX_WORKERS, cores));
}

function cpuWorkerSource() {
  const sharedFunctions = [
    formulaMeta,
    supportsBasinColor,
    cubicRootId,
    quarticRootId,
    basinRootId,
    basinColor,
    mandelbrotInSet,
    escapeMandelbrot,
    escapeJulia,
    escapeBurningShip,
    cpuEscape,
    cpuColor,
  ].map(fn => fn.toString()).join("\n\n");

  return `
const COLOR_MODE_ESCAPE = ${COLOR_MODE_ESCAPE};
const COLOR_MODE_BASIN = ${COLOR_MODE_BASIN};
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
const TRAP_STYLE_FLOWER = { tScale: 0.17, s0: 0.16, s1: 0.36, s2: 0.66, baseMix: 0.32, glowEdge: 0.18 };
const TRAP_STYLE_LOTUS  = { tScale: 0.16, s0: 0.08, s1: 0.34, s2: 0.70, baseMix: 0.30, glowEdge: 0.20 };
const TRAP_STYLE_ROSE   = { tScale: 0.19, s0: 0.22, s1: 0.48, s2: 0.76, baseMix: 0.34, glowEdge: 0.17 };
const TRAP_STYLE_DEFAULT = { tScale: 0.18, s0: 0.02, s1: 0.32, s2: 0.58, baseMix: 0.35, glowEdge: 0.16 };
const BASIN_BASES = new Uint8Array([
  245, 87, 56,
  46, 184, 255,
  199, 235, 71,
  194, 110, 255,
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
    const color = cpuColor(
      cpuEscape(_snap.formula, worldX, worldY, _snap.iter, _snap.juliaC),
      _snap.iter,
      _snap.palette,
      _snap.cycle,
      _snap.colorMode
    );
    const p = i * 4;
    colors[p] = color[0];
    colors[p + 1] = color[1];
    colors[p + 2] = color[2];
    colors[p + 3] = 255;
  }

  self.postMessage({ generation: _generation, passIndex: _passIndex, startBlock, colors }, [colors.buffer]);
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
  newtonCubic: 40,
  newtonQuartic: 41,
  halleyCubic: 42,
  novaBasins: 43,
  newtonRelaxSpiral: 44,
  newtonRelaxStorm: 45,
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
      if (fid === 41) {
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
        _SAMPLE.mag2 = zx * zx + zy * zy;
        return _SAMPLE;
      }
      if (++since >= refresh) { refX = zx; refY = zy; since = 0; if (refresh < 512) refresh *= 2; }
    }
    const mag2 = zx * zx + zy * zy;
    if (!Number.isFinite(mag2)) {
      _SAMPLE.iter = n; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
      _SAMPLE.root = hasBasin ? basinRootId(formula, zx, zy) : undefined;
      _SAMPLE.trap = trap; _SAMPLE.trapKind = trapKind; _SAMPLE.mag2 = 1e9;
      return _SAMPLE;
    }
    if (mag2 > 256) {
      _SAMPLE.iter = n; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
      _SAMPLE.root = hasBasin ? basinRootId(formula, zx, zy) : undefined;
      _SAMPLE.trap = trap; _SAMPLE.trapKind = trapKind; _SAMPLE.mag2 = mag2;
      return _SAMPLE;
    }
  }

  _SAMPLE.iter = maxIter; _SAMPLE.zx = zx; _SAMPLE.zy = zy;
  _SAMPLE.root = hasBasin ? basinRootId(formula, zx, zy) : undefined;
  _SAMPLE.trap = trap; _SAMPLE.trapKind = trapKind; _SAMPLE.mag2 = zx * zx + zy * zy;
  return _SAMPLE;
}

const PALETTE_SHIFTS = new Float64Array([
  0.00, 0.18, 0.36,
  0.46, 0.08, 0.02,
  0.04, 0.30, 0.22,
  0.28, 0.02, 0.38,
  0.38, 0.28, 0.04,
]);
const TRAP_STYLE_FLOWER = { tScale: 0.17, s0: 0.16, s1: 0.36, s2: 0.66, baseMix: 0.32, glowEdge: 0.18 };
const TRAP_STYLE_LOTUS  = { tScale: 0.16, s0: 0.08, s1: 0.34, s2: 0.70, baseMix: 0.30, glowEdge: 0.20 };
const TRAP_STYLE_ROSE   = { tScale: 0.19, s0: 0.22, s1: 0.48, s2: 0.76, baseMix: 0.34, glowEdge: 0.17 };
const TRAP_STYLE_DEFAULT = { tScale: 0.18, s0: 0.02, s1: 0.32, s2: 0.58, baseMix: 0.35, glowEdge: 0.16 };
const _COLOR = [0, 0, 0];
const TWO_PI = Math.PI * 2;

function cpuColor(sample, maxIter, paletteIdx, cycle, colorMode = COLOR_MODE_ESCAPE) {
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
    _COLOR[0] = Math.round((0.5 + 0.5 * Math.cos(TWO_PI * (t + ts.s0))) * 255 * mix);
    _COLOR[1] = Math.round((0.5 + 0.5 * Math.cos(TWO_PI * (t + ts.s1))) * 255 * mix);
    _COLOR[2] = Math.round((0.5 + 0.5 * Math.cos(TWO_PI * (t + ts.s2))) * 255 * mix);
    return _COLOR;
  }
  if (sample.iter >= maxIter) {
    _COLOR[0] = 0; _COLOR[1] = 0; _COLOR[2] = 0;
    return _COLOR;
  }
  const mag2 = sample.mag2;
  const logMag = Math.log2(mag2);
  const sm = sample.iter - Math.log2(logMag > 1 ? logMag : 1) + 4;
  const t = sm / maxIter + cycle;
  const base = (paletteIdx >= 0 && paletteIdx < 5) ? paletteIdx * 3 : 0;
  _COLOR[0] = Math.round((0.5 + 0.5 * Math.cos(TWO_PI * (t + PALETTE_SHIFTS[base]))) * 255);
  _COLOR[1] = Math.round((0.5 + 0.5 * Math.cos(TWO_PI * (t + PALETTE_SHIFTS[base + 1]))) * 255);
  _COLOR[2] = Math.round((0.5 + 0.5 * Math.cos(TWO_PI * (t + PALETTE_SHIFTS[base + 2]))) * 255);
  return _COLOR;
}

function makeCpuSnapshot() {
  const viewport = renderViewport();
  return {
    fractalIdx: state.fractalIdx,
    formula: FRACTALS[state.fractalIdx].formula || "mandelbrot",
    palette: state.palette,
    colorMode: state.colorMode,
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
}

function startCpuRender() {
  if (!deepCtx || !state.cpuRefine || !deepCanvas.width || !deepCanvas.height) return;
  if (cpuRender.running) cancelCpuWorkers();
  deepCanvas.style.transform = "";
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
  cpuRender.lastPaint = 0;
  cpuRender.useWorkers = ensureCpuWorkers();
  setupCpuPass();
  if (cpuRender.useWorkers) { initCpuWorkers(); dispatchCpuWorkerBatches(); }
  else requestAnimationFrame(() => processCpuRenderMain(generation));
}

function startCpuPreview() {
  if (!deepCtx || !state.cpuRefine || !deepCanvas.width || !deepCanvas.height) return;
  if (getZoom() < CPU_PREVIEW_ZOOM_THRESHOLD) return;
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
  cpuRender.lastPaint = 0;
  cpuRender.useWorkers = ensureCpuWorkers();
  setupCpuPass();
  if (cpuRender.useWorkers) { initCpuWorkers(); dispatchCpuWorkerBatches(); }
  else requestAnimationFrame(() => processCpuRenderMain(generation));
}

function setupCpuPass() {
  cpuRender.step = CPU_PASSES[cpuRender.passIndex];
  cpuRender.cols = Math.ceil(cpuRender.snapshot.width / cpuRender.step);
  cpuRender.rows = Math.ceil(cpuRender.snapshot.height / cpuRender.step);
  cpuRender.blockIndex = 0;
  cpuRender.nextBatchBlock = 0;
  cpuRender.pendingBatches = 0;
  cpuRender.totalBlocks = cpuRender.cols * cpuRender.rows;
}

function paintCpuBlock(blockIndex) {
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
  const color = cpuColor(
    cpuEscape(snap.formula, worldX, worldY, snap.iter, snap.juliaC),
    snap.iter,
    snap.palette,
    snap.cycle,
    snap.colorMode
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
  if (!cpuRender.running || cpuRender.dirty || !state.cpuRefine) return;

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

  if (data.generation !== cpuRender.activeGeneration ||
      data.passIndex !== cpuRender.passIndex ||
      !cpuRender.running ||
      cpuRender.dirty ||
      !state.cpuRefine) return;

  paintCpuColorBatch(data.startBlock, data.colors);
  const now = performance.now();
  if (now - cpuRender.lastPaint > 32 || cpuRender.pendingBatches === 0) {
    deepCtx.putImageData(cpuRender.imageData, 0, 0);
    cpuRender.lastPaint = now;
  }

  dispatchCpuWorkerBatches();
}

function finishCpuWorkerPassIfDone() {
  if (cpuRender.nextBatchBlock < cpuRender.totalBlocks || cpuRender.pendingBatches > 0) return;
  deepCtx.putImageData(cpuRender.imageData, 0, 0);
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
      cpuRender.dirty ||
      !state.cpuRefine) return;
  const started = performance.now();
  const totalBlocks = cpuRender.cols * cpuRender.rows;

  while (performance.now() - started < CPU_FRAME_BUDGET_MS) {
    paintCpuBlock(cpuRender.blockIndex++);
    if (cpuRender.blockIndex >= totalBlocks) {
      deepCtx.putImageData(cpuRender.imageData, 0, 0);
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

  deepCtx.putImageData(cpuRender.imageData, 0, 0);
  requestAnimationFrame(() => processCpuRenderMain(generation));
}

function maybeStartCpuRender(now) {
  if (!state.cpuRefine || !deepCtx || !cpuRender.dirty) return;
  if (cpuRender.running && !cpuRender.previewOnly) return;
  if (now - cpuRender.dirtySince < CPU_REFINE_DELAY_MS) return;
  if (state.dragging || activePointers.size || !isCameraSettled()) return;
  startCpuRender();
}

// ─── Input handlers ───────────────────────────────────────────────────────────

function canvasPixelFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / Math.max(rect.width, 1);
  const sy = canvas.height / Math.max(rect.height, 1);
  return {
    x: (clientX - rect.left) * sx,
    y: (clientY - rect.top) * sy,
  };
}

function worldAtClient(clientX, clientY, cx = state.targetCenterX, cy = state.targetCenterY, scale = state.targetPixelScale) {
  const p = canvasPixelFromClient(clientX, clientY);
  return {
    x: (p.x - canvas.width * 0.5) * scale + cx,
    y: (canvas.height * 0.5 - p.y) * scale + cy,
  };
}

function anchorTargetAtClient(clientX, clientY, worldX, worldY, scale) {
  const p = canvasPixelFromClient(clientX, clientY);
  setCameraTarget(
    worldX - (p.x - canvas.width * 0.5) * scale,
    worldY - (canvas.height * 0.5 - p.y) * scale,
    scale
  );
}

function zoomTargetAtClient(clientX, clientY, factor) {
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

function switchFractal(direction = 1) {
  const currentNavIdx = fractalNavOrder.indexOf(state.fractalIdx);
  const navIdx = currentNavIdx >= 0 ? currentNavIdx : 0;
  const nextNavIdx = (navIdx + direction + fractalNavOrder.length) % fractalNavOrder.length;
  selectFractal(fractalNavOrder[nextNavIdx]);
}

function selectFractal(idx) {
  if (idx === state.fractalIdx) return;
  saveViewForCurrentFractal();
  state.fractalIdx = idx;
  const modes = FRACTALS[state.fractalIdx].meta.colorModes || ["escape"];
  if (modes.includes("basin")) state.colorMode = COLOR_MODE_BASIN;
  else state.colorMode = COLOR_MODE_ESCAPE;
  restoreViewForFractal(state.fractalIdx);
  markDeepDirty(true);
  saveSettings();
}

function toggleHud() {
  const hidden = !ui.hud.hidden;
  ui.hud.hidden = hidden;
  ui.btnShowHud.hidden = !hidden;
}

function toggleRefine() {
  state.cpuRefine = !state.cpuRefine;
  markDeepDirty(true);
  if (!state.cpuRefine && deepCtx) deepCtx.clearRect(0, 0, deepCanvas.width, deepCanvas.height);
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
  if (cpuRender.previewOnly) {
    deepCanvas.style.transform = `translate(${dx}px,${dy}px)`;
  }
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
ui.btnPalette.addEventListener("click", () => { state.palette = (state.palette + 1) % 5; markMinimapDirty(); markDeepDirty(true); saveSettings(); });
ui.btnColorMode.addEventListener("click", toggleColorMode);
ui.btnRefine.addEventListener("click", toggleRefine);
ui.btnHideHud.addEventListener("click", toggleHud);
ui.btnShowHud.addEventListener("click", toggleHud);
ui.btnReset.addEventListener("click",   () => { resetView(); saveSettings(); });
ui.btnShare.addEventListener("click",   share);
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
window.addEventListener("resize", () => { resize(); markDeepDirty(true); });

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
  const hi  = Math.fround(x);
  const mid = Math.fround(x - hi);
  const lo  = Math.fround(x - hi - mid);
  return [hi, mid, lo];
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(now) {
  resize();
  const dt = Math.min(0.05, (now - state.lastTime) * 0.001);
  state.lastTime = now;

  applyKeyboard(dt);
  nudgeCamera(dt);

  state.fpsFrames++;
  if (now - state.fpsTime > 500) {
    ui.fpsReadout.textContent = String(Math.round(state.fpsFrames * 1000 / (now - state.fpsTime)));
    state.fpsFrames = 0;
    state.fpsTime   = now;
  }

  updateUI();

  const { prog, loc } = getProgram(state.fractalIdx);
  const jc = getRenderJuliaC();
  const viewport = renderViewport();

  const [x0Hi, x0Mid, x0Lo] = tsSplit(viewport.x0);
  const [y0Hi, y0Mid, y0Lo] = tsSplit(viewport.y0);

  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(loc.pos);
  gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);

  gl.uniform2f(loc.res,    viewport.width, viewport.height);
  gl.uniform3f(loc.x0,    x0Hi, x0Mid, x0Lo);
  gl.uniform3f(loc.y0,    y0Hi, y0Mid, y0Lo);
  gl.uniform1f(loc.scale,  viewport.pixelScale);
  gl.uniform1i(loc.iter,   getRenderIterations());
  gl.uniform1f(loc.palette, state.palette);
  gl.uniform1f(loc.cycle,  parseFloat(ui.colorCycle.value));
  gl.uniform2f(loc.juliaC, jc[0], jc[1]);
  gl.uniform1i(loc.colorMode, state.colorMode);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  drawMinimap();
  maybeStartCpuRender(now);
  requestAnimationFrame(render);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

resize();
resetView(0);
loadSettings();
loadFromParams();
if (!state.pixelScale) resetView();
ui.iterValue.textContent = ui.iterations.value;

requestAnimationFrame(render);
