"use strict";

const { loadConfig, validateConfig } = require("./src/config");
const { DeepSeekAgent } = require("./src/agent");
const { FeishuCodexBot } = require("./src/bot");

async function main() {
  const config = loadConfig();
  const missing = validateConfig(config);
  if (missing.length > 0) {
    console.error("缺少或非法配置：");
    missing.forEach((m) => console.error(`  - ${m}`));
    console.error("\n请复制 .env.example 为 .env 后填入真实凭据。");
    process.exit(2);
  }

  const agent = new DeepSeekAgent(config);
  const bot = new FeishuCodexBot(config, agent);

  await bot.start();

  // Keep process alive for WebSocket long-connection
  process.stdin.resume();
  process.on("SIGINT", () => {
    console.log("\n[bot] Shutting down...");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
