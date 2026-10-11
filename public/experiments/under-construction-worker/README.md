# Under construction — worker

Desktop-only experiment at `/experiments/under-construction-worker/`. Mobile widths (767 px and below) and primary touch pointers open the WIP editor instead.

Four handles resize an axis-aligned dashed rectangle. A tall box shows a relaxed standing worker with both feet on the floor. Lowering the box folds the knees and moves the worker toward the left wall. In the smallest box, the back and seat rest beside the wall, knees are raised, and hands rest near them. A wider, short box allows a slight backward lean.

## Illustration and movement

- `character.js` builds a flat SVG worker with a rounded facial profile, eye, ear, fingers, safety helmet, overalls and boots. There are no gradients or shading.
- Sleeves and trouser legs use closed, tapered outlines with rounded joints. Boots are drawn underneath horizontal trouser hems, with overlapping shafts, so angled shins cannot protrude through the shoes.
- `pose.js` computes joints at a constant scale of 1. Arm segments are 48/46 units; leg segments are 74/77. Body parts never stretch. Both soles stay on the lower edge; the other edges do not impose hand or foot contacts.
- Width is limited to 205–380 and height to 215–350 SVG units. The artwork is constrained before clipping; a rectangular clip remains as a final safeguard.
- Mouse handles have 44 px hit targets. Arrow keys move a focused handle; Shift increases the step. Escape cancels and Cmd/Ctrl+Z undoes a resize. No visible toolbar or instructions.
- `worker.svg` is the matching static fallback.

Pretendard, the frame's primary blue, and Go Back match the other experiments. `/404.html` remains the stone variation; this preview does not change that route.

## Validation

`node --test test/worker-deformation.test.mjs` checks the resize and fixed-length joint math.

With the local server running at port 8000, `node test/worker-browser.mjs` checks the real SVG paths and strokes across 49 frame sizes, standing and seated anatomy, floor contact, desktop dragging/undo, and mobile routing. Detailed bounds are saved to `/tmp/worker-pose-grid.json`.
