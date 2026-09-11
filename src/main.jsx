import React, { useEffect, useRef, useState } from "react";
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
const PROXY = "/api/fetch?url=";
const TWRP =
  "https://github.com/rponeawa/odin-android-flash/releases/download/tools-odin/qlp_twrp.img";
const COLLECT =
  "https://github.com/rponeawa/odin-android-flash/releases/download/tools-odin/qlp_collect";
const RANGE = 8 * 1024 * 1024;
const BLOCK = 262144;
const PART = 32 * 1024 * 1024;
const SKIP = /^(userdata|cache|metadata)$/i;

const proxied = (url) => PROXY + encodeURIComponent(url);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (bytes) =>
  new TextDecoder().decode(bytes).replace(/\0.*$/, "").trim();

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
  const bin = await fetch(proxied(COLLECT)).then((r) => {
    if (!r.ok) throw Error(`采集程序下载失败 HTTP ${r.status}`);
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
  const response = await fetch(proxied(url));
  if (!response.ok) throw Error(`下载失败 HTTP ${response.status}`);
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks = [];
  let done = 0;
  const started = performance.now();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    chunks.push(part.value);
    done += part.value.length;
    const seconds = Math.max(0.001, (performance.now() - started) / 1000);
    onProgress?.(done, total, done / seconds);
  }
  return new Blob(chunks);
}

async function probeSize(url) {
  const response = await fetch(proxied(url), { headers: { Range: "bytes=0-0" } });
  if (!response.ok && response.status !== 206)
    throw Error(`无法读取文件大小 HTTP ${response.status}`);
  await response.body?.cancel();
  const range = response.headers.get("content-range");
  if (range) return Number(range.split("/").pop()) || 0;
  return Number(response.headers.get("content-length")) || 0;
}

function rangedStream(url, total, onProgress) {
  let start = 0;
  const started = performance.now();
  return new ReadableStream({
    async pull(controller) {
      if (start >= total) {
        controller.close();
        return;
      }
      const end = Math.min(total - 1, start + RANGE - 1);
      let chunk = null;
      for (let retry = 0; retry < 3 && !chunk; retry += 1) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 60000);
        try {
          const response = await fetch(proxied(url), {
            headers: { Range: `bytes=${start}-${end}` },
            signal: ctl.signal,
          });
          if (!response.ok && response.status !== 206)
            throw Error(`下载失败 HTTP ${response.status}`);
          if (response.status === 200 && total > RANGE)
            throw Error("源站忽略了 Range 请求，无法分段下载");
          chunk = new Uint8Array(await response.arrayBuffer());
        } catch (e) {
          if (retry === 2) throw e;
        } finally {
          clearTimeout(timer);
        }
      }
      controller.enqueue(chunk);
      start = end + 1;
      const seconds = Math.max(0.001, (performance.now() - started) / 1000);
      onProgress?.(start, total, start / seconds);
    },
  });
}

function byteReader(stream) {
  const reader = stream.getReader();
  const queue = [];
  let size = 0;
  let ended = false;
  return {
    get size() {
      return size;
    },
    async fill(need) {
      while (size < need && !ended) {
        const part = await reader.read();
        if (part.done) {
          ended = true;
          break;
        }
        if (part.value.length) {
          queue.push(part.value);
          size += part.value.length;
        }
      }
      return size >= need;
    },
    take(count) {
      const out = new Uint8Array(count);
      let filled = 0;
      while (filled < count) {
        const head = queue[0];
        const use = Math.min(head.length, count - filled);
        out.set(head.subarray(0, use), filled);
        if (use === head.length) queue.shift();
        else queue[0] = head.subarray(use);
        filled += use;
        size -= use;
      }
      return out;
    },
    cancel: () => reader.cancel(),
  };
}

function blobSink() {
  const parts = [];
  let buffered = [];
  let held = 0;
  return {
    write(chunk) {
      buffered.push(chunk);
      held += chunk.length;
      if (held >= PART) {
        parts.push(new Blob(buffered));
        buffered = [];
        held = 0;
      }
    },
    end() {
      if (held) parts.push(new Blob(buffered));
      return new Blob(parts);
    },
  };
}

async function extractTarStream(stream, onEntry) {
  const src = byteReader(stream);
  while (await src.fill(512)) {
    const header = src.take(512);
    const name = text(header.subarray(0, 100));
    if (!name) break;
    const size = parseInt(text(header.subarray(124, 136)), 8) || 0;
    const padding = Math.ceil(size / 512) * 512 - size;
    const sink = await onEntry(name, size);
    let left = size;
    while (left > 0) {
      if (!(await src.fill(1))) throw Error(`底包数据在 ${name} 处中断`);
      const chunk = src.take(Math.min(left, src.size));
      sink?.write(chunk);
      left -= chunk.length;
    }
    if (padding) {
      await src.fill(padding);
      src.take(Math.min(padding, src.size));
    }
    await sink?.end();
  }
  await src.cancel();
}

async function flashBasePackage(fastboot, url, onDownload, onFlash, onCommand) {
  const total = await probeSize(url);
  if (!total) throw Error("无法读取官方底包大小");
  const stream = rangedStream(url, total, onDownload).pipeThrough(
    new DecompressionStream("gzip"),
  );
  let flashed = 0;
  await extractTarStream(stream, (name) => {
    if (!/\.img$/i.test(name)) return null;
    const partition = name.split("/").pop().replace(/\.img$/i, "");
    if (SKIP.test(partition)) return null;
    const sink = blobSink();
    return {
      write: sink.write,
      end: async () => {
        const image = sink.end();
        onCommand?.(`fastboot flash ${partition} <${name}>`);
        await fastboot.flashBlob(partition, image, (p) => onFlash(partition, p));
        flashed += 1;
      },
    };
  });
  if (!flashed) throw Error("官方底包中没有找到镜像文件");
  return flashed;
}

async function issueAuthorization(request, onProgress) {
  const fd = new FormData();
  fd.append("file", request, "request.zip");
  const result = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", AUTH);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress?.("上传授权请求", event.loaded, event.total);
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
  const blob = await downloadBlob(result.download, (done, total, speed) => {
    onProgress?.("下载授权包", done, total, speed);
  });
  return { blob, name: result.filename || "authorization.zip" };
}

async function sendSideload(adb, source, onProgress, total) {
  const socket = await adb.createSocket(`sideload-host:${total}:${BLOCK}`);
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
    const offset = block * BLOCK;
    const len = Math.min(BLOCK, total - offset);
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

async function feedProgress(size, onProgress) {
  const steps = Math.max(4, Math.min(40, Math.round(size / (16 * 1024 * 1024))));
  for (let i = 1; i <= steps; i += 1) {
    await wait(60);
    onProgress?.(i / steps);
  }
}

function mockFastboot() {
  return {
    mock: true,
    async connect() {
      await wait(350);
    },
    async getVariable(name) {
      await wait(120);
      return name === "product" ? "odin" : "";
    },
    async runCommand() {
      await wait(350);
      return { text: "" };
    },
    async flashBlob(partition, blob, onProgress) {
      await feedProgress(blob.size, onProgress);
    },
    async bootBlob(blob, onProgress) {
      await feedProgress(blob.size, onProgress);
    },
  };
}

function mockSideloadSocket(total) {
  const count = Math.ceil(total / BLOCK);
  const encoder = new TextEncoder();
  let next = 0;
  return {
    readable: new ReadableStream({
      async pull(controller) {
        await wait(8);
        controller.enqueue(
          encoder.encode(
            next < count ? String(next++).padStart(8, "0") : "DONEDONE",
          ),
        );
      },
    }),
    writable: new WritableStream({ write() {} }),
    async close() {},
  };
}

function mockAdb() {
  return {
    mock: true,
    serial: "mock-device",
    async sync() {
      return {
        async write({ file }) {
          if (file) await new Response(file).arrayBuffer();
        },
        async dispose() {},
      };
    },
    subprocess: {
      noneProtocol: {
        async spawn() {
          await wait(400);
          return { output: new Blob([new Uint8Array(64)]).stream() };
        },
      },
    },
    power: {
      async reboot() {
        await wait(300);
      },
    },
    async createSocket(service) {
      return mockSideloadSocket(Number(service.split(":")[1]) || 0);
    },
  };
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
  const logCommand = (command) =>
    setCommandLog((items) => [
      ...items.slice(-39),
      `${new Date().toLocaleTimeString()}  ${mockMode ? "[mock] " : ""}${command}`,
    ]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [commandLog]);
  const run = async (command, action) => {
    logCommand(command);
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
    setBusy("连接 fastboot");
    try {
      const device = mockMode ? mockFastboot() : new FastbootDevice();
      await run("fastboot usb connect", () => device.connect());
      await run("fastboot getvar product", () => device.getVariable("product"));
      setFastboot(device);
      setMessage("已连接 fastboot");
      setStep(1);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy("");
    }
  };
  const flashBase = async () => {
    if (!fastboot) return;
    setBusy("下载并刷入官方底包");
    try {
      const flashed = await flashBasePackage(
        fastboot,
        BASE,
        (done, total, speed) =>
          setProgress({ label: "下载官方底包", done, total, speed }),
        (partition, p) =>
          setProgress({
            label: `刷入 ${partition}`,
            done: Math.round(p * 1000),
            total: 1000,
          }),
        logCommand,
      );
      await run("fastboot erase userdata", () =>
        fastboot.runCommand("erase:userdata"),
      );
      setMessage(`已刷入 ${flashed} 个分区，设备保持在 fastboot`);
      setStep(2);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy("");
      setProgress(null);
    }
  };
  const bootTwrp = async () => {
    if (!fastboot) return;
    setBusy("启动 TWRP");
    try {
      const blob = await downloadBlob(TWRP, (done, total, speed) =>
        setProgress({ label: "下载 TWRP", done, total, speed }),
      );
      await run("fastboot boot <qlp_twrp.img>", () =>
        fastboot.bootBlob(blob, (p) =>
          setProgress({
            label: "上传 TWRP",
            done: Math.round(p * 1000),
            total: 1000,
          }),
        ),
      );
      setMessage("TWRP 已启动，请等待 ADB");
      setStep(3);
      setBusy("等待 ADB");
      const device = await run("adb connect (TWRP)", () =>
        mockMode ? mockAdb() : connectAdb(),
      );
      setAdb(device);
      setMessage(`已连接 ${device.serial}`);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy("");
      setProgress(null);
    }
  };
  const authorize = async () => {
    if (!adb) return;
    setBusy("采集中");
    try {
      const request = await run(
        "adb push qlp_collect /tmp/qlp_collect && adb shell /tmp/qlp_collect qlp_flash",
        () => pushAndCollect(adb),
      );
      setBusy("提交授权");
      const issued = await issueAuthorization(
        request,
        (label, done, total, speed) =>
          setProgress({ label, done, total, speed }),
      );
      setBusy("刷入授权包");
      await run(`adb sideload ${issued.name}`, () =>
        sendSideload(
          adb,
          issued.blob,
          (done, total) =>
            setProgress({ label: "刷入授权包", done, total }),
          issued.blob.size,
        ),
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
      const started = performance.now();
      const source = async (offset, len) => {
        let base = 0;
        for (const a of assets) {
          const size = Number(a.size || 0);
          if (offset < base + size) {
            const local = offset - base;
            const r = await fetch(proxied(a.browser_download_url), {
              headers: { Range: `bytes=${local}-${local + len - 1}` },
            });
            if (!r.ok && r.status !== 206)
              throw Error(`下载分卷失败 HTTP ${r.status}`);
            const data = new Uint8Array(await r.arrayBuffer());
            downloaded = Math.max(downloaded, offset + data.length);
            const seconds = Math.max(
              0.001,
              (performance.now() - started) / 1000,
            );
            setProgress({
              label: "下载并刷入刷机包",
              done: downloaded,
              total,
              speed: downloaded / seconds,
            });
            return data;
          }
          base += size;
        }
        throw Error("刷机包偏移超出分卷范围");
      };
      await run("adb sideload release parts", () =>
        sendSideload(adb, source, () => {}, total),
      );
      await run("adb reboot", () => adb.power.reboot());
      setStep(5);
      setMessage("刷机包已刷入，设备正在重启");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy("");
      setProgress(null);
    }
  };
  const restart = () => {
    setFastboot(null);
    setAdb(null);
    setRom(null);
    setProgress(null);
    setMessage("");
    setStep(0);
  };
  const titles = ["连接", "底包", "TWRP", "授权", "刷机包", "完成"];
  const fallback = { label: busy || "等待操作", done: 0, total: 1 };
  return (
    <>
      <header>
        <strong>Xiaomi MIX 4 刷机</strong>
      </header>
      <main>
        <nav>
          {titles.map((x, i) => (
            <i className={i <= step ? "on" : ""} key={x} />
          ))}
        </nav>
        {step === 0 && (
          <Page title="连接设备" icon="usb">
            <p>
              使用 Chrome 或 Edge 连接正常开机的 MIX 4，页面会自动处理后续刷机流程。
            </p>
            <Panel>
              <Actions onClick={connect} disabled={!!busy}>
                {busy || "连接设备"}
              </Actions>
              <label className="mode-choice">
                <input
                  type="checkbox"
                  checked={mockMode}
                  onChange={(event) => setMockMode(event.target.checked)}
                  disabled={!!busy}
                />
                Mock 模式，跳过 adb 与 fastboot 的设备通信
              </label>
              {message && <div className="result">{message}</div>}
            </Panel>
          </Page>
        )}
        {step === 1 && (
          <Page title="官方底包" icon="download">
            <p>页面会自动下载并刷入官方底包，完成后保持设备在 fastboot。</p>
            <div className="warning">此操作会清除手机上的全部数据。</div>
            <Panel>
              <Actions onClick={flashBase} disabled={!fastboot || !!busy}>
                {busy || "下载并刷入官方底包"}
              </Actions>
              <Progress {...(progress || fallback)} />
              {message && <div className="result">{message}</div>}
            </Panel>
          </Page>
        )}
        {step === 2 && (
          <Page title="临时启动 TWRP" icon="memory">
            <p>页面会通过 WebUSB 自动执行 fastboot boot。</p>
            <Panel>
              <Actions onClick={bootTwrp} disabled={!fastboot || !!busy}>
                {busy || "自动启动 TWRP"}
              </Actions>
              <Progress {...(progress || fallback)} />
              {message && <div className="result">{message}</div>}
            </Panel>
          </Page>
        )}
        {step === 3 && (
          <Page title="自动授权" icon="vpn_key">
            <p>采集、提交授权和刷入授权包会在浏览器端连续完成。</p>
            <Panel>
              <Actions onClick={authorize} disabled={!adb || !!busy}>
                {busy || "开始自动授权"}
              </Actions>
              <Progress {...(progress || fallback)} />
              {message && <div className="result">{message}</div>}
            </Panel>
          </Page>
        )}
        {step === 4 && (
          <Page title="自动刷入刷机包" icon="inventory_2">
            <p>
              选择刷机版本。页面会从 GitHub Release 分卷流式下载并自动执行 adb
              sideload。
            </p>
            <Panel>
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
              <Actions onClick={flash} disabled={!rom || !adb || !!busy}>
                {busy || "下载并自动刷入"}
              </Actions>
              <Progress {...(progress || fallback)} />
              {message && <div className="result">{message}</div>}
            </Panel>
          </Page>
        )}
        {step === 5 && (
          <Page title="完成" icon="check_circle">
            <p>刷机包已刷入，设备正在重启进入系统。</p>
            <Panel>
              <Actions onClick={restart}>返回主页</Actions>
            </Panel>
          </Page>
        )}
        <section className="command-log" aria-live="polite">
          <h2>日志</h2>
          <pre ref={logRef}>
            {commandLog.length ? commandLog.join("\n") : "等待执行命令"}
          </pre>
        </section>
      </main>
    </>
  );
}
function Page({ title, icon, children }) {
  return (
    <section>
      <h1>
        <span className="material-icons">{icon}</span>
        {title}
      </h1>
      {children}
    </section>
  );
}
function Panel({ children }) {
  return <div className="panel">{children}</div>;
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
function Progress({ label, done, total, speed }) {
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const display = total
    ? `${percent}%`
    : `${(done / 1024 / 1024).toFixed(1)} MB`;
  return (
    <div className="progress">
      <div>
        {label} {display}
        {speed ? ` | ${formatSpeed(speed)}` : ""}
      </div>
      <div
        className={`progress-track${total ? "" : " indeterminate"}`}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          className="progress-fill"
          style={{ width: `${total ? percent : 35}%` }}
        />
      </div>
    </div>
  );
}
function formatSpeed(value) {
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(value / 1024))} KB/s`;
}
createRoot(document.getElementById("root")).render(<App />);
