# One Mount — Helix Form Studio

A browser-based 3D rebrand concept inspired by the supplied One Mount Möbius logo. A continuous, broad ribbon opens from a closed loop into a rising helix. This is a parametric interpretation of the mark, not an exact vector reconstruction.

Run `npm run dev`, then open http://127.0.0.1:4321/. No package installation is needed: Three.js 0.180.0 and its MIT license are vendored locally. Build deployable files with `npm run build`.

## Spatial evolution presentation

Open `evolution.html` directly, or visit http://127.0.0.1:4321/evolution.html. The presentation deforms one solid three-dimensional ribbon from the original Möbius loop into a spiral following the outside of a funnel. The supplied construction diagrams guide the flared mouth, narrowing shoulder, and winding tail. Every stage can be inspected with orbit controls. Original angle, Horizontal view, Funnel view, and 3D view provide camera shortcuts.

The evolution scrubber and four stages control the same mesh and preserve form settings. Endpoint controls adjust turns, axial extension, band coverage, end radius, funnel curve, tail length, turn distribution, and end width. Turn distribution 1 gives even axial spacing; other values redistribute the turns within the chosen length. Cone, Horn, and Tornado provide starting forms. Funnel view stands the model upright with its mouth at the top; Horizontal view presents it along the original sketch’s direction.

Solid, real 3D edge, and combined views expose the spatial construction. PNG export supports transparent backgrounds and up to a 4096-pixel long edge.

The generated HTML embeds Three.js, all geometry, controls, styles, and reference images, so it works offline in a modern browser with WebGL 2. Save HTML preserves the current form options, evolution position, material, and camera angle. Run `node build-evolution.mjs` to regenerate it from `evolution.template.html`, `evolution.css`, `evolution.js`, and `spatial-evolution-geometry.js`; `npm run build` also performs this step.

## Controls

- Möbius / Growth / Helix tabs switch between evolution stages. Other geometry settings, object rotation, materials, camera, and export options carry across. Each tab remembers its edited evolution value.
- Evolution opens the loop and increases its height and number of turns. Turns and rise per turn control the final helix.
- Ribbon width, radius, edge thickness, twist, width variation, and asymmetry change the form.
- At zero growth, twist converges to a multiple of 180 degrees so the closed seam meets. Odd half turns form a Möbius ribbon; whole turns form a regular closed ribbon. The twist readout shows the effective angle.
- Drag to orbit, scroll to zoom, right-drag to pan. On touchscreens use one finger to orbit and two fingers to zoom/pan. Fit frames the mesh; the F key also fits it.
- Choose Rotate shape to drag the ribbon itself, or open Object rotation for X, Y, and Z sliders. Reset rotation clears only the object's rotation. Auto orbit rotates the camera independently.
- Logo angle restores the reference-inspired camera angle while preserving shape and material settings. The Möbius preset also uses this angle.
- Satin, Chrome, and Matte finishes work with an editable color and four backgrounds.
- Save image exports only the 3D scene as a PNG. Choose a 1200, 2400, or 4096 pixel long edge and current-view, square, landscape (4:3), or portrait (3:4) framing. Transparent exports omit the background and ground shadow.
- Copy settings copies parameter JSON, with a JSON download fallback when the browser blocks clipboard access.
- The browser saves the workspace, including camera and export settings, across page refreshes. Reset explicitly restores the studio defaults.

Extreme combinations of width, pitch, and twist can intersect. Controls are intended for concept exploration. WebGL 2 is required.

## Source

`geometry.js` contains the parametric sweep, rounded rectangular cross section, closed seam mapping, and helix end caps. `app.js` provides the renderer, camera, controls, lighting, and PNG export. `index.html` and `styles.css` define the studio. The original reference remains in `assets/logo.png`.
