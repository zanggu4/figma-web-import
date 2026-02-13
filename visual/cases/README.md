# Visual Case Schema

Each `*.json` file defines one visual-compare scenario.

## Required

- `id`: unique case id
- `target.url`: target web URL

## Optional

- `viewport.width`, `viewport.height`
- `wait.selector`, `wait.timeoutMs`, `wait.networkIdle`, `wait.delayMs`
- `capture.selector` (null means full document)
- `figma.fileKey`
- `figma.nodeId` (direct targeting)
- `figma.frameName` (latest node auto-resolve)
- `figma.pageName` (optional page filter)
- `figma.fileDepth` (default 3)
- `figma.scale`
- `comparison.maxDiffRatio`, `comparison.minSSIM`, `comparison.pixelmatchThreshold`
- `masks[]` rectangle list `{ x, y, width, height }`

Environment variables override case file values:

- `FIGMA_TOKEN`
- `FIGMA_FILE_KEY`
- `FIGMA_NODE_ID`
- `FIGMA_FRAME_NAME`
- `FIGMA_PAGE_NAME`
- `FIGMA_FILE_DEPTH`
- `FIGMA_IMAGE_SCALE`

You can put these values in repository root `.env` (or `.env.local`).
