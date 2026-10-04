# Snapblade backlog

Ideas and deferred work, roughly grouped. Newest requests first within each group.

## Next up
1. **Text-to-diagram input, PlantUML style.** Type `Customers -> WAF : HTTPS` and get boxes and labeled connectors, laid out with the existing rules, then polish by hand. Also worth considering: importing existing PlantUML or Mermaid files. This is the feature most likely to bring in other architects.
2. **Align and distribute** for a multi-selection (lefts, centers, rights, tops, middles, bottoms; even spacing), next to "Make the same size" in the selection panel.

## Done so far (build 18)
Self-tidying anchors and routing, bundles, containers, connector labels, colors with paired fills, multi-select with same size and match colors, copy/paste (shapes and styles), save/open `.snapblade` files, export to SVG/PNG/PDF, title block and legend. Published on GitHub Pages.

## Files and export (follow-ups)
- Remember the open file across page reloads in Chrome/Edge, so Ctrl+S after a reload saves without asking again.
- Embed Instrument Sans in PDFs (they use Helvetica today).
- Recent files list.

## Title block and legend (follow-ups)
- Optional extra title block fields: status (draft, final), source or project, a logo.
- Legend rows you add by hand, for meanings that aren't a color (e.g. a "⚡ async" note).
- Reuse a title block and legend setup across diagrams (a template, or "copy from another file").

## Authoring
- Default style for new boxes ("use this box's style for new boxes").
- System clipboard copy/paste, so shapes can move between tabs and documents.
- Dragging several shapes at once into or out of a container.
- Right-click menu: a click without moving opens a menu (copy, paste, same size, match colors); right-drag keeps panning.

## Styling
- Text color, font size and weight for box text and connector labels.
- Line weight for boxes and connectors.
- Selecting several connectors at once (Shift-click a line), so "Match colors" works on connectors.

## Connectors
- Drag a connector's middle segment by hand, and have it stay put through later layout changes.
- Drag a connector label to a custom spot that sticks.
- Setting for the label's distance from the box (currently 20 px at both ends).
- When a side is crowded, let anchors spill around the corner to the adjacent side (as a setting).
- Tall boxes: option to group anchors toward the end facing the connected boxes instead of spreading them over the whole side.
- Choose Auto sides by trying each candidate and keeping the cleanest route, instead of choosing sides before routing.
- Remove crossings between different bundles, not just within one.
- Optionally apply straightening on mouse release instead of live, so anchors don't jump while dragging.

## Interop
- Visio (.vsdx) export, and possibly import.
- draw.io export.

## Housekeeping
- Check "Snapblade" for existing trademarks and domains before any public launch.
