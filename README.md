# odin android flash
小米 MIX 4（odin）刷机向导。底包从小米官方 OSS 直连下载，TWRP 与刷机包从 GitHub Releases 直连下载，浏览器负责本地解压与设备操作。

## Release 同步
`.github/workflows/mega-release.yml` 每 6 小时检查 Mega 公共文件夹，筛选文件名包含“秋城落叶”且排除底包，选择最新文件，在 GitHub Actions 中下载、分卷并创建新 Release。服务器不承载刷机包流量。

## 开发
```sh
npm ci
npm run build
```
