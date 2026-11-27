# One Mount — Helix Form Studio

A browser-based 3D rebrand concept inspired by the supplied One Mount Möbius logo. A continuous, broad ribbon opens from a closed loop into a rising helix. This is a parametric interpretation of the mark, not an exact vector reconstruction.

Run `npm run dev`, then open http://127.0.0.1:4321/. No package installation is needed: Three.js 0.180.0 and its MIT license are vendored locally. Build deployable files with `npm run build`.

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
