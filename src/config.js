"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });

function loadConfig() {
  return {
    feishuAppId: process.env.FEISHU_APP_ID || "",
    feishuAppSecret: process.env.FEISHU_APP_SECRET || "",
    feishuDomain: (process.env.FEISHU_DOMAIN || "feishu").toLowerCase(),

    deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",

    botName: process.env.BOT_NAME || "Codex",
    sendTypingAck: (process.env.SEND_TYPING_ACK || "true").toLowerCase() !== "false",
  };
}

function validateConfig(cfg) {
  const missing = [];
  if (!cfg.feishuAppId) missing.push("FEISHU_APP_ID");
  if (!cfg.feishuAppSecret) missing.push("FEISHU_APP_SECRET");
  if (!cfg.deepseekApiKey) missing.push("DEEPSEEK_API_KEY");
  return missing;
}

module.exports = { loadConfig, validateConfig };
