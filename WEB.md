# RPGBox Web 测试版

Web 测试版可部署到任意静态网站服务，并同时包含游戏界面和 RPG 制作器。

## 本地运行

```powershell
pnpm build:web
pnpm preview:web
```

- 游戏入口：`http://localhost:4173/`
- 制作器入口：`http://localhost:4173/builder.html`

不要直接双击 `dist/index.html`。浏览器会限制 `file://` 页面读取静态资源，应通过 HTTP 静态服务访问。

## 浏览器行为

- RPG 数据和立绘保存在当前站点的浏览器存储中。
- `.rpgbox` 和 `.role.rpgbox` 导出到浏览器下载目录。
- 清除站点数据、使用无痕窗口或更换域名会失去该站点中的本地数据。
- AI 接口必须允许浏览器跨域访问，并且 HTTPS 页面只能连接 HTTPS 接口。

Web 构建默认不包含仓库本地的预设 RPG 输入。
