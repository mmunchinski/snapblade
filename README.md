# Snapblade

**A diagram editor whose connectors tidy themselves.**

**[Try it in your browser →](https://mmunchinski.github.io/snapblade/)** Nothing to install. Your diagrams stay in your own browser.

You place the boxes. Snapblade keeps the connectors clean: anchor points evenly spaced along each side, lines straight wherever the boxes allow, bends centered in the gap between boxes, and parallel connectors bundled without crossing. When you resize or move something, everything re-tidies, instead of leaving you to re-glue a dozen arrows by hand.

![Snapblade showing an application architecture diagram](docs/screenshot.png)

## Why

Manual tools (Visio, draw.io, Lucidchart) give you full control, and then you spend your time nudging connection points around after every resize. Diagrams-as-code tools (PlantUML, Mermaid) are fast, but you can't fix the layout they choose. Snapblade sits in between: manual placement, automatic tidiness.

## Features

- **Self-spacing anchors.** Connectors on a side spread evenly and re-space as boxes resize. The busiest side keeps even spacing, and lighter sides line up with it so lines run straight. A Visio-style mode is included for comparison.
- **Routing that respects your layout.** Right-angle connectors route around boxes and containers they don't belong to. Bends land halfway between the boxes they pass between, and bundles of connectors through the same gap are centered, evenly spaced and ordered so they don't cross.
- **Containers.** Boxes live inside containers, which can be free-form (grow to fit) or stack their contents in a row or column with even gaps.
- **Connector labels.** Placed near the start, center or end, and kept clear of boxes, other labels and other connectors.
- **Styling.** Line and fill colors from presets, a picker, hex or RGB, with fills that pair automatically as a tint of the line color. Solid, dashed and dotted lines. Light and dark themes.
- **Fast editing.** Multi-select, make same size, match colors, copy and paste style, copy, paste, duplicate, undo and redo.

## Getting started

Use it at **https://mmunchinski.github.io/snapblade/**, or open `index.html` from a clone in any modern browser (Chrome, Edge, Firefox or Safari). It's a single HTML file with no build step. Your diagram is saved in the browser as you work.

| Action | How |
|---|---|
| Add a box | Double-click empty canvas, or **+ Box** |
| Connect two boxes | Hover a box, drag one of its **+** handles onto another box |
| Rename | Double-click, press F2, or select and start typing |
| Select several | Drag a box on empty canvas, or Shift/Ctrl-click |
| Pan / zoom | Right-drag (or middle-drag, or Space+drag) / mouse wheel |
| Copy, paste, duplicate | Ctrl+C, Ctrl+V, Ctrl+D |
| Copy / paste style | Ctrl+Shift+C, Ctrl+Shift+V |

## Development

```sh
npm install
npx playwright install chromium   # first time only
npm test                          # layout tests (Node) + interaction tests (headless Chromium)
```

- `tests/layout.test.mjs` exercises the layout engine (anchors, routing, bundling, labels) without a browser.
- `tests/browser.test.mjs` drives the real app with mouse and keyboard input.

Planned work lives in [BACKLOG.md](BACKLOG.md).

## License

Copyright (C) 2026 Matt Munchinski.

Snapblade is free software, licensed under the [GNU Affero General Public License v3.0](LICENSE). You may use, modify and share it. If you distribute a modified version, or run one as a hosted service, you must make its source available under the same license.

"Snapblade" is the name of this project. Forks are welcome under the license, but please give yours a different name.
