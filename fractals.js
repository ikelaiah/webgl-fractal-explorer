"use strict";

// Shader and fractal catalog definitions. app.js consumes the globals exported
// from this file: vertSrc, FRACTALS, and FORMULA_META.
//
// When adding a new formula, keep three layers aligned:
// 1. A GLSL fragment shader for the interactive WebGL render.
// 2. A FRACTALS registry entry for UI, camera defaults, and presets.
// 3. CPU behavior metadata/implementation in app.js for minimap/refinement.

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
uniform int   uColorMode;
uniform int   uColorStyle;

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

vec3 tonePrimary(int p) {
  if      (p == 0) return vec3(0.08, 0.82, 1.00);
  else if (p == 1) return vec3(1.00, 0.54, 0.18);
  else if (p == 2) return vec3(0.35, 0.95, 0.58);
  else if (p == 3) return vec3(0.82, 0.46, 1.00);
  else             return vec3(0.96, 0.86, 0.24);
}

vec3 toneSecondary(int p) {
  if      (p == 0) return vec3(0.54, 0.13, 1.00);
  else if (p == 1) return vec3(0.98, 0.18, 0.40);
  else if (p == 2) return vec3(0.02, 0.56, 0.98);
  else if (p == 3) return vec3(0.08, 0.64, 1.00);
  else             return vec3(0.98, 0.34, 0.16);
}

vec3 tonePalette(float t) {
  float v = smoothstep(0.08, 1.0, clamp(t, 0.0, 1.0));
  float energy = pow(v, 1.35);
  int p = int(uPalette);
  vec3 dark = vec3(0.0, 0.006, 0.020);
  vec3 a = tonePrimary(p);
  if (uColorStyle == 1) {
    return mix(dark, a, energy) * (0.22 + 0.78 * v);
  }
  vec3 b = toneSecondary(p);
  vec3 ramp = mix(b, a, smoothstep(0.34, 0.96, v));
  vec3 glow = ramp * smoothstep(0.70, 1.0, v) * 0.45;
  return clamp(mix(dark, ramp, energy) + glow, 0.0, 1.0);
}

vec3 cospalette(float t, vec3 d) {
  if (uColorStyle == 1 || uColorStyle == 2) return tonePalette(t);
  vec3 a = vec3(0.5), b = vec3(0.5), c = vec3(1.0);
  return a + b * cos(TAU * (c * t + d));
}

vec3 interiorColor() {
  if (uColorStyle == 1 || uColorStyle == 2) return vec3(0.0, 0.008, 0.026);
  return vec3(0.0);
}

vec3 colorize(float iter, float maxIter, vec2 z) {
  // Escape-time fractals share this smooth coloring path. Basin and orbit-trap
  // shaders can override it when their formula needs a different visual model.
  if (iter >= maxIter) return interiorColor();
  float sm = iter - log2(max(1.0, log2(dot(z, z)))) + 4.0;
  vec3 d;
  int p = int(uPalette);
  if      (p == 0) d = vec3(0.00, 0.18, 0.36);
  else if (p == 1) d = vec3(0.46, 0.08, 0.02);
  else if (p == 2) d = vec3(0.04, 0.30, 0.22);
  else if (p == 3) d = vec3(0.28, 0.02, 0.38);
  else             d = vec3(0.38, 0.28, 0.04);
  float raw = sm / maxIter;
  float t = (uColorStyle == 1 || uColorStyle == 2) ? raw + uCycle * 0.08 : fract(raw + uCycle);
  return cospalette(t, d);
}

vec2 cdiv(vec2 a, vec2 b) {
  // Complex division helper used by rational/Newton-style formulas. The small
  // denominator guard avoids NaNs that would otherwise poison a whole pixel.
  float d = max(dot(b, b), 1e-8);
  return vec2(a.x*b.x + a.y*b.y, a.y*b.x - a.x*b.y) / d;
}

float cubicRootId(vec2 z) {
  vec2 r0 = vec2(1.0, 0.0);
  vec2 r1 = vec2(-0.5, 0.86602540378);
  vec2 r2 = vec2(-0.5, -0.86602540378);
  float d0 = dot(z - r0, z - r0);
  float d1 = dot(z - r1, z - r1);
  float d2 = dot(z - r2, z - r2);
  if (d0 <= d1 && d0 <= d2) return 0.0;
  if (d1 <= d2) return 1.0;
  return 2.0;
}

float quarticRootId(vec2 z) {
  vec2 r0 = vec2(1.0, 0.0);
  vec2 r1 = vec2(0.0, 1.0);
  vec2 r2 = vec2(-1.0, 0.0);
  vec2 r3 = vec2(0.0, -1.0);
  float d0 = dot(z - r0, z - r0);
  float d1 = dot(z - r1, z - r1);
  float d2 = dot(z - r2, z - r2);
  float d3 = dot(z - r3, z - r3);
  float m = min(min(d0, d1), min(d2, d3));
  if (m == d0) return 0.0;
  if (m == d1) return 1.0;
  if (m == d2) return 2.0;
  return 3.0;
}

vec3 basinColor(float root, float iter, float maxIter) {
  // Basin shaders color by the root each point converges to, with iteration
  // count used only as shading/ring detail.
  vec3 base;
  if      (root < 0.5) base = vec3(0.96, 0.34, 0.22);
  else if (root < 1.5) base = vec3(0.18, 0.72, 1.00);
  else if (root < 2.5) base = vec3(0.78, 0.92, 0.28);
  else if (root < 3.5) base = vec3(0.76, 0.43, 1.00);
  else                 base = vec3(0.98, 0.80, 0.18);
  float shade = 0.28 + 0.72 * pow(1.0 - clamp(iter / maxIter, 0.0, 1.0), 0.7);
  float ring = 0.86 + 0.14 * cos(TAU * (iter * 0.08 + uCycle));
  return base * shade * ring;
}
`;

// ── Formula Composer ---------------------------------------------------------
//
// The composer is deliberately whitelist-based: the UI stores operation IDs,
// and this builder expands those IDs into known-safe GLSL snippets. That keeps
// the feature expressive without accepting arbitrary shader text.
const COMPOSER_DEFAULT = Object.freeze({
  mode: "mandelbrot",
  ops: ["squareAddC", "absFold", "squareAddC", "empty"],
});

const COMPOSER_OPERATION_DEFS = Object.freeze([
  { id: "empty", label: "No-op", formula: "" },
  { id: "squareAddC", label: "z^2 + c", formula: "z = z^2 + c" },
  { id: "cubeAddC", label: "z^3 + c", formula: "z = z^3 + c" },
  { id: "absFold", label: "abs(real/imag)", formula: "z = |Re(z)| + i|Im(z)|" },
  { id: "conjugate", label: "Conjugate", formula: "z = conjugate(z)" },
  { id: "sinAddC", label: "sin(z) + c", formula: "z = sin(z) + c" },
  { id: "cosAddC", label: "cos(z) + c", formula: "z = cos(z) + c" },
  { id: "expAddC", label: "exp(z) + c", formula: "z = exp(z) + c" },
  { id: "rationalLace", label: "Rational divide", formula: "z = z^2 + c/(1 + 0.35z^2)" },
  { id: "boxFold", label: "Box fold", formula: "z = boxFold(z) + c" },
  { id: "newtonCubic", label: "Newton update", formula: "z = z - (z^3 - 1)/(3z^2) + 0.18c" },
]);

const COMPOSER_OP_IDS = new Set(COMPOSER_OPERATION_DEFS.map(op => op.id));

function normalizeComposerConfig(config) {
  const source = config && typeof config === "object" ? config : {};
  const mode = source.mode === "julia" ? "julia" : "mandelbrot";
  const ops = Array.isArray(source.ops) ? source.ops : COMPOSER_DEFAULT.ops;
  const normalizedOps = ops
    .slice(0, 4)
    .map(op => COMPOSER_OP_IDS.has(op) ? op : "empty");
  while (normalizedOps.length < 4) normalizedOps.push("empty");
  if (!normalizedOps.some(op => op !== "empty")) normalizedOps[0] = "squareAddC";
  return { mode, ops: normalizedOps };
}

function composerOperationCode(id) {
  if (id === "squareAddC") {
    return "z = csqr(z) + c;";
  }
  if (id === "cubeAddC") {
    return "z = cmul(csqr(z), z) + c;";
  }
  if (id === "absFold") {
    return "z = vec2(abs(z.x), abs(z.y));";
  }
  if (id === "conjugate") {
    return "z = vec2(z.x, -z.y);";
  }
  if (id === "sinAddC") {
    return `
      float sy = clamp(z.y, -8.0, 8.0);
      float ey = exp(sy);
      float eny = exp(-sy);
      float ch = 0.5 * (ey + eny);
      float sh = 0.5 * (ey - eny);
      z = vec2(sin(z.x) * ch, cos(z.x) * sh) + c;
    `;
  }
  if (id === "cosAddC") {
    return `
      float cy = clamp(z.y, -8.0, 8.0);
      float ey = exp(cy);
      float eny = exp(-cy);
      float ch = 0.5 * (ey + eny);
      float sh = 0.5 * (ey - eny);
      z = vec2(cos(z.x) * ch, -sin(z.x) * sh) + c;
    `;
  }
  if (id === "expAddC") {
    return `
      float ex = exp(clamp(z.x, -8.0, 8.0));
      float ey = clamp(z.y, -8.0, 8.0);
      z = vec2(ex * cos(ey), ex * sin(ey)) + c;
    `;
  }
  if (id === "rationalLace") {
    return `
      vec2 z2 = csqr(z);
      z = z2 + cdiv(c, vec2(1.0, 0.0) + 0.35 * z2);
    `;
  }
  if (id === "boxFold") {
    return `
      vec2 b = clamp(z, vec2(-1.0), vec2(1.0)) * 2.0 - z;
      float r2 = dot(b, b);
      if (r2 < 0.25) {
        b *= 4.0;
      } else if (r2 < 1.0) {
        b /= r2;
      }
      z = 2.0 * b + c;
    `;
  }
  if (id === "newtonCubic") {
    return `
      vec2 z2 = csqr(z);
      vec2 z3 = cmul(z2, z);
      z = z - cdiv(z3 - vec2(1.0, 0.0), 3.0 * z2) + 0.18 * c;
    `;
  }
  return "";
}

function buildComposerFormulaText(config) {
  const normalized = normalizeComposerConfig(config);
  const modeLabel = normalized.mode === "julia" ? "Julia start" : "Mandelbrot start";
  const parts = normalized.ops
    .map(id => COMPOSER_OPERATION_DEFS.find(op => op.id === id))
    .filter(op => op && op.id !== "empty")
    .map(op => op.formula);
  return `${modeLabel}: ${parts.join(" -> ") || "z = z^2 + c"}`;
}

function buildComposerFractalSource(config) {
  const normalized = normalizeComposerConfig(config);
  const opCode = normalized.ops
    .map(composerOperationCode)
    .filter(Boolean)
    .map(code => `{\n${code}\n}`)
    .join("\n");
  const initCode = normalized.mode === "julia"
    ? `
  vec2 z = p;
  vec2 c = uJuliaC;
    `
    : `
  vec2 z = vec2(0.0);
  vec2 c = p;
    `;

  return fragHeader + `
vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
}

vec2 csqr(vec2 z) {
  return vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
}

void main() {
  vec2 p = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  ${initCode}
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    ${opCode || "z = csqr(z) + c;"}
    if (!all(equal(z, z)) || dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;
}

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

// -- Cubic Celtic -------------------------------------------------------------
const cubicCelticFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    vec2 z3 = vec2(z.x * (x2 - 3.0 * y2), z.y * (3.0 * x2 - y2));
    z = vec2(abs(z3.x), z3.y) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Cubic Buffalo ------------------------------------------------------------
const cubicBuffaloFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    vec2 z3 = vec2(z.x * (x2 - 3.0 * y2), z.y * (3.0 * x2 - y2));
    z = vec2(abs(z3.x), -abs(z3.y)) + c;
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

// -- Perpendicular Mandelbrot -------------------------------------------------
const perpendicularMandelbrotFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, -2.0*abs(z.x)*z.y) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Celtic Heart -------------------------------------------------------------
const celticHeartFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(abs(z.x*z.x - z.y*z.y), -2.0*z.x*z.y) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Perpendicular Buffalo ----------------------------------------------------
const perpendicularBuffaloFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(abs(z.x*z.x - z.y*z.y), -2.0*abs(z.x*z.y)) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Douady Rabbit Julia ------------------------------------------------------
const rabbitJuliaFrag = fragHeader + `
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

// -- Quintic Multibrot ---------------------------------------------------------
const quinticMultibrotFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    float x4 = x2 * x2;
    float y4 = y2 * y2;
    z = vec2(
      z.x * (x4 - 10.0 * x2 * y2 + 5.0 * y4),
      z.y * (5.0 * x4 - 10.0 * x2 * y2 + y4)
    ) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Lambda Mandelbrot ---------------------------------------------------------
const lambdaFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.5, 0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 oneMinusZ = vec2(1.0 - z.x, -z.y);
    vec2 prod = vec2(
      z.x * oneMinusZ.x - z.y * oneMinusZ.y,
      z.x * oneMinusZ.y + z.y * oneMinusZ.x
    );
    z = vec2(c.x * prod.x - c.y * prod.y, c.x * prod.y + c.y * prod.x);
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Spider -------------------------------------------------------------------
const spiderFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    c = c * 0.5 + z;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Burning Ship Julia --------------------------------------------------------
const burningShipJuliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
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

// -- Dendrite Julia ------------------------------------------------------------
const dendriteJuliaFrag = fragHeader + `
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

// -- San Marco Dragon Julia ----------------------------------------------------
const sanMarcoFrag = fragHeader + `
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

// -- Tricorn Julia -------------------------------------------------------------
const tricornJuliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
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

// -- Celtic Julia --------------------------------------------------------------
const celticJuliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
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

// -- Buffalo Julia -------------------------------------------------------------
const buffaloJuliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
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

// -- Perpendicular Julia -------------------------------------------------------
const perpendicularJuliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, -2.0*abs(z.x)*z.y) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Cubic Julia ---------------------------------------------------------------
const cubicJuliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
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

// -- Quartic Julia -------------------------------------------------------------
const quarticJuliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
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

// -- Cubic Burning Ship --------------------------------------------------------
const burningShipCubicFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = abs(z);
    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    z = vec2(z.x * (x2 - 3.0 * y2), z.y * (3.0 * x2 - y2)) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Octic Multibrot -----------------------------------------------------------
const octicMultibrotFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
    vec2 z4 = vec2(z2.x * z2.x - z2.y * z2.y, 2.0 * z2.x * z2.y);
    vec2 z8 = vec2(z4.x * z4.x - z4.y * z4.y, 2.0 * z4.x * z4.y);
    z = z8 + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Sine Mandelbrot -----------------------------------------------------------
const sineMandelbrotFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    float yy = clamp(z.y, -8.0, 8.0);
    float ey = exp(yy);
    float eny = exp(-yy);
    float ch = 0.5 * (ey + eny);
    float sh = 0.5 * (ey - eny);
    z = vec2(sin(z.x) * ch, cos(z.x) * sh) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Mandelbox ----------------------------------------------------------------
const mandelboxFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = c;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = clamp(z, -1.0, 1.0) * 2.0 - z;
    float r2 = dot(z, z);
    if (r2 < 0.25) z *= 4.0;
    else if (r2 < 1.0) z /= r2;
    z = 2.0 * z + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Cubic Mandelbar -----------------------------------------------------------
const cubicMandelbarFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    z = vec2(z.x * (x2 - 3.0 * y2), -z.y * (3.0 * x2 - y2)) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Quartic Burning Ship ------------------------------------------------------
const quarticBurningShipFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = abs(z);
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    z = vec2(z2.x*z2.x - z2.y*z2.y, 2.0*z2.x*z2.y) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Magnet Type I -------------------------------------------------------------
const magnetFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 q = cdiv(z2 + c - vec2(1.0, 0.0), 2.0*z + c - vec2(2.0, 0.0));
    z = vec2(q.x*q.x - q.y*q.y, 2.0*q.x*q.y);
    if (dot(z, z) > 256.0) break;
    if (dot(z - vec2(1.0, 0.0), z - vec2(1.0, 0.0)) < 1e-8) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Cosine Mandelbrot ---------------------------------------------------------
const cosineMandelbrotFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    float yy = clamp(z.y, -8.0, 8.0);
    float ey = exp(yy);
    float eny = exp(-yy);
    float ch = 0.5 * (ey + eny);
    float sh = 0.5 * (ey - eny);
    z = vec2(cos(z.x) * ch, -sin(z.x) * sh) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Glynn Julia ---------------------------------------------------------------
const glynnJuliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    float r = pow(length(z), 1.5);
    float a = atan(z.y, z.x) * 1.5;
    z = vec2(cos(a), sin(a)) * r + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Sine Julia ----------------------------------------------------------------
const sineJuliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    float yy = clamp(z.y, -8.0, 8.0);
    float ey = exp(yy);
    float eny = exp(-yy);
    float ch = 0.5 * (ey + eny);
    float sh = 0.5 * (ey - eny);
    z = vec2(sin(z.x) * ch, cos(z.x) * sh) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Feather -------------------------------------------------------------------
const featherFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 z3 = vec2(z2.x*z.x - z2.y*z.y, z2.x*z.y + z2.y*z.x);
    z = cdiv(z3, vec2(1.0, 0.0) + z2) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Newton Cubic Basins -------------------------------------------------------
const newtonCubicFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 z3 = vec2(z2.x*z.x - z2.y*z.y, z2.x*z.y + z2.y*z.x);
    vec2 delta = cdiv(z3 - vec2(1.0, 0.0), 3.0*z2);
    z -= delta;
    if (dot(delta, delta) < 1e-12) break;
    if (dot(z, z) > 1e12) break;
    i += 1.0;
  }
  if (uColorMode == 1) {
    gl_FragColor = vec4(basinColor(cubicRootId(z), i, mi), 1.0);
  } else {
    gl_FragColor = vec4(colorize(i, mi, z), 1.0);
  }
}
`;

// -- Nova Basins ---------------------------------------------------------------
const novaBasinsFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 relax = vec2(0.85, 0.35);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 z3 = vec2(z2.x*z.x - z2.y*z.y, z2.x*z.y + z2.y*z.x);
    vec2 delta = cdiv(z3 - vec2(1.0, 0.0), 3.0*z2);
    z -= vec2(relax.x * delta.x - relax.y * delta.y,
              relax.x * delta.y + relax.y * delta.x);
    if (dot(delta, delta) < 1e-12) break;
    if (dot(z, z) > 1e12) break;
    i += 1.0;
  }
  if (uColorMode == 1) {
    gl_FragColor = vec4(basinColor(cubicRootId(z), i, mi), 1.0);
  } else {
    gl_FragColor = vec4(colorize(i, mi, z), 1.0);
  }
}
`;

// -- Newton Quartic Basins -----------------------------------------------------
const newtonQuarticFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 z3 = vec2(z2.x*z.x - z2.y*z.y, z2.x*z.y + z2.y*z.x);
    vec2 z4 = vec2(z2.x*z2.x - z2.y*z2.y, 2.0*z2.x*z2.y);
    vec2 delta = cdiv(z4 - vec2(1.0, 0.0), 4.0*z3);
    z -= delta;
    if (dot(delta, delta) < 1e-12) break;
    if (dot(z, z) > 1e12) break;
    i += 1.0;
  }
  if (uColorMode == 1) {
    gl_FragColor = vec4(basinColor(quarticRootId(z), i, mi), 1.0);
  } else {
    gl_FragColor = vec4(colorize(i, mi, z), 1.0);
  }
}
`;

// -- Relaxed Newton Spiral -----------------------------------------------------
const relaxedNewtonSpiralFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 relax = vec2(0.60, 0.60);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 z3 = vec2(z2.x*z.x - z2.y*z.y, z2.x*z.y + z2.y*z.x);
    vec2 delta = cdiv(z3 - vec2(1.0, 0.0), 3.0*z2);
    z -= vec2(relax.x * delta.x - relax.y * delta.y,
              relax.x * delta.y + relax.y * delta.x);
    if (dot(delta, delta) < 1e-12) break;
    if (dot(z, z) > 1e12) break;
    i += 1.0;
  }
  if (uColorMode == 1) {
    gl_FragColor = vec4(basinColor(cubicRootId(z), i, mi), 1.0);
  } else {
    gl_FragColor = vec4(colorize(i, mi, z), 1.0);
  }
}
`;

// -- Relaxed Newton Storm ------------------------------------------------------
const relaxedNewtonStormFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 relax = vec2(-0.30, 0.90);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 z3 = vec2(z2.x*z.x - z2.y*z.y, z2.x*z.y + z2.y*z.x);
    vec2 delta = cdiv(z3 - vec2(1.0, 0.0), 3.0*z2);
    z -= vec2(relax.x * delta.x - relax.y * delta.y,
              relax.x * delta.y + relax.y * delta.x);
    if (dot(delta, delta) < 1e-12) break;
    if (dot(z, z) > 1e12) break;
    i += 1.0;
  }
  if (uColorMode == 1) {
    gl_FragColor = vec4(basinColor(cubicRootId(z), i, mi), 1.0);
  } else {
    gl_FragColor = vec4(colorize(i, mi, z), 1.0);
  }
}
`;

// -- Halley Cubic Basins -------------------------------------------------------
const halleyCubicFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 z3 = vec2(z2.x*z.x - z2.y*z.y, z2.x*z.y + z2.y*z.x);
    vec2 f = z3 - vec2(1.0, 0.0);
    vec2 fp = 3.0 * z2;
    vec2 fpp = 6.0 * z;
    vec2 ffp = vec2(f.x*fp.x - f.y*fp.y, f.x*fp.y + f.y*fp.x);
    vec2 fp2 = vec2(fp.x*fp.x - fp.y*fp.y, 2.0*fp.x*fp.y);
    vec2 ffpp = vec2(f.x*fpp.x - f.y*fpp.y, f.x*fpp.y + f.y*fpp.x);
    vec2 delta = cdiv(2.0 * ffp, 2.0 * fp2 - ffpp);
    z -= delta;
    if (dot(delta, delta) < 1e-12) break;
    if (dot(z, z) > 1e12) break;
    i += 1.0;
  }
  if (uColorMode == 1) {
    gl_FragColor = vec4(basinColor(cubicRootId(z), i, mi), 1.0);
  } else {
    gl_FragColor = vec4(colorize(i, mi, z), 1.0);
  }
}
`;

// -- Mandelbar Julia -----------------------------------------------------------
const mandelbarJuliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
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

// -- Rational Julia Lace -------------------------------------------------------
const rationalJuliaLaceFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 inv = cdiv(c, z2 + vec2(0.22, 0.0));
    z = z2 + inv;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Orbit Trap Mandelbrot -----------------------------------------------------
const orbitTrapMandelbrotFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float trap = 32.0;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    float circle = abs(length(z - vec2(0.25, 0.0)) - 0.45);
    float cross = min(abs(z.x), abs(z.y));
    float diagonal = abs(z.x + z.y) * 0.70710678;
    trap = min(trap, min(circle, min(cross, diagonal)));
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  float t = clamp(-log(max(trap, 1e-6)) * 0.18 + uCycle * 0.18, 0.0, 1.0);
  vec3 base = cospalette(t, vec3(0.02, 0.32, 0.58));
  float glow = smoothstep(0.16, 0.0, trap);
  gl_FragColor = vec4(mix(base * 0.35, base, glow), 1.0);
}
`;

// -- Nova Julia Bloom -----------------------------------------------------------
const novaJuliaBloomFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
  vec2 relax = vec2(0.78, 0.28);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 z3 = vec2(z2.x*z.x - z2.y*z.y, z2.x*z.y + z2.y*z.x);
    vec2 delta = cdiv(z3 - vec2(1.0, 0.0), 3.0*z2);
    z -= vec2(relax.x * delta.x - relax.y * delta.y,
              relax.x * delta.y + relax.y * delta.x);
    z += c;
    if (dot(delta, delta) < 1e-12) break;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Rational Mandelbrot Lace --------------------------------------------------
const rationalMandelbrotLaceFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 inv = cdiv(vec2(0.22, -0.11), z2 + vec2(0.18, 0.06));
    z = z2 + inv + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// -- Orbit Trap Flower ---------------------------------------------------------
const orbitTrapFlowerFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float trap = 32.0;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    float a = atan(z.y, z.x);
    float petals = abs(length(z) - (0.35 + 0.12 * cos(6.0 * a)));
    float ring = abs(length(z - vec2(-0.18, 0.08)) - 0.28);
    float axis = min(abs(z.x + 0.18), abs(z.y - 0.08));
    trap = min(trap, min(petals, min(ring, axis)));
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  float t = clamp(-log(max(trap, 1e-6)) * 0.17 + uCycle * 0.18, 0.0, 1.0);
  vec3 base = cospalette(t, vec3(0.16, 0.36, 0.66));
  float glow = smoothstep(0.18, 0.0, trap);
  gl_FragColor = vec4(mix(base * 0.32, base, glow), 1.0);
}
`;

// -- Orbit Trap Lotus ----------------------------------------------------------
const orbitTrapLotusFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float trap = 32.0;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    float a = atan(z.y, z.x);
    float r = length(z);
    float outer = abs(r - (0.42 + 0.11 * cos(8.0 * a)));
    float inner = abs(r - (0.18 + 0.07 * cos(5.0 * a + 0.8)));
    float stem = min(abs(z.x * 0.65 + z.y * 0.35), abs(z.x * 0.65 - z.y * 0.35));
    trap = min(trap, min(outer, min(inner, stem)));
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  float t = clamp(-log(max(trap, 1e-6)) * 0.16 + uCycle * 0.18, 0.0, 1.0);
  vec3 base = cospalette(t, vec3(0.08, 0.34, 0.70));
  float glow = smoothstep(0.20, 0.0, trap);
  gl_FragColor = vec4(mix(base * 0.30, base, glow), 1.0);
}
`;

// -- Orbit Trap Rose Julia -----------------------------------------------------
const orbitTrapRoseJuliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
  float trap = 32.0;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    float a = atan(z.y, z.x);
    float r = length(z);
    float rose = abs(r - (0.34 + 0.14 * cos(7.0 * a)));
    float ring = abs(length(z - vec2(0.16, -0.10)) - 0.24);
    float vein = min(abs(z.x + 0.22 * sin(3.0 * a)), abs(z.y - 0.18 * cos(4.0 * a)));
    trap = min(trap, min(rose, min(ring, vein)));
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  float t = clamp(-log(max(trap, 1e-6)) * 0.19 + uCycle * 0.18, 0.0, 1.0);
  vec3 base = cospalette(t, vec3(0.22, 0.48, 0.76));
  float glow = smoothstep(0.17, 0.0, trap);
  gl_FragColor = vec4(mix(base * 0.34, base, glow), 1.0);
}
`;

// ── Exponential Mandelbrot (z ← exp(z) + c) ──────────────────────────────────
const expMandelbrotFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    float ey = clamp(z.y, -8.0, 8.0);
    float ex = exp(clamp(z.x, -8.0, 8.0));
    z = vec2(ex * cos(ey), ex * sin(ey)) + c;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// ── Magnet Type II ────────────────────────────────────────────────────────────
// Magnet II: z ← ((z³ + 3(c−1)z + (c−1)(c−2)) / (3z² + 3(c−2)z + (c−1)(c−2)+1))²
const magnetIIFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  // precompute constant complex terms from c
  vec2 cm1 = c - vec2(1.0, 0.0);               // (c-1)
  vec2 cm2 = c - vec2(2.0, 0.0);               // (c-2)
  vec2 cm1cm2 = vec2(cm1.x*cm2.x - cm1.y*cm2.y, cm1.x*cm2.y + cm1.y*cm2.x); // (c-1)(c-2)
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 z3 = vec2(z2.x*z.x - z2.y*z.y, z2.x*z.y + z2.y*z.x);
    // numerator: z³ + 3(c−1)z + (c−1)(c−2)
    vec2 nr = z3 + 3.0*vec2(cm1.x*z.x - cm1.y*z.y, cm1.x*z.y + cm1.y*z.x) + cm1cm2;
    // denominator: 3z² + 3(c−2)z + (c−1)(c−2) + 1
    vec2 dr = 3.0*z2 + 3.0*vec2(cm2.x*z.x - cm2.y*z.y, cm2.x*z.y + cm2.y*z.x)
              + cm1cm2 + vec2(1.0, 0.0);
    vec2 q = cdiv(nr, dr);
    z = vec2(q.x*q.x - q.y*q.y, 2.0*q.x*q.y);
    if ((z.x-1.0)*(z.x-1.0) + z.y*z.y < 1e-6) break;
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// ── Newton Quintic Basins (z⁵ − 1 = 0, five roots) ───────────────────────────
const newtonQuinticFrag = fragHeader + `
float quinticRootId(vec2 z) {
  float best = 1e9; float id = 0.0;
  for (int k = 0; k < 5; k++) {
    float angle = TAU * float(k) / 5.0;
    vec2 r = vec2(cos(angle), sin(angle));
    float d = dot(z - r, z - r);
    if (d < best) { best = d; id = float(k); }
  }
  return id;
}
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 z4 = vec2(z2.x*z2.x - z2.y*z2.y, 2.0*z2.x*z2.y);
    vec2 z5 = vec2(z4.x*z.x - z4.y*z.y, z4.x*z.y + z4.y*z.x);
    vec2 delta = cdiv(z5 - vec2(1.0, 0.0), 5.0*z4);
    z -= delta;
    if (dot(delta, delta) < 1e-12) break;
    if (dot(z, z) > 1e12) break;
    i += 1.0;
  }
  if (uColorMode == 1) {
    gl_FragColor = vec4(basinColor(quinticRootId(z), i, mi), 1.0);
  } else {
    gl_FragColor = vec4(colorize(i, mi, z), 1.0);
  }
}
`;

// ── Orbit Trap Star ───────────────────────────────────────────────────────────
const orbitTrapStarFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float trap = 32.0;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    float a = atan(z.y, z.x);
    float r = length(z);
    float spine = abs(r - (0.40 + 0.22 * abs(cos(5.0 * a))));
    float hub   = abs(r - 0.12);
    float spoke = min(min(abs(z.x), abs(z.y)),
                      min(abs(z.x - z.y) * 0.7071, abs(z.x + z.y) * 0.7071));
    trap = min(trap, min(spine, min(hub, spoke * 0.6)));
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  float t = clamp(-log(max(trap, 1e-6)) * 0.20 + uCycle * 0.18, 0.0, 1.0);
  vec3 base = cospalette(t, vec3(0.30, 0.10, 0.55));
  float glow = smoothstep(0.20, 0.0, trap);
  gl_FragColor = vec4(mix(base * 0.28, base, glow), 1.0);
}
`;

// ── Perpendicular Burning Ship ────────────────────────────────────────────────
const perpendicularBurningShipFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y + c.x, -2.0*abs(z.x)*z.y + c.y);
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// ── Heart Julia (Quartic Julia preset c = 0.38 + 0.34i) ──────────────────────
// Same shader as quartic Julia — just a registry entry with a special c value.

// ── Zubieta Julia (z ← z² − c/z³) ───────────────────────────────────────────
const zubietaJuliaFrag = fragHeader + `
void main() {
  vec2 z = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 c = uJuliaC;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    vec2 z2 = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y);
    vec2 z3 = vec2(z2.x*z.x - z2.y*z.y, z2.x*z.y + z2.y*z.x);
    z = z2 - cdiv(c, z3);
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  gl_FragColor = vec4(colorize(i, mi, z), 1.0);
}
`;

// ── Orbit Trap Web (Mandelbrot + grid-line trap) ──────────────────────────────
const orbitTrapWebFrag = fragHeader + `
void main() {
  vec2 c = vec2(worldCoord(uX0, gl_FragCoord.x),
                worldCoord(uY0, gl_FragCoord.y));
  vec2 z = vec2(0.0);
  float trap = 32.0;
  float i = 0.0, mi = float(uIter);
  for (int n = 0; n < MAX_ITER; n++) {
    if (n >= uIter) break;
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    vec2 frac = abs(fract(z * 1.5) - 0.5);
    float grid = min(frac.x, frac.y);
    float circ = abs(length(z) - 0.5);
    trap = min(trap, min(grid * 0.9, circ));
    if (dot(z, z) > 256.0) break;
    i += 1.0;
  }
  float t = clamp(-log(max(trap, 1e-6)) * 0.22 + uCycle * 0.18, 0.0, 1.0);
  vec3 base = cospalette(t, vec3(0.05, 0.42, 0.28));
  float glow = smoothstep(0.18, 0.0, trap);
  gl_FragColor = vec4(mix(base * 0.30, base, glow), 1.0);
}
`;

// ─── Fractals registry ────────────────────────────────────────────────────────
//
// Registry fields:
// - name/category: UI labels and dropdown grouping.
// - src: fragment shader string compiled by app.js.
// - center/scale/bounds: initial camera framing.
// - julia: true when the circular Julia angle slider should be shown.
// - juliaParam: fixed or user-editable Julia seed shown as real/imag inputs.
// - formula: stable key used by CPU refinement and behavior metadata.
// - formulaText: curated human-readable display string shown in the HUD.

const FRACTALS = [
  { name: "Mandelbrot Set",      category: "Classic",       src: mandelbrotFrag,       center: [-0.5, 0.0], scale: 3.5, julia: false, formula: "mandelbrot" },
  { name: "Julia Set",           category: "Julia",         src: juliaFrag,            center: [0.0,  0.0], scale: 3.5, julia: true,  formula: "julia" },
  { name: "Burning Ship",        category: "Classic",       src: burningShipFrag,      center: [-0.5,-0.5], scale: 3.5, julia: false, formula: "burningShip" },
  { name: "Tricorn (Mandelbar)", category: "Classic",       src: tricornFrag,          center: [0.0,  0.0], scale: 3.5, julia: false, formula: "tricorn" },
  { name: "Cubic Multibrot",     category: "Power",         src: cubicMultibrotFrag,   center: [0.0,  0.0], scale: 3.0, julia: false, formula: "cubic" },
  { name: "Quartic Multibrot",   category: "Power",         src: quarticMultibrotFrag, center: [0.0,  0.0], scale: 3.0, julia: false, formula: "quartic" },
  { name: "Celtic Mandelbrot",   category: "Folded",        src: celticFrag,           center: [-0.2, 0.0], scale: 3.2, julia: false, formula: "celtic" },
  { name: "Buffalo",             category: "Folded",        src: buffaloFrag,          center: [-0.2, 0.0], scale: 3.2, julia: false, formula: "buffalo" },
  { name: "Cubic Celtic",        category: "Folded",        src: cubicCelticFrag,      center: [0.0, 0.0], scale: 3.0, julia: false, formula: "cubicCeltic" },
  { name: "Cubic Buffalo",       category: "Folded",        src: cubicBuffaloFrag,     center: [0.0, -0.1], scale: 3.0, julia: false, formula: "cubicBuffalo" },
  { name: "Phoenix Julia",       category: "Julia",         src: phoenixFrag,          center: [0.0,  0.0], scale: 3.2, julia: true,  formula: "phoenix" },
  { name: "Phoenix Julia - Bloom", category: "Julia",       src: phoenixFrag,          center: [0.0,  0.0], scale: 3.0, julia: false, juliaParam: [-0.58, 0.42], formula: "phoenix" },
  { name: "Perpendicular Mandelbrot", category: "Perpendicular", src: perpendicularMandelbrotFrag, center: [0.0, 0.0], scale: 3.5, julia: false, formula: "perpendicularMandelbrot" },
  { name: "Celtic Heart",        category: "Folded",        src: celticHeartFrag,      center: [-0.2, 0.0], scale: 3.2, julia: false, formula: "celticHeart" },
  { name: "Perpendicular Buffalo", category: "Perpendicular", src: perpendicularBuffaloFrag, center: [-0.2, 0.0], scale: 3.2, julia: false, formula: "perpendicularBuffalo" },
  { name: "Douady Rabbit Julia", category: "Julia",         src: rabbitJuliaFrag,      center: [0.0,  0.0], scale: 3.0, julia: false, juliaParam: [-0.123, 0.745], formula: "julia" },
  { name: "Quintic Multibrot",   category: "Power",         src: quinticMultibrotFrag, center: [0.0,  0.0], scale: 2.6, julia: false, formula: "quintic" },
  { name: "Lambda Mandelbrot",   category: "Dynamic",       src: lambdaFrag,           center: [0.5,  0.0], scale: 4.0, julia: false, formula: "lambda" },
  { name: "Spider",              category: "Dynamic",       src: spiderFrag,           center: [0.0,  0.0], scale: 4.0, julia: false, formula: "spider" },
  { name: "Burning Ship Julia - Rift", category: "Julia",   src: burningShipJuliaFrag, center: [0.0,  0.0], scale: 2.2, julia: false, juliaParam: [-0.03, -1.052], formula: "burningJulia" },
  { name: "Burning Ship Julia - Ember", category: "Julia",  src: burningShipJuliaFrag, center: [0.0,  0.0], scale: 2.4, julia: false, juliaParam: [-0.3, -0.95], formula: "burningJulia" },
  { name: "Burning Ship Julia - Wake", category: "Julia",   src: burningShipJuliaFrag, center: [0.0,  0.0], scale: 2.2, julia: false, juliaParam: [0.096, -1.156], formula: "burningJulia" },
  { name: "Dendrite Julia",      category: "Julia",         src: dendriteJuliaFrag,    center: [0.0,  0.0], scale: 3.2, julia: false, juliaParam: [0.0, 1.0], formula: "julia" },
  { name: "San Marco Dragon Julia", category: "Julia",      src: sanMarcoFrag,         center: [0.0,  0.0], scale: 3.0, julia: false, juliaParam: [-0.75, 0.1], formula: "julia" },
  { name: "Tricorn Julia",       category: "Julia",         src: tricornJuliaFrag,     center: [0.0,  0.0], scale: 3.0, julia: false, juliaParam: [-0.36, 0.62], formula: "tricornJulia" },
  { name: "Celtic Julia",        category: "Julia",         src: celticJuliaFrag,      center: [0.0,  0.0], scale: 3.0, julia: false, juliaParam: [-0.18, 0.67], formula: "celticJulia" },
  { name: "Buffalo Julia",       category: "Julia",         src: buffaloJuliaFrag,     center: [0.0,  0.0], scale: 3.0, julia: false, juliaParam: [-0.45, -0.55], formula: "buffaloJulia" },
  { name: "Perpendicular Julia", category: "Julia",         src: perpendicularJuliaFrag, center: [0.0, 0.0], scale: 3.0, julia: false, juliaParam: [0.22, -0.54], formula: "perpendicularJulia" },
  { name: "Cubic Julia",         category: "Julia",         src: cubicJuliaFrag,       center: [0.0,  0.0], scale: 2.8, julia: false, juliaParam: [-0.1, 0.76], formula: "cubicJulia" },
  { name: "Quartic Julia - Dahlia", category: "Julia",      src: quarticJuliaFrag,     center: [0.0,  0.0], scale: 3.0, julia: false, juliaParam: [-0.68, 0.32], formula: "quarticJulia" },
  { name: "Quartic Julia - Clover", category: "Julia",      src: quarticJuliaFrag,     center: [0.0,  0.0], scale: 3.0, julia: false, juliaParam: [0.50, 0.0], formula: "quarticJulia" },
  { name: "Cubic Burning Ship",  category: "Folded",        src: burningShipCubicFrag, center: [0.0, -0.2], scale: 3.2, julia: false, formula: "burningCubic" },
  { name: "Octic Multibrot",     category: "Power",         src: octicMultibrotFrag,   center: [0.0,  0.0], scale: 2.4, julia: false, formula: "octic" },
  { name: "Sine Mandelbrot",     category: "Transcendental", src: sineMandelbrotFrag,  center: [0.0,  0.0], scale: 6.0, julia: false, formula: "sine" },
  { name: "Mandelbox",           category: "Box Fold",      src: mandelboxFrag,        center: [0.0,  0.0], scale: 4.0, bounds: { width: 44.0, height: 22.0 }, julia: false, formula: "mandelbox" },
  { name: "Cubic Mandelbar",     category: "Mandelbar",     src: cubicMandelbarFrag,   center: [0.0,  0.0], scale: 3.2, julia: false, formula: "cubicMandelbar" },
  { name: "Quartic Burning Ship", category: "Folded",       src: quarticBurningShipFrag, center: [0.0, -0.2], scale: 3.0, julia: false, formula: "burningQuartic" },
  { name: "Magnet Type I",       category: "Rational",      src: magnetFrag,           center: [1.0,  0.0], scale: 4.0, julia: false, formula: "magnet" },
  { name: "Cosine Mandelbrot",   category: "Transcendental", src: cosineMandelbrotFrag, center: [0.0,  0.0], scale: 6.0, julia: false, formula: "cosine" },
  { name: "Glynn Julia",         category: "Julia",         src: glynnJuliaFrag,       center: [0.0,  0.0], scale: 3.2, julia: false, juliaParam: [-0.2, 0.0], formula: "glynnJulia" },
  { name: "Glynn Julia - Rosette", category: "Julia",       src: glynnJuliaFrag,       center: [0.0,  0.0], scale: 2.8, julia: false, juliaParam: [-0.13, 0.18], formula: "glynnJulia" },
  { name: "Sine Julia",          category: "Julia",         src: sineJuliaFrag,        center: [0.0,  0.0], scale: 6.0, julia: false, juliaParam: [-0.12, 0.74], formula: "sineJulia" },
  { name: "Sine Julia - Veil",    category: "Julia",        src: sineJuliaFrag,        center: [0.0,  0.0], scale: 5.4, julia: false, juliaParam: [0.22, 0.62], formula: "sineJulia" },
  { name: "Feather",             category: "Rational",      src: featherFrag,          center: [0.0,  0.0], scale: 4.0, julia: false, formula: "feather" },
  { name: "Newton Cubic Basins", category: "Basins",        src: newtonCubicFrag,      center: [0.0,  0.0], scale: 3.4, julia: false, formula: "newtonCubic", basin: true },
  { name: "Nova Basins",         category: "Basins",        src: novaBasinsFrag,       center: [0.0,  0.0], scale: 3.2, julia: false, formula: "novaBasins", basin: true },
  { name: "Newton Quartic Basins", category: "Basins",      src: newtonQuarticFrag,    center: [0.0,  0.0], scale: 3.4, julia: false, formula: "newtonQuartic", basin: true },
  { name: "Relaxed Newton Spiral", category: "Basins",      src: relaxedNewtonSpiralFrag, center: [0.0, 0.0], scale: 3.4, julia: false, formula: "newtonRelaxSpiral", basin: true },
  { name: "Relaxed Newton Storm", category: "Basins",       src: relaxedNewtonStormFrag, center: [0.0, 0.0], scale: 3.4, julia: false, formula: "newtonRelaxStorm", basin: true },
  { name: "Halley Cubic Basins", category: "Basins",        src: halleyCubicFrag,      center: [0.0,  0.0], scale: 3.4, julia: false, formula: "halleyCubic", basin: true },
  { name: "Mandelbar Julia",     category: "Julia",         src: mandelbarJuliaFrag,   center: [0.0,  0.0], scale: 3.0, julia: false, juliaParam: [-0.18, 0.68], formula: "mandelbarJulia" },
  { name: "Rational Julia - Lace", category: "Julia",       src: rationalJuliaLaceFrag, center: [0.0, 0.0], scale: 3.2, julia: false, juliaParam: [-0.32, 0.58], formula: "rationalJuliaLace" },
  { name: "Orbit Trap Mandelbrot", category: "Orbit Trap",  src: orbitTrapMandelbrotFrag, center: [-0.5, 0.0], scale: 3.5, julia: false, formula: "orbitTrapMandelbrot" },
  { name: "Nova Julia Bloom",    category: "Julia",         src: novaJuliaBloomFrag,   center: [0.0,  0.0], scale: 3.0, julia: false, juliaParam: [-0.16, 0.08], formula: "novaJuliaBloom" },
  { name: "Rational Mandelbrot Lace", category: "Rational", src: rationalMandelbrotLaceFrag, center: [-0.35, 0.0], scale: 3.3, julia: false, formula: "rationalMandelbrotLace" },
  { name: "Orbit Trap Flower",   category: "Orbit Trap",    src: orbitTrapFlowerFrag,  center: [-0.5, 0.0], scale: 3.5, julia: false, formula: "orbitTrapFlower" },
  { name: "Orbit Trap Lotus",    category: "Orbit Trap",    src: orbitTrapLotusFrag,   center: [-0.45, 0.0], scale: 3.3, julia: false, formula: "orbitTrapLotus" },
  { name: "Orbit Trap Rose Julia", category: "Orbit Trap",  src: orbitTrapRoseJuliaFrag, center: [0.0, 0.0], scale: 3.0, julia: false, juliaParam: [-0.56, 0.38], formula: "orbitTrapRoseJulia" },

  // ── New fractals ──────────────────────────────────────────────────────────
  { name: "Exponential Mandelbrot", category: "Transcendental", src: expMandelbrotFrag, center: [-1.0, 0.0], scale: 6.0, julia: false, formula: "expMandelbrot" },
  { name: "Magnet Type II",        category: "Rational",      src: magnetIIFrag,         center: [0.0,  0.0], scale: 5.0, julia: false, formula: "magnetII" },
  { name: "Newton Quintic Basins", category: "Basins",        src: newtonQuinticFrag,    center: [0.0,  0.0], scale: 3.4, julia: false, formula: "newtonQuintic", basin: true },
  { name: "Orbit Trap Star",       category: "Orbit Trap",    src: orbitTrapStarFrag,    center: [-0.5, 0.0], scale: 3.5, julia: false, formula: "orbitTrapStar" },
  { name: "Orbit Trap Web",        category: "Orbit Trap",    src: orbitTrapWebFrag,     center: [-0.5, 0.0], scale: 3.5, julia: false, formula: "orbitTrapWeb" },
  { name: "Perpendicular Burning Ship", category: "Perpendicular", src: perpendicularBurningShipFrag, center: [-0.5, -0.5], scale: 3.5, julia: false, formula: "perpendicularBurningShip" },
  { name: "Zubieta Julia",         category: "Julia",         src: zubietaJuliaFrag,     center: [0.0,  0.0], scale: 3.2, julia: false, juliaParam: [-0.54, 0.50], formula: "zubietaJulia" },
  { name: "Zubieta Julia - Spiral", category: "Julia",        src: zubietaJuliaFrag,     center: [0.0,  0.0], scale: 3.0, julia: false, juliaParam: [-0.22, 0.72], formula: "zubietaJulia" },
  { name: "Quartic Julia - Crown", category: "Julia",         src: quarticJuliaFrag,     center: [0.0,  0.0], scale: 2.8, julia: false, juliaParam: [0.0, 0.65], formula: "quarticJulia" },
  { name: "Composed Formula",      category: "Composer",      src: buildComposerFractalSource(COMPOSER_DEFAULT), center: [0.0, 0.0], scale: 4.0, julia: false, juliaParam: [-0.4, 0.6], formula: "composer", composer: normalizeComposerConfig(COMPOSER_DEFAULT) },
];

// Human-readable formula strings shown in the HUD. These are intentionally
// curated instead of derived from shader source so the UI stays concise and the
// math remains understandable to users and future contributors.
const FORMULA_DISPLAY = Object.freeze({
  mandelbrot: "z(n+1) = z(n)^2 + c",
  julia: "z(n+1) = z(n)^2 + c",
  burningShip: "z(n+1) = (|Re(z(n))| + i|Im(z(n))|)^2 + c",
  tricorn: "z(n+1) = conjugate(z(n))^2 + c",
  cubic: "z(n+1) = z(n)^3 + c",
  quartic: "z(n+1) = z(n)^4 + c",
  celtic: "z(n+1) = |Re(z(n)^2)| + iIm(z(n)^2) + c",
  buffalo: "z(n+1) = (|Re(z(n)^2)| + i|Im(z(n)^2)|) + c",
  cubicCeltic: "z(n+1) = |Re(z(n)^3)| + iIm(z(n)^3) + c",
  cubicBuffalo: "z(n+1) = |Re(z(n)^3)| - i|Im(z(n)^3)| + c",
  phoenix: "z(n+1) = z(n)^2 + p + q*z(n-1)",
  perpendicularMandelbrot: "z(n+1) = (Re(z(n)^2) + i|Im(z(n)^2)|) + c",
  celticHeart: "z(n+1) = |Re(z(n)^2)| + iIm(z(n)^2) + c",
  perpendicularBuffalo: "z(n+1) = (|Re(z(n)^2)| + iIm(z(n)^2)) + c",
  quintic: "z(n+1) = z(n)^5 + c",
  lambda: "z(n+1) = c*z(n)*(1 - z(n))",
  spider: "z(n+1) = z(n)^2 + c(n), c(n+1) = c(n)/2 + z(n+1)",
  burningJulia: "z(n+1) = (|Re(z(n))| + i|Im(z(n))|)^2 + c",
  tricornJulia: "z(n+1) = conjugate(z(n))^2 + c",
  celticJulia: "z(n+1) = |Re(z(n)^2)| + iIm(z(n)^2) + c",
  buffaloJulia: "z(n+1) = (|Re(z(n)^2)| + i|Im(z(n)^2)|) + c",
  perpendicularJulia: "z(n+1) = (Re(z(n)^2) + i|Im(z(n)^2)|) + c",
  cubicJulia: "z(n+1) = z(n)^3 + c",
  quarticJulia: "z(n+1) = z(n)^4 + c",
  burningCubic: "z(n+1) = (|Re(z(n))| + i|Im(z(n))|)^3 + c",
  octic: "z(n+1) = z(n)^8 + c",
  sine: "z(n+1) = sin(z(n)) + c",
  mandelbox: "z = boxFold(ballFold(scale*z)) + c",
  cubicMandelbar: "z(n+1) = conjugate(z(n))^3 + c",
  burningQuartic: "z(n+1) = (|Re(z(n))| + i|Im(z(n))|)^4 + c",
  magnet: "z(n+1) = ((z(n)^2 + c - 1) / (2z(n) + c - 2))^2",
  cosine: "z(n+1) = cos(z(n)) + c",
  glynnJulia: "z(n+1) = z(n)^p + c",
  sineJulia: "z(n+1) = sin(z(n)) + c",
  feather: "z(n+1) = z(n)^3 / (1 + z(n)^2) + c",
  newtonCubic: "z(n+1) = z(n) - (z(n)^3 - 1) / (3z(n)^2)",
  novaBasins: "z(n+1) = z(n) - a*(f(z(n))/f'(z(n))) + c",
  newtonQuartic: "z(n+1) = z(n) - (z(n)^4 - 1) / (4z(n)^3)",
  newtonRelaxSpiral: "z(n+1) = z(n) - a*(z(n)^3 - 1) / (3z(n)^2)",
  newtonRelaxStorm: "z(n+1) = z(n) - a*(z(n)^4 - 1) / (4z(n)^3)",
  halleyCubic: "z(n+1) = z(n) - (2f(z)f'(z)) / (2(f'(z))^2 - f(z)f''(z))",
  mandelbarJulia: "z(n+1) = conjugate(z(n))^2 + c",
  rationalJuliaLace: "z(n+1) = (z(n)^2 + c) / (1 + alpha*z(n)^2)",
  orbitTrapMandelbrot: "z(n+1) = z(n)^2 + c, color from orbit-trap distance",
  novaJuliaBloom: "z(n+1) = z(n) - a*(f(z(n))/f'(z(n))) + c",
  rationalMandelbrotLace: "z(n+1) = (z(n)^2 + c) / (1 + alpha*z(n)^2)",
  orbitTrapFlower: "z(n+1) = z(n)^2 + c, color from flower orbit-trap distance",
  orbitTrapLotus: "z(n+1) = z(n)^2 + c, color from lotus orbit-trap distance",
  orbitTrapRoseJulia: "z(n+1) = z(n)^2 + c, color from rose orbit-trap distance",
  expMandelbrot: "z(n+1) = exp(z(n)) + c",
  magnetII: "z(n+1) = rational magnet iteration with c-dependent poles",
  newtonQuintic: "z(n+1) = z(n) - (z(n)^5 - 1) / (5z(n)^4)",
  orbitTrapStar: "z(n+1) = z(n)^2 + c, color from star orbit-trap distance",
  orbitTrapWeb: "z(n+1) = z(n)^2 + c, color from web orbit-trap distance",
  perpendicularBurningShip: "z(n+1) = (|Re(z(n)^2)| + iIm(z(n)^2)) + c",
  zubietaJulia: "z(n+1) = z(n)^2 + c with Zubieta-style parameter shaping",
  composer: buildComposerFormulaText(COMPOSER_DEFAULT),
});

const FORMULA_EXPLANATION = Object.freeze({
  mandelbrot: "The canonical escape-time fractal: every visible feature comes from whether repeated squaring plus c stays bounded or escapes.",
  julia: "A Julia set freezes c and lets the initial point vary, which turns the same iteration into a family of sharply different boundary shapes.",
  burningShip: "The Burning Ship folds the complex plane with absolute values before squaring, producing jagged vertical growth and asymmetric detail.",
  tricorn: "The Tricorn conjugates z before squaring, which flips orientation and creates a more mirrored, three-armed variant of Mandelbrot dynamics.",
  cubic: "Raising z to the third power produces a multibrot with broader lobes and stronger rotational symmetry than the classic quadratic case.",
  quartic: "Fourth-power multibrots push the symmetry further and make the main bulbs feel more angular and star-like.",
  celtic: "Celtic variants fold only part of the quadratic term, which creates heart-like voids and pinched edge structures.",
  buffalo: "Buffalo-style folds apply absolute values to both quadratic components, producing dense, layered wings and knotted filaments.",
  cubicCeltic: "A third-power Celtic fold that keeps the smoother multibrot symmetry while adding folded, pinched interior gaps.",
  cubicBuffalo: "A third-power Buffalo fold that turns the cubic lobes into denser mirrored wings and heavier edge knots.",
  phoenix: "Phoenix adds memory through the previous iterate, so the orbit is shaped by both the current and prior state.",
  perpendicularMandelbrot: "Perpendicular variants selectively fold one quadratic component, which skews the usual Mandelbrot geometry into harsher boundary forms.",
  celticHeart: "This fold emphasizes the heart-shaped cavity that appears when the real part is reflected while the imaginary flow stays signed.",
  perpendicularBuffalo: "A hybrid of perpendicular and Buffalo folding that produces tight, high-contrast edge geometry.",
  quintic: "Fifth-power multibrots exaggerate star symmetry and create heavier, more segmented exterior lobes.",
  lambda: "The lambda map comes from the logistic family and turns parameter space into a fractal view of iterative population-style dynamics.",
  spider: "Spider feeds each iterate back into the parameter, so both z and c move together and create webbed, thread-like structures.",
  burningJulia: "Burning Ship Julia sets freeze c while keeping the absolute-value fold, producing sharp, flame-like local structure.",
  tricornJulia: "A Julia-family counterpart to the Tricorn, with mirrored rotational structure driven by complex conjugation.",
  celticJulia: "Celtic Julia seeds create folded local boundaries that feel more pinched and decorative than the plain quadratic Julia family.",
  buffaloJulia: "Buffalo Julia variants keep the aggressive folding behavior but expose it through a fixed seed instead of a free parameter plane.",
  perpendicularJulia: "Perpendicular Julia sets retain the directional fold of the Mandelbrot-style parent and often produce skewed filament fans.",
  cubicJulia: "Cubic Julia sets extend the usual quadratic family into three-fold rotational behavior and thicker lobe transitions.",
  quarticJulia: "Quartic Julia seeds produce more rigid symmetry and floral or crown-like outlines.",
  burningCubic: "A higher-power Burning Ship variant that sharpens folded spikes into heavier clustered forms.",
  octic: "An eighth-power multibrot emphasizes rotational symmetry and makes the main body read almost like a many-pointed star.",
  sine: "Using sin(z) introduces transcendental growth, so the fractal mixes periodic structure with escape-time boundaries.",
  mandelbox: "The Mandelbox combines box folds, ball folds, and scaling, making it feel more geometric and architectural than polynomial sets.",
  cubicMandelbar: "A cubic Mandelbar extends conjugate-powered dynamics into a deeper rotational variant of the Tricorn family.",
  burningQuartic: "A fourth-power folded escape map that produces denser, chunkier Burning Ship-style structures.",
  magnet: "Magnet fractals iterate a rational map with poles and attractors, so the resulting boundaries feel more electrical and basin-like.",
  cosine: "Cos(z) creates a transcendental parameter space with repeated bands and strong periodic folding.",
  glynnJulia: "Glynn Julia sets use non-standard powers to create softer petal-like transitions and unusual symmetry breaks.",
  sineJulia: "A Julia seed driven by sin(z), blending periodicity with the sensitivity of the fixed-parameter Julia family.",
  feather: "Feather is a rational fractal with a softer central body and lace-like edge structures caused by division in the update rule.",
  newtonCubic: "Newton basin fractals color points by which root a numerical solver converges to, turning analysis of convergence into visible territory.",
  novaBasins: "Nova basins perturb Newton-style solving with an added constant, which makes the root boundaries bloom into richer filaments.",
  newtonQuartic: "Quartic Newton basins divide the plane into four root territories separated by unstable, self-similar boundaries.",
  newtonRelaxSpiral: "A relaxed Newton update slows convergence just enough to expose more visible swirling structure around the basin borders.",
  newtonRelaxStorm: "This relaxed solver amplifies unstable transitions and gives the basin boundaries a stormier, more turbulent look.",
  halleyCubic: "Halley uses a higher-order root finder, which changes how quickly points collapse onto roots and sharpens the basin geometry.",
  mandelbarJulia: "A Julia seed driven by conjugate-quadratic dynamics, producing mirrored local symmetries.",
  rationalJuliaLace: "This rational Julia family adds poles and compression effects, which often turns the boundary into woven lace.",
  orbitTrapMandelbrot: "Orbit traps color points by how closely their iterates approach a chosen shape, revealing structure that plain escape-time coloring hides.",
  novaJuliaBloom: "A Julia-form Nova variant that turns root-finding dynamics into compact floral structures.",
  rationalMandelbrotLace: "A rational parameter plane with braided edges caused by the interaction between polynomial growth and division.",
  orbitTrapFlower: "A flower-shaped orbit trap emphasizes petal-like distance contours inside the usual Mandelbrot dynamics.",
  orbitTrapLotus: "The lotus trap highlights layered radial contours and gives the fractal a more ornamental visual rhythm.",
  orbitTrapRoseJulia: "A rose-shaped trap applied to a Julia seed, mixing orbit geometry with the fixed-parameter Julia boundary.",
  expMandelbrot: "Exponential updates grow very differently from powers, creating transcendental regions with rapid stretching and folding.",
  magnetII: "A second magnet rational map with different poles and attraction behavior, giving it more electrically tangled boundaries.",
  newtonQuintic: "Quintic Newton basins divide the plane among five roots, producing star-like territory splits and delicate separators.",
  orbitTrapStar: "A star orbit trap highlights angular distance fields that cut across the usual smooth exterior bands.",
  orbitTrapWeb: "A web trap emphasizes crossing distance contours and makes the orbit field look more structural than painterly.",
  perpendicularBurningShip: "A perpendicular Burning Ship variant that keeps the fold-driven asymmetry but changes how vertical structure accumulates.",
  zubietaJulia: "A Julia-family variant tuned for more stylized, shaped parameter responses than the plain quadratic map.",
  composer: "A generated formula assembled from safe primitives. It renders on the GPU from the active composer stack.",
});

for (const fractal of FRACTALS) {
  fractal.formulaText = FORMULA_DISPLAY[fractal.formula] || "Formula metadata pending";
  fractal.explanationText = FORMULA_EXPLANATION[fractal.formula] || "This fractal uses the current formula to turn orbit behavior into visible structure.";
}

// Describes formula behavior that cannot be inferred from the shader string.
// app.js uses this to initialize CPU samples, choose available color modes, and
// decide whether basin/orbit-trap metadata is present.
const FORMULA_BEHAVIOR = Object.freeze({
  julia: { initial: "julia" },
  burningJulia: { initial: "julia" },
  tricornJulia: { initial: "julia" },
  celticJulia: { initial: "julia" },
  buffaloJulia: { initial: "julia" },
  perpendicularJulia: { initial: "julia" },
  cubicJulia: { initial: "julia" },
  quarticJulia: { initial: "julia" },
  glynnJulia: { initial: "julia" },
  sineJulia: { initial: "julia" },
  mandelbarJulia: { initial: "julia" },
  rationalJuliaLace: { initial: "julia" },
  novaJuliaBloom: { initial: "julia" },
  phoenix: { initial: "phoenix" },
  lambda: { initial: "lambda" },
  mandelbox: { initial: "point" },
  newtonCubic: { initial: "point", newton: true, basinRoots: 3, colorModes: ["escape", "basin"] },
  novaBasins: { initial: "point", newton: true, basinRoots: 3, colorModes: ["escape", "basin"] },
  newtonQuartic: { initial: "point", newton: true, basinRoots: 4, colorModes: ["escape", "basin"] },
  newtonRelaxSpiral: { initial: "point", newton: true, basinRoots: 3, colorModes: ["escape", "basin"] },
  newtonRelaxStorm: { initial: "point", newton: true, basinRoots: 3, colorModes: ["escape", "basin"] },
  halleyCubic: { initial: "point", newton: true, basinRoots: 3, colorModes: ["escape", "basin"] },
  orbitTrapMandelbrot: { orbitTrap: true },
  orbitTrapFlower: { orbitTrap: true },
  orbitTrapLotus: { orbitTrap: true },
  orbitTrapRoseJulia: { initial: "julia", orbitTrap: true },
  orbitTrapStar: { orbitTrap: true },
  orbitTrapWeb: { orbitTrap: true },
  zubietaJulia: { initial: "julia" },
  newtonQuintic: { initial: "point", newton: true, basinRoots: 5, colorModes: ["escape", "basin"] },
  composer: { gpuOnly: true, composer: true },
});

FRACTALS.forEach(fractal => {
  // Attach a normalized meta object to every registry item so UI/render code can
  // read one shape regardless of whether a formula has custom behavior.
  const behavior = FORMULA_BEHAVIOR[fractal.formula] || {};
  fractal.meta = Object.freeze({
    initial: "origin",
    newton: false,
    basinRoots: fractal.basin ? 3 : 0,
    orbitTrap: false,
    colorModes: fractal.basin ? ["escape", "basin"] : ["escape"],
    ...behavior,
  });
});

// Condensed lookup keyed by formula name. Multiple presets can share one
// formula, so keep the richest metadata seen for that formula.
const FORMULA_META = Object.freeze(FRACTALS.reduce((meta, fractal) => {
  const current = meta[fractal.formula];
  if (!current || fractal.meta.basinRoots > current.basinRoots) {
    meta[fractal.formula] = fractal.meta;
  }
  return meta;
}, {}));
