const ZH = {
  appTitle: "Xiaomi MIX 4 刷机",
  noDevice: "未连接设备",
  log: "日志",
  logEmpty: "等待执行命令",
  welcomeTitle: "开始",
  leaveTitle: "返回开始页面？",
  leaveText: "当前进度会丢失。",
  leaveConfirm: "返回",
  cancel: "取消",
  modeFirst: "初次刷入",
  modeFirstText: "从官方底包开始，包含授权",
  modeUpdate: "更新",
  modeUpdateText: "只刷入新的刷机包",
  pause: "暂停",
  resume: "继续",
  reconnectAdb: "重新连接 ADB",
  skip: "跳过",
  mockMode: "Mock 模式",
  waiting: "等待操作",
  language: "English",
  theme: "深色模式",

  navConnect: "连接",
  navBase: "底包",
  navTwrp: "TWRP",
  navAuth: "授权",
  navAuthFlash: "刷入授权",
  navRom: "刷机包",
  navDone: "完成",

  connectTitle: "连接设备",
  connectText: "使用 Chrome 或 Edge 连接正常开机的 MIX 4。",
  connectAction: "连接设备",

  baseTitle: "官方底包",
  baseText: "设备已在官方固件时可以跳过这一步。",
  baseWarning: "此操作会清除手机上的全部数据。",
  pickBase: "选择本地底包",
  flashBaseAction: "下载并刷入官方底包",
  flashBaseLocal: "刷入本地底包",

  twrpTitle: "临时启动 TWRP",
  pickTwrp: "选择本地 TWRP 镜像",
  bootTwrpAction: "自动启动 TWRP",

  collectTitle: "采集并提交授权",
  collectText: "请让 TWRP 停留在主界面。",
  collectAction: "采集并提交授权",

  authFlashTitle: "刷入授权包",
  authFlashText: "先在 TWRP 中选择 高级 - ADB Sideload 并滑动确认。",
  authFlashAction: "刷入授权包",

  romTitle: "自动刷入刷机包",
  romText: "先在 TWRP 中选择 高级 - ADB Sideload 并滑动确认。",
  selectVersion: "选择版本",
  pickRom: "选择本地刷机包",
  romAction: "下载并自动刷入",
  romLocal: "刷入本地刷机包",

  doneTitle: "完成",
  doneText: "刷机包已刷入，设备正在重启进入系统。",
  home: "返回主页",

  busyConnectFastboot: "连接 fastboot",
  busyDownloadBase: "下载官方底包",
  busyReadLocalBase: "读取本地底包",
  busyFlashBase: "刷入官方底包",
  busyBootTwrp: "启动 TWRP",
  busyWaitAdb: "等待 ADB",
  busyConnectAdb: "连接 ADB",
  busyCollect: "采集中",
  busySubmit: "提交授权",
  busyFlashAuth: "刷入授权包",
  busyFlashRom: "下载并刷入",
  busyFlashLocalRom: "刷入本地刷机包",

  progDownloadTwrp: "下载 TWRP",
  progUploadTwrp: "上传 TWRP",
  progUploadRequest: "上传授权请求",
  progDownloadAuth: "下载授权包",
  progFlashAuth: "刷入授权包",
  progFlashRom: "下载并刷入刷机包",
  progFlash: "刷入 {partition} {index}",
  progErase: "擦除 {partition} {index}",
  progSlot: "切换槽位 {slot} {index}",

  connectedFastboot: "已连接 fastboot",
  skippedBase: "已跳过官方底包",
  baseFlashed: "已执行 {script} 的 {count} 条命令，设备保持在 fastboot",
  twrpBooted: "TWRP 已启动，请等待 ADB",
  connected: "已连接 {serial}",
  gotAuth: "已取得 {name}，请在 TWRP 中选择 高级 - ADB Sideload",
  authFlashed: "授权包已刷入",
  romFlashed: "刷机包已刷入，设备正在重启",
  logError: "错误 {detail}",

  noWebUsb: "当前浏览器不支持 WebUSB，请使用 Chrome 或 Edge",
  noFastbootDevice:
    "没有找到 fastboot 设备。请让手机进入 fastboot 后用数据线连接，并在弹出的窗口中选择设备",
  noAdbDevice:
    "没有找到 ADB 设备。请等待 TWRP 启动完成，并在手机上允许这台电脑调试",
  noAdbDeviceMode:
    "没有找到 ADB 设备。请确认 TWRP 已在对应模式，并在手机上允许这台电脑调试",
  notSideload:
    "设备不在 ADB Sideload 模式。请在 TWRP 中选择 高级 - ADB Sideload，滑动确认后重试",
  downloadFailed: "下载失败 HTTP {status}",
  partDownloadFailed: "下载分卷失败 HTTP {status}",
  sizeFailed: "无法读取文件大小 HTTP {status}",
  rangeIgnored: "源站忽略了 Range 请求，无法分段下载",
  baseSizeFailed: "无法读取官方底包大小",
  baseNoRange: "官方底包源站不支持分段下载",
  baseTruncated: "底包数据在 {name} 处中断",
  baseMissingFile: "底包缺少 {file}",
  baseNoScript: "官方底包中没有 {script}",
  baseNoCommands: "{script} 中没有可执行的 fastboot 命令",
  collectEmpty: "采集程序没有生成授权请求",
  authHttp: "授权服务 HTTP {status}",
  authNetwork: "授权请求网络错误",
  authTimeout: "授权请求超时",
  authNoPackage: "授权服务未返回授权包",
  sideloadClosed: "sideload 连接已断开",
  sideloadReject: "TWRP 拒绝刷机包",
  sideloadBadBlock: "sideload 返回无效块号 {cmd}",
  sideloadRange: "sideload 请求超出文件范围",
  romOffset: "刷机包偏移超出分卷范围",
};

const EN = {
  appTitle: "Xiaomi MIX 4 Flasher",
  noDevice: "No device",
  log: "Log",
  logEmpty: "No commands yet",
  welcomeTitle: "Start",
  leaveTitle: "Return to the start?",
  leaveText: "The current progress is lost.",
  leaveConfirm: "Return",
  cancel: "Cancel",
  modeFirst: "First flash",
  modeFirstText: "Starts from official firmware and includes authorization",
  modeUpdate: "Update",
  modeUpdateText: "Flashes a new ROM only",
  pause: "Pause",
  resume: "Resume",
  reconnectAdb: "Reconnect ADB",
  skip: "Skip",
  mockMode: "Mock mode",
  waiting: "Idle",
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
  connectText: "Connect a booted MIX 4 with Chrome or Edge.",
  connectAction: "Connect device",

  baseTitle: "Official firmware",
  baseText: "Skip this step if the device already runs official firmware.",
  baseWarning: "This erases all data on the phone.",
  pickBase: "Choose a local firmware package",
  flashBaseAction: "Download and flash firmware",
  flashBaseLocal: "Flash local firmware",

  twrpTitle: "Boot TWRP",
  pickTwrp: "Choose a local TWRP image",
  bootTwrpAction: "Boot TWRP",

  collectTitle: "Collect and submit",
  collectText: "Leave TWRP on its main screen.",
  collectAction: "Collect and submit",

  authFlashTitle: "Flash authorization",
  authFlashText: "In TWRP choose Advanced - ADB Sideload and swipe to confirm.",
  authFlashAction: "Flash authorization",

  romTitle: "Flash the ROM",
  romText: "In TWRP choose Advanced - ADB Sideload and swipe to confirm.",
  selectVersion: "Select a version",
  pickRom: "Choose a local ROM",
  romAction: "Download and flash",
  romLocal: "Flash local ROM",

  doneTitle: "Done",
  doneText: "The ROM is flashed and the device is rebooting.",
  home: "Back to start",

  busyConnectFastboot: "Connecting fastboot",
  busyDownloadBase: "Downloading firmware",
  busyReadLocalBase: "Reading local firmware",
  busyFlashBase: "Flashing firmware",
  busyBootTwrp: "Booting TWRP",
  busyWaitAdb: "Waiting for ADB",
  busyConnectAdb: "Connecting ADB",
  busyCollect: "Collecting",
  busySubmit: "Submitting",
  busyFlashAuth: "Flashing authorization",
  busyFlashRom: "Downloading and flashing",
  busyFlashLocalRom: "Flashing local ROM",

  progDownloadTwrp: "Downloading TWRP",
  progUploadTwrp: "Uploading TWRP",
  progUploadRequest: "Uploading request",
  progDownloadAuth: "Downloading authorization",
  progFlashAuth: "Flashing authorization",
  progFlashRom: "Downloading and flashing ROM",
  progFlash: "Flashing {partition} {index}",
  progErase: "Erasing {partition} {index}",
  progSlot: "Setting slot {slot} {index}",

  connectedFastboot: "Fastboot connected",
  skippedBase: "Firmware step skipped",
  baseFlashed: "Ran {count} commands from {script}; the device stays in fastboot",
  twrpBooted: "TWRP booted, waiting for ADB",
  connected: "Connected {serial}",
  gotAuth: "Got {name}. In TWRP choose Advanced - ADB Sideload",
  authFlashed: "Authorization flashed",
  romFlashed: "ROM flashed, the device is rebooting",
  logError: "error {detail}",

  noWebUsb: "This browser has no WebUSB. Use Chrome or Edge.",
  noFastbootDevice:
    "No fastboot device found. Put the phone in fastboot, connect it by cable and pick it in the dialog.",
  noAdbDevice:
    "No ADB device found. Wait for TWRP to finish booting and allow this computer on the phone.",
  noAdbDeviceMode:
    "No ADB device found. Check that TWRP is in the right mode and allow this computer on the phone.",
  notSideload:
    "The device is not in ADB Sideload. In TWRP choose Advanced - ADB Sideload, swipe to confirm and try again.",
  downloadFailed: "Download failed, HTTP {status}",
  partDownloadFailed: "Part download failed, HTTP {status}",
  sizeFailed: "Could not read the file size, HTTP {status}",
  rangeIgnored: "The origin ignored the Range request, so it cannot be split",
  baseSizeFailed: "Could not read the firmware size",
  baseNoRange: "The firmware origin does not serve ranges",
  baseTruncated: "The firmware data stops at {name}",
  baseMissingFile: "The firmware has no {file}",
  baseNoScript: "The firmware has no {script}",
  baseNoCommands: "{script} has no fastboot commands to run",
  collectEmpty: "The collector produced no authorization request",
  authHttp: "Authorization service, HTTP {status}",
  authNetwork: "Authorization request network error",
  authTimeout: "Authorization request timed out",
  authNoPackage: "The authorization service returned no package",
  sideloadClosed: "The sideload connection closed",
  sideloadReject: "TWRP rejected the package",
  sideloadBadBlock: "Sideload returned an invalid block number {cmd}",
  sideloadRange: "Sideload asked for data past the end of the file",
  romOffset: "The ROM offset falls outside the parts",
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
