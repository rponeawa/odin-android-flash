import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Adb,AdbDaemonTransport,AdbSignatureAuthenticator,AdbPublicKeyAuthenticator} from '@yume-chan/adb';
import {AdbDaemonWebUsbDeviceManager} from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import './style.css';

const BASE='https://bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com/OS1.0.2.0.UKMCNXM/odin_images_OS1.0.2.0.UKMCNXM_20240425.0000.00_14.0_cn_d3eb80577c.tgz';
const REPO='https://api.github.com/repos/rponeawa/odin-android-flash/releases';
const AUTH='https://file.xkji.com/xiaomi/api/issue';
const TWRP='https://github.com/rponeawa/odin-android-flash/releases/latest/download/qlp_twrp.img';
const CHUNK=64*1024;

async function connectAdb(){
  if(!navigator.usb) throw Error('当前浏览器不支持 WebUSB，请使用 Chrome 或 Edge');
  const manager=AdbDaemonWebUsbDeviceManager.BROWSER;
  const device=await manager.requestDevice();
  const connection=await device.connect();
  const transport=await AdbDaemonTransport.authenticate({serial:device.serial,connection,credentialStore:new AdbWebCredentialStore('odin-flash'),authenticators:[AdbSignatureAuthenticator,AdbPublicKeyAuthenticator]});
  return new Adb(transport);
}
async function pushAndCollect(adb){
  const sync=await adb.sync();
  const bin=await fetch('https://github.com/rponeawa/odin-android-flash/releases/latest/download/qlp_collect').then(r=>{if(!r.ok)throw Error('采集程序下载失败');return r.blob()});
  await sync.write({filename:'/tmp/qlp_collect',file:bin.stream(),permission:0o755});
  const p=await adb.subprocess.noneProtocol.spawn(['sh','-c','/tmp/qlp_collect qlp_flash']);
  const out=await new Response(p.output).blob();
  if(!out.size) throw Error('采集程序没有生成授权请求');
  return out;
}
async function issueAuthorization(request){
  const fd=new FormData(); fd.append('file',request,'request.zip');
  const r=await fetch(AUTH,{method:'POST',body:fd});
  if(!r.ok) throw Error(`授权服务 HTTP ${r.status}`);
  const d=await r.json(); if(!d.ok||!d.download) throw Error(d.error||'授权服务未返回授权包');
  return {blob:await fetch(d.download).then(x=>x.blob()),name:d.filename||'authorization.zip'};
}
async function sendSideload(adb,stream,onProgress,total){
  const socket=await adb.createSocket('sideload-host');
  const writer=socket.writable.getWriter(); const reader=socket.readable.getReader();
  let sent=0;
  const send=async bytes=>{const h=new Uint8Array(4);new DataView(h.buffer).setUint32(0,bytes.length,true);await writer.write(h);await writer.write(bytes);};
  const readStatus=async()=>{const h=await reader.read(); if(h.done) throw Error('sideload 连接已断开'); const b=h.value; const s=new TextDecoder().decode(b); if(s.startsWith('FAIL')) throw Error(s.slice(4)); return s;};
  const src=stream.getReader(); let buf;
  while(true){const n=await src.read();if(n.done)break;buf=n.value;for(let i=0;i<buf.length;i+=CHUNK){const part=buf.subarray(i,Math.min(i+CHUNK,buf.length));await send(part);sent+=part.length;onProgress(sent,total);await readStatus();}}
  const done=new Uint8Array(4);new DataView(done.buffer).setUint32(0,0,true);await writer.write(done);await readStatus();await writer.close();await reader.cancel();await socket.close();
}
async function rangedDownload(url,onProgress){
  const head=await fetch(url,{method:'HEAD'});const total=Number(head.headers.get('content-length'))||0;if(!total)return fetch(url).then(r=>r.blob());
  const parts=[];let done=0;for(let start=0;start<total;start+=8*1024*1024){const end=Math.min(total-1,start+8*1024*1024-1);let ok=false;for(let retry=0;retry<3&&!ok;retry++){const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),50000);try{const r=await fetch(url,{headers:{Range:`bytes=${start}-${end}`},signal:ctl.signal});if(!r.ok&&r.status!==206)throw Error(`HTTP ${r.status}`);parts.push(await r.arrayBuffer());done=end+1;onProgress(done,total);ok=true;}catch(e){if(retry===2)throw e;}finally{clearTimeout(timer);}}}return new Blob(parts);
}
function App(){
 const [step,setStep]=useState(0),[releases,setReleases]=useState([]),[rom,setRom]=useState(null),[progress,setProgress]=useState(null),[busy,setBusy]=useState('');
 const [adb,setAdb]=useState(null),[fastboot,setFastboot]=useState(null),[message,setMessage]=useState('');
 useEffect(()=>{fetch(REPO).then(r=>r.json()).then(xs=>setReleases(xs.filter(x=>!/(底包|base|firmware)/i.test(x.name||'')&&x.assets?.some(a=>/\.part-[ab]-\d+$/.test(a.name))))).catch(e=>setMessage(e.message));},[]);
 const connect=async()=>{setBusy('连接 fastboot');try{const f=new FastbootDevice();await f.connect();setFastboot(f);setMessage('已连接 fastboot');setStep(1);}catch(e){setMessage(e.message)}finally{setBusy('')}};
 const bootTwrp=async()=>{if(!fastboot)return;setBusy('启动 TWRP');try{const blob=await fetch(TWRP).then(r=>r.blob());await fastboot.bootBlob(blob,p=>setProgress({label:'上传 TWRP',done:p.bytesSent||0,total:p.totalBytes||blob.size}));setMessage('TWRP 已启动，请等待 ADB');setStep(3);setBusy('等待 ADB');const a=await connectAdb();setAdb(a);setMessage(`已连接 ${a.serial}`);}catch(e){setMessage(e.message)}finally{setBusy('')}};
 const authorize=async()=>{if(!adb)return;setBusy('采集中');try{const req=await pushAndCollect(adb);setBusy('提交授权');const issued=await issueAuthorization(req);setBusy('刷入授权包');await sendSideload(adb,issued.blob.stream(),(d,t)=>setProgress({label:'刷入授权包',done:d,total:t}),issued.blob.size);setMessage('授权包已自动刷入');setStep(4);}catch(e){setMessage(e.message)}finally{setBusy('');setProgress(null)}};
 const flash=async()=>{if(!adb||!rom)return;setBusy('下载并刷入');try{const assets=rom.assets.filter(a=>/\.part-[ab]-\d+$/.test(a.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));const total=assets.reduce((n,a)=>n+Number(a.size||0),0);let done=0;const stream=new ReadableStream({async pull(c){if(!this.i)this.i=0;if(this.i>=assets.length){c.close();return}const a=assets[this.i++];const r=await fetch(a.browser_download_url);if(!r.ok)throw Error(`下载分卷失败 HTTP ${r.status}`);const rd=r.body.getReader();while(true){const x=await rd.read();if(x.done)break;done+=x.value.length;setProgress({label:`下载并刷入 ${Math.round(done/total*100)}%`,done,total});c.enqueue(x.value)} }});await sendSideload(adb,stream,(d,t)=>setProgress({label:'刷入刷机包',done:d,total:t}),total);await adb.power.reboot();setStep(5);setMessage('刷机包已刷入，设备正在重启');}catch(e){setMessage(e.message)}finally{setBusy('');setProgress(null)}};
 const titles=['连接','底包','TWRP','授权','刷机包','完成'];return <><header><strong><span>odin</span> Xiaomi MIX 4 刷机</strong></header><main><nav>{titles.map((x,i)=><i className={i<=step?'on':''} key={x}/>)}</nav>{step===0&&<Page title="连接设备"><p>使用 Chrome 或 Edge 连接处于 TWRP 的 MIX 4。连接后授权和刷机包会自动处理。</p><Panel icon="usb"><Actions onClick={connect} disabled={!!busy}>{busy||'连接设备'}</Actions>{message&&<div className="result">{message}</div>}</Panel></Page>}{step===1&&<Page title="官方底包"><p>先使用清除所有数据的方式刷入官方底包，并保持设备在 fastboot。</p><div className="warning">此操作会清除手机上的全部数据。</div><Panel icon="download"><a href={BASE} target="_blank" rel="noreferrer">打开官方底包</a><Actions onClick={bootTwrp}>底包已完成，自动启动 TWRP</Actions></Panel></Page>}{step===2&&<Page title="临时启动 TWRP"><p>页面会通过 WebUSB 自动执行 fastboot boot。</p><Panel icon="memory"><Actions onClick={bootTwrp} disabled={!fastboot||!!busy}>{busy||'自动启动 TWRP'}</Actions></Panel></Page>}{step===3&&<Page title="自动授权"><p>采集、提交授权和刷入授权包会在浏览器端连续完成。</p><Panel icon="vpn_key"><Actions onClick={authorize} disabled={!adb||!!busy}>{busy||'开始自动授权'}</Actions>{progress&&<Progress {...progress}/>} {message&&<div className="result">{message}</div>}</Panel></Page>}{step===4&&<Page title="自动刷入刷机包"><p>选择刷机版本。页面会从 GitHub Release 分卷流式下载并自动执行 adb sideload。</p><Panel icon="inventory_2"><select value={rom?.id||''} onChange={e=>setRom(releases.find(x=>String(x.id)===e.target.value))}><option value="">选择版本</option>{releases.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select><Actions onClick={flash} disabled={!rom||!adb||!!busy}>{busy||'下载并自动刷入'}</Actions>{progress&&<Progress {...progress}/>} {message&&<div className="result">{message}</div>}</Panel></Page>}{step===5&&<Page title="完成"><Panel icon="check_circle">刷机包已刷入，设备正在重启进入系统。</Panel></Page>}</main></>;
}
function Page(p){return <section><h1>{p.title}</h1>{p.children}</section>}function Panel({icon,children}){return <div className="panel"><div className="state"><span className="material-icons">{icon}</span>{children}</div></div>}function Actions({onClick,disabled,children}){return <div className="actions"><button onClick={onClick} disabled={disabled}>{children}</button></div>}function Progress({label,done,total}){return <div className="progress"><div>{label} {total?Math.round(done/total*100):0}%</div><progress value={done} max={total||1}/></div>}
createRoot(document.getElementById('root')).render(<App/>);
