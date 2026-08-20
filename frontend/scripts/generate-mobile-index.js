import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.join(__dirname, '..', '.output', 'public');
const assetsDir = path.join(publicDir, 'assets');

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
  <title>Shore Leave</title>
  ${cssFile ? `<link rel="stylesheet" href="${cssFile}">` : ''}
</head>
<body class="bg-background text-foreground antialiased selection:bg-primary selection:text-primary-foreground">
  <div id="root"></div>
  ${jsFile ? `<script type="module" src="${jsFile}"></script>` : ''}
</body>
</html>
`;

fs.writeFileSync(path.join(publicDir, 'index.html'), html, 'utf8');
console.log('✔ Generated mobile index.html in .output/public');
