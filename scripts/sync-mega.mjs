import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { File } from 'megajs';

const url = process.env.MEGA_FOLDER_URL;
if (!url) throw new Error('MEGA_FOLDER_URL is required');
const out = process.env.OUTPUT_DIR || 'dist';
const folder = File.fromURL(url);
await folder.loadAttributes();
const candidates = (folder.children || [])
  .filter(x => /秋城落叶/.test(decodeURIComponent(x.name || '')))
  .filter(x => !/(底包|base|firmware|official)/i.test(x.name || ''))
  .sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0) || (b.name || '').localeCompare(a.name || ''));
if (!candidates.length) throw new Error('No 秋城落叶 ROM found');
const file = candidates[0];
await fsp.mkdir(out, { recursive: true });
const target = path.join(out, decodeURIComponent(file.name));
await new Promise((resolve, reject) => {
  const stream = file.download();
  stream.on('error', reject);
  stream.pipe(fs.createWriteStream(target)).on('finish', resolve).on('error', reject);
});
console.log(`Downloaded ${file.name} -> ${target}`);
