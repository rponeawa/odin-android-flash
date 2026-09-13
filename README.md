# odin android flash

小米 MIX 4（odin）刷机向导，全部在浏览器里跑。下载、解压、刷写都由页面完成，不需要装驱动或命令行工具，只需要 Chrome 或 Edge（WebUSB）。

## 流程

打开后先选一条流程：

- **初次刷入** — 连接 / 官方底包 / TWRP / 授权 / 刷入授权 / 刷机包 / 完成
- **更新** — 连接 / TWRP / 刷机包 / 完成

底包刷入按包内 `flash_all.sh` 的命令顺序执行，分区名与文件名都取自脚本，不另行硬编码。

## 设备连接

fastboot 与 ADB 是两个不同的 USB 设备，模式一变就要重新授权。模式切换过的步骤、以及手上没有设备的步骤，都会出现「选择设备」按钮。

底包、TWRP、刷机包这三步先备料再要设备：按下按钮先下载解压（选了本地文件就读本地文件），材料备好之后才提示进入对应模式并选择设备，再按一次按钮才开始刷写。ADB Sideload 的连接有超时，8 GB 的刷机包下载不能让设备在旁边等着。备料期间材料留在页面里，第二次按下不会重新下载；材料备好后，该步骤的文件选择与版本下拉会锁定。

采集并提交授权、刷入授权包这两步没有可备的材料，设备未就绪时只有「选择设备」可用。

| 步骤 | 模式 |
| --- | --- |
| 底包、TWRP | Fastboot |
| 采集并提交授权 | TWRP 的普通 ADB |
| 刷入授权包、刷机包 | ADB Sideload |

TWRP 启动后 fastboot 的 USB 句柄会释放；sideload 结束后 ADB 句柄会关闭。切换模式后重新选择设备即可。

macOS 与 Linux 上本机的 adb server 会独占 USB 接口，页面就连不上，报「设备已被其他程序占用」。在终端运行 `adb kill-server` 后重试。只要再跑一次 `adb` 或 `fastboot`，这个 server 就会自动回来。

## 下载

所有下载都经过 Cloudflare Worker 代理，页面只和同源地址打交道。每个文件一次请求，响应边收边写入 OPFS，不在内存里停留。中断后按已写入的字节数用 Range 续传，所以源站需要支持 Range。

底包解压出的镜像、刷机包分卷都暂存在 OPFS（浏览器私有文件系统），刷写时按需读取，不常驻内存。步骤结束后会清理。

## Worker

`worker/auth-proxy.js` 处理三条路由：

- `/api/fetch?url=` — 带 Range 的下载代理，目标站点按白名单限制
- `/api/releases` — GitHub Release 列表，边缘缓存 10 分钟，避免共用出口 IP 触及未认证限额
- `/api/issue` — 授权服务的跨域转发

```sh
npm run deploy:worker
```

开发时 Vite 把 `/api` 代理到线上 worker，见 `vite.config.js`。

## Release 同步

`mega-sync.yml` 每 6 小时跑一次，筛选 Mega 公共文件夹里文件名含「秋城落叶」且非底包的最新文件：

- `check` — 读文件名与大小，不下载。名字与已有 Release 的标题相同就结束，本轮不产生流量
- `download-a` / `download-b` — 仅在名字是新的时运行。Mega 未登录时单次下载上限 5 GB，而 ROM 有 8 GB 出头，所以必须分两半下载，不能合成一次；两次串行是为了不让两笔下载同时占用账号额度
- `publish` — 两半齐了分卷发布为新的 Release，并核对两条 `rom-name.txt` 一致、总字节数等于 `check` 报出的大小

服务器不承载刷机包流量。

## 开发

```sh
npm ci
npm run dev        # http://127.0.0.1:5173
```

未连接设备时勾选页面上的 **Mock 模式**：fastboot 由模拟的 bootloader 应答，ADB 由模拟的守护进程应答，其余部分——下载、解压、按脚本执行、sideload 协议——走的是和真机完全相同的代码。

Mock 模式在「采集并提交授权」这一步需要一份真实的 `request.zip`，放在 `public/request.zip`（已在 `.gitignore` 中，不会进版本库，也不会被部署）。没有它这一步无法通过，因为授权服务只接受真实的采集结果。

```sh
npm run build      # 产物在 dist/，推送到 main 后由 pages.yml 部署
```
