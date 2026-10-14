#!/usr/bin/env node
// 可选步骤: 用 OpenAI 兼容接口自动翻译 missing.json 中的未处理字符串, 追加进 zh-CN.json。
//
// 未设置 TRANSLATE_API_KEY 时静默跳过(不算失败), 因此不配置也能正常构建。
//
// 环境变量:
//   TRANSLATE_API_KEY   必填, API Key(缺失则跳过)
//   TRANSLATE_BASE_URL  选填, 默认 https://api.openai.com/v1
//                       (任何 OpenAI 兼容端点均可: DeepSeek https://api.deepseek.com/v1,
//                        智谱 https://open.bigmodel.cn/api/paas/v4, Moonshot https://api.moonshot.cn/v1 等)
//   TRANSLATE_MODEL     选填, 默认 gpt-4o-mini
//
// 用法:
//   node l10n/autotranslate.mjs [--missing <文件>] [--dict <文件>] [--limit 400] [--batch 40]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function argOf(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const missingPath = argOf("--missing", path.join(here, "missing.json"));
const dictPath = argOf("--dict", path.join(here, "zh-CN.json"));
const limit = parseInt(argOf("--limit", "400"), 10);
const batchSize = parseInt(argOf("--batch", "40"), 10);

const key = process.env.TRANSLATE_API_KEY;
if (!key) {
  console.log("未设置 TRANSLATE_API_KEY, 跳过自动翻译。");
  process.exit(0);
}

const baseUrl = (process.env.TRANSLATE_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const model = process.env.TRANSLATE_MODEL || "gpt-4o-mini";

if (!fs.existsSync(missingPath)) {
  console.log(`未找到 ${missingPath}(先运行 extract.mjs), 跳过自动翻译。`);
  process.exit(0);
}

const missing = JSON.parse(fs.readFileSync(missingPath, "utf8"));
const dict = fs.existsSync(dictPath) ? JSON.parse(fs.readFileSync(dictPath, "utf8")) : {};

const todo = missing
  .map((m) => (typeof m === "string" ? m : m.key))
  .filter((k) => k && !(k in dict))
  .slice(0, limit);

if (!todo.length) {
  console.log("没有需要翻译的新字符串。");
  process.exit(0);
}

const SYSTEM = [
  "你是软件界面本地化专家, 负责把英文 UI 字符串翻译成简体中文。",
  "规则:",
  '1. 只输出一个 JSON 对象: {"原文": "译文"}; 不要输出解释或 Markdown 代码块标记;',
  "2. 保留占位符与变量原样, 例如 %s、{name}、$1、http:// 等;",
  "3. 技术名词保持原样或通用译法: Kopia、SMTP、SSH、SFTP、WebDAV、HTTP、JSON、TLS、AES、SHA256、S3、B2、rclone、Pushover、ZIP;",
  "4. 译文尽量简短, 符合桌面/网页 UI 用语习惯; 中文标点用全角;",
  "5. 数字、单位、路径、文件名等保持原样; 不确定的字符串也给出最合理的 UI 译法。",
].join("\n");

async function callAPI(batch, jsonMode) {
  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: "请翻译以下 JSON 数组中的字符串:" + JSON.stringify(batch) },
    ],
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const resp = await fetch(baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${t.slice(0, 300)}`);
  }
  const data = await resp.json();
  const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  const jsonText = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  return JSON.parse(jsonText);
}

let added = 0;
let failedBatches = 0;

for (let i = 0; i < todo.length; i += batchSize) {
  const batch = todo.slice(i, i + batchSize);
  let out = null;
  let lastErr = null;
  // 先按 json_object 模式调用; 若接口不支持(400), 再退回普通模式重试一次
  for (const jsonMode of [true, false]) {
    try {
      out = await callAPI(batch, jsonMode);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!out) {
    failedBatches++;
    console.warn(`批次 ${i / batchSize + 1} 失败(跳过): ${lastErr && lastErr.message}`);
    continue;
  }
  for (const k of batch) {
    const v = out[k];
    if (typeof v === "string" && v.trim() && !(k in dict)) {
      dict[k] = v.trim();
      added++;
    }
  }
  console.log(`批次 ${i / batchSize + 1}: ${batch.length} 条, 累计新增 ${added}`);
}

if (added > 0) {
  fs.writeFileSync(dictPath, JSON.stringify(dict, null, 2) + "\n");
}
console.log(`自动翻译完成: 新增 ${added} 条, 失败批次 ${failedBatches}。`);
