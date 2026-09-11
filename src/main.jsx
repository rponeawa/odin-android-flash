import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Adb,
  AdbDaemonTransport,
  AdbSignatureAuthenticator,
  AdbPublicKeyAuthenticator,
} from "@yume-chan/adb";
import { AdbDaemonWebUsbDeviceManager } from "@yume-chan/adb-daemon-webusb";
import { FastbootDevice } from "android-fastboot";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import "./style.css";

const BASE =
  "https://bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com/OS1.0.2.0.UKMCNXM/odin_images_OS1.0.2.0.UKMCNXM_20240425.0000.00_14.0_cn_d3eb80577c.tgz";
const REPO =
  "https://api.github.com/repos/rponeawa/odin-android-flash/releases";
const AUTH = "/api/issue";
const TWRP =
  "https://github.com/rponeawa/odin-android-flash/releases/download/tools-odin/qlp_twrp.img";
const CHUNK = 64 * 1024;

async function connectAdb() {
  if (!navigator.usb)
    throw Error("当前浏览器不支持 WebUSB，请使用 Chrome 或 Edge");
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  const device = await manager.requestDevice();
  const connection = await device.connect();
  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial,
    connection,
    credentialStore: new AdbWebCredentialStore("odin-flash"),
    authenticators: [AdbSignatureAuthenticator, AdbPublicKeyAuthenticator],
  });
  return new Adb(transport);
}
async function pushAndCollect(adb) {
  const sync = await adb.sync();
  const bin = await fetch(
    "https://github.com/rponeawa/odin-android-flash/releases/download/tools-odin/qlp_collect",
  ).then((r) => {
    if (!r.ok) throw Error("采集程序下载失败");
    return r.blob();
  });
  await sync.write({
    filename: "/tmp/qlp_collect",
    file: bin.stream(),
    permission: 0o755,
  });
  const p = await adb.subprocess.noneProtocol.spawn([
    "sh",
    "-c",
    "/tmp/qlp_collect qlp_flash",
  ]);
  const out = await new Response(p.output).blob();
  if (!out.size) throw Error("采集程序没有生成授权请求");
  return out;
}
async function downloadBlob(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`下载失败 HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks = [];
  let done = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    chunks.push(part.value);
    done += part.value.length;
    onProgress?.(done, total);
  }
  return new Blob(chunks);
}
async function mockDownloadBlob(onProgress, size = 8 * 1024 * 1024) {
  const chunk = 256 * 1024;
  const parts = [];
  for (let done = 0; done < size; done += chunk) {
    await new Promise((resolve) => setTimeout(resolve, 70));
    const length = Math.min(chunk, size - done);
    parts.push(new Uint8Array(length));
    onProgress?.(done + length, size);
  }
  return new Blob(parts);
}
async function extractTarGz(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const data = new Uint8Array(await new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).arrayBuffer());
  const files = new Map();
  for (let offset = 0; offset + 512 <= data.length; ) {
    const name = new TextDecoder().decode(data.slice(offset, offset + 100)).replace(/\0.*$/, "");
    if (!name) break;
    const sizeText = new TextDecoder().decode(data.slice(offset + 124, offset + 136)).replace(/\0.*$/, "").trim();
    const size = parseInt(sizeText, 8) || 0;
    const start = offset + 512;
    files.set(name, new Blob([data.slice(start, start + size)]));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return files;
}
async function flashBasePackage(fastboot, blob, onProgress) {
  const files = await extractTarGz(blob);
  const images = [...files.entries()].filter(([name]) => /\.img$/i.test(name));
  const partitions = images.map(([name]) => name.split("/").pop().replace(/\.img$/i, ""));
  if (!images.length) throw Error("官方底包中没有找到镜像文件");
  let index = 0;
  for (const [name, image] of images) {
    const partition = partitions[index++];
    if (/^(userdata|cache|metadata)$/i.test(partition)) continue;
    await fastboot.flashBlob(partition, image, (p) =>
      onProgress?.(index - 1 + p, images.length),
    );
  }
  await fastboot.runCommand("erase:userdata");
}
async function issueAuthorization(request, onProgress) {
  const fd = new FormData();
  fd.append("file", request, "request.zip");
  const result = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", AUTH);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.("上传授权请求", event.loaded, event.total);
    };
    xhr.onerror = () => reject(Error("授权请求网络错误"));
    xhr.ontimeout = () => reject(Error("授权请求超时"));
    xhr.timeout = 120000;
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(Error(`授权服务 HTTP ${xhr.status}`));
        return;
      }
      const data = xhr.response;
      if (!data?.ok || !data.download) {
        reject(Error(data?.error || "授权服务未返回授权包"));
        return;
      }
      resolve(data);
    };
    xhr.send(fd);
  });
  const blob = await downloadBlob(result.download, (done, total) => {
    onProgress?.("下载授权包", done, total);
  });
  return { blob, name: result.filename || "authorization.zip" };
}

async function sendSideload(adb, source, onProgress, total) {
  const socket = await adb.createSocket(`sideload-host:${total}:262144`);
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  let sent = 0;
  let pending = new Uint8Array();
  const readExact = async (n) => {
    while (pending.length < n) {
      const x = await reader.read();
      if (x.done) throw Error("sideload 连接已断开");
      const z = new Uint8Array(pending.length + x.value.length);
      z.set(pending);
      z.set(x.value, pending.length);
      pending = z;
    }
    const out = pending.slice(0, n);
    pending = pending.slice(n);
    return out;
  };
  const file = source instanceof Blob ? source : null;
  const get = async (offset, len) => {
    if (file)
      return new Uint8Array(
        await file.slice(offset, offset + len).arrayBuffer(),
      );
    return source(offset, len);
  };
  while (true) {
    const cmd = new TextDecoder().decode(await readExact(8));
    if (cmd === "DONEDONE") break;
    if (cmd === "FAILFAIL") throw Error("TWRP 拒绝刷机包");
    const block = Number(cmd);
    if (!Number.isInteger(block)) throw Error(`sideload 返回无效块号 ${cmd}`);
    const offset = block * 262144;
    const len = Math.min(262144, total - offset);
    if (len <= 0) throw Error("sideload 请求超出文件范围");
    const data = await get(offset, len);
    await writer.write(data);
    sent = Math.max(sent, offset + data.length);
    onProgress(sent, total);
  }
  await writer.close();
  await reader.cancel();
  await socket.close();
}

async function rangedDownload(url, onProgress) {
  const head = await fetch(url, { method: "HEAD" });
  const total = Number(head.headers.get("content-length")) || 0;
  if (!total) return fetch(url).then((r) => r.blob());
  const parts = [];
  let done = 0;
  for (let start = 0; start < total; start += 8 * 1024 * 1024) {
    const end = Math.min(total - 1, start + 8 * 1024 * 1024 - 1);
    let ok = false;
    for (let retry = 0; retry < 3 && !ok; retry++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 50000);
      try {
        const r = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}` },
          signal: ctl.signal,
        });
        if (!r.ok && r.status !== 206) throw Error(`HTTP ${r.status}`);
        parts.push(await r.arrayBuffer());
        done = end + 1;
        onProgress(done, total);
        ok = true;
      } catch (e) {
        if (retry === 2) throw e;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return new Blob(parts);
}
function App() {
  const [step, setStep] = useState(0),
    [releases, setReleases] = useState([]),
    [rom, setRom] = useState(null),
    [progress, setProgress] = useState(null),
    [busy, setBusy] = useState("");
  const [commandLog, setCommandLog] = useState([]);
  const [adb, setAdb] = useState(null),
    [fastboot, setFastboot] = useState(null),
    [message, setMessage] = useState(""),
    [mockMode, setMockMode] = useState(false);
  const logRef = useRef(null);
  const logCommand = (text) =>
    setCommandLog((items) => [
      ...items.slice(-39),
      `${new Date().toLocaleTimeString()}  ${text}`,
    ]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [commandLog]);
  const executeCommand = async ({ name, mock = mockMode, action, delay = 350 }) => {
    logCommand(`${mock ? "[mock] " : ""}${name}`);
    if (mock) {
      if (typeof action === "function") return action();
      await new Promise((resolve) => setTimeout(resolve, delay));
      return undefined;
    }
    if (typeof action !== "function") throw Error(`未实现命令：${name}`);
    return action();
  };
  useEffect(() => {
    fetch(REPO)
      .then((r) => r.json())
      .then((xs) =>
        setReleases(
          xs.filter(
            (x) =>
              !/(底包|base|firmware)/i.test(x.name || "") &&
              x.assets?.some((a) => /\.part-[ab]-\d+$/.test(a.name)),
          ),
        ),
      )
      .catch((e) => setMessage(e.message));
  }, []);
  const connect = async () => {
    if (mockMode) {
      await executeCommand({ name: "usb.requestDevice(filters=fastboot)" });
      await executeCommand({ name: "fastboot getvar product" });
      setMessage("测试设备已连接");
      setStep(1);
      return;
    }
    setBusy("连接 fastboot");
    try {
      const f = new FastbootDevice();
      await f.connect();
      logCommand("fastboot usb connect");
      setFastboot(f);
      setMessage("已连接 fastboot");
      setStep(1);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy("");
    }
  };
  const bootTwrp = async () => {
    if (mockMode) {
      setBusy("下载 TWRP");
      await executeCommand({ name: "GET qlp_twrp.img", action: () => mockDownloadBlob((done, total) => setProgress({ label: "下载 TWRP", done, total })) });
      setProgress(null);
      await executeCommand({ name: "fastboot download <qlp_twrp.img>", delay: 600 });
      await executeCommand({ name: "fastboot boot" });
      setMessage("测试 TWRP 已启动");
      setStep(3);
      setBusy("");
      return;
    }
    if (!fastboot) return;
    setBusy("启动 TWRP");
    try {
      const blob = await executeCommand({
        name: "GET qlp_twrp.img",
        action: () => downloadBlob(TWRP, (done, total) =>
        setProgress({ label: "下载 TWRP", done, total }),
        ),
      });
      await executeCommand({
        name: "fastboot boot <qlp_twrp.img>",
        action: () => fastboot.bootBlob(blob, (p) =>
        setProgress({
          label: "上传 TWRP",
          done: p.bytesSent || 0,
          total: p.totalBytes || blob.size,
        }),
        ),
      });
      setMessage("TWRP 已启动，请等待 ADB");
      setStep(3);
      setBusy("等待 ADB");
      const a = await connectAdb();
      setAdb(a);
      setMessage(`已连接 ${a.serial}`);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy("");
    }
  };
  const flashBase = async () => {
    if (mockMode) {
      setBusy("下载并刷入官方底包");
      await executeCommand({ name: "GET official-base.tgz", action: () => mockDownloadBlob((done, total) => setProgress({ label: "下载官方底包", done, total }), 16 * 1024 * 1024) });
      setProgress(null);
      for (const partition of ["boot", "vendor_boot", "dtbo", "vbmeta", "super"]) {
        await executeCommand({ name: `fastboot flash ${partition} <image>`, delay: 400 });
      }
      await executeCommand({ name: "fastboot erase userdata" });
      setMessage("测试底包已刷入，设备保持在 fastboot");
      setStep(2);
      setBusy("");
      return;
    }
    if (!fastboot) return;
    setBusy("下载并刷入官方底包");
    try {
      const blob = await downloadBlob(BASE, (done, total) =>
        setProgress({ label: "下载官方底包", done, total }),
      );
      await flashBasePackage(fastboot, blob, (done, total) =>
        setProgress({ label: "刷入官方底包", done, total }),
      );
      await executeCommand({
        name: "fastboot erase userdata",
        action: () => fastboot.runCommand("erase:userdata"),
      });
      setMessage("官方底包已刷入，设备保持在 fastboot");
      setStep(2);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy("");
      setProgress(null);
    }
  };
  const authorize = async () => {
    if (mockMode) {
      await executeCommand({ name: "adb connect (TWRP)" });
      await executeCommand({ name: "adb push qlp_collect /tmp/qlp_collect" });
      await executeCommand({ name: "adb shell /tmp/qlp_collect qlp_flash" });
      await executeCommand({ name: "POST /api/issue request.zip", delay: 500 });
      await executeCommand({ name: "GET authorization.zip", action: () => mockDownloadBlob((done, total) => setProgress({ label: "下载授权包", done, total }), 4 * 1024 * 1024) });
      await executeCommand({ name: "adb sideload authorization.zip", delay: 700 });
      setMessage("测试授权包已刷入");
      setStep(4);
      setProgress(null);
      return;
    }
    if (!adb) return;
    setBusy("采集中");
    try {
      logCommand("adb push qlp_collect /tmp/qlp_collect");
      const req = await pushAndCollect(adb);
      setBusy("提交授权");
      const issued = await issueAuthorization(req, (label, done, total) =>
        setProgress({ label, done, total }),
      );
      setBusy("刷入授权包");
      await sendSideload(
        adb,
        issued.blob.stream(),
        (d, t) => setProgress({ label: "刷入授权包", done: d, total: t }),
        issued.blob.size,
      );
      setMessage("授权包已自动刷入");
      setStep(4);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy("");
      setProgress(null);
    }
  };
  const flash = async () => {
    if (mockMode) {
      await executeCommand({ name: `GET release parts for ${rom?.name || "selected ROM"}`, action: () => mockDownloadBlob((done, total) => setProgress({ label: "下载刷机包", done, total }), 24 * 1024 * 1024) });
      await executeCommand({ name: "adb sideload release parts", delay: 1000 });
      await executeCommand({ name: "adb reboot" });
      setMessage("测试刷机包已刷入，设备正在重启");
      setStep(5);
      setProgress(null);
      return;
    }
    if (!adb || !rom) return;
    setBusy("下载并刷入");
    try {
      const assets = rom.assets
        .filter((a) => /\.part-[ab]-\d+$/.test(a.name))
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true }),
        );
      const total = assets.reduce((n, a) => n + Number(a.size || 0), 0);
      let downloaded = 0;
      const source = async (offset, len) => {
        let base = 0;
        for (const a of assets) {
          const size = Number(a.size || 0);
          if (offset < base + size) {
            const local = offset - base;
            const r = await fetch(a.browser_download_url, {
              headers: { Range: `bytes=${local}-${local + len - 1}` },
            });
            if (!r.ok && r.status !== 206)
              throw Error(`下载分卷失败 HTTP ${r.status}`);
            const data = new Uint8Array(await r.arrayBuffer());
            downloaded = Math.max(downloaded, offset + data.length);
            setProgress({
              label: `下载并刷入 ${Math.round((downloaded / total) * 100)}%`,
              done: downloaded,
              total,
            });
            return data;
          }
          base += size;
        }
        throw Error("刷机包偏移超出分卷范围");
      };
      await sendSideload(
        adb,
        source,
        (d, t) => setProgress({ label: "刷入刷机包", done: d, total: t }),
        total,
      );
      logCommand("adb reboot");
      await adb.power.reboot();
      setStep(5);
      setMessage("刷机包已刷入，设备正在重启");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy("");
      setProgress(null);
    }
  };
  const titles = ["连接", "底包", "TWRP", "授权", "刷机包", "完成"];
  return (
    <>
      <header>
        <strong>
          Xiaomi MIX 4 刷机
        </strong>
      </header>
      <main>
        <nav>
          {titles.map((x, i) => (
            <i className={i <= step ? "on" : ""} key={x} />
          ))}
        </nav>
        {step === 0 && (
          <Page title="连接设备">
            <p>
              使用 Chrome 或 Edge 连接正常开机的 MIX 4，页面会自动处理后续刷机流程。
            </p>
            <Panel icon="usb">
              <Actions onClick={connect} disabled={!!busy}>
                {busy || "连接设备"}
              </Actions>
              <label className="mode-choice">
                <input type="radio" name="mode" checked={mockMode} onChange={(event) => setMockMode(event.target.checked)} disabled={!!busy} />
                Mock 模式
              </label>
              {message && <div className="result">{message}</div>}
            </Panel>
          </Page>
        )}
        {step === 1 && (
          <Page title="官方底包">
            <p>页面会自动下载并刷入官方底包，完成后保持设备在 fastboot。</p>
            <div className="warning">此操作会清除手机上的全部数据。</div>
            <Panel icon="download">
              <Actions onClick={flashBase} disabled={!mockMode && (!fastboot || !!busy)}>
                {busy || "下载并刷入官方底包"}
              </Actions>
              {progress && <Progress {...progress} />}
              {message && <div className="result">{message}</div>}
            </Panel>
          </Page>
        )}
        {step === 2 && (
          <Page title="临时启动 TWRP">
            <p>页面会通过 WebUSB 自动执行 fastboot boot。</p>
            <Panel icon="memory">
              <Actions onClick={bootTwrp} disabled={!mockMode && (!fastboot || !!busy)}>
                {busy || "自动启动 TWRP"}
              </Actions>
            </Panel>
          </Page>
        )}
        {step === 3 && (
          <Page title="自动授权">
            <p>采集、提交授权和刷入授权包会在浏览器端连续完成。</p>
            <Panel icon="vpn_key">
              <Actions onClick={authorize} disabled={(!mockMode && !adb) || !!busy}>
                {busy || "开始自动授权"}
              </Actions>
              {progress && <Progress {...progress} />}{" "}
              {message && <div className="result">{message}</div>}
            </Panel>
          </Page>
        )}
        {step === 4 && (
          <Page title="自动刷入刷机包">
            <p>
              选择刷机版本。页面会从 GitHub Release 分卷流式下载并自动执行 adb
              sideload。
            </p>
            <Panel icon="inventory_2">
              <select
                value={rom?.id || ""}
                onChange={(e) =>
                  setRom(releases.find((x) => String(x.id) === e.target.value))
                }
              >
                <option value="">选择版本</option>
                {releases.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <Actions
                onClick={flash}
                disabled={(!mockMode && (!rom || !adb)) || !!busy}
              >
                {busy || "下载并自动刷入"}
              </Actions>
              {progress && <Progress {...progress} />}{" "}
              {message && <div className="result">{message}</div>}
            </Panel>
          </Page>
        )}
        {step === 5 && (
          <Page title="完成">
            <Panel icon="check_circle">
              刷机包已刷入，设备正在重启进入系统。
            </Panel>
          </Page>
        )}
        <section className="command-log" aria-live="polite">
          <h2>日志</h2>
          <pre ref={logRef}>{commandLog.length ? commandLog.join("\n") : "等待执行命令"}</pre>
        </section>
      </main>
    </>
  );
}
function Page(p) {
  return (
    <section>
      <h1>{p.title}</h1>
      {p.children}
    </section>
  );
}
function Panel({ icon, children }) {
  return (
    <div className="panel">
      <div className="state">
        <span className="material-icons">{icon}</span>
        {children}
      </div>
    </div>
  );
}
function Actions({ onClick, disabled, children }) {
  return (
    <div className="actions">
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    </div>
  );
}
function Progress({ label, done, total }) {
  return (
    <div className="progress">
      <div>
        {label} {total ? Math.round((done / total) * 100) : 0}%
      </div>
      <progress value={done} max={total || 1} />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
