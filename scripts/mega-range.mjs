import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { File } from 'megajs';
const url=process.env.MEGA_FOLDER_URL, out=process.env.OUTPUT, nameOut=process.env.NAME_OUTPUT, sizeOut=process.env.SIZE_OUTPUT; let start=Number(process.env.RANGE_START), end=Number(process.env.RANGE_END); const side=process.env.RANGE_SIDE;
if(!url||!Number.isFinite(start)||!Number.isFinite(end)||!out) throw Error('MEGA_FOLDER_URL, RANGE_START, RANGE_END, OUTPUT required');
const folder=File.fromURL(url); await folder.loadAttributes();
const xs=(folder.children||[]).filter(x=>/秋城落叶/.test(decodeURIComponent(x.name||''))).filter(x=>!/(底包|base|firmware|official)/i.test(x.name||'')).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
if(!xs.length) throw Error('No ROM'); const file=xs[0];
if(side){const midpoint=Math.ceil(file.size/2); start=side==='a'?0:midpoint; end=side==='a'?midpoint-1:file.size-1;} if(!Number.isFinite(start)||!Number.isFinite(end)) throw Error('RANGE_SIDE or RANGE_START/RANGE_END required'); const decodedName=decodeURIComponent(file.name); if(nameOut) fs.writeFileSync(nameOut, decodedName); if(sizeOut) fs.writeFileSync(sizeOut, String(file.size)); console.log(JSON.stringify({name:decodedName,size:file.size,start,end}));
const stream=file.download({start,end,forceHttps:true,maxConnections:8,initialChunkSize:4*1024*1024,chunkSizeIncrement:4*1024*1024,maxChunkSize:16*1024*1024});
const ws=fs.createWriteStream(out); let total=0,next=100*1024*1024;
for await(const chunk of stream){ws.write(chunk);total+=chunk.length;if(total>=next){console.log(`range ${start}-${end}: ${Math.round(total/1024/1024)} MiB`);next+=100*1024*1024;}}
await new Promise((r,j)=>ws.end(e=>e?j(e):r())); if(total!==end-start+1) throw Error(`short range ${total}, expected ${end-start+1}`);
