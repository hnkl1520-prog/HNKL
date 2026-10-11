# WIP — vector editor

Standalone comparison at `/experiments/page-states/soon-editor/`. The live 404 uses the stone version; this editor is not selected automatically.

- Drag square anchors to reshape the closed glyph contours.
- Select an anchor to expose its circular Bézier handles; drag a handle to change the curve. Smooth points keep tangent continuity, and Alt allows independent handles.
- On narrow screens, only the selected letter shows its anchors. Tap another letter to select it.
- No visible toolbar or instruction copy. Command/Ctrl + Z undoes the latest edit; reloading restores the original outlines.
- Keyboard: focus an anchor or handle, use arrow keys to move it, Shift for larger steps; brackets select neighboring anchors. Escape cancels a current drag.
- Edits remain in memory only. SVG paths and control points are local code assets; no embedded editor or external runtime is used.

`glyphs.js` contains editable cubic outlines for W/I/P, converted from Arial Regular glyphs with their natural proportions preserved. The word is centered with a 260-unit height and 64-unit gaps. No font binary is distributed. Interface typography uses the site's existing Pretendard stylesheet. Anchor points, handles and focus outlines use `--primary-50` (#3B82F6) from the shared `tokens.css`.

Verified in Chrome: anchor moves, unchanged neighboring glyphs, curve-handle edits, touch editing, and 390 × 844 / 375 × 320 layouts without horizontal overflow. No console errors.
