"use strict";

const OpenAI = require("openai");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const SYSTEM_PROMPT = `你是部署在飞书里的 Codex Agent，运行在用户的 Windows PC 上。
你可以：执行命令、读写文件、浏览目录、移动/点击鼠标、发送键盘按键、输入文本。
当用户要求做某事，直接调用工具执行，别只说"你可以这样做"。
默认用中文回复。涉及危险操作（删除、格式化、注册表修改）先提醒用户确认。

鼠标/键盘工具说明：
- mouse_move: 移动鼠标到屏幕坐标，屏幕左上角是(0,0)
- mouse_click: 点击鼠标，可选 left/right 和 click/dblclick，可指定坐标
- send_keys: 发送组合键，如 ^c=Ctrl+C, %{Tab}=Alt+Tab, ^{Esc}=Win键
- type_text: 逐字输入文本`;

const MAX_TOOL_LOOPS = 10;
const DEFAULT_WORKDIR = process.env.USERPROFILE || process.env.HOME || ".";
const EXE_RE = /\.exe$/i;
const LNK_RE = /\.lnk$/i;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "在用户电脑上执行一条 shell 命令。启动程序用 start（如 start steam），执行脚本用完整命令。返回命令输出。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的命令" },
          workdir: { type: "string", description: `工作目录，默认 ${DEFAULT_WORKDIR}` },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取文件内容",
      parameters: {
        type: "object",
        properties: {
          filepath: { type: "string", description: "文件完整路径" },
          max_lines: { type: "integer", description: "最大行数，默认 200" },
        },
        required: ["filepath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "创建或覆盖文件",
      parameters: {
        type: "object",
        properties: {
          filepath: { type: "string", description: "文件完整路径" },
          content: { type: "string", description: "写入内容" },
        },
        required: ["filepath", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "列出目录内容",
      parameters: {
        type: "object",
        properties: {
          dirpath: { type: "string", description: "目录路径" },
        },
        required: ["dirpath"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_move",
      description: "移动鼠标到指定屏幕坐标。屏幕左上角为 (0,0)。",
      parameters: {
        type: "object",
        properties: {
          x: { type: "integer", description: "X 坐标（像素）" },
          y: { type: "integer", description: "Y 坐标（像素）" },
        },
        required: ["x", "y"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mouse_click",
      description: "在当前位置点击鼠标。可指定左键/右键、单击/双击。",
      parameters: {
        type: "object",
        properties: {
          button: { type: "string", description: "left 或 right，默认 left" },
          action: { type: "string", description: "click 或 dblclick，默认 click" },
          x: { type: "integer", description: "可选：先移动到该 X 坐标再点击" },
          y: { type: "integer", description: "可选：先移动到该 Y 坐标再点击" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_keys",
      description: "发送键盘组合键。例如 Ctrl+C 用 ^c，Alt+Tab 用 %{Tab}，Win+R 用 ^{ESC}r。特殊键：^ = Ctrl, % = Alt, + = Shift, {Enter}, {Tab}, {Esc}, {F1}-{F12}。",
      parameters: {
        type: "object",
        properties: {
          keys: { type: "string", description: "按键组合字符串，如 ^c 表示 Ctrl+C" },
        },
        required: ["keys"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "模拟键盘逐字输入一段纯文本。适合输入用户名、密码、搜索内容等。",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "要输入的文本" },
        },
        required: ["text"],
      },
    },
  },
];

class DeepSeekAgent {
  constructor(config) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.deepseekApiKey,
      baseURL: config.deepseekBaseUrl,
    });
    this.conversations = new Map();
  }

  _getHistory(key) {
    if (!this.conversations.has(key)) {
      this.conversations.set(key, []);
    }
    return this.conversations.get(key);
  }

  _trimHistory(history) {
    const MAX = 30;
    // Remove in safe pairs: if removing an assistant+tools msg, also remove its tool msgs
    while (history.length > MAX) {
      const first = history[0];
      if (first.tool_calls) {
        // Remove the assistant tool_call msg and all following tool msgs belonging to it
        const ids = new Set(first.tool_calls.map((tc) => tc.id));
        history.shift(); // remove assistant msg
        while (history.length && history[0].role === "tool" && ids.has(history[0].tool_call_id)) {
          history.shift();
        }
      } else {
        history.shift();
      }
    }
  }

  /** Remove intermediate tool-call/tool-response pairs from this turn */
  _stripToolMessages(history) {
    // Walk backwards, remove any assistant+tool call chain, leave only final text
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      if (msg.role === "assistant" && msg.tool_calls) {
        // Remove this assistant tool_call msg and all subsequent tool responses
        const ids = new Set(msg.tool_calls.map((tc) => tc.id));
        history.splice(i, 1);
        // Remove tool messages that follow
        while (i < history.length && history[i].role === "tool" && ids.has(history[i].tool_call_id)) {
          history.splice(i, 1);
        }
      }
    }
  }

  async run(prompt, conversationKey) {
    const history = this._getHistory(conversationKey);

    // Always sanitize before use — strip orphaned tool_calls/tool msgs
    this._stripToolMessages(history);

    history.push({ role: "user", content: prompt });

    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history];
    let textReply = "";

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
      const resp = await this.client.chat.completions.create({
        model: this.config.deepseekModel,
        messages,
        tools: TOOLS,
        max_tokens: 4096,
      });

      const msg = resp.choices?.[0]?.message;
      if (!msg) {
        textReply = "模型未返回有效响应。";
        break;
      }

      if (msg.content && !msg.tool_calls?.length) {
        textReply = msg.content.trim();
        history.push({ role: "assistant", content: textReply });
        // Clean up tool messages from this turn — only keep final text for future context
        this._stripToolMessages(history);
        break;
      }

      if (msg.tool_calls?.length) {
        history.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls,
        });
        messages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls,
        });

        for (const tc of msg.tool_calls) {
          const fnName = tc.function.name;
          let fnArgs;
          try {
            fnArgs = JSON.parse(tc.function.arguments || "{}");
          } catch {
            fnArgs = {};
          }

          console.log(`[agent] tool call: ${fnName}(${JSON.stringify(fnArgs)})`);

          let result;
          try {
            result = await this._execute(fnName, fnArgs);
          } catch (err) {
            result = `执行失败: ${err.message}`;
          }

          console.log(`[agent] tool result (${fnName}): ${result.slice(0, 300)}`);

          messages.push({ role: "tool", tool_call_id: tc.id, content: result });
          history.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
        continue;
      }

      textReply = "模型未返回有效内容。";
      break;
    }

    if (!textReply) textReply = "已执行完成。";
    this._trimHistory(history);
    return textReply;
  }

  async _execute(name, args) {
    switch (name) {
      case "run_command": {
        const workdir = args.workdir || DEFAULT_WORKDIR;
        const cmd = args.command;

        // Commands starting with "start " launch GUI apps — use detached spawn
        // so they don't block the bot while the target program runs.
        if (/^start\s/i.test(cmd)) {
          return this._startDetached(cmd);
        }

        return this._execAsync(cmd, workdir);
      }
      case "read_file": {
        const { filepath, max_lines: maxLines = 200 } = args;
        if (!fs.existsSync(filepath)) return `文件不存在: ${filepath}`;
        const content = fs.readFileSync(filepath, "utf8");
        const lines = content.split("\n");
        if (lines.length > maxLines) {
          return lines.slice(0, maxLines).join("\n") + `\n\n... (共 ${lines.length} 行，仅显示前 ${maxLines} 行)`;
        }
        return content;
      }
      case "write_file": {
        const { filepath, content } = args;
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filepath, content, "utf8");
        return `文件已写入: ${filepath} (${content.length} 字符)`;
      }
      case "list_files": {
        const dirpath = args.dirpath;
        if (!fs.existsSync(dirpath)) return `目录不存在: ${dirpath}`;
        const entries = fs.readdirSync(dirpath, { withFileTypes: true });
        const lines = entries.map((e) => {
          const type = e.isDirectory() ? "[DIR]" : e.isFile() ? "[FILE]" : "[OTHER]";
          return `${type}  ${e.name}`;
        });
        return lines.join("\n") || "(空目录)";
      }
      case "mouse_move": {
        return await this._psExec(`
          Add-Type -Name Win32Mouse -Namespace Win32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);'
          [Win32.Win32Mouse]::SetCursorPos(${args.x}, ${args.y})
        `);
      }
      case "mouse_click": {
        const btn = args.button === "right" ? "right" : "left";
        const act = args.action === "dblclick" ? "dblclick" : "click";
        // Move first if coordinates given
        let result = "";
        if (args.x !== undefined && args.y !== undefined) {
          result += await this._psExec(`
            Add-Type -Name Win32Mouse2 -Namespace Win32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);'
            [Win32.Win32Mouse2]::SetCursorPos(${args.x}, ${args.y})
          `);
        }
        // Use WScript.Shell for reliable mouse clicks via SendKeys
        const shellCmd =
          btn === "right"
            ? `$wshell.SendKeys('+{F10}')`
            : act === "dblclick"
              ? `$wshell.SendKeys('{ENTER}')`
              : `Add-Type -Name Win32Click -Namespace Win32 -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);'; [Win32.Win32Click]::mouse_event(0x0002,0,0,0,0); Start-Sleep -Milli 50; [Win32.Win32Click]::mouse_event(0x0004,0,0,0,0)`;
        result += await this._psExec(shellCmd);
        return result || "鼠标点击完成。";
      }
      case "send_keys": {
        const keys = args.keys.replace(/"/g, '\\"');
        return await this._psExec(`$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys("${keys}")`);
      }
      case "type_text": {
        const text = args.text.replace(/"/g, '\\"').replace(/\n/g, "{Enter}");
        return await this._psExec(`$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys("${text}")`);
      }
      default:
        return `未知工具: ${name}`;
    }
  }

  /** Run a PowerShell snippet (Base64-encoded to avoid quoting hell) */
  _psExec(script) {
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    return this._execAsync(`powershell -NoProfile -EncodedCommand ${encoded}`, DEFAULT_WORKDIR);
  }

  /** Execute a command and wait for its output (for scripts, dir, etc.) */
  _execAsync(cmd, workdir) {
    return new Promise((resolve) => {
      exec(cmd, { cwd: workdir, timeout: 60000, windowsHide: true, shell: "cmd.exe" }, (err, stdout, stderr) => {
        if (err) {
          resolve(`命令失败 (退出码 ${err.code || "N/A"}):\n${stderr || err.message}`);
        } else {
          resolve(stdout.trim() || "(命令执行成功，无输出)");
        }
      });
    });
  }

  /** Launch a GUI app via "start" — tries PATH, Start Menu, then Program Files */
  async _startDetached(cmd) {
    const target = cmd.replace(/^start\s+/i, "").trim();
    if (!target) return "start 命令缺少目标程序名。";

    // 1. Try `where` to see if it's in PATH
    const whereResult = await this._execAsync(`where ${target} 2>nul`, DEFAULT_WORKDIR);
    if (!whereResult.startsWith("命令失败")) {
      const exePath = whereResult.split("\n")[0].trim();
      this._spawnDetached(exePath);
      return `程序已启动: ${exePath}`;
    }

    // 2. Search Start Menu shortcut folders for a matching .lnk
    const startMenuDirs = [
      "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
      `${DEFAULT_WORKDIR}\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs`,
    ];
    for (const smDir of startMenuDirs) {
      const lnkPath = this._findInStartMenu(smDir, target);
      if (lnkPath) {
        this._spawnDetached(lnkPath);
        return `程序已启动: ${lnkPath}`;
      }
    }

    // 3. Search common install directories for matching .exe
    const commonDirs = [
      "C:\\Program Files",
      "C:\\Program Files (x86)",
      `${DEFAULT_WORKDIR}\\AppData\\Local`,
      `${DEFAULT_WORKDIR}\\AppData\\Roaming`,
    ];
    for (const dir of commonDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const lowerName = e.name.toLowerCase();
          const lowerTarget = target.toLowerCase();
          if (lowerName.includes(lowerTarget) || lowerTarget.includes(lowerName)) {
            const subDir = path.join(dir, e.name);
            try {
              const files = fs.readdirSync(subDir);
              const exe = files.find((f) => EXE_RE.test(f));
              if (exe) {
                const exePath = path.join(subDir, exe);
                this._spawnDetached(exePath);
                return `程序已启动: ${exePath}`;
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
    }

    // 4. Last resort: try start anyway
    this._spawnDetached(target);
    return `未找到 ${target}。请提供程序的完整安装路径，或在飞书中告诉我正确的程序名。`;
  }

  /** Recursively search a Start Menu directory for a folder/lnk matching name */
  _findInStartMenu(baseDir, target) {
    if (!fs.existsSync(baseDir)) return null;
    const lowerTarget = target.toLowerCase();
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(baseDir, e.name);
        if (e.isDirectory()) {
          // Match directory name
          if (e.name.toLowerCase().includes(lowerTarget)) {
            // Look for .lnk files inside
            try {
              const subs = fs.readdirSync(full);
              const lnk = subs.find((f) => LNK_RE.test(f));
              if (lnk) return path.join(full, lnk);
            } catch { /* skip */ }
          }
          // Recurse into subdirectories (max depth handled by typical Start Menu structure)
          const found = this._findInStartMenu(full, target);
          if (found) return found;
        } else if (e.isFile() && LNK_RE.test(e.name) && e.name.toLowerCase().includes(lowerTarget)) {
          return full;
        }
      }
    } catch { /* skip */ }
    return null;
  }

  _spawnDetached(targetPath) {
    const child = spawn("cmd.exe", ["/c", "start", "", targetPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
  }

  reset(conversationKey) {
    this.conversations.delete(conversationKey);
  }
}

module.exports = { DeepSeekAgent };
