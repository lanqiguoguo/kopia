#!/usr/bin/env node
// 从 kopia/htmlui 源码中提取候选 UI 字符串，过滤掉已在字典里的，输出 missing.json
//
// 用法:
//   node l10n/extract.mjs <htmlui源码目录> [--dict <字典路径>] [--out <输出路径>]
//
// 示例:
//   node l10n/extract.mjs ../htmlui-src
//   node l10n/extract.mjs ../htmlui-src --dict l10n/zh-CN.json --out l10n/missing.json
//
// 注意:这里是"模糊提取"，只用于生成待翻译清单，不参与替换；
// 替换端(DOM 注入)按"整串精确匹配"，所以提取有少量噪声不影响正确性。

import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const srcRoot = argv[0];
if (!srcRoot) {
  console.error("用法: node extract.mjs <htmlui源码目录> [--dict f] [--out f]");
  process.exit(1);
}

function flag(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}

const dictPath = flag("--dict", "l10n/zh-CN.json");
const outPath = flag("--out", "l10n/missing.json");

// ---------- 遍历源文件 ----------
const exts = new Set([".js", ".jsx", ".ts", ".tsx"]);
const files = [];

function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (["node_modules", "tests", "__tests__", "dist", "build"].includes(ent.name)) continue;
      walk(p);
    } else if (exts.has(path.extname(ent.name))) {
      if (/\.(test|spec)\./.test(ent.name)) continue;
      files.push(p);
    }
  }
}

const src = path.join(srcRoot, "src");
walk(fs.existsSync(src) ? src : srcRoot);

// ---------- 字符串候选 ----------
const counts = new Map();

function addCandidate(raw) {
  if (!raw) return;
  // 去掉转义与首尾空白
  let s = raw.replace(/\\['"\\]/g, (m) => (m.length === 2 ? m[1] : m)).trim();
  if (s.length < 2 || s.length > 120) return;
  if (!/[A-Z]/.test(s)) return; // 至少要有一个大写字母(过滤 className/变量名之类)
  if (/[<>{}`$%]/.test(s)) return; // 模板片段、HTML、格式化占位
  if (s.includes("://") || s.startsWith("@")) return;
  if (/^[A-Za-z0-9_./-]+\.[A-Za-z0-9]+$/.test(s)) return; // 文件名之类
  if (s.includes("/") && !s.includes(" ")) return; // 模块路径/接口路径，如 react-bootstrap/Form
  if (/^[a-z][A-Za-z0-9]*$/.test(s)) return; // lowerCamelCase 标识符，如 knownHostsFile
  counts.set(s, (counts.get(s) || 0) + 1);
}

const reQuoted = /"((?:[^"\\\n]|\\.){2,200})"|'((?:[^'\\\n]|\\.){2,200})'/g;
const reJsxText = />([^<>{}]{2,120})</g;

for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  let m;
  while ((m = reQuoted.exec(text))) addCandidate(m[1] ?? m[2]);
  while ((m = reJsxText.exec(text))) addCandidate(m[1]);
}

// ---------- 已翻译的排除 ----------
let dict = {};
if (fs.existsSync(dictPath)) dict = JSON.parse(fs.readFileSync(dictPath, "utf8"));

const missing = [...counts.entries()]
  .filter(([k]) => !(k in dict))
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([k, c]) => ({ key: k, count: c }));

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(missing, null, 2) + "\n");

// 方便人工浏览的纯文本清单:每行 "出现次数<TAB>字符串"
const txtPath = outPath.replace(/\.json$/, ".txt");
fs.writeFileSync(txtPath, missing.map(({ key, count }) => `${count}\t${key}`).join("\n") + "\n");

console.log(`扫描 ${files.length} 个文件, 候选字符串 ${counts.size} 条, 未翻译 ${missing.length} 条`);
console.log(`已写入 ${outPath} 和 ${txtPath}`);
console.log("出现次数 Top 30:");
for (const { key, count } of missing.slice(0, 30)) {
  console.log(`  ${String(count).padStart(3)}  ${key}`);
}
