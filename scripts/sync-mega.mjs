import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { File } from 'megajs';
const url=process.env.MEGA_FOLDER_URL, out=process.env.OUTPUT_DIR||'dist', chunkSize=1900*1024*1024;
if(!url) throw new Error('MEGA_FOLDER_URL is required');
const folder=File.fromURL(url); await folder.loadAttributes();
const candidates=(folder.children||[]).filter(x=>/秋城落叶/.test(decodeURIComponent(x.name||''))).filter(x=>!/(底包|base|firmware|official)/i.test(x.name||'')).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0)||(b.name||'').localeCompare(a.name||''));
if(!candidates.length) throw new Error('No 秋城落叶 ROM found');
const file=candidates[0]; await fsp.mkdir(out,{recursive:true});
const hash=crypto.createHash('sha256'); let index=0, used=0, stream=null;
const open=()=>{const p=path.join(out,`odin-rom.zip.part-${String(index).padStart(3,'0')}`); stream=fs.createWriteStream(p); index++; used=0}; open();
for await (const chunk of file.download({forceHttps:true,maxConnections:32,initialChunkSize:4*1024*1024,chunkSizeIncrement:4*1024*1024,maxChunkSize:16*1024*1024})) { let off=0; hash.update(chunk); while(off<chunk.length){if(used===chunkSize){await new Promise((r,j)=>stream.end(e=>e?j(e):r()));open()} const n=Math.min(chunk.length-off,chunkSize-used); if(!stream.write(chunk.subarray(off,off+n))) await new Promise(r=>stream.once('drain',r)); off+=n; used+=n; }}
await new Promise((r,j)=>stream.end(e=>e?j(e):r())); const sha=hash.digest('hex'); await fsp.writeFile(path.join(out,'rom.json'),JSON.stringify({name:file.name,sha256:sha,parts:index},null,2)); console.log(JSON.stringify({name:file.name,sha256:sha,parts:index}));
