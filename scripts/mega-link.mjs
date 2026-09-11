import { File } from 'megajs';
const folder=File.fromURL(process.env.MEGA_FOLDER_URL); await folder.loadAttributes();
const xs=(folder.children||[]).filter(x=>/秋城落叶/.test(decodeURIComponent(x.name||''))).filter(x=>!/(底包|base|firmware|official)/i.test(x.name||'')).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
if(!xs.length) throw Error('No ROM'); const modern=await xs[0].link({noKey:false}); const m=modern.match(/\/file\/[^,]+,([^#]+)#(.+)$/); if(!m) throw Error('Unexpected Mega link '+modern); console.log(JSON.stringify({name:decodeURIComponent(xs[0].name),url:`https://mega.nz/#!${m[1]}!${m[2]}`}));
