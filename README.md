# Tempest Globe

A snow globe with a living neon Art Deco city inside it. Shake it and a hurricane hits. Turn it upside down and everything falls. Put it back and emergency crews rebuild.

No interface. Three.js and WebGL2, one self-contained HTML file.

**[Watch the video](../../releases/latest/download/tempest-globe.mp4)** · **[Download the source](../../releases/latest/download/tempest-globe-source.zip)**

## Run it

Open `tempest-globe.html` in Chrome or Edge. It works offline. The first load takes a few seconds while shaders compile. A dedicated graphics card is recommended.

| Action | Result |
|---|---|
| Drag the globe back and forth hard | Hurricane, then a tornado |
| Right-drag or Shift-drag down | Turns it upside down |
| Double-click | Sets it upright and zooms out |
| Scroll | Zooms toward the cursor, down to dancers inside the clubs |
| Drag the background | Orbits the camera |
| Hold Space | Slow motion |
| Click once | Starts the sound |

## Build it

```
npm install
npm run build
```

This writes `tempest-globe.html`.

## How it works

| File | What it does |
|---|---|
| `src/world.js` | Island, streets, towers as bonded chunks |
| `src/physics.js` | Breakable-bond destruction and rigid clusters |
| `src/weather.js` | Storm energy, wind, tornado, lightning, flood, day and night |
| `src/life.js` | Traffic, police chase, pedestrians, clubs, boats, aircraft, sea life |
| `src/chaos.js` | Fires, destruction, and the rebuild |
| `src/audio.js` | All sound and music, synthesised live and placed in 3D |
| `src/render.js`, `src/glsl_*.js` | Render pipeline and shaders |

Third-party code: three.js (MIT). See `THIRD_PARTY_LICENSES.md`.
