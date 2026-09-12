const ZH = {
  appTitle: "Xiaomi MIX 4 刷机",
  noDevice: "未连接设备",
  log: "日志",
  logEmpty: "等待执行命令",
  welcomeTitle: "开始",
  creditBy: "ROM 作者：酷安",
  creditName: "@秋城落叶",
  creditSync: "ROM 自动同步于其分发的 Mega 网盘",
  creditQq: "QQ 群【MIX4@秋城落叶】：",
  leaveTitle: "返回开始页面？",
  leaveText: "当前进度会丢失。",
  leaveConfirm: "返回",
  cancel: "取消",
  clear: "取消选择",
  modeFirst: "初次刷入",
  modeFirstText: "从官方底包开始，包含授权",
  modeUpdate: "更新",
  modeUpdateText: "只刷入新的 ROM",
  pause: "暂停",
  resume: "继续",
  skip: "跳过",
  mockMode: "Mock 模式",
  waiting: "等待操作",
  actionDownloadBase: "自动下载底包并刷入",
  actionDownloadTwrp: "自动下载 TWRP 并启动",
  actionDownloadRom: "自动下载 ROM 并刷入",
  actionFlashSelected: "刷入选中",
  actionBootSelected: "启动选中",
  language: "English",
  theme: "深色模式",

  navConnect: "连接",
  navBase: "底包",
  navTwrp: "TWRP",
  navAuth: "授权",
  navAuthFlash: "刷入授权",
  navRom: "ROM",
  navDone: "完成",

  connectTitle: "连接设备",
  connectText: "让 MIX 4 进入 Fastboot 模式，用 Chrome 或 Edge 连接。",
  connectAction: "连接设备",

  baseTitle: "官方底包",
  baseText: "设备已在官方固件时可以跳过这一步。",
  baseWarning: "此操作会清除手机上的全部数据。",
  pickBase: "选择本地底包",

  twrpTitle: "临时启动 TWRP",
  pickTwrp: "选择本地 TWRP 镜像",

  collectTitle: "采集并提交授权",
  collectText: "进入 TWRP 后，先在手机上滑动滑块允许调试，再点「选择设备」。",
  collectAction: "采集并提交授权",

  authFlashTitle: "刷入授权包",
  authFlashText: "先在 TWRP 中选择 高级 - ADB Sideload 并滑动确认。",
  authFlashAction: "刷入授权包",

  romTitle: "自动刷入 ROM",
  romText: "先在 TWRP 中选择 高级 - ADB Sideload 并滑动确认。",
  selectVersion: "选择版本",
  pickRom: "选择本地 ROM",

  doneTitle: "完成",
  doneText: "ROM 已刷入。请等待设备开机。",
  home: "返回主页",

  busyConnectFastboot: "连接中",
  busySelectDevice: "选择设备中",
  busyDownloadBase: "下载底包中",
  busyUnpackBase: "解压底包中",
  busyReadLocalBase: "读取本地底包中",
  busyFlashBase: "刷入底包中",
  busyDownloadTwrp: "下载 TWRP 中",
  busyBootTwrp: "启动 TWRP 中",
  busyCollect: "采集中",
  busySubmit: "提交授权中",
  busyFlashAuth: "刷入授权包中",
  busyDownloadRom: "下载 ROM 中",
  busyFlashRom: "刷入 ROM 中",
  busyFlashLocalRom: "刷入本地 ROM 中",

  progUploadRequest: "上传授权请求中",
  progDownloadAuth: "下载授权包中",

  connectedFastboot: "已连接 Fastboot",
  skippedBase: "已跳过官方底包",
  baseFlashed: "已执行 {script} 的 {count} 条命令，设备保持在 Fastboot",
  twrpBooted: "TWRP 已启动，请等待 ADB",
  gotAuth: "已取得 {name}，请在 TWRP 中选择 高级 - ADB Sideload",
  authFlashed: "授权包已刷入",
  romFlashed: "ROM 已刷入",
  logError: "错误 {detail}",

  noWebUsb: "当前浏览器不支持 WebUSB，请使用 Chrome 或 Edge",
  noOpfs: "当前浏览器不支持本地暂存，无法处理大文件。请使用 Chrome 或 Edge",
  mockNeedsRequest:
    "Mock 模式需要一份真实的 request.zip 放在项目的 public/request.zip，并通过本地开发服务器打开页面",
  noFastbootDevice:
    "找到了设备但无法连接。请关闭其他占用 USB 的程序（adb、Android File Transfer 等）后重试",
  chooseDevice: "选择设备",
  deviceBusy:
    "找到了设备但无法连接。它可能被其他程序占用（adb、Android File Transfer），请关闭后重试",
  adbNotAllowed: "手机没有允许这台电脑调试。请在手机上点「允许」后重试",
  notSideload:
    "设备不在 ADB Sideload 模式。请在 TWRP 中选择 高级 - ADB Sideload，滑动确认后重试",
  releasesFailed: "无法读取版本列表 HTTP {status}",
  downloadFailed: "下载失败 HTTP {status}",
  baseTruncated: "底包数据在 {name} 处中断",
  baseMissingFile: "底包缺少 {file}",
  baseNoScript: "官方底包中没有 {script}",
  baseNoCommands: "{script} 中没有可执行的 Fastboot 命令",
  collectEmpty: "采集程序没有生成授权请求",
  authHttp: "授权服务 HTTP {status}",
  authNetwork: "授权请求网络错误",
  authTimeout: "授权请求超时",
  authNoPackage: "授权服务未返回授权包",
  sideloadClosed: "sideload 连接已断开",
  sideloadReject: "TWRP 拒绝了这个包。已发送 {sent} / {total} 字节，文件头 {head}",
  sideloadShort: "第 {block} 块只取到 {got} 字节，应为 {want} 字节",
  romSizeMismatch: "下载得到的包为 {got} 字节，与声明的 {want} 字节不符",
  sideloadBadBlock: "sideload 返回无效块号 {cmd}",
  sideloadRange: "sideload 请求超出文件范围",
};

const EN = {
  appTitle: "Xiaomi MIX 4 Flasher",
  noDevice: "No device",
  log: "Log",
  logEmpty: "No commands yet",
  welcomeTitle: "Start",
  creditBy: "ROM by CoolApk",
  creditName: "@秋城落叶",
  creditSync: "Synced automatically from the Mega folder they publish.",
  creditQq: "QQ group MIX4@秋城落叶: ",
  leaveTitle: "Return to the start?",
  leaveText: "The current progress is lost.",
  leaveConfirm: "Return",
  cancel: "Cancel",
  clear: "Clear",
  modeFirst: "First flash",
  modeFirstText: "Starts from official firmware and includes authorization",
  modeUpdate: "Update",
  modeUpdateText: "Flashes a new ROM only",
  pause: "Pause",
  resume: "Resume",
  skip: "Skip",
  mockMode: "Mock mode",
  waiting: "Idle",
  actionDownloadBase: "Download and flash firmware",
  actionDownloadTwrp: "Download and boot TWRP",
  actionDownloadRom: "Download and flash the ROM",
  actionFlashSelected: "Flash selected",
  actionBootSelected: "Boot selected",
  language: "中文",
  theme: "Dark mode",

  navConnect: "Connect",
  navBase: "Firmware",
  navTwrp: "TWRP",
  navAuth: "Authorize",
  navAuthFlash: "Flash auth",
  navRom: "ROM",
  navDone: "Done",

  connectTitle: "Connect the device",
  connectText: "Put the MIX 4 in Fastboot mode and connect it with Chrome or Edge.",
  connectAction: "Connect device",

  baseTitle: "Official firmware",
  baseText: "Skip this step if the device already runs official firmware.",
  baseWarning: "This erases all data on the phone.",
  pickBase: "Choose a local firmware package",

  twrpTitle: "Boot TWRP",
  pickTwrp: "Choose a local TWRP image",

  collectTitle: "Collect and submit",
  collectText:
    "In TWRP, swipe the slider on the phone to allow debugging, then choose the device.",
  collectAction: "Collect and submit",

  authFlashTitle: "Flash authorization",
  authFlashText: "In TWRP choose Advanced - ADB Sideload and swipe to confirm.",
  authFlashAction: "Flash authorization",

  romTitle: "Flash the ROM",
  romText: "In TWRP choose Advanced - ADB Sideload and swipe to confirm.",
  selectVersion: "Select a version",
  pickRom: "Choose a local ROM",

  doneTitle: "Done",
  doneText: "The ROM is flashed. Wait for the device to boot.",
  home: "Back to start",

  busyConnectFastboot: "Connecting",
  busySelectDevice: "Choosing a device",
  busyDownloadBase: "Downloading firmware",
  busyUnpackBase: "Unpacking firmware",
  busyReadLocalBase: "Reading local firmware",
  busyFlashBase: "Flashing firmware",
  busyDownloadTwrp: "Downloading TWRP",
  busyBootTwrp: "Booting TWRP",
  busyCollect: "Collecting",
  busySubmit: "Submitting",
  busyFlashAuth: "Flashing authorization",
  busyDownloadRom: "Downloading the ROM",
  busyFlashRom: "Flashing the ROM",
  busyFlashLocalRom: "Flashing local ROM",

  progUploadRequest: "Uploading request",
  progDownloadAuth: "Downloading authorization",

  connectedFastboot: "Fastboot connected",
  skippedBase: "Firmware step skipped",
  baseFlashed: "Ran {count} commands from {script}; the device stays in Fastboot",
  twrpBooted: "TWRP booted, waiting for ADB",
  gotAuth: "Got {name}. In TWRP choose Advanced - ADB Sideload",
  authFlashed: "Authorization flashed",
  romFlashed: "ROM flashed",
  logError: "error {detail}",

  noWebUsb: "This browser has no WebUSB. Use Chrome or Edge.",
  noOpfs:
    "This browser cannot stage files locally, so large packages cannot be handled. Use Chrome or Edge.",
  mockNeedsRequest:
    "Mock mode needs a real request.zip at public/request.zip in the project, served by the local dev server",
  noFastbootDevice:
    "Found the device but could not connect. Close other programs using it (adb, Android File Transfer) and try again.",
  chooseDevice: "Choose device",
  deviceBusy:
    "Found the device but could not connect. Another program may hold it (adb, Android File Transfer); close it and try again",
  adbNotAllowed:
    "The phone did not allow this computer. Tap Allow on the phone and try again",
  notSideload:
    "The device is not in ADB Sideload. In TWRP choose Advanced - ADB Sideload, swipe to confirm and try again.",
  releasesFailed: "Could not read the release list, HTTP {status}",
  downloadFailed: "Download failed, HTTP {status}",
  baseTruncated: "The firmware data stops at {name}",
  baseMissingFile: "The firmware has no {file}",
  baseNoScript: "The firmware has no {script}",
  baseNoCommands: "{script} has no Fastboot commands to run",
  collectEmpty: "The collector produced no authorization request",
  authHttp: "Authorization service, HTTP {status}",
  authNetwork: "Authorization request network error",
  authTimeout: "Authorization request timed out",
  authNoPackage: "The authorization service returned no package",
  sideloadClosed: "The sideload connection closed",
  sideloadReject: "TWRP rejected the package. Sent {sent} of {total} bytes, header {head}",
  sideloadShort: "Block {block} yielded {got} bytes, expected {want}",
  romSizeMismatch: "The package is {got} bytes, not the {want} it declares",
  sideloadBadBlock: "Sideload returned an invalid block number {cmd}",
  sideloadRange: "Sideload asked for data past the end of the file",
};

const TABLE = { zh: ZH, en: EN };
let current =
  (typeof localStorage !== "undefined" && localStorage.getItem("lang")) ||
  (typeof navigator !== "undefined" && /^zh/i.test(navigator.language || "")
    ? "zh"
    : "en");
if (!TABLE[current]) current = "zh";

export const getLang = () => current;
export const setLang = (next) => {
  current = TABLE[next] ? next : "zh";
  if (typeof localStorage !== "undefined") localStorage.setItem("lang", current);
};
export function t(key, vars) {
  let text = TABLE[current][key] ?? ZH[key] ?? key;
  if (vars)
    for (const [name, value] of Object.entries(vars))
      text = text.replaceAll(`{${name}}`, value);
  return text;
}
