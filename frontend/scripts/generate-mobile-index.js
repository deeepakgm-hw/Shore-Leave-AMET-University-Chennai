import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.join(__dirname, '..', '.output', 'public');
const assetsDir = path.join(publicDir, 'assets');
const androidPublicDir = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'public');

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

let cssFile = '';
let jsFile = '';

if (fs.existsSync(assetsDir)) {
  const files = fs.readdirSync(assetsDir);
  const css = files.find((f) => f.startsWith('styles-') && f.endsWith('.css'));
  const js = files.find((f) => f.startsWith('index-') && f.endsWith('.js'));
  if (css) cssFile = `assets/${css}`;
  if (js) jsFile = `assets/${js}`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Shore Leave — AMET University</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  ${cssFile ? `<link rel="stylesheet" href="/${cssFile}">` : ''}
</head>
<body class="bg-background text-foreground antialiased selection:bg-primary selection:text-primary-foreground">
  <div id="root"></div>
  ${jsFile ? `<script type="module" src="/${jsFile}"></script>` : ''}
</body>
</html>
`;

fs.writeFileSync(path.join(publicDir, 'index.html'), html, 'utf8');
console.log('✔ Generated production entry index.html in .output/public');

if (fs.existsSync(androidPublicDir)) {
  fs.writeFileSync(path.join(androidPublicDir, 'index.html'), html, 'utf8');
  console.log('✔ Synced entry index.html to Android assets');
}
