import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const isWatch = process.argv.includes('--watch');

// Build main plugin code (runs in Figma sandbox)
// Figma's sandbox doesn't support spread operators, so target ES2015
const mainConfig = {
  entryPoints: ['src/main/code.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  format: 'iife',
  target: 'es2015',
  platform: 'neutral',
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
};

// Build UI code (runs in iframe)
const uiConfig = {
  entryPoints: ['src/ui/main.tsx'],
  bundle: true,
  outfile: 'dist/ui.js',
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
    '__BUILD_TIME__': JSON.stringify(new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })),
  },
  alias: {
    'react': 'preact/compat',
    'react-dom': 'preact/compat',
  },
};

// Generate HTML file with inlined JS
async function generateHTML() {
  const uiJS = fs.readFileSync('dist/ui.js', 'utf8');
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      color: #333;
      background: #fff;
    }

    .container {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      height: 100vh;
    }

    .header {
      text-align: center;
    }

    .header h1 {
      font-size: 16px;
      font-weight: 600;
      color: #333;
      margin-bottom: 4px;
    }

    .header p {
      font-size: 11px;
      color: #666;
    }

    .section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .label {
      font-size: 11px;
      font-weight: 500;
      color: #666;
    }

    .textarea {
      width: 100%;
      height: 120px;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-family: monospace;
      font-size: 11px;
      resize: vertical;
    }

    .textarea:focus {
      outline: none;
      border-color: #18A0FB;
    }

    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-primary {
      background: #18A0FB;
      color: white;
    }

    .btn-primary:hover:not(:disabled) {
      background: #0C8CE9;
    }

    .btn-secondary {
      background: #f5f5f5;
      color: #333;
      border: 1px solid #ddd;
    }

    .options {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      background: #f8f8f8;
      border-radius: 4px;
    }

    .option {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .option input[type="checkbox"] {
      margin: 0;
    }

    .option label {
      font-size: 11px;
    }

    .status {
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 11px;
    }

    .status.error {
      background: #FEE2E2;
      color: #DC2626;
    }

    .status.success {
      background: #ECFDF5;
      color: #059669;
    }

    .status.info {
      background: #EFF6FF;
      color: #2563EB;
    }

    .preview {
      padding: 8px;
      background: #f5f5f5;
      border-radius: 4px;
      font-size: 11px;
      overflow: hidden;
    }

    .preview-item {
      display: flex;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .preview-item:last-child {
      margin-bottom: 0;
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>${uiJS}</script>
</body>
</html>`;

  fs.writeFileSync('dist/ui.html', html);
}

// Copy manifest
function copyManifest() {
  fs.copyFileSync('manifest.json', 'dist/manifest.json');
}

// Ensure dist directory exists
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist');
}

async function build() {
  try {
    await esbuild.build(mainConfig);
    console.log('✓ Built main code');

    await esbuild.build(uiConfig);
    console.log('✓ Built UI code');

    await generateHTML();
    console.log('✓ Generated HTML');

    copyManifest();
    console.log('✓ Copied manifest');

    console.log('\\nBuild complete! Plugin ready in ./dist');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

async function watch() {
  // Watch main code
  const mainCtx = await esbuild.context({
    ...mainConfig,
    plugins: [
      {
        name: 'rebuild-notify',
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length === 0) {
              console.log('✓ Rebuilt main code');
            }
          });
        },
      },
    ],
  });

  // Watch UI code
  const uiCtx = await esbuild.context({
    ...uiConfig,
    plugins: [
      {
        name: 'rebuild-notify',
        setup(build) {
          build.onEnd(async (result) => {
            if (result.errors.length === 0) {
              await generateHTML();
              console.log('✓ Rebuilt UI + HTML');
            }
          });
        },
      },
    ],
  });

  await mainCtx.watch();
  await uiCtx.watch();

  // Initial build
  await generateHTML();
  copyManifest();

  console.log('Watching for changes...');
}

if (isWatch) {
  watch();
} else {
  build();
}
