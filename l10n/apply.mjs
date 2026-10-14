#!/usr/bin/env node
// 把汉化应用到 kopia 仓库(只涉及 Electron 两个文件, 不动 Go 代码):
//   1) app/public/preload.js   末尾追加"内联字典"的注入块
//      (打包后即安装目录 resources/preload.js, 由 Electron 主进程加载进 UI 页面)
//   2) app/public/electron.js  托盘菜单/系统对话框字符串按 electron-zh.json 整串替换
//
// 用法:
//   node l10n/apply.mjs [--root <kopia仓库目录>] [--check] [--emit <输出文件>]
//
//   --root   默认取本目录的上一级(即把 l10n/ 放在仓库根目录时的位置)
//   --check  只检查与统计, 不写任何文件
//   --emit   额外生成一个可直接粘贴进浏览器 DevTools Console 的独立注入文件(本地调试用)
//
// 特性:
//   - 只做"整串精确匹配", 上游的变量名、逻辑、其他代码不受影响;
//   - 可重复执行: preload 注入块带 BEGIN/END 标记, 重复运行先移除旧块;
//   - electron.js 中未命中的词条只会给出警告, 不会让构建失败(托盘少量英文可接受)。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function argOf(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const root = path.resolve(argOf("--root", path.join(here, "..")));
const checkOnly = process.argv.includes("--check");
const emitPath = argOf("--emit", null);

function die(msg) {
  console.error("错误: " + msg);
  process.exit(1);
}

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    die(`无法读取或解析 ${p}: ${e.message}`);
  }
}

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (e) {
    die(`无法读取 ${p}: ${e.message}`);
  }
}

const dict = readJSON(path.join(here, "zh-CN.json"));
const rules = readJSON(path.join(here, "zh-CN.rules.json"));
const injectSrc = readText(path.join(here, "inject.js"));
const electronDict = readJSON(path.join(here, "electron-zh.json"));

const preloadPath = path.join(root, "app", "public", "preload.js");
const electronPath = path.join(root, "app", "public", "electron.js");
if (!fs.existsSync(preloadPath) || !fs.existsSync(electronPath)) {
  die(
    `未找到 ${preloadPath}\n` +
      `请把 l10n/ 目录放在 kopia 仓库根目录下运行, 或用 --root <kopia仓库目录> 指定路径`,
  );
}

const BEGIN = "/* BEGIN kopia-zh-cn (generated, do not edit) */";
const END = "/* END kopia-zh-cn */";
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const injectedCall = `__kopiaZhCN(${JSON.stringify(dict)}, ${JSON.stringify(rules)});`;

// ---------- 1) preload.js: 追加注入块 ----------
const preloadOrig = readText(preloadPath);
const stripRe = new RegExp("[\\r\\n]*" + escapeRe(BEGIN) + "[\\s\\S]*?" + escapeRe(END) + "\\n?", "g");
let base = preloadOrig.replace(stripRe, "").replace(/[\r\n]+$/, "") + "\n";
const newPreload = base + "\n" + BEGIN + "\n" + injectSrc + "\n" + injectedCall + "\n" + END + "\n";
const preloadChanged = newPreload !== preloadOrig;

// ---------- 2) electron.js: 托盘/对话框词条替换 ----------
const electronOrig = readText(electronPath);
let electron = electronOrig;
const zeroHits = [];
let totalHits = 0;

for (const [en, zh] of Object.entries(electronDict)) {
  const zhLiteral = JSON.stringify(zh);
  let hits = 0;
  for (const q of ['"', "'"]) {
    const needle = q + en + q;
    const parts = electron.split(needle);
    hits += parts.length - 1;
    if (parts.length > 1) electron = parts.join(zhLiteral);
  }
  totalHits += hits;
  if (hits === 0) zeroHits.push(en);
}
const electronChanged = electron !== electronOrig;

// ---------- 3) 独立调试文件 ----------
if (emitPath && !checkOnly) {
  const standalone =
    `/* Kopia 汉化调试用: 在 UI 页面打开 DevTools Console, 整段粘贴回车即可看到效果 */\n` +
    `(function () {\n${injectSrc}\n${injectedCall}\n})();\n`;
  fs.mkdirSync(path.dirname(path.resolve(emitPath)), { recursive: true });
  fs.writeFileSync(emitPath, standalone);
}

// ---------- 输出统计 ----------
const dictCount = Object.keys(dict).length;
console.log(`字典: zh-CN.json ${dictCount} 条, 规则 ${rules.length} 条, electron-zh.json ${Object.keys(electronDict).length} 条`);
console.log(`preload.js: ${checkOnly ? "[检查]" : "[写入]"} 注入块 ${preloadChanged ? "已生成" : "无变化"} (${newPreload.length} 字节)`);
console.log(`electron.js: ${checkOnly ? "[检查]" : "[写入]"} 替换 ${totalHits} 处${electronChanged ? "" : " (无变化)"}`);
if (zeroHits.length) {
  console.warn(
    `警告: 有 ${zeroHits.length} 条 electron 词条在上游源码中未找到(可能上游已改动, 不影响构建):`,
  );
  for (const en of zeroHits) console.warn("  - " + JSON.stringify(en));
}
if (emitPath && !checkOnly) console.log(`已生成调试文件: ${emitPath}`);

if (!checkOnly) {
  fs.writeFileSync(preloadPath, newPreload);
  fs.writeFileSync(electronPath, electron);
  console.log("汉化注入完成。");
}
