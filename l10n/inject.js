/* Kopia 中文注入器。
 *
 * 由 l10n/apply.mjs 内联到 app/public/preload.js 末尾, 作为 Electron preload 的一部分执行:
 * preload 在页面脚本(webpack/React)之前运行, 因此翻译器能在界面上屏前就位, 基本无闪烁。
 *
 * 设计原则: 只做"整串精确匹配"的 DOM 翻译, 不碰任何功能逻辑。
 *  - 字典未命中的文本原样保留(优雅降级, 永远不会因为翻译缺失而报错);
 *  - 翻译发生在渲染后的 DOM 上, 不修改 React 状态/数据;
 *  - 只替换文本节点与 title/placeholder/aria-label 等显示性属性;
 *  - <script>/<style>/<code>/<pre>/<textarea> 与 contentEditable 区域一律跳过,
 *    保证命令行示例(CLI equivalent)等代码块保持英文原样。
 */
function __kopiaZhCN(DICT, RULES) {
  "use strict";
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;

  var ATTRS = ["title", "placeholder", "aria-label", "alt", "label"];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1 };
  var HAS_LETTER = /[A-Za-z]/;
  var OWNP = Object.prototype.hasOwnProperty;

  var compiled = [];
  for (var r = 0; r < RULES.length; r++) {
    try {
      compiled.push([new RegExp(RULES[r][0]), RULES[r][1]]);
    } catch (e) {}
  }

  function norm(s) {
    return String(s).replace(/\u00a0/g, " ").trim();
  }

  // 返回译文; 未命中返回 null
  function lookup(s) {
    var core = norm(s);
    if (!core || !HAS_LETTER.test(core)) return null;
    if (OWNP.call(DICT, core)) return DICT[core];
    for (var i = 0; i < compiled.length; i++) {
      if (compiled[i][0].test(core)) {
        return core.replace(compiled[i][0], compiled[i][1]);
      }
    }
    return null;
  }

  function translateText(node) {
    var v = node.nodeValue;
    if (!v || !HAS_LETTER.test(v)) return;
    var t = lookup(v);
    if (t === null) return;
    var lead = v.match(/^\s*/)[0];
    var trail = v.match(/\s*$/)[0];
    node.nodeValue = lead + t + trail;
  }

  function translateAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = el.getAttribute(ATTRS[i]);
      if (!a || !HAS_LETTER.test(a)) continue;
      var t = lookup(a);
      if (t !== null) el.setAttribute(ATTRS[i], t);
    }
  }

  function walk(root) {
    if (!root) return;
    var type = root.nodeType;
    if (type === 3) {
      translateText(root);
      return;
    }
    if (type !== 1 && type !== 9 && type !== 11) return; // 元素 / 文档 / 片段
    if (type === 1) {
      if (SKIP_TAGS[root.tagName]) return;
      if (root.isContentEditable) return;
      if (root.getAttribute && root.getAttribute("data-zhcn") === "off") return;
      translateAttrs(root);
    }
    var kids = root.childNodes;
    if (!kids) return;
    for (var i = 0; i < kids.length; i++) walk(kids[i]);
  }

  var pending = [];
  var scheduled = false;

  function flush() {
    scheduled = false;
    var batch = pending;
    pending = [];
    for (var i = 0; i < batch.length; i++) walk(batch[i]);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(flush, 50);
  }

  try {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === "childList") {
          for (var j = 0; j < m.addedNodes.length; j++) pending.push(m.addedNodes[j]);
        } else if (m.target) {
          pending.push(m.target);
        }
      }
      if (pending.length) schedule();
    }).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  } catch (e) {}

  function boot() {
    walk(document.body || document.documentElement || document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // 便于调试: 在控制台里 window.__kopiaZhCN.add({"New Key": "新译文"}) 临时补充词条
  window.__kopiaZhCN = {
    dict: DICT,
    add: function (extra) {
      for (var k in extra) if (OWNP.call(extra, k)) DICT[k] = extra[k];
      boot();
    },
  };
}
