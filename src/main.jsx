import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { getLang, setLang, t } from "./strings.js";
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
const SCRIPT = "flash_all.sh";
const FLOWS = {
  full: ["connect", "base", "twrp", "collect", "auth", "rom", "done"],
  update: ["connect", "twrp", "rom", "done"],
};
const NAV = {
  connect: "navConnect",
  base: "navBase",
  twrp: "navTwrp",
  collect: "navAuth",
  auth: "navAuthFlash",
  rom: "navRom",
  done: "navDone",
};

const proxied = (url) => PROXY + encodeURIComponent(url);
function replyText(result) {
  if (typeof result === "string") return result.trim();
  if (typeof result?.text === "string") return result.text.trim();
  return "";
}

class StepError extends Error {
  constructor(hint, cause) {
    super(hint);
    this.detail = cause?.message || String(cause);
  }
}

function createGate() {
  let paused = false;
  let waiters = [];
  let since = 0;
  let total = 0;
  const release = () => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };
  return {
    get paused() {
      return paused;
    },
    get pausedMs() {
      return total + (paused ? performance.now() - since : 0);
    },
    pause() {
      if (paused) return;
      paused = true;
      since = performance.now();
    },
    resume() {
      if (!paused) return;
      paused = false;
      total += performance.now() - since;
      release();
    },
    reset() {
      paused = false;
      total = 0;
      release();
    },
    wait() {
      return paused ? new Promise((resolve) => waiters.push(resolve)) : null;
    },
  };
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (bytes) =>
  new TextDecoder().decode(bytes).replace(/\0.*$/, "").trim();

async function connectAdb() {
  if (!navigator.usb)
    throw Error(t("noWebUsb"));
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

async function pushAndCollect(adb, gate) {
  const sync = await adb.sync();
  const bin = await downloadBlob(COLLECT, undefined, gate);
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
  if (!out.size) throw Error(t("collectEmpty"));
  return out;
}

async function downloadBlob(url, onProgress, gate) {
  const probe = await probeSize(url).catch(() => ({ total: 0, ranged: false }));
  if (probe.ranged && probe.total) {
    const reader = rangedStream(url, probe.total, onProgress, gate).getReader();
    const parts = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      parts.push(part.value);
    }
    return new Blob(parts);
  }
  const response = await fetch(proxied(url));
  if (!response.ok) throw Error(t("downloadFailed", { status: response.status }));
  if (!response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks = [];
  let done = 0;
  const started = performance.now();
  while (true) {
    await gate?.wait();
    const part = await reader.read();
    if (part.done) break;
    chunks.push(part.value);
    done += part.value.length;
    const elapsed = performance.now() - started - (gate?.pausedMs || 0);
    onProgress?.(done, probe.total, done / Math.max(0.001, elapsed / 1000));
  }
  return new Blob(chunks);
}

async function probeSize(url) {
  const response = await fetch(proxied(url), { headers: { Range: "bytes=0-0" } });
  if (!response.ok && response.status !== 206)
    throw Error(t("sizeFailed", { status: response.status }));
  await response.body?.cancel();
  const range = response.headers.get("content-range");
  const ranged = response.status === 206 && !!range;
  const total = ranged
    ? Number(range.split("/").pop()) || 0
    : Number(response.headers.get("content-length")) || 0;
  return { total, ranged };
}

function rangedStream(url, total, onProgress, gate) {
  let start = 0;
  const started = performance.now();
  return new ReadableStream({
    async pull(controller) {
      await gate?.wait();
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
            throw Error(t("downloadFailed", { status: response.status }));
          if (response.status === 200 && total > RANGE)
            throw Error(t("rangeIgnored"));
          chunk = new Uint8Array(await response.arrayBuffer());
        } catch (e) {
          if (retry === 2) throw e;
        } finally {
          clearTimeout(timer);
        }
      }
      controller.enqueue(chunk);
      start = end + 1;
      const elapsed = performance.now() - started - (gate?.pausedMs || 0);
      onProgress?.(start, total, start / Math.max(0.001, elapsed / 1000));
    },
  });
}

function blobStream(blob, onProgress, gate) {
  const reader = blob.stream().getReader();
  let done = 0;
  const started = performance.now();
  return new ReadableStream({
    async pull(controller) {
      await gate?.wait();
      const part = await reader.read();
      if (part.done) {
        controller.close();
        return;
      }
      done += part.value.length;
      const elapsed = performance.now() - started - (gate?.pausedMs || 0);
      onProgress?.(done, blob.size, done / Math.max(0.001, elapsed / 1000));
      controller.enqueue(part.value);
    },
    cancel: () => reader.cancel(),
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
      if (!(await src.fill(1))) throw Error(t("baseTruncated", { name }));
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

function packagePath(name) {
  return name.split("/").slice(1).join("/");
}

async function basePackageStream(source, onProgress, gate) {
  if (source instanceof Blob) return blobStream(source, onProgress, gate);
  const { total, ranged } = await probeSize(source);
  if (!total) throw Error(t("baseSizeFailed"));
  if (!ranged) throw Error(t("baseNoRange"));
  return rangedStream(source, total, onProgress, gate);
}

async function collectBasePackage(source, onDownload, gate) {
  const stream = (await basePackageStream(source, onDownload, gate)).pipeThrough(
    new DecompressionStream("gzip"),
  );
  const files = new Map();
  await extractTarStream(stream, (name, size) => {
    if (!size || name.endsWith("/")) return null;
    const sink = blobSink();
    return {
      write: sink.write,
      end: () => files.set(packagePath(name), sink.end()),
    };
  });
  return files;
}

function parseFlashScript(script) {
  const steps = [];
  let depth = 0;
  for (const raw of script.split("\n")) {
    const line = raw
      .replace(/`dirname\s+\$0`|\$\(dirname\s+\$0\)/g, ".")
      .trim();
    if (!line || line.startsWith("#")) continue;
    const opens = /^if\b/.test(line);
    const closes = /(^|[\s;])fi$/.test(line);
    if (opens) {
      if (!closes) depth += 1;
      continue;
    }
    if (closes) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;
    const call = line.match(/^fastboot\s+(.+)$/);
    if (!call) continue;
    const tokens = call[1]
      .replace(/\s*(\|\||&&|;|\||\d?>[&\S]*).*$/, "")
      .trim()
      .split(/\s+/)
      .filter((token) => token && !/^("\$@"|\$\*|\$@)$/.test(token));
    const flags = [];
    while (tokens.length && tokens[0].startsWith("-")) flags.push(tokens.shift());
    const verb = tokens.shift();
    if (verb === "flash" && tokens.length >= 2)
      steps.push({
        verb,
        partition: tokens[0],
        file: tokens[1].replace(/^\.\//, ""),
        flags,
      });
    else if (verb === "erase" && tokens.length >= 1)
      steps.push({ verb, partition: tokens[0], flags });
    else if (verb === "set_active" && tokens.length >= 1)
      steps.push({ verb, slot: tokens[0], flags });
  }
  return steps;
}

async function runFlashScript(fastboot, files, steps, onFlash, run) {
  let index = 0;
  for (const step of steps) {
    index += 1;
    const label = `${index}/${steps.length}`;
    if (step.verb === "flash") {
      const image = files.get(step.file);
      if (!image) throw Error(t("baseMissingFile", { file: step.file }));
      await run(`fastboot flash ${step.partition} ${step.file}`, () =>
        fastboot.flashBlob(step.partition, image, (p) =>
          onFlash(t("progFlash", { partition: step.partition, index: label }), p),
        ),
      );
    } else if (step.verb === "erase") {
      onFlash(t("progErase", { partition: step.partition, index: label }), 0);
      await run(`fastboot erase ${step.partition}`, () =>
        fastboot.runCommand(`erase:${step.partition}`),
      );
      onFlash(t("progErase", { partition: step.partition, index: label }), 1);
    } else if (step.verb === "set_active") {
      onFlash(t("progSlot", { slot: step.slot, index: label }), 0);
      await run(`fastboot set_active ${step.slot}`, () =>
        fastboot.runCommand(`set_active:${step.slot}`),
      );
      onFlash(t("progSlot", { slot: step.slot, index: label }), 1);
    }
  }
}

async function issueAuthorization(request, onProgress, gate) {
  const fd = new FormData();
  fd.append("file", request, "request.zip");
  const result = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", AUTH);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress?.(t("progUploadRequest"), event.loaded, event.total);
    };
    xhr.onerror = () => reject(Error(t("authNetwork")));
    xhr.ontimeout = () => reject(Error(t("authTimeout")));
    xhr.timeout = 120000;
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(Error(t("authHttp", { status: xhr.status })));
        return;
      }
      const data = xhr.response;
      if (!data?.ok || !data.download) {
        reject(Error(data?.error || t("authNoPackage")));
        return;
      }
      resolve(data);
    };
    xhr.send(fd);
  });
  const blob = await downloadBlob(
    result.download,
    (done, total, speed) => onProgress?.(t("progDownloadAuth"), done, total, speed),
    gate,
  );
  return { blob, name: result.filename || "authorization.zip" };
}

async function sendSideload(adb, source, onProgress, total, gate) {
  let socket;
  try {
    socket = await adb.createSocket(`sideload-host:${total}:${BLOCK}`);
  } catch (e) {
    throw new StepError(
      t("notSideload"),
      e,
    );
  }
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  let sent = 0;
  let pending = new Uint8Array();
  const readExact = async (n) => {
    while (pending.length < n) {
      const x = await reader.read();
      if (x.done) throw Error(t("sideloadClosed"));
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
    await gate?.wait();
    const cmd = new TextDecoder().decode(await readExact(8));
    if (cmd === "DONEDONE") break;
    if (cmd === "FAILFAIL") throw Error(t("sideloadReject"));
    const block = Number(cmd);
    if (!Number.isInteger(block)) throw Error(t("sideloadBadBlock", { cmd }));
    const offset = block * BLOCK;
    const len = Math.min(BLOCK, total - offset);
    if (len <= 0) throw Error(t("sideloadRange"));
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
  const [mode, setMode] = useState(null),
    [step, setStep] = useState(0),
    [releases, setReleases] = useState([]),
    [rom, setRom] = useState(null),
    [progress, setProgress] = useState(null),
    [busy, setBusy] = useState("");
  const [commandLog, setCommandLog] = useState([]);
  const [adb, setAdb] = useState(null),
    [fastboot, setFastboot] = useState(null),
    [mockMode, setMockMode] = useState(false);
  const [toast, setToast] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const [device, setDevice] = useState(null);
  const [issued, setIssued] = useState(null);
  const [lang, setLangState] = useState(getLang());
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "",
  );
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  const [baseFile, setBaseFile] = useState(null);
  const [twrpFile, setTwrpFile] = useState(null);
  const [romFile, setRomFile] = useState(null);
  const gate = useRef(createGate()).current;
  const toastId = useRef(0);
  const notify = (text, tone = "info") =>
    setToast({ text, tone, id: (toastId.current += 1) });
  const showError = (error) => {
    const detail = error?.detail || error?.message || String(error);
    logCommand(t("logError", { detail }));
    notify(error?.message || detail, "error");
  };
  const dismissToast = useCallback(() => setToast(null), []);
  const logRef = useRef(null);
  const logId = useRef(0);
  const logCommand = (command) => {
    const id = (logId.current += 1);
    setCommandLog((items) => [
      ...items.slice(-39),
      {
        id,
        text: `${new Date().toLocaleTimeString()}  ${mockMode ? "[mock] " : ""}${command}`,
      },
    ]);
    return id;
  };
  const settleCommand = (id, reply) =>
    setCommandLog((items) =>
      items.map((item) =>
        item.id === id ? { ...item, text: `${item.text}  ${reply}` } : item,
      ),
    );
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [commandLog]);
  const togglePause = () => {
    if (gate.paused) gate.resume();
    else gate.pause();
    setPaused(gate.paused);
  };
  const begin = (label) => {
    gate.reset();
    setPaused(false);
    setBusy(label);
  };
  const finish = () => {
    gate.reset();
    setPaused(false);
    setBusy("");
    setProgress(null);
  };
  const asSideload = async (action) => {
    setDevice((d) => (d ? { ...d, mode: "Recovery Sideload" } : d));
    try {
      return await action();
    } finally {
      setDevice((d) => (d ? { ...d, mode: "Recovery ADB" } : d));
    }
  };
  const run = async (command, action) => {
    const id = logCommand(command);
    const started = performance.now();
    const result = await action();
    const reply = replyText(result);
    settleCommand(
      id,
      reply || `OKAY [${((performance.now() - started) / 1000).toFixed(2)}s]`,
    );
    return result;
  };
  useEffect(() => {
    const root = document.documentElement;
    if (theme) {
      root.dataset.theme = theme;
      localStorage.setItem("theme", theme);
    } else {
      delete root.dataset.theme;
      localStorage.removeItem("theme");
    }
  }, [theme]);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return undefined;
    const onChange = (event) => setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    if (!navigator.usb) return undefined;
    const onDisconnect = (event) => {
      setDevice((current) => {
        if (!current) return current;
        const serial = event.device?.serialNumber;
        if (current.serial && serial && current.serial !== serial) return current;
        setFastboot(null);
        setAdb(null);
        return null;
      });
    };
    navigator.usb.addEventListener("disconnect", onDisconnect);
    return () => navigator.usb.removeEventListener("disconnect", onDisconnect);
  }, []);
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
      .catch(showError);
  }, []);
  const connect = async () => {
    setBusy(t("busyConnectFastboot"));
    try {
      const device = mockMode ? mockFastboot() : new FastbootDevice();
      await run("fastboot usb connect", () =>
        device.connect().catch((e) => {
          throw new StepError(
            t("noFastbootDevice"),
            e,
          );
        }),
      );
      const product = await run("fastboot getvar product", () =>
        device.getVariable("product"),
      );
      setFastboot(device);
      setDevice({
        mode: "Fastboot",
        name: product || device.device?.serialNumber || "",
        serial: device.device?.serialNumber || "",
      });
      notify(t("connectedFastboot"));
      advance();
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  };
  const flashBase = async () => {
    if (!fastboot) return;
    const label = baseFile ? t("busyReadLocalBase") : t("busyDownloadBase");
    begin(label);
    try {
      const files = await collectBasePackage(
        baseFile || BASE,
        (done, total, speed) => setProgress({ label, done, total, speed }),
        gate,
      );
      const script = files.get(SCRIPT);
      if (!script) throw Error(t("baseNoScript", { script: SCRIPT }));
      const steps = parseFlashScript(await script.text());
      if (!steps.length) throw Error(t("baseNoCommands", { script: SCRIPT }));
      setBusy(t("busyFlashBase"));
      const onFlash = (label, p) =>
        setProgress({ label, done: Math.round(p * 1000), total: 1000 });
      await runFlashScript(fastboot, files, steps, onFlash, run);
      notify(t("baseFlashed", { script: SCRIPT, count: steps.length }));
      advance();
    } catch (e) {
      showError(e);
    } finally {
      finish();
    }
  };
  const skipBase = () => {
    notify(t("skippedBase"));
    advance();
  };
  const bootTwrp = async () => {
    if (!fastboot) return;
    begin(t("busyBootTwrp"));
    try {
      const blob =
        twrpFile ||
        (await downloadBlob(
          TWRP,
          (done, total, speed) =>
            setProgress({ label: t("progDownloadTwrp"), done, total, speed }),
          gate,
        ));
      await run(`fastboot boot <${twrpFile?.name || "qlp_twrp.img"}>`, () =>
        fastboot.bootBlob(blob, (p) =>
          setProgress({
            label: t("progUploadTwrp"),
            done: Math.round(p * 1000),
            total: 1000,
          }),
        ),
      );
      notify(t("twrpBooted"));
      advance();
      setBusy(t("busyWaitAdb"));
      const device = await run("adb connect (TWRP)", () =>
        mockMode
          ? mockAdb()
          : connectAdb().catch((e) => {
              throw new StepError(
                t("noAdbDevice"),
                e,
              );
            }),
      );
      setAdb(device);
      setDevice({
        mode: "Recovery ADB",
        name: device.serial || "",
        serial: device.serial || "",
      });
      notify(t("connected", { serial: device.serial }));
    } catch (e) {
      showError(e);
    } finally {
      finish();
    }
  };
  const reconnectAdb = async () => {
    begin(t("busyConnectAdb"));
    try {
      const next = await run("adb connect", () =>
        mockMode
          ? mockAdb()
          : connectAdb().catch((e) => {
              throw new StepError(
                t("noAdbDeviceMode"),
                e,
              );
            }),
      );
      setAdb(next);
      setDevice({
        mode: "Recovery ADB",
        name: next.serial || "",
        serial: next.serial || "",
      });
      notify(t("connected", { serial: next.serial }));
    } catch (e) {
      showError(e);
    } finally {
      finish();
    }
  };
  const collect = async () => {
    if (!adb) return;
    begin(t("busyCollect"));
    try {
      const request = await run(
        "adb push qlp_collect /tmp/qlp_collect && adb shell /tmp/qlp_collect qlp_flash",
        () => pushAndCollect(adb, gate),
      );
      setBusy(t("busySubmit"));
      const result = await issueAuthorization(
        request,
        (label, done, total, speed) =>
          setProgress({ label, done, total, speed }),
        gate,
      );
      setIssued(result);
      notify(t("gotAuth", { name: result.name }));
      advance();
    } catch (e) {
      showError(e);
    } finally {
      finish();
    }
  };
  const flashAuthorization = async () => {
    if (!adb || !issued) return;
    begin(t("busyFlashAuth"));
    try {
      await run(`adb sideload ${issued.name}`, () =>
        asSideload(() =>
          sendSideload(
            adb,
            issued.blob,
            (done, total) => setProgress({ label: t("progFlashAuth"), done, total }),
            issued.blob.size,
            gate,
          ),
        ),
      );
      notify(t("authFlashed"));
      advance();
    } catch (e) {
      showError(e);
    } finally {
      finish();
    }
  };
  const flash = async () => {
    if (!adb || (!rom && !romFile)) return;
    begin(romFile ? t("busyFlashLocalRom") : t("busyFlashRom"));
    try {
      if (romFile) {
        const started = performance.now();
        await run(`adb sideload ${romFile.name}`, () =>
          asSideload(() =>
            sendSideload(
            adb,
            romFile,
            (done, total) => {
              const elapsed = performance.now() - started - gate.pausedMs;
              setProgress({
                label: t("busyFlashLocalRom"),
                done,
                total,
                speed: done / Math.max(0.001, elapsed / 1000),
              });
            },
              romFile.size,
              gate,
            ),
          ),
        );
        await run("adb reboot", () => adb.power.reboot());
        advance();
        notify(t("romFlashed"));
        return;
      }
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
              throw Error(t("partDownloadFailed", { status: r.status }));
            const data = new Uint8Array(await r.arrayBuffer());
            downloaded = Math.max(downloaded, offset + data.length);
            const seconds = Math.max(
              0.001,
              (performance.now() - started) / 1000,
            );
            setProgress({
              label: t("progFlashRom"),
              done: downloaded,
              total,
              speed: downloaded / seconds,
            });
            return data;
          }
          base += size;
        }
        throw Error(t("romOffset"));
      };
      await run("adb sideload release parts", () =>
        asSideload(() => sendSideload(adb, source, () => {}, total, gate)),
      );
      await run("adb reboot", () => adb.power.reboot());
      advance();
      notify(t("romFlashed"));
    } catch (e) {
      showError(e);
    } finally {
      finish();
    }
  };
  const advance = () => setStep((current) => current + 1);
  const restart = () => {
    setLeaving(false);
    setMode(null);
    gate.reset();
    setPaused(false);
    setDevice(null);
    setIssued(null);
    setBaseFile(null);
    setTwrpFile(null);
    setRomFile(null);
    setFastboot(null);
    setAdb(null);
    setRom(null);
    setProgress(null);
    setStep(0);
  };
  const toggleLang = () => {
    const next = lang === "zh" ? "en" : "zh";
    setLang(next);
    setLangState(next);
  };
  const reconnectButton = (
    <button type="button" className="secondary" onClick={reconnectAdb} disabled={!!busy}>
      <span className="material-icons">usb</span>
      {t("reconnectAdb")}
    </button>
  );
  const pauseButton = busy ? (
    <button type="button" className="secondary" onClick={togglePause}>
      <span className="material-icons">{paused ? "play_arrow" : "pause"}</span>
      {paused ? t("resume") : t("pause")}
    </button>
  ) : null;
  const flow = FLOWS[mode] || [];
  const view = flow[step];
  const fallback = { label: busy || t("waiting"), done: 0, total: 1 };
  const dark = theme ? theme === "dark" : systemDark;
  return (
    <>
      {toast && (
        <Toast
          key={toast.id}
          message={toast.text}
          tone={toast.tone}
          onDismiss={dismissToast}
        />
      )}
      {leaving && (
        <Confirm
          title={t("leaveTitle")}
          text={t("leaveText")}
          confirmLabel={t("leaveConfirm")}
          cancelLabel={t("cancel")}
          onConfirm={restart}
          onCancel={() => setLeaving(false)}
        />
      )}
      <header>
        <button
          type="button"
          className="brand"
          onClick={() => mode && setLeaving(true)}
        >
          {t("appTitle")}
        </button>
        <div className="tools">
          <span
            className="device"
            key={device ? `${device.mode} ${device.name}` : "none"}
          >
            <span className="material-icons">
              {device ? "smartphone" : "usb"}
            </span>
            {device ? `${device.mode} ${device.name}`.trim() : t("noDevice")}
          </span>
          <button
            type="button"
            className="icon"
            onClick={toggleLang}
            title={t("language")}
            aria-label={t("language")}
          >
            <span className="material-icons">translate</span>
          </button>
          <button
            type="button"
            className="icon"
            onClick={() => setTheme(dark ? "light" : "dark")}
            title={t("theme")}
            aria-label={t("theme")}
          >
            <span className="material-icons">
              {dark ? "light_mode" : "dark_mode"}
            </span>
          </button>
        </div>
      </header>
      <main>
        {!mode && (
          <Page title={t("welcomeTitle")} icon="rocket_launch">
            <div className="choices">
              <button
                type="button"
                className="choice"
                onClick={() => {
                  setMode("full");
                  setStep(0);
                }}
              >
                <span className="material-icons">restart_alt</span>
                <span className="choice-text">
                  <strong>{t("modeFirst")}</strong>
                  <span>{t("modeFirstText")}</span>
                </span>
              </button>
              <button
                type="button"
                className="choice"
                onClick={() => {
                  setMode("update");
                  setStep(0);
                }}
              >
                <span className="material-icons">system_update_alt</span>
                <span className="choice-text">
                  <strong>{t("modeUpdate")}</strong>
                  <span>{t("modeUpdateText")}</span>
                </span>
              </button>
            </div>
          </Page>
        )}
        {mode && (
          <nav>
            {flow.map((key, i) => (
              <i className={i <= step ? "on" : ""} key={key} title={t(NAV[key])} />
            ))}
          </nav>
        )}
        {view === "connect" && (
          <Page title={t("connectTitle")} icon="usb">
            <p>{t("connectText")}</p>
            <Panel>
              <Actions onClick={connect} disabled={!!busy}>
                {busy || t("connectAction")}
              </Actions>
              <label className="mode-choice">
                <input
                  type="checkbox"
                  checked={mockMode}
                  onChange={(event) => setMockMode(event.target.checked)}
                  disabled={!!busy}
                />
                {t("mockMode")}
              </label>
            </Panel>
          </Page>
        )}
        {view === "base" && (
          <Page title={t("baseTitle")} icon="download">
            <p>{t("baseText")}</p>
            <div className="warning">{t("baseWarning")}</div>
            <Panel>
              <FilePick
                accept=".tgz,.gz,application/gzip"
                file={baseFile}
                onPick={setBaseFile}
                label={t("pickBase")}
              />
              <Actions
                extra={
                  <>
                    {pauseButton}
                    <button
                      type="button"
                      className="secondary"
                      onClick={skipBase}
                      disabled={!!busy}
                    >
                      <span className="material-icons">skip_next</span>
                      {t("skip")}
                    </button>
                  </>
                }
                onClick={flashBase}
                disabled={!fastboot || !!busy}
              >
                {busy || (baseFile ? t("flashBaseLocal") : t("flashBaseAction"))}
              </Actions>
              <Progress {...(progress || fallback)} />
            </Panel>
          </Page>
        )}
        {view === "twrp" && (
          <Page title={t("twrpTitle")} icon="memory">
            <Panel>
              <FilePick
                accept=".img"
                file={twrpFile}
                onPick={setTwrpFile}
                label={t("pickTwrp")}
              />
              <Actions
                extra={pauseButton}
                onClick={bootTwrp}
                disabled={!fastboot || !!busy}
              >
                {busy || t("bootTwrpAction")}
              </Actions>
              <Progress {...(progress || fallback)} />
            </Panel>
          </Page>
        )}
        {view === "collect" && (
          <Page title={t("collectTitle")} icon="vpn_key">
            <p>{t("collectText")}</p>
            <Panel>
              <Actions
                extra={
                  <>
                    {pauseButton}
                    {reconnectButton}
                  </>
                }
                onClick={collect}
                disabled={!adb || !!busy}
              >
                {busy || t("collectAction")}
              </Actions>
              <Progress {...(progress || fallback)} />
            </Panel>
          </Page>
        )}
        {view === "auth" && (
          <Page title={t("authFlashTitle")} icon="verified_user">
            <p>{t("authFlashText")}</p>
            <Panel>
              <Actions
                extra={
                  <>
                    {pauseButton}
                    {reconnectButton}
                  </>
                }
                onClick={flashAuthorization}
                disabled={!adb || !issued || !!busy}
              >
                {busy || t("authFlashAction")}
              </Actions>
              <Progress {...(progress || fallback)} />
            </Panel>
          </Page>
        )}
        {view === "rom" && (
          <Page title={t("romTitle")} icon="inventory_2">
            <p>{t("romText")}</p>
            <Panel>
              <Select
                value={rom?.id ? String(rom.id) : ""}
                placeholder={t("selectVersion")}
                disabled={!!busy}
                options={releases.map((x) => ({
                  value: String(x.id),
                  label: x.name,
                }))}
                onChange={(value) =>
                  setRom(releases.find((x) => String(x.id) === value))
                }
              />
              <FilePick
                accept=".zip"
                file={romFile}
                onPick={setRomFile}
                label={t("pickRom")}
              />
              <Actions
                extra={
                  <>
                    {pauseButton}
                    {reconnectButton}
                  </>
                }
                onClick={flash}
                disabled={(!rom && !romFile) || !adb || !!busy}
              >
                {busy || (romFile ? t("romLocal") : t("romAction"))}
              </Actions>
              <Progress {...(progress || fallback)} />
            </Panel>
          </Page>
        )}
        {view === "done" && (
          <Page title={t("doneTitle")} icon="check_circle">
            <p>{t("doneText")}</p>
            <Panel>
              <Actions onClick={restart}>{t("home")}</Actions>
            </Panel>
          </Page>
        )}
        {mode && (
          <section className="command-log" aria-live="polite">
            <h2>{t("log")}</h2>
            <pre ref={logRef}>
              {commandLog.length
                ? commandLog.map((item) => item.text).join("\n")
                : t("logEmpty")}
            </pre>
          </section>
        )}
      </main>
    </>
  );
}

function Toast({ message, tone, onDismiss }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    const hide = setTimeout(() => setOpen(false), 5000);
    const gone = setTimeout(onDismiss, 5260);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(hide);
      clearTimeout(gone);
    };
  }, [onDismiss]);
  return (
    <div
      className={`toast ${tone}${open ? " open" : ""}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span className="material-icons">
        {tone === "error" ? "error_outline" : "info"}
      </span>
      <span className="toast-text">{message}</span>
      <button type="button" className="toast-close" onClick={() => setOpen(false)}>
        <span className="material-icons">close</span>
      </button>
    </div>
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
function FilePick({ accept, file, onPick, label }) {
  return (
    <label className="file-pick">
      <span className="material-icons">{file ? "description" : "folder_open"}</span>
      <span className="file-name">{file ? file.name : label}</span>
      <input
        type="file"
        accept={accept}
        onChange={(event) => onPick(event.target.files?.[0] || null)}
      />
    </label>
  );
}
function Confirm({ title, text, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const close = (after) => {
    setOpen(false);
    setTimeout(after, 180);
  };
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") close(onCancel);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      className={`overlay${open ? " open" : ""}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close(onCancel);
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true">
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="actions">
          <button type="button" onClick={() => close(onConfirm)}>
            {confirmLabel}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => close(onCancel)}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
function Select({ value, options, placeholder, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!box.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const chosen = options.find((option) => option.value === value);
  return (
    <div className={`select${open ? " open" : ""}`} ref={box}>
      <button
        type="button"
        className="select-value"
        onClick={() => setOpen(!open)}
        disabled={disabled}
      >
        <span className="select-label">{chosen ? chosen.label : placeholder}</span>
        <span className="material-icons">expand_more</span>
      </button>
      {open && (
        <div className="select-list">
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`select-option${option.value === value ? " on" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function Actions({ onClick, disabled, children, extra }) {
  return (
    <div className="actions">
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
      {extra}
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
