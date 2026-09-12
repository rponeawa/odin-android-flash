import { JSDOM } from "jsdom";
const files = new Map();
const root = {
  async getFileHandle(n, o = {}) { if (!files.has(n)) { if (!o.create) throw new Error("nf"); files.set(n, []); }
    return { async createWritable() { const c = []; return { async write(d) { c.push(new Uint8Array(d.buffer ?? d, d.byteOffset ?? 0, d.byteLength ?? d.length)); }, async seek() {}, async close() { files.set(n, c); } }; },
             async getFile() { return new Blob(files.get(n) || []); } }; },
  async removeEntry(n) { files.delete(n); }, async *keys() { for (const k of files.keys()) yield k; },
};
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "https://odin.androidflash.xyz/" });
const { window } = dom;
globalThis.URL.createObjectURL = () => "blob:m"; globalThis.URL.revokeObjectURL = () => {};
globalThis.FileReader = class { readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onload?.(); }, (e) => { this.onerror?.(e); }); } };
const authz = new Uint8Array(2000); authz.set([0x50,0x4b,0x03,0x04]);
window.XMLHttpRequest = class {
  constructor() { this.upload = {}; this.status = 200; this.response = { ok: true, download: "/api/download/x", filename: "authorization.zip" }; }
  open() {} send() { setTimeout(() => this.onload?.(), 10); }
};
for (const k of ["window","document","HTMLElement","Element","Node","Event","MouseEvent","localStorage","requestAnimationFrame","cancelAnimationFrame","getComputedStyle","XMLHttpRequest"])
  if (window[k]) Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
Object.defineProperty(globalThis.navigator, "storage", { value: { getDirectory: async () => root }, configurable: true });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const abs = String(url).startsWith("/") ? "https://odin.androidflash.xyz" + url : String(url);
  if (abs.includes("/api/releases")) return { ok: true, json: async () => [] };
  if (abs.includes("/api/download/")) return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === "content-length" ? String(authz.length) : null) }, body: new Blob([authz]).stream() };
  if (abs.includes("/request.zip")) return { ok: false, status: 404 };
  return realFetch(abs, init);
};
window.localStorage.setItem("lang", "zh");
await import("/tmp/t-app.mjs");
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 20)); };
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const click = async (el, n = 6) => { el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); await tick(n); };
const check = (n, p, e = "") => console.log(`${p ? "通过" : "失败"}  ${n}${e ? "  " + e : ""}`);
const btn = (re) => $$(".actions button").find((b) => re.test(b.textContent));
const main = () => $$(".actions button").find((b) => !/选择设备|暂停|继续|跳过/.test(b.textContent));
await tick(8);
await click($$(".choice")[0]);
await click($('input[type="checkbox"]'));
await click($(".actions button"), 60);
await click(btn(/跳过/), 20);
await click($(".actions button"), 150);
check("TWRP 后主按钮置灰", main().disabled);
await click(btn(/选择设备/), 40);
check("选设备后可用", !main().disabled);
await click(main(), 120);
check("采集完成进入授权", /刷入授权/.test($("h1")?.textContent || ""), $("h1")?.textContent?.trim());
check("授权步骤无需重选（同一个 ADB）", !main().disabled);
await click(main(), 120);
console.log("刷完授权:", $("h1")?.textContent?.trim(), "| 设备栏:", $(".device")?.textContent?.trim());
check("sideload 后句柄已弃用", /未连接/.test($(".device")?.textContent || ""));
check("刷机包步骤要求重选", main().disabled);
await click(btn(/选择设备/), 40);
check("重选后可用", !main().disabled);
