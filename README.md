# Feishu-Remote-PC-Agent

将 DeepSeek Agent 接入飞书机器人。通过飞书长连接接收消息，Agent 可以执行命令、读写文件、操控鼠标键盘，实现在飞书里远程操控 Windows PC。

## 本项目大部分由AI编写和执行，本人监管

## 功能

- **远程执行命令** — 启动程序、运行脚本
- **文件操作** — 读取、写入、列出目录
- **鼠标键盘操控** — 移动鼠标、点击、发送组合键、输入文本
- **飞书长连接** — 不需要公网域名，开箱即用

## 快速开始

### 1. 飞书开放平台配置

1. 进入 [飞书开放平台](https://open.feishu.cn/app)，创建「企业自建应用」
2. 在「凭证与基础信息」复制 `App ID` 和 `App Secret`
3. 在「应用能力」→ 开启机器人能力
4. 在「权限管理」添加以下权限并发布：
   - `im:message`
   - `im:message:send_as_bot`
   - 读取单聊和群聊消息的相关权限
5. 在「事件订阅」选择「使用长连接接收事件」，订阅 `im.message.receive_v1`
6. 在「版本管理与发布」创建版本并发布到企业

### 2. 本地配置

```bash
# 安装依赖
npm install

# 创建配置文件
cp .env.example .env
```

编辑 `.env`，填入你的凭据：

| 配置项 | 说明 | 从哪里获取 |
|--------|------|-----------|
| `FEISHU_APP_ID` | 飞书应用 ID | 飞书开放平台 → 凭证与基础信息 |
| `FEISHU_APP_SECRET` | 飞书应用密钥 | 飞书开放平台 → 凭证与基础信息 |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | [platform.deepseek.com](https://platform.deepseek.com) |
| `DEEPSEEK_MODEL` | 模型名称 | 默认 `deepseek-chat` |
| `BOT_NAME` | 机器人显示名称 | 可自定义 |

### 3. 启动

```bash
npm start
```

启动后把机器人添加到单聊或群聊，直接发文本即可。在群聊中建议 `@机器人` 后输入任务。

### 4. 常用指令

| 指令 | 功能 |
|------|------|
| `/reset` / `重置` / `清空上下文` | 清空当前会话的对话历史 |

## 项目结构

```
├── index.js          # 入口文件
├── src/
│   ├── config.js     # 配置加载与校验
│   ├── bot.js        # 飞书长连接机器人
│   └── agent.js      # DeepSeek Agent（含工具定义与执行）
├── app/              # Python 版实现（备用）
│   ├── agent.py
│   ├── bot.py
│   ├── config.py
│   └── message_utils.py
├── main.py           # Python 版入口（备用）
├── .env.example      # 配置文件模板
└── package.json
```

## 安全提示

- **不要**将 `.env` 文件提交到代码仓库
- 机器人具有执行系统命令和操控桌面的能力，仅在小群或私聊中使用
- 建议在 DeepSeek 平台设置 API 用量限额，避免意外消耗

## 许可证

MIT
