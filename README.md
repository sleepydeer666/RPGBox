# RPGBox

RPGBox 是一款面向 Android 的 AI RPG 对话客户端，针对“单主角、多 NPC”的互动剧情体验进行了优化。它将 AI 生成的旁白、角色对话和行动选项组织成更接近 Galgame 的竖屏交互界面。

## 主要功能

- 多 RPG 目录，支持新建、编辑、克隆、删除、导入和导出
- 兼容 OpenAI 格式的 API，可从接口获取模型列表
- 每个 RPG 可独立选择模型、生成参数和上下文轮数
- 支持流式生成、中断生成和最近对话回滚
- 旁白、主角对话、NPC 对话和点击选项分层展示
- 选项可直接选择、组合或追加自定义指令
- 支持单人、多人立绘布局，以及按角色状态切换立绘
- 角色可配置姓名、设定、代表色、状态栏和多组立绘
- 支持历史记录、剧情记忆和手工总结
- 支持章节名、时间、地点与剧情模式展示
- 可单独收尾当前章节，并引导 AI 开启新剧情
- NSFW 模式按 RPG 独立开启，新建 RPG 默认关闭

## 角色与 RPG 分享

RPGBox 使用 `.rpgbox` 作为 RPG 分享文件，可包含 RPG 设置、角色和立绘资源。单个 NPC 也可以通过 `.role.rpgbox` 角色包导入或导出。

## AI 接口

RPGBox 支持 OpenAI 兼容接口。在全局设置中添加 Base URL、API Key 和模型后，即可在不同 RPG 中选择使用。

## 许可证

项目代码使用 [GPL-3.0-only](LICENSE) 许可证。

## 界面截图
<img width="1440" height="3120" alt="8fc5246bdb3c93a175a0a0edd2655fbf" src="https://github.com/user-attachments/assets/0d03d5df-67d6-4a03-adab-b66e0bd4d9cd" />
<img width="1440" height="3120" alt="d03c8d6d4e84cc95cf04d37952c9d7b2" src="https://github.com/user-attachments/assets/63a2f7a4-bd7a-449a-9c4b-db4a1a25539e" />
<img width="1280" height="2773" alt="171b7373e757e5bfd8e6cd06d302f1c3" src="https://github.com/user-attachments/assets/f6d2be14-e445-438f-b24d-3a19388bc699" />
