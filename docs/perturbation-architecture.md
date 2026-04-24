# Perturbation Architecture

Status: first implementation slice  
Current scope: Mandelbrot CPU refinement only

## Why This Exists

The original CPU refinement path recomputed a full orbit for every pixel.
That works well at moderate zoom, but at deep zoom the viewport is full of
points whose orbits are only tiny variations around the center orbit.

Perturbation changes the work model:

1. compute one high-value reference orbit for the viewport center
2. express every nearby pixel as a small delta from that reference point
3. evolve the delta instead of recomputing the whole orbit from scratch

This is the first real deep-zoom backend in the project.

## What Ships In This Slice

- Mandelbrot perturbation in the CPU refinement backend
- worker-compatible reference-orbit snapshots
- explicit backend labels in the UI: `Perturb`, `Perturb...`, `Perturb xN`
- fallback to the old CPU escape path when perturbation becomes unreliable

## What Does Not Ship Yet

- arbitrary-precision camera storage
- perturbation for Burning Ship, Tricorn, or the wider catalog
- rebase / multi-reference logic
- glitch maps or perturbation diagnostics UI

Because camera state is still stored as JavaScript `number`, this slice improves
deep-zoom rendering efficiency and local stability, but it does not yet solve
every precision limit in navigation itself.

## Reference Orbit

The refinement snapshot may choose backend `perturbMandelbrot`.
When it does, `makeCpuSnapshot()` builds:

- `referenceOrbit.cx`
- `referenceOrbit.cy`
- `referenceOrbit.orbitX`
- `referenceOrbit.orbitY`
- `referenceOrbit.length`

Those arrays contain the center-point Mandelbrot orbit:

```text
Z(n+1) = Z(n)^2 + C_ref
```

with `Z(0) = 0`.

## Delta Iteration

For each pixel, the pixel parameter is written as:

```text
c = C_ref + dc
z = Z_ref + dz
```

Substituting into the Mandelbrot recurrence gives:

```text
dz(n+1) = 2 * Z_ref(n) * dz(n) + dz(n)^2 + dc
```

This is the perturbation step used by `perturbEscapeMandelbrot()`.

## Fallback Behavior

Perturbation is only useful while the delta stays meaningfully small.
If the delta grows too large or becomes non-finite, the implementation falls
back to the existing `cpuEscape("mandelbrot", ...)` path for that sample.

That fallback is intentional:

- it localizes perturbation glitches
- it keeps the first implementation slice safe
- it avoids pretending the approximation is valid when it is not

## Backend Selection

`shouldUsePerturbationBackend(snapshot)` currently enables perturbation only
when:

- the active formula is Mandelbrot
- zoom is beyond `PERTURB_MIN_ZOOM`

Everything else stays on the previous CPU backend.

## Diagnostics

The inspector now exposes two lightweight runtime signals for the perturbation backend:

- `Perturb`
  a coarse health label derived from fallback rate
- `Ref Orbit`
  the number of orbit samples stored in the current reference orbit

The fallback rate is accumulated from real CPU refinement work, including worker batches.
It is not a static estimate. A high fallback rate means the current reference orbit is
still producing correct pixels through fallback, but the perturbation approximation is
losing efficiency or local stability for that view.

## Main Files

- `app.js`
  backend selection, reference orbit generation, perturbation escape, worker integration
- `docs/perturbation-architecture.md`
  developer overview and design notes

## Next Steps

1. move camera center / target storage beyond plain `number`
2. add rebase logic so a single bad reference orbit does not dominate a region
3. add Burning Ship perturbation
4. add explicit diagnostics for fallback rate and backend health
