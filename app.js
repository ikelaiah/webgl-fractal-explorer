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
const CPU_WORKER_BATCH_BLOCKS = 2048;
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

function basinColor(root, iter, maxIter, cycle = 0) {
  const bases = [
    [245, 87, 56],
    [46, 184, 255],
    [199, 235, 71],
    [194, 110, 255],
  ];
  const base = bases[root] || bases[0];
  const shade = 0.28 + 0.72 * Math.pow(1 - Math.min(1, iter / Math.max(maxIter, 1)), 0.7);
  const ring = 0.86 + 0.14 * Math.cos(Math.PI * 2 * (iter * 0.08 + cycle));
  return base.map(channel => Math.round(channel * shade * ring));
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
    } else if (formula === "quartic") {
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
      const r = Math.hypot(zx, zy);
      const a = Math.atan2(zy, zx) * 8;
      const rp = Math.pow(r, 8);
      nx = Math.cos(a) * rp + cx;
      ny = Math.sin(a) * rp + cy;
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
    } else if (formula === "orbitTrapMandelbrot") {
      nx = x2 - y2 + cx;
      ny = 2 * xy + cy;
      const circle = Math.abs(Math.hypot(nx - 0.25, ny) - 0.45);
      const cross = Math.min(Math.abs(nx), Math.abs(ny));
      const diagonal = Math.abs(nx + ny) * 0.70710678118;
      trap = Math.min(trap, circle, cross, diagonal);
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
  if (cpuRender.running) cancelCpuWorkers();
  cpuRender.dirty = true;
  cpuRender.complete = false;
  cpuRender.dirtySince = performance.now();
  cpuRender.generation++;
  cpuRender.running = false;
  if (clear && deepCtx) deepCtx.clearRect(0, 0, deepCanvas.width, deepCanvas.height);
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
    cpuEscape,
    cpuColor,
  ].map(fn => fn.toString()).join("\n\n");

  return `
const COLOR_MODE_ESCAPE = ${COLOR_MODE_ESCAPE};
const COLOR_MODE_BASIN = ${COLOR_MODE_BASIN};
const FORMULA_META = ${JSON.stringify(FORMULA_META)};

${sharedFunctions}

self.onmessage = event => {
  const { generation, passIndex, snapshot, step, cols, totalBlocks, startBlock, count } = event.data;
  const actualCount = Math.min(count, totalBlocks - startBlock);
  const colors = new Uint8ClampedArray(actualCount * 4);

  for (let i = 0; i < actualCount; i++) {
    const blockIndex = startBlock + i;
    const col = blockIndex % cols;
    const row = Math.floor(blockIndex / cols);
    const xStart = col * step;
    const yStart = row * step;
    const sampleX = Math.min(xStart + step * 0.5, snapshot.width - 0.5);
    const sampleY = Math.min(yStart + step * 0.5, snapshot.height - 0.5);
    const worldX = snapshot.x0 + sampleX * snapshot.scale;
    const worldY = snapshot.y1 - sampleY * snapshot.scale;
    const color = cpuColor(
      cpuEscape(snapshot.formula, worldX, worldY, snapshot.iter, snapshot.juliaC),
      snapshot.iter,
      snapshot.palette,
      snapshot.cycle,
      snapshot.colorMode
    );
    const p = i * 4;
    colors[p] = color[0];
    colors[p + 1] = color[1];
    colors[p + 2] = color[2];
    colors[p + 3] = 255;
  }

  self.postMessage({ generation, passIndex, startBlock, colors }, [colors.buffer]);
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

function cpuEscape(formula, x, y, maxIter, jc) {
  const meta = formulaMeta(formula);
  let zx = 0, zy = 0, cx = x, cy = y, px = 0, trap = Infinity;

  if (meta.initial === "julia") {
    zx = x; zy = y; cx = jc[0]; cy = jc[1];
  } else if (meta.initial === "phoenix") {
    zx = x; zy = y; cx = -0.5 + 0.32 * jc[0]; cy = 0.32 * jc[1];
  } else if (meta.initial === "lambda") {
    zx = 0.5; zy = 0; cx = x; cy = y;
  } else if (meta.initial === "point") {
    zx = x; zy = y;
  }

  for (let n = 0; n < maxIter; n++) {
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
    } else if (formula === "quartic") {
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
      px = zx;
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
      const r = Math.hypot(zx, zy);
      const a = Math.atan2(zy, zx) * 8;
      const rp = Math.pow(r, 8);
      nx = Math.cos(a) * rp + cx;
      ny = Math.sin(a) * rp + cy;
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
      if ((nx - 1) * (nx - 1) + ny * ny < 1e-8) return { iter: n + 1, zx: nx, zy: ny, mag2: nx * nx + ny * ny };
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
    } else if (formula === "orbitTrapMandelbrot") {
      nx = x2 - y2 + cx;
      ny = 2 * xy + cy;
      const circle = Math.abs(Math.hypot(nx - 0.25, ny) - 0.45);
      const cross = Math.min(Math.abs(nx), Math.abs(ny));
      const diagonal = Math.abs(nx + ny) * 0.70710678118;
      trap = Math.min(trap, circle, cross, diagonal);
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
      if (qx * qx + qy * qy < 1e-12) {
        return { iter: n + 1, zx: nx, zy: ny, root: basinRootId(formula, nx, ny), mag2: nx * nx + ny * ny };
      }
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
    const mag2 = zx * zx + zy * zy;
    if (!Number.isFinite(mag2)) return { iter: n + 1, zx, zy, root: supportsBasinColor(formula) ? basinRootId(formula, zx, zy) : undefined, trap, mag2: 1e9 };
    if (mag2 > 256) return { iter: n + 1, zx, zy, root: supportsBasinColor(formula) ? basinRootId(formula, zx, zy) : undefined, trap, mag2 };
  }

  return { iter: maxIter, zx, zy, root: supportsBasinColor(formula) ? basinRootId(formula, zx, zy) : undefined, trap, mag2: zx * zx + zy * zy };
}

function cpuColor(sample, maxIter, paletteIdx, cycle, colorMode = COLOR_MODE_ESCAPE) {
  if (colorMode === COLOR_MODE_BASIN && sample.root !== undefined) {
    return basinColor(sample.root, sample.iter, maxIter, cycle);
  }
  if (Number.isFinite(sample.trap)) {
    const t = Math.max(0, Math.min(1, -Math.log(Math.max(sample.trap, 1e-6)) * 0.18 + cycle * 0.18));
    const shifts = [0.02, 0.32, 0.58];
    const glow = Math.max(0, Math.min(1, (0.16 - sample.trap) / 0.16));
    return shifts.map(shift => {
      const base = (0.5 + 0.5 * Math.cos(Math.PI * 2 * (t + shift))) * 255;
      return Math.round(base * (0.35 + 0.65 * glow));
    });
  }
  if (sample.iter >= maxIter) return [0, 0, 0];
  const sm = sample.iter - Math.log2(Math.max(1, Math.log2(sample.mag2))) + 4;
  const t = sm / maxIter + cycle;
  const shifts = [
    [0.00, 0.18, 0.36],
    [0.46, 0.08, 0.02],
    [0.04, 0.30, 0.22],
    [0.28, 0.02, 0.38],
    [0.38, 0.28, 0.04],
  ][paletteIdx] || [0.00, 0.18, 0.36];
  return shifts.map(shift => Math.round((0.5 + 0.5 * Math.cos(Math.PI * 2 * (t + shift))) * 255));
}

function makeCpuSnapshot() {
  const worldWidth = canvas.width * state.pixelScale;
  const worldHeight = canvas.height * state.pixelScale;
  const scale = worldWidth / Math.max(deepCanvas.width, 1);
  return {
    fractalIdx: state.fractalIdx,
    formula: FRACTALS[state.fractalIdx].formula || "mandelbrot",
    palette: state.palette,
    colorMode: state.colorMode,
    cycle: parseFloat(ui.colorCycle.value) || 0,
    iter: getRenderIterations(),
    width: deepCanvas.width,
    height: deepCanvas.height,
    x0: state.centerX - worldWidth * 0.5,
    y1: state.centerY + worldHeight * 0.5,
    scale,
    juliaC: getRenderJuliaC(),
  };
}

function startCpuRender() {
  if (!deepCtx || !state.cpuRefine || !deepCanvas.width || !deepCanvas.height) return;
  const generation = ++cpuRender.generation;
  cpuRender.running = true;
  cpuRender.dirty = false;
  cpuRender.complete = false;
  cpuRender.activeGeneration = generation;
  cpuRender.imageData = deepCtx.createImageData(deepCanvas.width, deepCanvas.height);
  cpuRender.pixels = cpuRender.imageData.data;
  cpuRender.passIndex = 0;
  cpuRender.blockIndex = 0;
  cpuRender.snapshot = makeCpuSnapshot();
  cpuRender.lastPaint = 0;
  cpuRender.useWorkers = ensureCpuWorkers();
  setupCpuPass();
  if (cpuRender.useWorkers) dispatchCpuWorkerBatches();
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
  const worldX = snap.x0 + sampleX * snap.scale;
  const worldY = snap.y1 - sampleY * snap.scale;
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

function dispatchCpuWorkerBatches() {
  if (!cpuRender.running || cpuRender.dirty || !state.cpuRefine) return;

  for (const entry of cpuRender.workers) {
    if (entry.busy || cpuRender.nextBatchBlock >= cpuRender.totalBlocks) continue;
    const startBlock = cpuRender.nextBatchBlock;
    const count = Math.min(CPU_WORKER_BATCH_BLOCKS, cpuRender.totalBlocks - startBlock);
    cpuRender.nextBatchBlock += count;
    cpuRender.pendingBatches++;
    entry.busy = true;
    entry.worker.postMessage({
      generation: cpuRender.activeGeneration,
      passIndex: cpuRender.passIndex,
      snapshot: cpuRender.snapshot,
      step: cpuRender.step,
      cols: cpuRender.cols,
      totalBlocks: cpuRender.totalBlocks,
      startBlock,
      count,
    });
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
  if (cpuRender.passIndex >= CPU_PASSES.length) {
    cpuRender.running = false;
    cpuRender.complete = true;
    return;
  }
  setupCpuPass();
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
      if (cpuRender.passIndex >= CPU_PASSES.length) {
        cpuRender.running = false;
        cpuRender.complete = true;
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
  if (!state.cpuRefine || !deepCtx || cpuRender.running || !cpuRender.dirty) return;
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
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / Math.max(rect.width, 1);
  const sy = canvas.height / Math.max(rect.height, 1);
  setCameraTarget(
    state.dragStartCX - (e.clientX - state.dragStartX) * sx * state.targetPixelScale,
    state.dragStartCY + (e.clientY - state.dragStartY) * sy * state.targetPixelScale,
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
  if (e.code === "KeyB") toggleColorMode();
  if (e.code === "KeyX") toggleRefine();
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
ui.btnReset.addEventListener("click",   () => { resetView(); saveSettings(); });
ui.btnShare.addEventListener("click",   share);
["iterations","colorCycle","juliaAngle"].forEach(id => {
  ui[id].addEventListener("input", () => {
    if (id !== "iterations") markMinimapDirty();
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

  const x0 = state.centerX - canvas.width  * 0.5 * state.pixelScale;
  const y0 = state.centerY - canvas.height * 0.5 * state.pixelScale;
  const [x0Hi, x0Mid, x0Lo] = tsSplit(x0);
  const [y0Hi, y0Mid, y0Lo] = tsSplit(y0);

  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(loc.pos);
  gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);

  gl.uniform2f(loc.res,    canvas.width, canvas.height);
  gl.uniform3f(loc.x0,    x0Hi, x0Mid, x0Lo);
  gl.uniform3f(loc.y0,    y0Hi, y0Mid, y0Lo);
  gl.uniform1f(loc.scale,  state.pixelScale);
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

requestAnimationFrame(render);
