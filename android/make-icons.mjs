// Writes the Meridian launcher icon at every Android density into <out>/mipmap-*/ic_launcher.png
// (the same drawing as the Windows icon, tools/icon.mjs).   node android/make-icons.mjs <out>
import fs from 'node:fs';
import path from 'node:path';
import { icon } from '../tools/icon.mjs';

const out = process.argv[2];
if (!out) throw new Error('usage: node android/make-icons.mjs <res-dir>');
for (const [density, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  const dir = path.join(out, `mipmap-${density}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), icon(size));
}
console.log(`icons written to ${out}`);
