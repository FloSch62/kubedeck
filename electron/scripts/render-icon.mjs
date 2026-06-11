import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Render the app icon from the client SVG; electron-builder derives the
// platform formats (.ico/.icns/Linux sizes) from this single PNG.
const root = path.dirname(fileURLToPath(import.meta.url));
const svg = path.resolve(root, '../../client/public/kubedeck.svg');
const png = path.resolve(root, '../build/icon.png');

const mtime = async (p) => (await stat(p).catch(() => undefined))?.mtimeMs ?? 0;

if ((await mtime(png)) > (await mtime(svg))) {
  process.exit(0);
}

await mkdir(path.dirname(png), { recursive: true });
await sharp(svg, { density: 300 }).resize(1024, 1024).png().toFile(png);
console.log(`rendered ${png}`);
