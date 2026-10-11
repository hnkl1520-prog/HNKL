# SOON / Under Construction

Standalone local prototype: `/experiments/soon-stone/`.

- Four stone meshes balanced edge to edge, with a suspended base and no floor.
- Actual triangle surfaces determine the three resting contacts. Contact constraints remain joined during the small idle sway and hover rotation.
- Hover a letter to tilt around its support point. Nearby letters follow with a distance-weighted response and a slight delay; the letters above also follow the moving contact. On exit, the underdamped springs carry the stack slightly past its resting angles, then settle back. Touch holds the same pose briefly.
- Keyboard: tab through the four letter controls. Reduced-motion mode uses static poses without continuous drift.
- No floor, ground shadow, or changes to the site's existing unfinished-page routes.

`app.js` controls placement, lighting and spring motion. `contacts.js` samples the stone surfaces and maintains the joints. `stone-material.js` applies the scanned rock maps with consistent object-space triplanar sampling, including view-correct detail normals during rotation. `style.css` controls the page and responsive stage. The model can be regenerated with `tools/build-soon-stone.py` using Blender. The four nodes are `S`, `O1`, `O2`, and `N`.

The model uses broad fracture planes, chipped edges and asymmetric full-depth cuts around the O silhouettes. Shallow front-face relief is baked from the scanned height map, using the same per-letter coordinates as the browser material. The final GLB has 67,560 triangles and is 1.71 MB; only the color, normal and roughness textures load at runtime.

Active textures: Poly Haven **Rock Face 03**, CC0, 2K. Source URLs, image optimization notes and checksums are in `assets/limestone-LICENSE.txt`. The earlier **Rock Boulder Dry** set remains as an unused reference with its own `assets/TEXTURE-LICENSE.txt`. Three.js 0.182.0 is vendored under `vendor/` with its MIT license.

Verified in Chrome: all four pointer targets, return on pointer exit, touch activation and automatic release, and a 390 × 844 viewport with no horizontal overflow. During the new neighboring response and spring return, all three joints remained within 5e-16 world units; the release passed through the resting angle and settled back. One canvas and no console errors were observed.
