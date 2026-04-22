"use strict";

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

vec2 cdiv(vec2 a, vec2 b) {
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
  vec3 base;
  if      (root < 0.5) base = vec3(0.96, 0.34, 0.22);
  else if (root < 1.5) base = vec3(0.18, 0.72, 1.00);
  else if (root < 2.5) base = vec3(0.78, 0.92, 0.28);
  else                 base = vec3(0.76, 0.43, 1.00);
  float shade = 0.28 + 0.72 * pow(1.0 - clamp(iter / maxIter, 0.0, 1.0), 0.7);
  float ring = 0.86 + 0.14 * cos(TAU * (iter * 0.08 + uCycle));
  return base * shade * ring;
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
];

const FORMULA_BEHAVIOR = Object.freeze({
  julia: { initial: "julia" },
  burningJulia: { initial: "julia" },
  tricornJulia: { initial: "julia" },
  celticJulia: { initial: "julia" },
  buffaloJulia: { initial: "julia" },
  perpendicularJulia: { initial: "julia" },
  cubicJulia: { initial: "julia" },
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
});

FRACTALS.forEach(fractal => {
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

const FORMULA_META = Object.freeze(FRACTALS.reduce((meta, fractal) => {
  const current = meta[fractal.formula];
  if (!current || fractal.meta.basinRoots > current.basinRoots) {
    meta[fractal.formula] = fractal.meta;
  }
  return meta;
}, {}));
