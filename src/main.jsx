import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

const BASE='https://bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com/OS1.0.2.0.UKMCNXM/odin_images_OS1.0.2.0.UKMCNXM_20240425.0000.00_14.0_cn_d3eb80577c.tgz';
const REPO='https://api.github.com/repos/rponeawa/odin-android-flash/releases';
const AUTH='https://file.xkji.com/xiaomi/api/issue';
const TWRP='https://github.com/rponeawa/odin-android-flash/releases/latest/download/qlp_twrp.img';

async function rangedDownload(url,onProgress){
  const head=await fetch(url,{method:'HEAD'}); const total=Number(head.headers.get('content-length'))||0;
  if(!total) return fetch(url).then(r=>r.blob());
  const chunk=8*1024*1024, parts=[]; let done=0;
  for(let start=0;start<total;start+=chunk){
    const end=Math.min(total-1,start+chunk-1); let ok=false;
    for(let retry=0;retry<3&&!ok;retry++){
      const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),50000);
      try{const r=await fetch(url,{headers:{Range:`bytes=${start}-${end}`},signal:ctl.signal}); if(!r.ok && r.status!==206) throw Error(`HTTP ${r.status}`); parts.push(await r.arrayBuffer()); done=end+1; onProgress(done,total); ok=true;}finally{clearTimeout(timer)}}
    if(!ok) throw Error('下载分段失败');
  }
  return new Blob(parts);
}
function App(){
 const [step,setStep]=useState(0),[releases,setReleases]=useState([]),[rom,setRom]=useState(null),[progress,setProgress]=useState(null),[busy,setBusy]=useState('');
 const [authFile,setAuthFile]=useState(null),[authMsg,setAuthMsg]=useState('');
 useEffect(()=>{fetch(REPO).then(r=>r.json()).then(xs=>setReleases(xs.filter(x=>!/(底包|base|firmware)/i.test(x.name||'')&&x.assets?.length))).catch(()=>{});},[]);
 const downloadRom=async()=>{if(!rom)return;setBusy('下载刷机包');try{const assets=rom.assets.filter(a=>/\.part-\d+$/.test(a.name));const files=[];for(let i=0;i<assets.length;i++){files.push(await rangedDownload(assets[i].browser_download_url,(d,t)=>setProgress({label:`下载分卷 ${i+1}/${assets.length}`,done:d,total:t})));}const blob=new Blob(files);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='odin-rom.zip';a.click();setProgress(null);setStep(5)}catch(e){setAuthMsg(e.message)}finally{setBusy('')}};
 const issue=async()=>{if(!authFile)return;setBusy('提交授权');setAuthMsg('');try{const fd=new FormData();fd.append('file',authFile,'request.zip');const r=await fetch(AUTH,{method:'POST',body:fd});const d=await r.json();if(!d.ok)throw Error(d.error||'授权失败');setAuthMsg(<a href={d.download} download>下载 {d.filename}</a>);setStep(4)}catch(e){setAuthMsg(e.message)}finally{setBusy('')}};
 const titles=['设备','底包','TWRP','授权','刷机包','完成']; const next=()=>setStep(s=>Math.min(5,s+1));
 return <><header><strong><span>odin</span> Xiaomi MIX 4 刷机</strong></header><main><nav>{titles.map((x,i)=><i className={i<=step?'on':''} key={x}/>)}</nav>{step===0&&<Page title="连接设备"><p>将 MIX 4 进入 fastboot 并通过 USB 连接。后续授权步骤会在浏览器本地使用 WebUSB ADB。</p><Panel icon="usb">使用 Chrome 或 Edge，并允许 WebUSB 访问。<Actions onClick={next}>我已连接设备</Actions></Panel></Page>}{step===1&&<Page title="刷入官方底包"><p>使用清除所有数据的方式刷入，完成后保持在 fastboot。</p><div className="warning">此操作会清除手机上的全部数据。</div><Panel icon="download"><a href={BASE}>下载官方底包</a><Actions onClick={next}>底包已完成</Actions></Panel></Page>}{step===2&&<Page title="临时启动 TWRP"><p>使用 fastboot boot 临时启动，不写入 boot 分区。</p><Panel icon="memory"><a href={TWRP}>下载 qlp_twrp.img</a><Actions onClick={next}>已进入 TWRP</Actions></Panel></Page>}{step===3&&<Page title="自动完成授权"><p>在 TWRP ADB 模式下，连接设备后自动运行采集程序，再提交授权请求。</p><Panel icon="vpn_key"><input type="file" accept=".zip" onChange={e=>setAuthFile(e.target.files?.[0])}/><Actions onClick={issue} disabled={!authFile||!!busy}>{busy||'上传并生成授权包'}</Actions>{authMsg&&<div className="result">{authMsg}</div>}</Panel></Page>}{step===4&&<Page title="下载并刷入刷机包"><p>选择不包含官方底包的版本。下载分段保持连接并显示进度，完成后在 TWRP 中执行 adb sideload。</p><Panel icon="inventory_2"><select value={rom?.id||''} onChange={e=>setRom(releases.find(x=>String(x.id)===e.target.value))}><option value="">选择版本</option>{releases.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select><Actions onClick={downloadRom} disabled={!rom||!!busy}>{busy||'下载并准备刷机包'}</Actions>{progress&&<Progress {...progress}/>}</Panel></Page>}{step===5&&<Page title="完成"><Panel icon="check_circle">刷机包已准备完成，请在 TWRP 中刷入后重启系统。</Panel></Page>}</main></>;
}
function Page(p){return <section><h1>{p.title}</h1>{p.children}</section>}function Panel({icon,children}){return <div className="panel"><div className="state"><span className="material-icons">{icon}</span>{children}</div></div>}function Actions({onClick,disabled,children}){return <div className="actions"><button onClick={onClick} disabled={disabled}>{children}</button></div>}function Progress({label,done,total}){return <div className="progress"><div>{label} {Math.round(done/total*100)}%</div><progress value={done} max={total}/></div>}
createRoot(document.getElementById('root')).render(<App/>);
