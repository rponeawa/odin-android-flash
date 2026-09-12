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
const REPO = "/api/releases";
const AUTH = "/api/issue";
const PROXY = "/api/fetch?url=";
const TWRP =
  "https://github.com/rponeawa/odin-android-flash/releases/download/tools-odin/qlp_twrp.img";
const AUTHOR = "https://www.coolapk.com/u/4874574";
const GROUP = "https://qm.qq.com/q/LslPTWDqo0";
const GROUP_ID = "489658149";
const COLLECT =
  "https://github.com/rponeawa/odin-android-flash/releases/download/tools-odin/qlp_collect";
const STALL = 30000;
// sideload 块大小。取值同 AOSP adb 的 SIDELOAD_HOST_BLOCK_SIZE (adb.h: CHUNK_SIZE)。
const BLOCK = 64 * 1024;
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
function adbMode(device) {
  const state = device?.banner?.state;
  if (state === "sideload") return "Recovery Sideload";
  if (state === "recovery") return "Recovery ADB";
  return "ADB";
}

function logLine(item) {
  const head = `${item.time}  ${item.mock ? "[mock] " : ""}`;
  if (item.error)
    return (
      head +
      t("logError", {
        detail: item.error.detail || item.error.message || String(item.error),
      })
    );
  return head + item.command + (item.reply ? `  ${item.reply}` : "");
}

function replyText(result) {
  if (typeof result === "string") return result.trim();
  if (typeof result?.text === "string") return result.text.trim();
  return "";
}

class AppError extends Error {
  constructor(key, vars, cause) {
    super();
    this.key = key;
    this.vars = vars;
    if (cause) this.detail = cause.message || String(cause);
  }
  get message() {
    return t(this.key, this.vars);
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

const wasCancelled = (e) => e?.name === "NotFoundError";
const FASTBOOT_FILTER = {
  classCode: 0xff,
  subclassCode: 0x42,
  protocolCode: 0x03,
};

function isFastbootUsb(device) {
  return (device.configurations || []).some((config) =>
    (config.interfaces || []).some((face) =>
      (face.alternates || []).some(
        (alt) =>
          alt.interfaceClass === 0xff &&
          alt.interfaceSubclass === 0x42 &&
          alt.interfaceProtocol === 0x03,
      ),
    ),
  );
}

// 已授权过的就不再打扰用户；没有才弹选择窗口。取消返回 null。
async function requestFastbootUsb() {
  const granted = (await navigator.usb.getDevices()).find(isFastbootUsb);
  if (granted) return granted;
  return navigator.usb
    .requestDevice({ filters: [FASTBOOT_FILTER] })
    .catch((e) => {
      if (wasCancelled(e)) return null;
      throw e;
    });
}

async function requestAdbDevice() {
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  return (await manager.getDevices())[0] || (await manager.requestDevice());
}

// fastboot 用的那个 USB 句柄在进入 TWRP 后已经失效，但接口仍被声明着，
// 不释放会让接下来的 ADB 连接拿不到设备。
// 直接接管已经拿到句柄的 USB 设备，不经过库的 connect：它数到不止一个
// 已授权设备时会再弹一次选择窗口。
async function attachFastboot(usb) {
  const fastboot = new FastbootDevice();
  fastboot.device = usb;
  await fastboot._validateAndConnectDevice();
  return fastboot;
}

async function releaseUsb(fastboot) {
  const usb = fastboot?.device;
  if (!usb) return;
  try {
    await usb.releaseInterface(0);
  } catch (e) {
    /* 已释放或本就不支持 */
  }
  try {
    await usb.close();
  } catch (e) {
    /* 已关闭 */
  }
}

async function connectAdb(device) {
  if (!navigator.usb) throw new AppError("noWebUsb");
  const connection = await device.connect().catch((e) => {
    throw new AppError("deviceBusy", undefined, e);
  });
  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial,
    connection,
    credentialStore: new AdbWebCredentialStore("odin-flash"),
    authenticators: [AdbSignatureAuthenticator, AdbPublicKeyAuthenticator],
  }).catch((e) => {
    throw new AppError("adbNotAllowed", undefined, e);
  });
  return new Adb(transport);
}

// 采集程序把 zip 写到 stdout。让它重定向到手机上的文件再拉回来，而不是直接
// 读 stdout：重定向只捕获 stdout，stderr 不会混进包里，读文件本身也是字节精确的。
async function pushAndCollect(adb, gate, run) {
  const bin = await downloadToFile(COLLECT, "qlp_collect", undefined, gate);
  const sync = await adb.sync();
  await run("adb push qlp_collect /tmp/qlp_collect", () =>
    sync.write({
      filename: "/tmp/qlp_collect",
      file: bin.stream(),
      permission: 0o755,
    }),
  );
  // push 时带的 permission 在设备上没生效，显式补一次执行位
  await run("adb shell chmod 755 /tmp/qlp_collect", () =>
    adb.subprocess.noneProtocol.spawnWait(["chmod", "755", "/tmp/qlp_collect"]),
  );
  // 采集程序把包写到手机上的文件，然后把那个路径打到 stdout
  const proc = await run(
    "adb shell /tmp/qlp_collect qlp_flash",
    () =>
      adb.subprocess.noneProtocol.spawn(["/tmp/qlp_collect", "qlp_flash"]),
  );
  const raw = new Uint8Array(await new Response(proc.output).arrayBuffer());
  const zip = cutZip(raw);
  if (!zip) throw new AppError("collectorFailed", { text: "没有找到 zip" });
  const out = new Blob([zip]);
  if (!out.size) throw new AppError("collectEmpty");
  return out;
}

// 进度回调按固定间隔放行。本地写入每秒会产生上千个数据块，
// 逐个 setState 会让 React 一直重渲染，界面看起来像卡住了。
function throttled(fn, ms = 250) {
  if (!fn) return undefined;
  let last = 0;
  return (...args) => {
    const now = performance.now();
    if (now - last < ms) return;
    last = now;
    fn(...args);
  };
}

// 采集程序把 zip 和一行日志都写到 stdout，日志跟在 zip 后面。
// 按 zip 自己的结构切出来：从第一个本地文件头，到中央目录结尾记录。
function cutZip(bytes) {
  const at = (i, sig) => sig.every((b, k) => bytes[i + k] === b);
  let start = -1;
  for (let i = 0; i + 4 <= bytes.length; i += 1) {
    if (at(i, [0x50, 0x4b, 0x03, 0x04])) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (at(i, [0x50, 0x4b, 0x05, 0x06])) {
      const comment = bytes[i + 20] | (bytes[i + 21] << 8);
      const end = i + 22 + comment;
      return bytes.slice(start, end);
    }
  }
  return null;
}

async function opfsRoot() {
  if (!navigator.storage?.getDirectory) throw new AppError("noOpfs");
  return navigator.storage.getDirectory();
}

async function clearStorage() {
  const root = await opfsRoot();
  for await (const name of root.keys()) {
    try {
      await root.removeEntry(name);
    } catch (e) {
      /* 已被移除 */
    }
  }
}

// 唯一的下载路径。流式写进 OPFS，中断时按已写入的字节数接着下。
// 返回 File，它本身就是 Blob，可以直接交给 fastboot 和 sideload。
async function downloadToFile(url, name, onProgress, gate) {
  const root = await opfsRoot();
  const handle = await root.getFileHandle(name, { create: true });
  const started = performance.now();
  const report = throttled(onProgress);
  let written = 0;
  let total = 0;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(
        proxied(url),
        written > 0 ? { headers: { Range: `bytes=${written}-` } } : undefined,
      );
      if (!response.ok && response.status !== 206)
        throw new AppError("downloadFailed", { status: response.status });
      if (!response.body) throw new AppError("downloadFailed", { status: 404 });
      if (written > 0 && response.status !== 206) written = 0;
      total = written + (Number(response.headers.get("content-length")) || 0);
      const writable = await handle.createWritable({
        keepExistingData: written > 0,
      });
      if (written) await writable.seek(written);
      const reader = response.body.getReader();
      let timer;
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => reader.cancel(), STALL);
      };
      try {
        arm();
        while (true) {
          await gate?.wait();
          const part = await reader.read();
          if (part.done) break;
          await writable.write(part.value);
          written += part.value.length;
          arm();
          const elapsed = performance.now() - started - (gate?.pausedMs || 0);
          report?.(written, total, written / Math.max(0.001, elapsed / 1000));
        }
      } finally {
        clearTimeout(timer);
        await writable.close();
      }
      if (total > 0 && written >= total) {
        const elapsed = performance.now() - started - (gate?.pausedMs || 0);
        onProgress?.(written, total, written / Math.max(0.001, elapsed / 1000));
        return await handle.getFile();
      }
      lastError = new AppError("downloadFailed", { status: 200 });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
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

async function extractTarStream(stream, onEntry) {
  const src = byteReader(stream);
  while (await src.fill(512)) {
    const header = src.take(512);
    const name = text(header.subarray(0, 100));
    if (!name) break;
    const kind = String.fromCharCode(header[156]);
    const size = parseInt(text(header.subarray(124, 136)), 8) || 0;
    const padding = Math.ceil(size / 512) * 512 - size;
    const sink = kind === "x" || kind === "g" ? null : await onEntry(name, size);
    let left = size;
    while (left > 0) {
      if (!(await src.fill(1))) throw new AppError("baseTruncated", { name });
      const chunk = src.take(Math.min(left, src.size));
      await sink?.write(chunk);
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

// 把底包解压到 OPFS：镜像落盘，flash_all.sh 留在内存里。
// 返回完整名到 FileHandle 的映射和脚本内容，之后按脚本刷写。
async function extractBasePackage(file, onProgress) {
  const root = await opfsRoot();
  const files = new Map();
  const report = throttled(onProgress);
  let scriptName = "";
  let scriptText = "";
  let written = 0;
  const stream = file
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  await extractTarStream(stream, async (name, size) => {
    if (!size || name.endsWith("/")) return null;
    if (name === SCRIPT || name.endsWith(`/${SCRIPT}`)) {
      scriptName = name;
      const parts = [];
      return {
        write: (chunk) => parts.push(chunk),
        end: async () => {
          scriptText = await new Blob(parts).text();
        },
      };
    }
    const handle = await root.getFileHandle(name.replace(/\//g, "_"), {
      create: true,
    });
    const writable = await handle.createWritable();
    files.set(name, handle);
    return {
      write: async (chunk) => {
        await writable.write(chunk);
        written += chunk.length;
        report?.(written);
      },
      end: () => writable.close(),
    };
  });
  if (!scriptName) throw new AppError("baseNoScript", { script: SCRIPT });
  onProgress?.(written);
  return { files, scriptName, scriptText };
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

async function runFlashScript(fastboot, resolve, steps, onFlash, run, prefix) {
  let index = 0;
  for (const step of steps) {
    index += 1;
    const label = `${index}/${steps.length}`;
    if (step.verb === "flash") {
      const image = await resolve(step.file);
      if (!image) throw new AppError("baseMissingFile", { file: step.file });
      await run(`fastboot flash ${step.partition} ${step.file}`, () =>
        fastboot.flashBlob(step.partition, image, (p) =>
          onFlash(`${prefix} ${step.partition} ${label}`, p),
        ),
      );
    } else if (step.verb === "erase") {
      onFlash(`${prefix} ${step.partition} ${label}`, 0);
      await run(`fastboot erase ${step.partition}`, () =>
        fastboot.runCommand(`erase:${step.partition}`),
      );
      onFlash(`${prefix} ${step.partition} ${label}`, 1);
    } else if (step.verb === "set_active") {
      onFlash(`${prefix} ${step.slot} ${label}`, 0);
      await run(`fastboot set_active ${step.slot}`, () =>
        fastboot.runCommand(`set_active:${step.slot}`),
      );
      onFlash(`${prefix} ${step.slot} ${label}`, 1);
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
    xhr.onerror = () => reject(new AppError("authNetwork"));
    xhr.ontimeout = () => reject(new AppError("authTimeout"));
    xhr.timeout = 120000;
    xhr.onload = () => {
      const data = xhr.response;
      if (data?.error) {
        reject(Error(data.error));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new AppError("authHttp", { status: xhr.status }));
        return;
      }
      if (!data?.ok || !data.download) {
        reject(new AppError("authNoPackage"));
        return;
      }
      resolve(data);
    };
    xhr.send(fd);
  });
  const blob = await downloadToFile(
    result.download,
    "authorization.zip",
    (done, total, speed) =>
      onProgress?.(t("progDownloadAuth"), done, total, speed),
    gate,
  );
  return { blob, name: result.filename || "authorization.zip" };
}

// 前几个字节，用来判断送出去的到底是不是预期的包
async function headHex(source) {
  if (!(source instanceof Blob)) return "?";
  const bytes = new Uint8Array(await source.slice(0, 8).arrayBuffer());
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

async function sendSideload(adb, source, onProgress, total, gate) {
  let socket;
  try {
    socket = await adb.createSocket(`sideload-host:${total}:${BLOCK}`);
  } catch (e) {
    throw new AppError("notSideload", undefined, e);
  }
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  let sent = 0;
  let pending = new Uint8Array();
  const readExact = async (n) => {
    while (pending.length < n) {
      const x = await reader.read();
      if (x.done) throw new AppError("sideloadClosed");
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
    if (cmd === "FAILFAIL")
      throw new AppError("sideloadReject", {
        sent,
        total,
        head: await headHex(source),
      });
    const block = Number(cmd);
    if (!Number.isInteger(block)) throw new AppError("sideloadBadBlock", { cmd });
    const offset = block * BLOCK;
    const len = Math.min(BLOCK, total - offset);
    if (len <= 0) throw new AppError("sideloadRange");
    const data = await get(offset, len);
    if (data.length !== len)
      throw new AppError("sideloadShort", { block, got: data.length, want: len });
    await writer.write(data);
    sent = Math.max(sent, offset + data.length);
    onProgress(sent, total);
  }
  await writer.close();
  await reader.cancel();
  await socket.close();
}

// Android 启动镜像的魔数：boot/init_boot/recovery 是 ANDROID!，
// vendor_boot 是 VNDRBOOT，两者不同。
const BOOT_MAGICS = {
  boot: [0x41, 0x4e, 0x44, 0x52, 0x4f, 0x49, 0x44, 0x21],
  init_boot: [0x41, 0x4e, 0x44, 0x52, 0x4f, 0x49, 0x44, 0x21],
  recovery: [0x41, 0x4e, 0x44, 0x52, 0x4f, 0x49, 0x44, 0x21],
  vendor_boot: [0x56, 0x4e, 0x44, 0x52, 0x42, 0x4f, 0x4f, 0x54],
};
const ANDROID_MAGIC = BOOT_MAGICS.boot;
const SLOT_PARTITIONS = new Set([
  "boot",
  "init_boot",
  "vendor_boot",
  "dtbo",
  "vbmeta",
  "vbmeta_system",
  "recovery",
  "xbl",
  "xbl_config",
  "abl",
  "aop",
  "tz",
  "hyp",
  "modem",
  "bluetooth",
  "dsp",
  "keymaster",
  "devcfg",
  "qupfw",
  "uefisecapp",
  "imagefv",
  "shrm",
  "multiimgoem",
  "cpucp",
  "qweslicstore",
]);
function magicFor(partition) {
  const name = partition.replace(/_(ab|[ab])$/, "");
  return BOOT_MAGICS[name];
}

function hasMagic(bytes, magic) {
  return !magic || magic.every((byte, i) => bytes[i] === byte);
}
const LOGICAL_PARTITIONS = new Set([
  "system",
  "system_ext",
  "vendor",
  "product",
  "odm",
  "odm_dlkm",
  "vendor_dlkm",
  "system_dlkm",
  "mi_ext",
]);

const SPARSE_MAGIC = 0xed26ff3a;

function fingerprint(bytes) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function sparseInfo(bytes) {
  if (bytes.length < 28) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== SPARSE_MAGIC) return null;
  const headerSize = view.getUint16(8, true);
  const chunkHeader = view.getUint16(10, true);
  const blockSize = view.getUint32(12, true);
  const totalBlocks = view.getUint32(16, true);
  const totalChunks = view.getUint32(20, true);
  let at = headerSize;
  let blocks = 0;
  let written = 0;
  for (let i = 0; i < totalChunks; i += 1) {
    if (at + chunkHeader > bytes.length) return { error: "块头越界" };
    const type = view.getUint16(at, true);
    const chunkBlocks = view.getUint32(at + 4, true);
    const size = view.getUint32(at + 8, true);
    if (size < chunkHeader || at + size > bytes.length) return { error: "块越界" };
    if (type === 0xcac1 || type === 0xcac2 || type === 0xcac3) {
      blocks += chunkBlocks;
      // Skip blocks leave their region untouched, so they cover the header's
      // block count without writing anything.
      if (type !== 0xcac3) written += chunkBlocks * blockSize;
    }
    at += size;
  }
  if (at !== bytes.length) return { error: "末尾有多余字节" };
  if (blocks !== totalBlocks)
    return { error: `块数不符 ${blocks} != ${totalBlocks}` };
  return { expanded: written, sized: blocks * blockSize, chunks: totalChunks };
}

function mockBootloader() {
  const responses = [];
  const log = [];
  let opened = false;
  let pending = 0;
  const payload = [];
  let payloadSize = 0;
  let slot = "a";
  let rebooted = false;
  const flashed = new Map();
  const writes = [];
  const erased = new Set();
  const resized = new Map();

  const reply = (text) => {
    responses.push(new TextEncoder().encode(text));
    log.push(text.split(/\s/)[0]);
  };
  const okay = (text = "") => reply(`OKAY${text}`);
  const fail = (text) => reply(`FAIL${text}`);

  const takePayload = () => {
    const size = payloadSize;
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const part of payload) {
      bytes.set(part, at);
      at += part.length;
    }
    payload.length = 0;
    payloadSize = 0;
    return bytes;
  };

  const getvar = (name) => {
    switch (name) {
      case "product":
        return "odin";
      case "current-slot":
        return slot;
      case "max-download-size":
        return (256 * 1024 * 1024).toString(16);
      case "version":
        return "0.4";
      case "serialno":
        return "MOCK0DIN0000";
      default:
        if (name.startsWith("has-slot:"))
          return SLOT_PARTITIONS.has(name.slice(9)) ? "yes" : "no";
        if (name.startsWith("is-logical:"))
          return LOGICAL_PARTITIONS.has(
            name.slice(11).replace(/_(ab|[ab])$/, ""),
          )
            ? "yes"
            : "no";
        return "";
    }
  };

  const command = (line) => {
    const at = line.indexOf(":");
    const verb = at < 0 ? line : line.slice(0, at);
    const rest = at < 0 ? "" : line.slice(at + 1);
    switch (verb) {
      case "getvar":
        okay(getvar(rest));
        return;
      case "download": {
        const size = parseInt(rest, 16);
        if (!Number.isFinite(size) || size <= 0) {
          fail("Invalid download size");
          return;
        }
        if (size > 512 * 1024 * 1024) {
          fail("Data too large");
          return;
        }
        pending = size;
        reply(`DATA${size.toString(16).padStart(8, "0")}`);
        return;
      }
      case "flash": {
        if (payloadSize === 0) {
          fail(`No payload for ${rest}`);
          return;
        }
        const bytes = takePayload();
        const sparse = sparseInfo(bytes);
        if (sparse?.error) {
          fail(`Malformed sparse image: ${sparse.error}`);
          return;
        }
        if (!sparse && !hasMagic(bytes, magicFor(rest))) {
          fail(`Image is not a boot image`);
          return;
        }
        const written = sparse?.expanded ?? bytes.length;
        writes.push({
          partition: rest,
          bytes: bytes.length,
          written,
          sparse: !!sparse,
          fingerprint: fingerprint(bytes),
        });
        flashed.set(rest, (flashed.get(rest) || 0) + written);
        okay(`Flashing '${rest}'`);
        return;
      }
      case "erase":
        erased.add(rest);
        okay(`Erasing '${rest}'`);
        return;
      case "resize-logical-partition": {
        const [name, size] = rest.split(":");
        if (!LOGICAL_PARTITIONS.has(name.replace(/_(ab|[ab])$/, ""))) {
          fail(`Not a logical partition: ${name}`);
          return;
        }
        resized.set(name, Number(size));
        okay("");
        return;
      }
      case "set_active":
        if (rest !== "a" && rest !== "b") {
          fail(`Invalid slot ${rest}`);
          return;
        }
        slot = rest;
        okay(`Setting current slot to '${rest}'`);
        return;
      case "boot": {
        if (payloadSize === 0) {
          fail("No kernel to boot");
          return;
        }
        const bytes = takePayload();
        if (!sparseInfo(bytes) && !hasMagic(bytes, ANDROID_MAGIC)) {
          fail("Image is not a boot image");
          return;
        }
        okay("Booting");
        return;
      }
      case "reboot":
      case "reboot-bootloader":
        rebooted = true;
        okay("");
        return;
      default:
        fail(`Unknown command ${verb}`);
    }
  };

  const usb = {
    opened: false,
    deviceClass: 0xff,
    deviceSubclass: 0x42,
    deviceProtocol: 0x03,
    vendorId: 0x18d1,
    productId: 0xd00d,
    serialNumber: "MOCK0DIN0000",
    configurations: [
      {
        configurationValue: 1,
        interfaces: [
          {
            interfaceNumber: 0,
            claimed: false,
            alternates: [
              {
                alternateSetting: 0,
                interfaceClass: 0xff,
                endpoints: [
                  { type: "bulk", direction: "in", endpointNumber: 1 },
                  { type: "bulk", direction: "out", endpointNumber: 2 },
                ],
              },
            ],
          },
        ],
      },
    ],
    async open() {
      opened = true;
      this.opened = true;
    },
    async close() {
      opened = false;
      this.opened = false;
    },
    async reset() {},
    async selectConfiguration() {},
    async claimInterface() {
      this.configurations[0].interfaces[0].claimed = true;
    },
    async releaseInterface() {
      this.configurations[0].interfaces[0].claimed = false;
    },
    async transferOut(endpoint, data) {
      // The library hands commands as Uint8Array views but payload chunks as
      // ArrayBuffers, so read the length that the value actually has.
      const bytes = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data);
      if (pending > 0) {
        const take = Math.min(bytes.length, pending);
        payload.push(bytes.slice(0, take));
        payloadSize += take;
        pending -= take;
        if (take && payloadSize % (4 * 1024 * 1024) < take) await wait(1);
        if (pending === 0) okay("");
        return { bytesWritten: take, status: "ok" };
      }
      command(new TextDecoder().decode(bytes));
      return { bytesWritten: bytes.length, status: "ok" };
    },
    async transferIn() {
      while (!responses.length) await wait(4);
      const bytes = responses.shift();
      return { data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), status: "ok" };
    },
  };

  return {
    usb,
    get flashed() {
      return flashed;
    },
    get erased() {
      return erased;
    },
    get writes() {
      return writes;
    },
    get resized() {
      return resized;
    },
    get slot() {
      return slot;
    },
    get rebooted() {
      return rebooted;
    },
    get commands() {
      return log;
    },
  };
}

async function connectMockFastboot() {
  const bootloader = mockBootloader();
  const fastboot = new FastbootDevice();
  if (typeof fastboot._validateAndConnectDevice !== "function")
    throw Error("android-fastboot 的内部接口变了，Mock 设备无法接管连接");
  fastboot.device = bootloader.usb;
  await fastboot._validateAndConnectDevice();
  // 便于在控制台检查这台模拟设备的状态
  if (typeof globalThis !== "undefined") globalThis.__mockBootloader = bootloader;
  return { fastboot, bootloader };
}

function mockSideloadSocket(total) {
  const encoder = new TextEncoder();
  const count = Math.ceil(total / BLOCK);
  let next = 0;
  let received = 0;
  let head = null;
  let verdict = "";
  return {
    readable: new ReadableStream({
      async pull(controller) {
        if (next < count) {
          controller.enqueue(encoder.encode(String(next++).padStart(8, "0")));
          return;
        }
        if (!verdict) {
          // 块号发完之后，最后一块可能还在路上：ReadableStream 会在消费者
          // 读走一个块号后立刻补充队列，判定得等字节数不再增长再下。
          let last = -1;
          for (let i = 0; i < 50 && received !== last; i += 1) {
            last = received;
            await wait(10);
          }
          // sideload-host 只搬字节，不校验包内容；是不是合法 zip 由之后
          // 的安装器判断，模拟器不代劳，只在控制台提示。
          const ok = received === total;
          if (!ok)
            console.warn(
              `[mock] 字节数不符：收到 ${received}，声明 ${total}`,
            );
          else if (head !== "PK")
            console.warn(
              `[mock] 字节数正确，但前两字节是 ${JSON.stringify(head)} 而非 "PK"`,
            );
          verdict = ok ? "DONEDONE" : "FAILFAIL";
        }
        await wait(4);
        controller.enqueue(encoder.encode(verdict.slice(0, 8)));
      },
    }),
    writable: new WritableStream({
      write(chunk) {
        if (received === 0) head = String.fromCharCode(chunk[0], chunk[1]);
        received += chunk.length;
      },
    }),
    async close() {},
  };
}

// Mock 模式下采集程序交出的东西。没有真实的 request.zip 就没法继续，
// 与其塞个占位数据让授权服务报"不是有效 zip"，不如在这里说清楚。
async function mockCollectorOutput() {
  const local = await fetch("/request.zip")
    .then((r) => (r.ok ? r.blob() : null))
    .catch(() => null);
  if (local) return local;
  throw new AppError("mockNeedsRequest");
}

function mockAdb() {
  const written = [];
  // 模拟采集程序把包写到手机上的文件，之后再拉回来
  const deviceFiles = new Map();
  return {
    mock: true,
    serial: "MOCK0DIN0000",
    banner: { state: "recovery" },
    written,
    async sync() {
      return {
        async write({ filename, file }) {
          const size = file ? new Blob([file]).size : 0;
          written.push({ filename, size });
          if (file) await new Response(file).arrayBuffer();
          await wait(400);
        },
        read(filename) {
          const blob = deviceFiles.get(filename);
          if (!blob) throw new Error(`no such file: ${filename}`);
          return blob.stream();
        },
        async dispose() {},
      };
    },
    subprocess: {
      noneProtocol: {
        async spawn() {
          await wait(600);
          // 真机是写到文件再把路径打到 stdout，这里照做
          const path = "/tmp/request.zip";
          deviceFiles.set(path, await mockCollectorOutput());
          return { output: new Blob([path]).stream() };
        },
      },
    },
    power: {
      async reboot() {
        await wait(300);
      },
    },
    async createSocket(service) {
      const chunks = String(service).split(":");
      return mockSideloadSocket(Number(chunks[1]) || 0);
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
  const [pausable, setPausable] = useState(false);
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
    logFailure(error);
    notify(error?.message || error?.detail || String(error), "error");
  };
  const dismissToast = useCallback(() => setToast(null), []);
  const logRef = useRef(null);
  const logId = useRef(0);
  const appendLog = (entry) => {
    const id = (logId.current += 1);
    setCommandLog((items) => [
      ...items.slice(-39),
      { id, time: new Date().toLocaleTimeString(), mock: mockMode, ...entry },
    ]);
    return id;
  };
  const logCommand = (command) => appendLog({ command });
  const logFailure = (error) => appendLog({ error });
  const settleCommand = (id, reply) =>
    setCommandLog((items) =>
      items.map((item) => (item.id === id ? { ...item, reply } : item)),
    );
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [commandLog]);
  const togglePause = () => {
    if (gate.paused) gate.resume();
    else gate.pause();
    setPaused(gate.paused);
  };
  // 按钮文字和状态行共用同一个阶段名，避免两者在切换瞬间各说各话
  // pausable 只在下载阶段为真：刷写和 sideload 期间闸门不会被查询，
  // 挂住也会让设备干等，所以那时不提供暂停。
  const phase = (key, pausable = false) => {
    const text = t(key);
    setBusy(text);
    setProgress({ label: text });
    setPausable(pausable);
    if (!pausable) {
      gate.resume();
      setPaused(false);
    }
  };
  const begin = (key, pausable = false) => {
    gate.reset();
    setPaused(false);
    phase(key, pausable);
  };
  const finish = () => {
    gate.reset();
    setPaused(false);
    setBusy("");
    setProgress(null);
  };
  const attachAdb = (next) => {
    setAdb(next);
    setDevice({
      mode: adbMode(next),
      name: next.serial || "",
      serial: next.serial || "",
    });
  };
  const asSideload = async (action) => {
    setDevice((d) => (d ? { ...d, mode: "Recovery Sideload" } : d));
    try {
      return await action();
    } finally {
      // 只是丢掉引用的话，设备仍被本页占着，之后再连必然失败
      try {
        await adb.close();
      } catch (e) {
        /* 连接已经断了 */
      }
      setAdb(null);
      setDevice(null);
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
    document.title = t("appTitle");
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);
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
      .then((r) => {
        if (!r.ok) throw new AppError("releasesFailed", { status: r.status });
        return r.json();
      })
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
    phase("busyConnectFastboot");
    try {
      const usb = mockMode ? null : await requestFastbootUsb();
      if (!mockMode && !usb) {
        finish();
        return;
      }
      const device = mockMode
        ? (await connectMockFastboot()).fastboot
        : await run("fastboot connect (WebUSB)", () =>
            attachFastboot(usb).catch((e) => {
              throw new AppError("noFastbootDevice", undefined, e);
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
      finish();
    }
  };
  const flashBase = async () => {
    if (!fastboot) return;
    begin(baseFile ? "busyReadLocalBase" : "busyDownloadBase", !baseFile);
    try {
      await clearStorage();
      const archive =
        baseFile ||
        (await downloadToFile(BASE, "base.tgz", (done, total, speed) =>
          setProgress({ label: t("busyDownloadBase"), done, total, speed }),
        gate));
      phase("busyUnpackBase");
      const { files, scriptName, scriptText } = await extractBasePackage(
        archive,
        (done) =>
          setProgress({ label: t("busyUnpackBase"), done, total: 0 }),
      );
      const root = scriptName.slice(0, scriptName.length - SCRIPT.length);
      const resolve = async (file) => {
        if (file === SCRIPT) return scriptText;
        const handle = files.get(root + file);
        if (!handle) throw new AppError("baseMissingFile", { file });
        return handle.getFile();
      };
      const steps = parseFlashScript(scriptText);
      if (!steps.length) throw new AppError("baseNoCommands", { script: SCRIPT });
      phase("busyFlashBase");
      const onFlash = (label, p) =>
        setProgress({ label, done: Math.round(p * 1000), total: 1000 });
      await runFlashScript(
        fastboot,
        resolve,
        steps,
        onFlash,
        run,
        t("busyFlashBase"),
      );
      notify(t("baseFlashed", { script: SCRIPT, count: steps.length }));
      await clearStorage();
      advance();
    } catch (e) {
      showError(e);
    } finally {
      finish();
    }
  };
  // 除了第一步，其余步骤都靠这个按钮换设备：fastboot 与 ADB 是两个不同的
  // USB 设备，模式一变就得重新选。
  const selectDevice = async () => {
    // 重复连接同一个已占用的设备只会失败
    if (deviceReady) return;
    begin("busySelectDevice");
    try {
      if (mockMode) {
        if (needsFastboot) {
          setFastboot((await connectMockFastboot()).fastboot);
          setDevice({
            mode: "Fastboot",
            name: "odin",
            serial: "MOCK0DIN0000",
          });
        } else {
          attachAdb(mockAdb());
        }
        return;
      }
      if (needsFastboot) {
        const usb = await requestFastbootUsb();
        if (!usb) return;
        setFastboot(await attachFastboot(usb));
        setDevice({
          mode: "Fastboot",
          name: usb.serialNumber || "",
          serial: usb.serialNumber || "",
        });
      } else {
        const found = await requestAdbDevice();
        if (!found) return;
        const device = await connectAdb(found);
        // 模式不对就当场说清楚，别等真正发 sideload 时才失败
        const mode = adbMode(device);
        const wanted = needsSideload ? "Recovery Sideload" : "Recovery ADB";
        if (mode !== wanted) {
          await device.close().catch(() => {});
          throw new AppError(needsSideload ? "needSideload" : "needRecoveryAdb");
        }
        attachAdb(device);
      }
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
    begin("busyDownloadTwrp", !twrpFile);
    try {
      const blob =
        twrpFile ||
        (await downloadToFile(
          TWRP,
          "twrp.img",
          (done, total, speed) =>
            setProgress({ label: t("busyDownloadTwrp"), done, total, speed }),
          gate,
        ));
      phase("busyBootTwrp");
      await run(`fastboot boot <${twrpFile?.name || "qlp_twrp.img"}>`, () =>
        fastboot.bootBlob(blob, (p) =>
          setProgress({
            label: t("busyBootTwrp"),
            done: Math.round(p * 1000),
            total: 1000,
          }),
        ),
      );
      // 句柄一放掉，标题栏也不能再说设备还在
      await releaseUsb(fastboot);
      setFastboot(null);
      setDevice(null);
      notify(t("twrpBooted"));
      advance();
    } catch (e) {
      showError(e);
    } finally {
      finish();
    }
  };
  const collect = async () => {
    if (!adb) return;
    begin("busyCollect");
    try {
      const request = await pushAndCollect(adb, gate, run);
      logCommand(
        `采集得到 ${request.size} 字节，头 ${(await headHex(request)).slice(0, 23)}`,
      );
      phase("busySubmit");
      const result = await issueAuthorization(
        request,
        (label, done, total, speed) => {
          setBusy(label);
          setProgress({ label, done, total, speed });
        },
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
    begin("busyFlashAuth");
    try {
      if (!adb) return;
      await run(`adb sideload ${issued.name}`, () =>
        asSideload(() =>
          sendSideload(
            adb,
            issued.blob,
            (done, total) =>
              setProgress({ label: t("busyFlashAuth"), done, total }),
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
  const reboot = async (device) => {
    try {
      await run("adb reboot", () => device.power.reboot());
    } catch (e) {
      logFailure(e);
    }
  };
  const flash = async () => {
    if (!adb || (!rom && !romFile)) return;
    begin(romFile ? "busyFlashLocalRom" : "busyDownloadRom");
    try {
      if (!adb) return;
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
        await reboot(adb);
        await clearStorage();
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
      phase("busyDownloadRom", true);
      let downloaded = 0;
      const parts = [];
      for (const asset of assets) {
        const base = downloaded;
        parts.push(
          await downloadToFile(
            asset.browser_download_url,
            asset.name,
            (done, partTotal, speed) =>
              setProgress({
                label: t("busyDownloadRom"),
                done: base + done,
                total,
                speed,
              }),
            gate,
          ),
        );
        downloaded += Number(asset.size || 0);
      }
      // File 也是 Blob，跨分卷的切片的由浏览器处理，不必自己拼接
      const source = new Blob(parts);
      if (source.size !== total)
        throw new AppError("romSizeMismatch", {
          got: source.size,
          want: total,
        });
      phase("busyFlashRom");
      await run(`adb sideload ${rom.name}`, () =>
        asSideload(() =>
          sendSideload(
            adb,
            source,
            (done, all) =>
              setProgress({ label: t("busyFlashRom"), done, total: all }),
            total,
            gate,
          ),
        ),
      );
      await reboot(adb);
      await clearStorage();
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
    clearStorage().catch(() => {});
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
  const pauseButton = busy && pausable ? (
    <button type="button" className="secondary" onClick={togglePause}>
      <span className="material-icons">{paused ? "play_arrow" : "pause"}</span>
      {paused ? t("resume") : t("pause")}
    </button>
  ) : null;
  const flow = FLOWS[mode] || [];
  const view = flow[step];
  const needsFastboot = view === "base" || view === "twrp";
  const needsAdb = view === "collect" || view === "auth" || view === "rom";
  const needsSideload = view === "auth" || view === "rom";
  const deviceReady = needsFastboot ? !!fastboot : needsAdb ? !!adb : true;
  // 只有设备换过模式的步骤才放这个按钮：连接之后到 TWRP 启动前是同一个
  // fastboot 设备，不用重选。选好之后按钮留在原地置灰，不要忽隐忽现。
  // 手上没有该步骤需要的设备时，除了选择设备按钮，其余一律不可操作
  const blocked = !!busy || !deviceReady;
  const deviceButton =
    view === "collect" || view === "rom" || !deviceReady ? (
      <button
        type="button"
        className="secondary"
        onClick={selectDevice}
        disabled={!!busy || deviceReady}
      >
        <span className="material-icons">usb</span>
        {t("chooseDevice")}
      </button>
    ) : null;
  const fallback = { label: busy || t("waiting") };
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
            <p className="credit">
              {t("creditBy")}{" "}
              <a href={AUTHOR} target="_blank" rel="noreferrer">
                {t("creditName")}
              </a>
            </p>
            <p className="credit">{t("creditSync")}</p>
            <p className="credit">
              {t("creditQq")}
              <a href={GROUP} target="_blank" rel="noreferrer">
                {GROUP_ID}
              </a>
            </p>
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
              <Actions onClick={connect} disabled={blocked}>
                {busy || t("connectAction")}
              </Actions>
              <label className="mode-choice">
                <input
                  type="checkbox"
                  checked={mockMode}
                  onChange={(event) => setMockMode(event.target.checked)}
                  disabled={blocked}
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
                disabled={blocked}
                label={t("pickBase")}
              />
              <Actions
                extra={
                  <>
                    {deviceButton}
                    {pauseButton}
                    <button
                      type="button"
                      className="secondary"
                      onClick={skipBase}
                      disabled={blocked}
                    >
                      <span className="material-icons">skip_next</span>
                      {t("skip")}
                    </button>
                  </>
                }
                onClick={flashBase}
                disabled={blocked}
              >
                {busy ||
                  (baseFile
                    ? t("actionFlashSelected")
                    : t("actionDownloadBase"))}
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
                disabled={blocked}
                label={t("pickTwrp")}
              />
              <Actions
                extra={
                  <>
                    {deviceButton}
                    {pauseButton}
                  </>
                }
                onClick={bootTwrp}
                disabled={blocked}
              >
                {busy ||
                  (twrpFile
                    ? t("actionBootSelected")
                    : t("actionDownloadTwrp"))}
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
                    {deviceButton}
                    {pauseButton}
                  </>
                }
                onClick={collect}
                disabled={blocked}
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
                    {deviceButton}
                    {pauseButton}
                  </>
                }
                onClick={flashAuthorization}
                disabled={blocked || !issued}
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
                disabled={blocked}
                options={releases.map((x) => ({
                  value: String(x.id),
                  label: x.name,
                }))}
                onChange={(value) =>
                  setRom(releases.find((x) => String(x.id) === value))
                }
                onClear={() => setRom(null)}
              />
              <FilePick
                accept=".zip"
                file={romFile}
                onPick={setRomFile}
                disabled={blocked}
                label={t("pickRom")}
              />
              <Actions
                extra={
                  <>
                    {deviceButton}
                    {pauseButton}
                  </>
                }
                onClick={flash}
                disabled={blocked || (!rom && !romFile)}
              >
                {busy ||
                  (romFile
                    ? t("actionFlashSelected")
                    : t("actionDownloadRom"))}
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
                ? commandLog.map(logLine).join("\n")
                : t("logEmpty")}
            </pre>
          </section>
        )}
        {mode && (
          <div className="step-nav">
            <button
              type="button"
              className="secondary"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0 || !!busy}
            >
              <span className="material-icons">arrow_back</span>
              {t("prev")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setStep((current) => Math.min(flow.length - 1, current + 1))
              }
              disabled={step === flow.length - 1 || !!busy}
            >
              {t("next")}
              <span className="material-icons">arrow_forward</span>
            </button>
          </div>
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
function FilePick({ accept, file, onPick, label, disabled }) {
  return (
    <div className={`file-pick${disabled ? " disabled" : ""}`}>
      <label className="file-pick-main">
        <span className="material-icons">
          {file ? "description" : "folder_open"}
        </span>
        <span className="file-name">{file ? file.name : label}</span>
        <input
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(event) => {
            onPick(event.target.files?.[0] || null);
            event.target.value = "";
          }}
        />
      </label>
      {file && (
        <button
          type="button"
          className="icon"
          onClick={() => onPick(null)}
          title={t("clear")}
          aria-label={t("clear")}
          disabled={disabled}
        >
          <span className="material-icons">close</span>
        </button>
      )}
    </div>
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
function Select({ value, options, placeholder, onChange, onClear, disabled }) {
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
    <div className="select-row">
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
      {chosen && onClear && (
        <button
          type="button"
          className="icon"
          onClick={onClear}
          title={t("clear")}
          aria-label={t("clear")}
          disabled={disabled}
        >
          <span className="material-icons">close</span>
        </button>
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
  if (total === undefined)
    return (
      <div className="progress">
        <div>{label}</div>
      </div>
    );
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
