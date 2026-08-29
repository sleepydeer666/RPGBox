# RPGBox

RPGBox 是一款面向 PC 和 Android 的 AI RPG 对话客户端，针对“单主角、多 NPC”的互动剧情体验进行了优化。它将 AI 生成的旁白、角色对话和行动选项组织成更接近 Galgame 的竖屏交互界面。
项目开发的初衷是优化自己偏好的“多人物短篇叙事”玩法的体验，完全由个人使用Codex开发完成，因此和酒馆那种强大成熟的LLM聊天框架不能比。如果需要长篇复杂叙事，大量世界书设定的玩法，酒馆肯定更合适。
由于作者偏向NSFW玩法，因此预设中有相关的设定，框架内也专门有NSFW的设定区域，可自行调整/留空。

## 主要功能

- 多 RPG 目录，支持新建、编辑、克隆、删除、导入和导出
- 兼容 OpenAI 格式的 API，可从接口获取模型列表
- 每个 RPG 可独立选择模型、生成参数和上下文轮数
- 支持流式生成、中断生成和最近对话回滚
- 旁白、主角对话、NPC 对话和点击选项分层展示
- 选项可直接选择、组合或追加自定义指令
- 支持单人、多人立绘布局，以及按叙事模式切换立绘
- 角色可配置姓名、设定、代表色、状态栏、不同叙事模式下的立绘及特别设定
- 支持历史记录、自动总结剧情记忆、自动总结人物经历
- 支持章节名、时间、地点与叙事模式的动态变化，并反映在UI上
- 提供扩展控制指令，方便自动修复格式、控制文字数量等
- 有独立的NSFW玩法的设定区域，可留空以回避NSFW（预设包内其他设定中也描述了NSFW内容，如需彻底回避/修改需要同步删除/调整）

## 角色与 RPG 分享

RPGBox 使用 `.rpgbox` 作为 RPG 分享文件，可包含 RPG 设置、角色和立绘资源。单个 NPC 也可以通过 `.role.rpgbox` 角色包导入或导出。

## AI 接口

RPGBox 支持 OpenAI 兼容接口。在全局设置中添加 Base URL、API Key 和模型后，即可在不同 RPG 中选择使用。

## 许可证

项目代码使用 [GPL-3.0-only](LICENSE) 许可证。

## 免责声明
1. RPGBox是免费开源的框架app，不用于商业目的。
2. 框架提供的预设使用了DMM Games的闪耀星骑士、像素深渊游戏的故事设定、公开的人物立绘（部分特殊立绘采用AI加工生成），角色形象归属版权属原公司所有。
3. AI大语言模型生成内容与框架本身无关，属于AI基于用户要求自动生成，部分预设包含作者个人兴趣和对角色/故事的解读，如不喜欢请自行修改。

## 界面截图
<img width="720" height="1560" alt="1" src="https://github.com/user-attachments/assets/2e17ad65-6aa6-4af5-be3e-b1b264702bf6" /><img width="720" height="1560" alt="2" src="https://github.com/user-attachments/assets/ab9165da-d56d-4b63-9302-1ba2189a5e5e" />
<img width="720" height="1560" alt="3" src="https://github.com/user-attachments/assets/b9eec0f7-ac7b-4c40-a59b-6531acd5d61f" /><img width="720" height="1560" alt="4" src="https://github.com/user-attachments/assets/c01af4b6-f3bd-4975-91b7-bdca64bf67b2" />
<img width="720" height="1560" alt="5" src="https://github.com/user-attachments/assets/f607c947-aff4-4228-a37b-aebef583668e" /><img width="720" height="1560" alt="6" src="https://github.com/user-attachments/assets/27e3cc2c-955b-45ca-8feb-792a90d21c7e" />

