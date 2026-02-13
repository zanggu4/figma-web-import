# Figma Web Import

Import web pages into Figma as editable designs.

## Overview

This project consists of two main components:
1. **Chrome Extension** - Captures DOM/CSS from web pages
2. **Figma Plugin** - Converts captured data to editable Figma nodes

## Architecture

```
┌─────────────────────────┐     ┌─────────────────────────┐
│   Chrome Extension      │     │     Figma Plugin        │
│   (Manifest V3)         │────►│                         │
├─────────────────────────┤     ├─────────────────────────┤
│ • Content Script        │     │ • Plugin UI (Preact)    │
│   - DOM traversal       │     │ • Main Code (Sandbox)   │
│   - getComputedStyle    │     │   - Node Factory        │
│   - getBoundingRect     │     │   - Style Applier       │
│ • Popup UI (Preact)     │     │   - Layout Engine       │
│ • Service Worker        │     │                         │
└─────────────────────────┘     └─────────────────────────┘
         │                                  │
         └──────────┬───────────────────────┘
                    ▼
         ┌─────────────────────┐
         │   Shared Library    │
         │   (dom-to-layer)    │
         └─────────────────────┘
```

## Project Structure

```
figma-web-import/
├── packages/
│   ├── shared/                    # Shared types and converters
│   │   └── src/
│   │       ├── types/layer-meta.ts
│   │       └── converters/
│   │           ├── dom-to-layer.ts
│   │           ├── style-parser.ts
│   │           └── color-utils.ts
│   │
│   ├── chrome-extension/          # Chrome Extension
│   │   └── src/
│   │       ├── background/service-worker.ts
│   │       ├── content/capture.ts
│   │       └── popup/App.tsx
│   │
│   └── figma-plugin/              # Figma Plugin
│       └── src/
│           ├── main/
│           │   ├── code.ts
│           │   ├── node-factory.ts
│           │   ├── style-applier.ts
│           │   └── layout-engine.ts
│           └── ui/App.tsx
│
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## Setup

### Prerequisites
- Node.js 20+
- pnpm 9+

### Installation

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## Development

### Chrome Extension

```bash
cd packages/chrome-extension
pnpm dev
```

Load the extension in Chrome:
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `packages/chrome-extension/dist` directory

### Figma Plugin

```bash
cd packages/figma-plugin
pnpm dev
```

Load the plugin in Figma:
1. Open Figma
2. Go to Plugins > Development > Import plugin from manifest
3. Select `packages/figma-plugin/dist/manifest.json`

## Usage

1. **Capture a web page:**
   - Open any web page in Chrome
   - Click the extension icon
   - Click "Capture Full Page" or enter a CSS selector
   - Click "Copy to Clipboard"

2. **Import to Figma:**
   - Open Figma
   - Run the Web Import plugin
   - Paste the captured data
   - Adjust options if needed
   - Click "Import to Figma"

## Visual Parity Automation

You can automate visual comparison between:
- target web screenshot (captured by Playwright)
- imported Figma frame screenshot (fetched from Figma API)

### One-time setup

```bash
pnpm install
pnpm --filter @figma-web-import/shared build:iife
```

Configure case file:
- `visual/cases/example.local.json`

Configure `.env` values:
```bash
cp .env.example .env
```
- `FIGMA_TOKEN`
- `FIGMA_FILE_KEY`
- `FIGMA_NODE_ID` (optional)
- `FIGMA_FRAME_NAME` (recommended for repeated imports)

If `FIGMA_NODE_ID` is empty and `FIGMA_FRAME_NAME` is set, the script resolves the newest matching frame automatically.

### Full run (manual import once, then automated compare)

```bash
pnpm visual:case
```

Flow:
1. Script captures `web.png` + `capture.json`
2. You paste `capture.json` into Figma plugin and click Import
3. Script fetches `figma.png`, compares images, and writes report

### Compare only (no wait/prompt)

```bash
pnpm visual:all -- --mode compare --no-wait
```

Artifacts are written to `visual/artifacts/<case-id>/`:
- `web.png`
- `capture.json`
- `figma.png`
- `diff.png`
- `report.json`
- `report.md`

## Supported Conversions

### Element Mapping
| HTML | Figma |
|------|-------|
| div, section, article | Frame |
| p, h1-h6, span | Text |
| img | Rectangle + Image Fill |
| button | Frame + Text |

### Style Mapping
| CSS | Figma |
|-----|-------|
| background-color | fills (SOLID) |
| border | strokes |
| box-shadow | effects (DROP_SHADOW) |
| border-radius | cornerRadius |
| display: flex | layoutMode: HORIZONTAL/VERTICAL |
| justify-content | primaryAxisAlignItems |
| align-items | counterAxisAlignItems |
| gap | itemSpacing |
| padding | paddingTop/Right/Bottom/Left |

## License

MIT
