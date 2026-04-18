"use strict";

const canvas = document.getElementById("fractal");
const gl = canvas.getContext("webgl", {
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
});

if (!gl) {
  document.body.innerHTML = '<main class="fallback">WebGL is not available in this browser.</main>';
  throw new Error("WebGL unavailable");
}

// ─── Shaders ──────────────────────────────────────────────────────────────────

const vertSrc = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Shared fragment prefix — fractal-specific bodies are appended below.
//
// Double-single (DS) emulation gives ~48 bits of mantissa vs the 23 bits in
// a plain highp float, deferring pixelation until ~10^13× zoom instead of ~10^6×.
// Each DS number is a pair (hi, lo) where the true value = hi + lo and |lo| < ulp(hi)/2.
// Arithmetic follows Dekker/Veltkamp two-sum and two-product algorithms.
const fragHeader = `
precision highp float;

uniform vec2  uRes;
// Top-left world coordinate split into f32 hi+lo pairs (computed in JS float64).
// Pixel (fx, fy) maps to world (uX0.x + uX0.y + fx*uScale, uY0.x + uY0.y + fy*uScale).
uniform vec2  uX0;      // world X of left edge: (hi, lo)
uniform vec2  uY0;      // world Y of bottom edge: (hi, lo) — GL Y is bottom-up
uniform float uScale;   // world units per pixel
uniform int   uIter;
uniform float uPalette;
uniform float uCycle;
uniform vec2  uJuliaC;

#define PI  3.14159265359
#define TAU 6.28318530718

// ── Coordinate reconstruction ─────────────────────────────────────────────────
// Compute world coordinate for a pixel offset from the corner.
// offset (fragCoord component, 0-based from left/bottom) is a small integer-valued
// float, so offset*uScale is exact to f32 precision.
// We then add the DS corner using two-sum to preserve the lo bits.
float worldCoord(vec2 corner, float offset) {
  float offset_world = offset * uScale;       // exact: small int * small float
  float s  = corner.x + offset_world;
  float bb = s - corner.x;
  float lo = (corner.x - (s - bb)) + (offset_world - bb) + corner.y;
  return s + lo;
}

// ── Color ─────────────────────────────────────────────────────────────────────
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
  for (int n = 0; n < 512; n++) {
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
  for (int n = 0; n < 512; n++) {
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
  for (int n = 0; n < 512; n++) {
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
  for (int n = 0; n < 512; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, -2.0*z.x*z.y) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// ─── Fractals registry ────────────────────────────────────────────────────────

const FRACTALS = [
  { name: "Mandelbrot Set",     src: mandelbrotFrag,  center: [-0.5, 0.0], scale: 3.5,  julia: false },
  { name: "Julia Set",          src: juliaFrag,       center: [0.0, 0.0],  scale: 3.5,  julia: true  },
  { name: "Burning Ship",       src: burningShipFrag, center: [-0.5,-0.5], scale: 3.5,  julia: false },
  { name: "Tricorn (Mandelbar)",src: tricornFrag,     center: [0.0, 0.0],  scale: 3.5,  julia: false },
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

// Pre-compile all programs
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

const state = {
  fractalIdx: 0,
  palette: 0,
  // view
  centerX: FRACTALS[0].center[0],
  centerY: FRACTALS[0].center[1],
  pixelScale: 0,  // set by resetView()
  // drag
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragStartCX: 0,
  dragStartCY: 0,
  // fps
  fpsFrames: 0,
  fpsTime: performance.now(),
  lastTime: performance.now(),
};

function resetView(idx) {
  const f = FRACTALS[idx ?? state.fractalIdx];
  state.centerX = f.center[0];
  state.centerY = f.center[1];
  // scale so the default viewport width covers f.scale world units
  state.pixelScale = f.scale / Math.max(canvas.width || 800, 1);
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function saveSettings() {
  try {
    // Save view per-fractal so switching doesn't inherit another fractal's zoom.
    const views = JSON.parse(localStorage.getItem(STORAGE_KEY + "_views") || "{}");
    views[state.fractalIdx] = { cx: state.centerX, cy: state.centerY, ps: state.pixelScale };
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
    if (s.fractalIdx !== undefined) state.fractalIdx = s.fractalIdx;
    if (s.palette    !== undefined) state.palette    = s.palette;
    if (s.iterations) ui.iterations.value = s.iterations;
    if (s.colorCycle) ui.colorCycle.value = s.colorCycle;
    if (s.juliaAngle) ui.juliaAngle.value = s.juliaAngle;
    // Restore per-fractal view if available
    const views = JSON.parse(localStorage.getItem(STORAGE_KEY + "_views") || "{}");
    const v = views[state.fractalIdx];
    if (v) { state.centerX = v.cx; state.centerY = v.cy; state.pixelScale = v.ps; }
  } catch { /* ignore */ }
}

function saveViewForCurrentFractal() {
  try {
    const views = JSON.parse(localStorage.getItem(STORAGE_KEY + "_views") || "{}");
    views[state.fractalIdx] = { cx: state.centerX, cy: state.centerY, ps: state.pixelScale };
    localStorage.setItem(STORAGE_KEY + "_views", JSON.stringify(views));
  } catch { /* quota */ }
}

function restoreViewForFractal(idx) {
  resetView(idx);  // start from default
  try {
    const views = JSON.parse(localStorage.getItem(STORAGE_KEY + "_views") || "{}");
    const v = views[idx];
    if (v) { state.centerX = v.cx; state.centerY = v.cy; state.pixelScale = v.ps; }
  } catch { /* ignore */ }
}

// ─── URL share ────────────────────────────────────────────────────────────────

function stateToParams() {
  return new URLSearchParams({
    f:  state.fractalIdx,
    pa: state.palette,
    cx: state.centerX.toFixed(10),
    cy: state.centerY.toFixed(10),
    ps: state.pixelScale.toExponential(6),
    it: ui.iterations.value,
    cc: ui.colorCycle.value,
    ja: ui.juliaAngle.value,
  }).toString();
}

function loadFromParams() {
  const p = new URLSearchParams(window.location.search);
  if (p.has("f"))  state.fractalIdx = Math.min(parseInt(p.get("f"), 10) || 0, FRACTALS.length - 1);
  if (p.has("pa")) state.palette    = parseInt(p.get("pa"), 10) || 0;
  if (p.has("cx")) state.centerX    = parseFloat(p.get("cx")) || 0;
  if (p.has("cy")) state.centerY    = parseFloat(p.get("cy")) || 0;
  if (p.has("ps")) state.pixelScale = parseFloat(p.get("ps")) || 0;
  if (p.has("it")) ui.iterations.value = p.get("it");
  if (p.has("cc")) ui.colorCycle.value = p.get("cc");
  if (p.has("ja")) ui.juliaAngle.value = p.get("ja");
}

// ─── Resize ───────────────────────────────────────────────────────────────────

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(canvas.clientWidth  * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    if (!state.pixelScale) resetView();
  }
}

// ─── Julia C from angle on cardioid-ish circle ────────────────────────────────

function juliaC() {
  const a = parseFloat(ui.juliaAngle.value);
  // A classic circle of interesting Julia parameters
  return [0.7885 * Math.cos(a), 0.7885 * Math.sin(a)];
}

// ─── Sync UI text ─────────────────────────────────────────────────────────────

function updateUI() {
  const f = FRACTALS[state.fractalIdx];
  ui.fractalName.textContent = f.name;
  ui.juliaRow.style.display  = f.julia ? "" : "none";
  ui.iterReadout.textContent = ui.iterations.value;
  const zoom = (FRACTALS[state.fractalIdx].scale / (state.pixelScale * Math.max(canvas.width, 1)));
  ui.zoomReadout.textContent = zoom >= 1000
    ? (zoom / 1000).toFixed(1) + "k×"
    : zoom.toFixed(zoom < 10 ? 2 : 0) + "×";
}

// ─── Input handlers ───────────────────────────────────────────────────────────

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

// Pointer pan
canvas.addEventListener("pointerdown", e => {
  state.dragging = true;
  state.dragStartX  = e.clientX;
  state.dragStartY  = e.clientY;
  state.dragStartCX = state.centerX;
  state.dragStartCY = state.centerY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", e => {
  if (!state.dragging) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const dx = (e.clientX - state.dragStartX) * dpr;
  const dy = (e.clientY - state.dragStartY) * dpr;
  state.centerX = state.dragStartCX - dx * state.pixelScale;
  state.centerY = state.dragStartCY + dy * state.pixelScale;  // +Y = up in GL
});
canvas.addEventListener("pointerup", e => {
  state.dragging = false;
  canvas.releasePointerCapture(e.pointerId);
  saveSettings();
});

// Scroll zoom — zoom toward cursor
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const dpr    = Math.min(window.devicePixelRatio || 1, 2);
  const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
  // cursor in world coords before zoom
  const cx = (e.offsetX * dpr - canvas.width  * 0.5) * state.pixelScale + state.centerX;
  const cy = (canvas.height * 0.5 - e.offsetY * dpr) * state.pixelScale + state.centerY;
  state.pixelScale *= factor;
  // shift center so the point under cursor stays fixed
  state.centerX = cx - (e.offsetX * dpr - canvas.width  * 0.5) * state.pixelScale;
  state.centerY = cy - (canvas.height * 0.5 - e.offsetY * dpr) * state.pixelScale;
  saveSettings();
}, { passive: false });

// Keyboard
const keys = {};
window.addEventListener("keydown", e => {
  keys[e.code] = true;
  if (e.code === "KeyF") switchFractal();
  if (e.code === "KeyP") { state.palette = (state.palette + 1) % 5; saveSettings(); }
  if (e.code === "KeyR") { resetView(); saveSettings(); }
  if (e.code === "KeyC") share();
});
window.addEventListener("keyup", e => { keys[e.code] = false; });

// Touch pinch-to-zoom
let lastPinchDist = 0;
canvas.addEventListener("touchstart", e => {
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    lastPinchDist = Math.sqrt(dx*dx + dy*dy);
  }
}, { passive: true });
canvas.addEventListener("touchmove", e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const dx   = e.touches[0].clientX - e.touches[1].clientX;
    const dy   = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const factor = lastPinchDist / dist;
    state.pixelScale *= factor;
    lastPinchDist = dist;
  }
}, { passive: false });

ui.btnFractal.addEventListener("click", switchFractal);
ui.btnPalette.addEventListener("click", () => { state.palette = (state.palette + 1) % 5; saveSettings(); });
ui.btnReset.addEventListener("click",   () => { resetView(); saveSettings(); });
ui.btnShare.addEventListener("click",   share);
["iterations","colorCycle","juliaAngle"].forEach(id => {
  ui[id].addEventListener("input", saveSettings);
});
window.addEventListener("resize", resize);

// ─── Keyboard pan/zoom ────────────────────────────────────────────────────────

function applyKeyboard(dt) {
  const panSpeed  = state.pixelScale * canvas.width * dt * 0.6;
  const zoomSpeed = Math.pow(2, dt * 1.5);

  if (keys["ArrowLeft"]  || keys["KeyA"]) state.centerX -= panSpeed;
  if (keys["ArrowRight"] || keys["KeyD"]) state.centerX += panSpeed;
  if (keys["ArrowUp"]    || keys["KeyW"]) state.centerY += panSpeed;
  if (keys["ArrowDown"]  || keys["KeyS"]) state.centerY -= panSpeed;
  if (keys["Equal"] || keys["NumpadAdd"])      state.pixelScale /= zoomSpeed;
  if (keys["Minus"] || keys["NumpadSubtract"]) state.pixelScale *= zoomSpeed;
}

// ─── Double-single split ─────────────────────────────────────────────────────
// Split a JS double into (hi, lo) such that hi + lo === value exactly (in f32).
// Uses the Veltkamp split: multiply by 2^12+1 to isolate the high 12 bits.
function dsSplit(x) {
  // Split JS double x into two float32s (hi, lo) where hi + lo ≈ x.
  // We simply cast x to f32 for hi, then store the residual in lo.
  // This gives ~24 bits in hi and up to ~24 more bits in lo.
  const hi = Math.fround(x);
  const lo = Math.fround(x - hi);
  return [hi, lo];
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(now) {
  resize();
  const dt = Math.min(0.05, (now - state.lastTime) * 0.001);
  state.lastTime = now;

  applyKeyboard(dt);

  // FPS counter
  state.fpsFrames++;
  if (now - state.fpsTime > 500) {
    ui.fpsReadout.textContent = String(Math.round(state.fpsFrames * 1000 / (now - state.fpsTime)));
    state.fpsFrames = 0;
    state.fpsTime   = now;
  }

  updateUI();

  const { prog, loc } = programs[state.fractalIdx];
  const jc = juliaC();
  // Compute world coordinate at fragCoord = 0 (left/bottom edge extrapolation).
  // worldCoord(fx) = x0 + fx * scale, so x0 = centerX - width/2 * scale.
  // The shader receives gl_FragCoord which starts at 0.5, but we bake 0-origin here.
  const x0 = state.centerX - canvas.width  * 0.5 * state.pixelScale;
  const y0 = state.centerY - canvas.height * 0.5 * state.pixelScale;
  const [x0Hi, x0Lo] = dsSplit(x0);
  const [y0Hi, y0Lo] = dsSplit(y0);

  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(loc.pos);
  gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);

  gl.uniform2f(loc.res,    canvas.width, canvas.height);
  gl.uniform2f(loc.x0,     x0Hi, x0Lo);
  gl.uniform2f(loc.y0,     y0Hi, y0Lo);
  gl.uniform1f(loc.scale,  state.pixelScale);
  gl.uniform1i(loc.iter,   parseInt(ui.iterations.value, 10));
  gl.uniform1f(loc.palette, state.palette);
  gl.uniform1f(loc.cycle,  parseFloat(ui.colorCycle.value));
  gl.uniform2f(loc.juliaC, jc[0], jc[1]);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  requestAnimationFrame(render);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

resize();
resetView(0);
loadSettings();
loadFromParams();
if (!state.pixelScale) resetView();

requestAnimationFrame(render);
