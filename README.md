# Krunked Lumia

A standalone TypeScript + WebGL2 + Web Audio synesthetic diamond falling-block puzzle game preserving crisp native `320x180` 6-color minimalist pixel-diamond art, staggered `8x29` diamond-container slide-off physics, luminance-adaptive dark/light Gaussian bloom shaders, and a beat-locked harmonic progression music engine.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173` in a WebGL2-capable browser.

## Features

- **Native 320x180 6-Color Pixel-Diamond Art**: Crisp nearest-neighbor scaling, 6x6 monochrome shape-and-color-coded diamonds, 68x128 vertical diamond container, cellular-automaton board ripples, geometric diamond background pulses, and 4-pass WebGL2 bloom (`bloom_filter_luminance`, separable `blur_2_pass_gauss_lerp`, `blend_darken` for light palettes, and `color_threshold` for 2-color album covers).
- **Staggered 8x29 Diamond Physics**: Deterministic 60 Hz simulation with 45-degree diagonal wall sliding, CW/CCW spin with lock-delay wiggle room (`slack_t = 12` ticks), alternating slide-off valley cascades, simultaneous 2x2 diamond and 3+ diagonal matching, 4x combo cap, and Perfect Clear bonuses.
- **6 Game Modes**: Marathon (450 blocks), Endless, Intense (max speed 450 blocks), Relaxed (constant speed, auto-clearing board), Rush (2-minute timed score attack), and Impossible (unlocks at 4,000,000 high score).
- **8 Beat-Locked Harmonic Tracks & 63 Palettes**: Original procedural Web Audio synthesis synced to live chord progressions, full interactive Color Palette Editor (HSV/RGB sliders, Swatch Swap, Copy, Save, Delete, Share/Import), and 30/60/120 FPS rendering with Tate 90° rotation and Board Zoom.
- **Optional Local Owned Custom Pack**: Load your own local pack directly from the Title Screen (`LOAD CUSTOM PACK`) with IndexedDB caching and instant switching between Built-In Krunked Art and Custom Pack mode.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite dev server on port 5173 |
| `npm run play` | Start strict-port Vite server for playtesting |
| `npm run typecheck` | Run strict TypeScript typecheck |
| `npm run test` | Run Vitest unit & integration suites |
| `npm run verify:assets` | Gate A: Asset, oracle, taste & IP hygiene check |
| `npm run verify:sim` | Gate B: Headless 6-mode soak & FNV-1a determinism check |
| `npm run verify` | Run all checks (`typecheck`, `test`, `verify:assets`, `verify:sim`) |
| `npm run build` | Build static `dist/` bundle |
| `npm run extract` | Extract locally owned retail assets into gitignored `.lumia-assets/` |
| `npm run oracle` | Regenerate `.lumia-assets/oracle.json` |
