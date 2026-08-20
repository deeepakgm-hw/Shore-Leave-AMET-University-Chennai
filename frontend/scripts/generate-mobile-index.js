import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Clean any static index.html in .output/public and dist so Cloudflare Worker executes SSR
const pathsToClean = [
  path.join(__dirname, '..', '.output', 'public', 'index.html'),
  path.join(__dirname, '..', 'dist', 'index.html'),
];

for (const p of pathsToClean) {
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log(`✔ Removed ${p} to ensure full SSR edge rendering`);
  }
}

// Write index.html ONLY to Android native assets for offline Capacitor fallback
const androidPublicDir = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'public');
const assetsDir = path.join(__dirname, '..', '.output', 'public', 'assets');

if (fs.existsSync(androidPublicDir) && fs.existsSync(assetsDir)) {
  const files = fs.readdirSync(assetsDir);
  const css = files.find((f) => f.startsWith('styles-') && f.endsWith('.css'));
  const js = files.find((f) => f.startsWith('index-') && f.endsWith('.js'));
  const cssFile = css ? `assets/${css}` : '';
  const jsFile = js ? `assets/${js}` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Shore Leave</title>
  ${cssFile ? `<link rel="stylesheet" href="${cssFile}">` : ''}
</head>
<body class="bg-background text-foreground antialiased selection:bg-primary selection:text-primary-foreground">
  <div id="root"></div>
  ${jsFile ? `<script type="module" src="${jsFile}"></script>` : ''}
</body>
</html>
`;

  fs.writeFileSync(path.join(androidPublicDir, 'index.html'), html, 'utf8');
  console.log('✔ Generated Android fallback index.html');
}
