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
    float r = length(z);
    float a = atan(z.y, z.x) * 8.0;
    float rp = pow(r, 8.0);
    z = vec2(cos(a), sin(a)) * rp + c;
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

// ─── Fractals registry ────────────────────────────────────────────────────────

const FRACTALS = [
  { name: "Mandelbrot Set",      category: "Classic",       src: mandelbrotFrag,       center: [-0.5, 0.0], scale: 3.5, julia: false, formula: "mandelbrot" },
  { name: "Julia Set",           category: "Julia",         src: juliaFrag,            center: [0.0,  0.0], scale: 3.5, julia: true,  formula: "julia" },
  { name: "Burning Ship",        category: "Classic",       src: burningShipFrag,      center: [-0.5,-0.5], scale: 3.5, julia: false, formula: "burningShip" },
  { name: "Tricorn (Mandelbar)", category: "Classic",       src: tricornFrag,          center: [0.0,  0.0], scale: 3.5, julia: false, formula: "tricorn" },
  { name: "Cubic Multibrot",     category: "Power",         src: cubicMultibrotFrag,   center: [0.0,  0.0], scale: 3.0, julia: false, formula: "cubic" },
  { name: "Quartic Multibrot",   category: "Power",         src: quarticMultibrotFrag, center: [0.0,  0.0], scale: 3.0, julia: false, formula: "quartic" },
  { name: "Celtic Mandelbrot",   category: "Folded",        src: celticFrag,           center: [-0.2, 0.0], scale: 3.2, julia: false, formula: "celtic" },
  { name: "Buffalo",             category: "Folded",        src: buffaloFrag,          center: [-0.2, 0.0], scale: 3.2, julia: false, formula: "buffalo" },
  { name: "Phoenix Julia",       category: "Julia",         src: phoenixFrag,          center: [0.0,  0.0], scale: 3.2, julia: true,  formula: "phoenix" },
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
  { name: "Cubic Burning Ship",  category: "Folded",        src: burningShipCubicFrag, center: [0.0, -0.2], scale: 3.2, julia: false, formula: "burningCubic" },
  { name: "Octic Multibrot",     category: "Power",         src: octicMultibrotFrag,   center: [0.0,  0.0], scale: 2.4, julia: false, formula: "octic" },
  { name: "Sine Mandelbrot",     category: "Transcendental", src: sineMandelbrotFrag,  center: [0.0,  0.0], scale: 6.0, julia: false, formula: "sine" },
  { name: "Mandelbox",           category: "Box Fold",      src: mandelboxFrag,        center: [0.0,  0.0], scale: 4.0, julia: false, formula: "mandelbox" },
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
const MINIMAP_ITER = 56;
const CPU_DPR = 1;
const CPU_FRAME_BUDGET_MS = 10;
const CPU_REFINE_DELAY_MS = 180;
const CPU_PASSES = [8, 4, 2, 1];
const CPU_MAX_WORKERS = 8;
const CPU_WORKER_COUNT_OVERRIDE = 8;
const CPU_WORKER_BATCH_BLOCKS = 2048;

const state = {
  fractalIdx: 0,
  palette: 0,
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

function resetView(idx) {
  const f = FRACTALS[idx ?? state.fractalIdx];
  setCameraTarget(f.center[0], f.center[1], f.scale / Math.max(canvas.width || 800, 1), true);
}

function setCameraTarget(cx, cy, pixelScale, immediate = false) {
  const fallback = FRACTALS[state.fractalIdx].scale / Math.max(canvas.width || 800, 1);
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

function previewEscape(fractalIdx, x, y) {
  const formula = FRACTALS[fractalIdx].formula || "mandelbrot";
  const jc = getRenderJuliaC(fractalIdx);
  let zx = 0, zy = 0, cx = x, cy = y, px = 0, py = 0;

  if (formula === "julia" ||
      formula === "burningJulia" ||
      formula === "tricornJulia" ||
      formula === "celticJulia" ||
      formula === "buffaloJulia" ||
      formula === "perpendicularJulia" ||
      formula === "cubicJulia") {
    zx = x; zy = y; cx = jc[0]; cy = jc[1];
  } else if (formula === "phoenix") {
    zx = x; zy = y; cx = -0.5 + 0.32 * jc[0]; cy = 0.32 * jc[1];
  } else if (formula === "lambda") {
    zx = 0.5; zy = 0; cx = x; cy = y;
  } else if (formula === "mandelbox") {
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
    } else if (formula === "tricorn" || formula === "tricornJulia") {
      nx = x2 - y2 + cx;
      ny = -2 * xy + cy;
    } else if (formula === "cubic" || formula === "cubicJulia") {
      nx = zx * (x2 - 3 * y2) + cx;
      ny = zy * (3 * x2 - y2) + cy;
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
    } else if (formula === "octic") {
      const r = Math.hypot(zx, zy);
      const a = Math.atan2(zy, zx) * 8;
      const rp = Math.pow(r, 8);
      nx = Math.cos(a) * rp + cx;
      ny = Math.sin(a) * rp + cy;
    } else if (formula === "sine") {
      const yy = Math.max(-8, Math.min(8, zy));
      nx = Math.sin(zx) * Math.cosh(yy) + cx;
      ny = Math.cos(zx) * Math.sinh(yy) + cy;
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
  return `
const TAU = Math.PI * 2;

function cpuEscape(formula, x, y, maxIter, jc) {
  let zx = 0, zy = 0, cx = x, cy = y, px = 0;

  if (formula === "julia" ||
      formula === "burningJulia" ||
      formula === "tricornJulia" ||
      formula === "celticJulia" ||
      formula === "buffaloJulia" ||
      formula === "perpendicularJulia" ||
      formula === "cubicJulia") {
    zx = x; zy = y; cx = jc[0]; cy = jc[1];
  } else if (formula === "phoenix") {
    zx = x; zy = y; cx = -0.5 + 0.32 * jc[0]; cy = 0.32 * jc[1];
  } else if (formula === "lambda") {
    zx = 0.5; zy = 0; cx = x; cy = y;
  } else if (formula === "mandelbox") {
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
    } else if (formula === "tricorn" || formula === "tricornJulia") {
      nx = x2 - y2 + cx;
      ny = -2 * xy + cy;
    } else if (formula === "cubic" || formula === "cubicJulia") {
      nx = zx * (x2 - 3 * y2) + cx;
      ny = zy * (3 * x2 - y2) + cy;
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
    } else if (formula === "octic") {
      const r = Math.hypot(zx, zy);
      const a = Math.atan2(zy, zx) * 8;
      const rp = Math.pow(r, 8);
      nx = Math.cos(a) * rp + cx;
      ny = Math.sin(a) * rp + cy;
    } else if (formula === "sine") {
      const yy = Math.max(-8, Math.min(8, zy));
      nx = Math.sin(zx) * Math.cosh(yy) + cx;
      ny = Math.cos(zx) * Math.sinh(yy) + cy;
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
    if (!Number.isFinite(mag2)) return { iter: n + 1, mag2: 1e9 };
    if (mag2 > 256) return { iter: n + 1, mag2 };
  }

  return { iter: maxIter, mag2: zx * zx + zy * zy };
}

function cpuColor(sample, maxIter, paletteIdx, cycle) {
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
  return shifts.map(shift => Math.round((0.5 + 0.5 * Math.cos(TAU * (t + shift))) * 255));
}

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
      snapshot.cycle
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
  let zx = 0, zy = 0, cx = x, cy = y, px = 0;

  if (formula === "julia" ||
      formula === "burningJulia" ||
      formula === "tricornJulia" ||
      formula === "celticJulia" ||
      formula === "buffaloJulia" ||
      formula === "perpendicularJulia" ||
      formula === "cubicJulia") {
    zx = x; zy = y; cx = jc[0]; cy = jc[1];
  } else if (formula === "phoenix") {
    zx = x; zy = y; cx = -0.5 + 0.32 * jc[0]; cy = 0.32 * jc[1];
  } else if (formula === "lambda") {
    zx = 0.5; zy = 0; cx = x; cy = y;
  } else if (formula === "mandelbox") {
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
    } else if (formula === "tricorn" || formula === "tricornJulia") {
      nx = x2 - y2 + cx;
      ny = -2 * xy + cy;
    } else if (formula === "cubic" || formula === "cubicJulia") {
      nx = zx * (x2 - 3 * y2) + cx;
      ny = zy * (3 * x2 - y2) + cy;
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
    } else if (formula === "octic") {
      const r = Math.hypot(zx, zy);
      const a = Math.atan2(zy, zx) * 8;
      const rp = Math.pow(r, 8);
      nx = Math.cos(a) * rp + cx;
      ny = Math.sin(a) * rp + cy;
    } else if (formula === "sine") {
      const yy = Math.max(-8, Math.min(8, zy));
      nx = Math.sin(zx) * Math.cosh(yy) + cx;
      ny = Math.cos(zx) * Math.sinh(yy) + cy;
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
    if (!Number.isFinite(mag2)) return { iter: n + 1, zx, zy, mag2: 1e9 };
    if (mag2 > 256) return { iter: n + 1, zx, zy, mag2 };
  }

  return { iter: maxIter, zx, zy, mag2: zx * zx + zy * zy };
}

function cpuColor(sample, maxIter, paletteIdx, cycle) {
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
    snap.cycle
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

  const { prog, loc } = programs[state.fractalIdx];
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
