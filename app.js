"use strict";

const canvas = document.getElementById("fractal");
const minimap = document.getElementById("minimap");
const gl = canvas.getContext("webgl", {
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
});
const miniCtx = minimap.getContext("2d");
const minimapBase = document.createElement("canvas");
const minimapBaseCtx = minimapBase.getContext("2d");

if (!gl) {
  document.body.innerHTML = '<main class="fallback">WebGL is not available in this browser.</main>';
  throw new Error("WebGL unavailable");
}

// ─── Shaders ──────────────────────────────────────────────────────────────────

const vertSrc = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const fragHeader = `
precision highp float;

uniform vec2  uRes;
uniform vec3  uX0;      // world X of left edge: triple-single (hi, mid, lo)
uniform vec3  uY0;      // world Y of bottom edge: triple-single (hi, mid, lo)
uniform float uScale;   // world units per pixel
uniform int   uIter;
uniform float uPalette;
uniform float uCycle;
uniform vec2  uJuliaC;

#define MAX_ITER 1024
#define PI  3.14159265359
#define TAU 6.28318530718

// Triple-single coordinate reconstruction (~72 bits of precision).
// Pushes pixelation to ~10^14x zoom.
float worldCoord(vec3 corner, float offset) {
  float ow = offset * uScale;
  float s0 = corner.x + ow;
  float e0 = ow - (s0 - corner.x);
  float s1 = corner.y + e0;
  float e1 = e0 - (s1 - corner.y);
  float s2 = corner.z + e1;
  float r1 = s0 + s1;
  float r2 = s1 - (r1 - s0);
  float r3 = r2 + s2;
  return r1 + r3;
}

vec3 cospalette(float t, vec3 d) {
  vec3 a = vec3(0.5), b = vec3(0.5), c = vec3(1.0);
  return a + b * cos(TAU * (c * t + d));
}

vec3 colorize(float iter, float maxIter, vec2 z) {
  if (iter >= maxIter) return vec3(0.0);
  float sm = iter - log2(max(1.0, log2(dot(z, z)))) + 4.0;
  float t = fract(sm / maxIter + uCycle);
  vec3 d;
  int p = int(uPalette);
  if      (p == 0) d = vec3(0.00, 0.18, 0.36);
  else if (p == 1) d = vec3(0.46, 0.08, 0.02);
  else if (p == 2) d = vec3(0.04, 0.30, 0.22);
  else if (p == 3) d = vec3(0.28, 0.02, 0.38);
  else             d = vec3(0.38, 0.28, 0.04);
  return cospalette(t, d);
}
`;

// ── Mandelbrot ────────────────────────────────────────────────────────────────
const mandelbrotFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// ── Julia set ─────────────────────────────────────────────────────────────────
const juliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// ── Burning Ship ──────────────────────────────────────────────────────────────
const burningShipFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(abs(z.x), abs(z.y));
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// ── Tricorn (Mandelbar) ───────────────────────────────────────────────────────
const tricornFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, -2.0*z.x*z.y) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Cubic Multibrot ----------------------------------------------------------
const cubicMultibrotFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    z = vec2(z.x * (x2 - 3.0 * y2), z.y * (3.0 * x2 - y2)) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Quartic Multibrot --------------------------------------------------------
const quarticMultibrotFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    z = vec2(z2.x*z2.x - z2.y*z2.y, 2.0*z2.x*z2.y) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Celtic Mandelbrot --------------------------------------------------------
const celticFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(abs(z.x*z.x - z.y*z.y), 2.0*z.x*z.y) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Buffalo ------------------------------------------------------------------
const buffaloFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(abs(z.x*z.x - z.y*z.y), -abs(2.0*z.x*z.y)) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Phoenix Julia ------------------------------------------------------------
const phoenixFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = vec2(-0.5, 0.0) + 0.32 * uJuliaC;
  vec2 p = vec2(-0.45, 0.0);
  vec2 prev = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 next = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c + p * prev;
    prev = z;
    z = next;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// ─── Fractals registry ────────────────────────────────────────────────────────

const FRACTALS = [
  { name: "Mandelbrot Set",      src: mandelbrotFrag,       center: [-0.5, 0.0], scale: 3.5, julia: false },
  { name: "Julia Set",           src: juliaFrag,            center: [0.0,  0.0], scale: 3.5, julia: true  },
  { name: "Burning Ship",        src: burningShipFrag,      center: [-0.5,-0.5], scale: 3.5, julia: false },
  { name: "Tricorn (Mandelbar)", src: tricornFrag,          center: [0.0,  0.0], scale: 3.5, julia: false },
  { name: "Cubic Multibrot",     src: cubicMultibrotFrag,   center: [0.0,  0.0], scale: 3.0, julia: false },
  { name: "Quartic Multibrot",   src: quarticMultibrotFrag, center: [0.0,  0.0], scale: 3.0, julia: false },
  { name: "Celtic Mandelbrot",   src: celticFrag,           center: [-0.2, 0.0], scale: 3.2, julia: false },
  { name: "Buffalo",             src: buffaloFrag,          center: [-0.2, 0.0], scale: 3.2, julia: false },
  { name: "Phoenix Julia",       src: phoenixFrag,          center: [0.0,  0.0], scale: 3.2, julia: true  },
];

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

const programs = FRACTALS.map(f => {
  const prog = buildProgram(f.src);
  return {
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
    },
  };
});

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
  iterations:  document.getElementById("iterations"),
  colorCycle:  document.getElementById("colorCycle"),
  juliaRow:    document.getElementById("juliaRow"),
  juliaAngle:  document.getElementById("juliaAngle"),
  btnFractal:  document.getElementById("btnFractal"),
  btnPalette:  document.getElementById("btnPalette"),
  btnReset:    document.getElementById("btnReset"),
  btnShare:    document.getElementById("btnShare"),
};

// ─── State ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "fractal2d_v1";
const MIN_ITER = 32;
const MAX_ITER = 1024;
const DEFAULT_ITER = 256;
const CAMERA_EASE = 12;
const MINIMAP_ITER = 56;

const state = {
  fractalIdx: 0,
  palette: 0,
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
};

const activePointers = new Map();
const gesture = {
  pinchStartDist: 0,
  pinchStartScale: 0,
  pinchAnchorX: 0,
  pinchAnchorY: 0,
};

let minimapDirty = true;

function resetView(idx) {
  const f = FRACTALS[idx ?? state.fractalIdx];
  setCameraTarget(f.center[0], f.center[1], f.scale / Math.max(canvas.width || 800, 1), true);
}

function setCameraTarget(cx, cy, pixelScale, immediate = false) {
  const fallback = FRACTALS[state.fractalIdx].scale / Math.max(canvas.width || 800, 1);
  state.targetCenterX = Number.isFinite(cx) ? cx : FRACTALS[state.fractalIdx].center[0];
  state.targetCenterY = Number.isFinite(cy) ? cy : FRACTALS[state.fractalIdx].center[1];
  state.targetPixelScale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : fallback;
  if (immediate) {
    state.centerX = state.targetCenterX;
    state.centerY = state.targetCenterY;
    state.pixelScale = state.targetPixelScale;
  }
}

function syncTargetToCurrent() {
  setCameraTarget(state.centerX, state.centerY, state.pixelScale, true);
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
  if (Math.abs(state.targetCenterX - state.centerX) < viewWidth * 1e-7 &&
      Math.abs(state.targetCenterY - state.centerY) < viewWidth * 1e-7 &&
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
      iterations: ui.iterations.value,
      colorCycle: ui.colorCycle.value,
      juliaAngle: ui.juliaAngle.value,
    }));
  } catch { /* quota */ }
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (s.fractalIdx !== undefined) state.fractalIdx = Math.max(0, Math.min(parseInt(s.fractalIdx, 10) || 0, FRACTALS.length - 1));
    if (s.palette    !== undefined) state.palette    = Math.max(0, Math.min(parseInt(s.palette, 10) || 0, 4));
    if (s.iterations) ui.iterations.value = Math.max(MIN_ITER, Math.min(parseInt(s.iterations, 10) || DEFAULT_ITER, MAX_ITER));
    if (s.colorCycle) ui.colorCycle.value = s.colorCycle;
    if (s.juliaAngle) ui.juliaAngle.value = s.juliaAngle;
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
  return new URLSearchParams({
    f:  state.fractalIdx,
    pa: state.palette,
    cx: state.targetCenterX.toFixed(15),
    cy: state.targetCenterY.toFixed(15),
    ps: state.targetPixelScale.toExponential(6),
    it: ui.iterations.value,
    cc: ui.colorCycle.value,
    ja: ui.juliaAngle.value,
  }).toString();
}

function loadFromParams() {
  const p = new URLSearchParams(window.location.search);
  if (p.has("f"))  state.fractalIdx = Math.max(0, Math.min(parseInt(p.get("f"), 10) || 0, FRACTALS.length - 1));
  if (p.has("pa")) state.palette    = Math.max(0, Math.min(parseInt(p.get("pa"), 10) || 0, 4));
  if (p.has("cx")) state.centerX    = parseFloat(p.get("cx")) || 0;
  if (p.has("cy")) state.centerY    = parseFloat(p.get("cy")) || 0;
  if (p.has("ps")) state.pixelScale = parseFloat(p.get("ps")) || 0;
  if (p.has("it")) ui.iterations.value = Math.max(MIN_ITER, Math.min(parseInt(p.get("it"), 10) || DEFAULT_ITER, MAX_ITER));
  if (p.has("cc")) ui.colorCycle.value = p.get("cc");
  if (p.has("ja")) ui.juliaAngle.value = p.get("ja");
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
}

// ─── Julia C ──────────────────────────────────────────────────────────────────

function juliaC() {
  const a = parseFloat(ui.juliaAngle.value);
  return [0.7885 * Math.cos(a), 0.7885 * Math.sin(a)];
}

// ─── Sync UI ──────────────────────────────────────────────────────────────────

function updateUI() {
  const f = FRACTALS[state.fractalIdx];
  ui.fractalName.textContent = f.name;
  ui.juliaRow.style.display  = f.julia ? "" : "none";
  ui.iterReadout.textContent = getRenderIterations();
  const zoom = FRACTALS[state.fractalIdx].scale / (state.pixelScale * Math.max(canvas.width, 1));
  ui.zoomReadout.textContent = zoom >= 1e6
    ? (zoom / 1e6).toFixed(2) + "M×"
    : zoom >= 1000
    ? (zoom / 1000).toFixed(1) + "k×"
    : zoom.toFixed(zoom < 10 ? 2 : 0) + "×";
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

function previewEscape(fractalIdx, x, y) {
  const jc = juliaC();
  let zx = 0, zy = 0, cx = x, cy = y, px = 0, py = 0;

  if (fractalIdx === 1) {
    zx = x; zy = y; cx = jc[0]; cy = jc[1];
  } else if (fractalIdx === 8) {
    zx = x; zy = y; cx = -0.5 + 0.32 * jc[0]; cy = 0.32 * jc[1];
  }

  for (let n = 0; n < MINIMAP_ITER; n++) {
    let nx, ny;
    const x2 = zx * zx;
    const y2 = zy * zy;
    const xy = zx * zy;

    if (fractalIdx === 2) {
      const ax = Math.abs(zx), ay = Math.abs(zy);
      nx = ax * ax - ay * ay + cx;
      ny = 2 * ax * ay + cy;
    } else if (fractalIdx === 3) {
      nx = x2 - y2 + cx;
      ny = -2 * xy + cy;
    } else if (fractalIdx === 4) {
      nx = zx * (x2 - 3 * y2) + cx;
      ny = zy * (3 * x2 - y2) + cy;
    } else if (fractalIdx === 5) {
      const qx = x2 - y2;
      const qy = 2 * xy;
      nx = qx * qx - qy * qy + cx;
      ny = 2 * qx * qy + cy;
    } else if (fractalIdx === 6) {
      nx = Math.abs(x2 - y2) + cx;
      ny = 2 * xy + cy;
    } else if (fractalIdx === 7) {
      nx = Math.abs(x2 - y2) + cx;
      ny = -Math.abs(2 * xy) + cy;
    } else if (fractalIdx === 8) {
      nx = x2 - y2 + cx - 0.45 * px;
      ny = 2 * xy + cy;
      px = zx; py = zy;
    } else {
      nx = x2 - y2 + cx;
      ny = 2 * xy + cy;
    }

    zx = nx; zy = ny;
    if (zx * zx + zy * zy > 256) return n;
  }
  return MINIMAP_ITER;
}

function renderMinimapBackground() {
  if (!resizeMinimap()) return;
  const w = minimapBase.width;
  const h = minimapBase.height;
  const image = minimapBaseCtx.createImageData(w, h);
  const f = FRACTALS[state.fractalIdx];
  const scale = f.scale;
  const left = f.center[0] - scale * 0.5;
  const top = f.center[1] + scale * 0.5;

  for (let py = 0; py < h; py++) {
    const y = top - (py / Math.max(h - 1, 1)) * scale;
    for (let px = 0; px < w; px++) {
      const x = left + (px / Math.max(w - 1, 1)) * scale;
      const iter = previewEscape(state.fractalIdx, x, y);
      const offset = (py * w + px) * 4;
      if (iter >= MINIMAP_ITER) {
        image.data[offset] = 2;
        image.data[offset + 1] = 5;
        image.data[offset + 2] = 7;
      } else {
        const t = iter / MINIMAP_ITER + parseFloat(ui.colorCycle.value) * 0.08;
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
  const f = FRACTALS[state.fractalIdx];
  const scale = f.scale;
  return {
    x: ((x - (f.center[0] - scale * 0.5)) / scale) * minimap.width,
    y: (((f.center[1] + scale * 0.5) - y) / scale) * minimap.height,
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

function switchFractal() {
  saveViewForCurrentFractal();
  state.fractalIdx = (state.fractalIdx + 1) % FRACTALS.length;
  restoreViewForFractal(state.fractalIdx);
  saveSettings();
}

function share() {
  const url = location.origin + location.pathname + "?" + stateToParams();
  navigator.clipboard.writeText(url).then(() => {
    ui.btnShare.textContent = "Copied!";
    setTimeout(() => { ui.btnShare.textContent = "Share"; }, 1800);
  }).catch(() => window.prompt("Copy link:", url));
}

canvas.addEventListener("pointerdown", e => {
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
  if (e.code === "KeyF") switchFractal();
  if (e.code === "KeyP") { state.palette = (state.palette + 1) % 5; markMinimapDirty(); saveSettings(); }
  if (e.code === "KeyR") { resetView(); saveSettings(); }
  if (e.code === "KeyC") share();
});
window.addEventListener("keyup", e => { keys[e.code] = false; });

ui.btnFractal.addEventListener("click", switchFractal);
ui.btnPalette.addEventListener("click", () => { state.palette = (state.palette + 1) % 5; markMinimapDirty(); saveSettings(); });
ui.btnReset.addEventListener("click",   () => { resetView(); saveSettings(); });
ui.btnShare.addEventListener("click",   share);
["iterations","colorCycle","juliaAngle"].forEach(id => {
  ui[id].addEventListener("input", () => {
    if (id !== "iterations") markMinimapDirty();
    saveSettings();
  });
});
window.addEventListener("resize", resize);

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

  const { prog, loc } = programs[state.fractalIdx];
  const jc = juliaC();

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

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  drawMinimap();
  requestAnimationFrame(render);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

resize();
resetView(0);
loadSettings();
loadFromParams();
if (!state.pixelScale) resetView();

requestAnimationFrame(render);
