# Snapblade backlog

Ideas and deferred work, roughly grouped. Newest requests first within each group.

## Files and export (follow-ups)
- Remember the open file across page reloads in Chrome/Edge, so Ctrl+S after a reload saves without asking again.
- Embed Instrument Sans in PDFs (they use Helvetica today).
- Recent files list.

## Diagram objects
- **Legend / key object.** A standardized, reusable legend that explains the colors, line patterns and shapes used in the diagram. Ideally it builds itself from the styles actually in use, and you add the wording.
- **Attribution object.** A standard block for author, date, version, source and status (draft, final), placed consistently, e.g. in a corner. A title block like an architectural drawing's.

## Authoring
- Text-to-diagram input in the spirit of PlantUML (`Customers -> WAF : HTTPS`), then polish by hand. The auto-layout rules apply to whatever the text creates.
- Align (lefts, centers, rights, tops, middles, bottoms) and distribute (even spacing) for a multi-selection.
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
