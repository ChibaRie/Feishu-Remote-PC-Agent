# claudecode_lark_mcp

Claude Code 的飞书/Lark 机器人 MCP 网关。

本项目作为本地 MCP 服务运行在 Claude Code 内。启动后，它会通过飞书/Lark 的 WebSocket 长连接接入已配置好的机器人。用户在飞书机器人里发送消息后，消息会进入本地队列，并通过 Claude Code channel notification 推送给 Claude Code；Claude Code 再调用 MCP 工具把回复发回飞书/Lark。

## 本次更新内容

- 删除旧的内置 DeepSeek/OpenAI agent 后端。
- 删除远程 PC 控制能力，包括命令执行、文件写入、鼠标控制和键盘模拟。
- 保留飞书/Lark WebSocket 长连接思路，并将项目改造成 Claude Code 可用的 MCP 服务。
- 项目更名为 `claudecode_lark_mcp`。

## 消息流程

```text
飞书/Lark 机器人消息
  -> 本地 WebSocket 网关
  -> MCP 内存消息队列
  -> Claude Code channel notification
  -> Claude Code 调用 lark_reply_message
  -> 回复到飞书/Lark
```

## 环境要求

- Node.js 18 或更高版本
- 支持 MCP 的 Claude Code
- 已启用机器人能力和 WebSocket 事件订阅的飞书/Lark 应用

## 安装与配置

1. 安装依赖：

```bash
npm install
```

2. 创建 `.env`：

```bash
copy .env.example .env
```

3. 填写飞书/Lark 应用凭据：

```env
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_DOMAIN=feishu
```

4. 构建项目：

```bash
npm run build
```

5. 配置 Claude Code MCP。本仓库已包含 `.mcp.json`：

```json
{
  "mcpServers": {
    "claudecode_lark_mcp": {
      "command": "node",
      "args": ["dist/index.js"]
    }
  }
}
```

6. 在本项目目录中打开 Claude Code。MCP 服务会启动并连接飞书/Lark。

## MCP 工具

- `lark_fetch_messages`：读取飞书/Lark 消息队列。
- `lark_reply_message`：根据 `message_id` 回复已收到的消息。
- `lark_send_message`：向指定 `chat_id` 发送新消息。
- `lark_mark_message`：更新本地消息处理状态。
- `lark_get_status`：查看网关连接状态和队列状态。

## 群聊行为

默认情况下，群聊消息只有在提到机器人时才会被处理：

```env
REQUIRE_MENTION_IN_GROUP=true
```

私聊消息不需要提到机器人。若要限制可使用的用户，设置：

```env
ALLOW_USER_IDS=ou_xxx,ou_yyy
```

## 说明

当前版本是单实例网关。后续可以增加 router/worker 层，把不同的 `chat_id` 映射到不同的本地 Claude Code 工作区，思路类似参考项目 `phxwang/feishuchannel-for-claudecode`。
