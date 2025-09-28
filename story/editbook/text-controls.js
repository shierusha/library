/* text-controls.js — B/I/U（OK）+ A+/A-（只動反白、統一尺寸、截斷邊界）
 * - B/I/U：使用原生 toggle + 清理
 * - A+/A-（重寫）：
 *    1) 必須有反白（無選取就不動，以符合「務必只動我有反白的字」）
 *    2) 先把選取範圍邊界「截斷」：抽出 fragment
 *    3) 把 fragment 內任何 data-fs 都剝掉（保留 B/I/U 等其他 inline）
 *    4) 以「選取起點的字級」為基準 → 統一成 (base + delta)em 包一層 <span data-fs>
 *    5) 插回原位後，合併左右相同字級、移除空 span
 */
(function () {
  if (!window.EditorCore) return;

  /* ================== 小工具 ================== */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const EM_MIN = 0.2, EM_MAX = 5, STEP = 0.1;

  function getStoryAndRange(allowCollapsed = true) {
    const dbIndex = EditorCore.getFocusedDbIndex();
    if (!dbIndex) return null;
    const story = EditorCore.getStoryByDbIndex(dbIndex);
    if (!story) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const rng = sel.getRangeAt(0);
    if (!story.contains(rng.startContainer)) return null;
    if (!allowCollapsed && rng.collapsed) return null;
    return { story, range: rng, dbIndex };
  }

  function afterChange(story) {
    const db = Number(story.dataset.dbIndex || "0") | 0;
    EditorCore.updatePageJsonFromStory(db, story);
    if (window.PasteFlow && typeof window.PasteFlow.forceReflow === "function") {
      window.PasteFlow.forceReflow(story);
    } else {
      story.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function unwrap(el) {
    const p = el.parentNode;
    if (!p) return;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
  }

  function replaceTag(el, newTag) {
    if (el.tagName === newTag.toUpperCase()) return el;
    const newEl = document.createElement(newTag);
    while (el.firstChild) newEl.appendChild(el.firstChild);
    el.parentNode.replaceChild(newEl, el);
    return newEl;
  }

  /* ========== B/I/U 清理 ========== */
  function sanitizeInlineBUI(root) {
    if (!root) return;
    root.querySelectorAll("strong").forEach((n) => replaceTag(n, "b"));
    root.querySelectorAll("em").forEach((n) => replaceTag(n, "i"));
    ["b","i","u"].forEach(tag=>{
      Array.from(root.querySelectorAll(tag)).forEach(el=>{
        // 移除空標（只有空白或沒有子節點）
        let hasText = false;
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        while (tw.nextNode()) {
          if ((tw.currentNode.nodeValue || "").replace(/\u00a0/g, " ").trim()) { hasText = true; break; }
        }
        if (!hasText) unwrap(el);
      });
    });
    ["b","i","u"].forEach(tag=>{
      // 去巢狀
      let changed = true;
      while (changed) {
        changed = false;
        root.querySelectorAll(tag).forEach(el=>{
          const p = el.parentElement;
          if (p && p.tagName.toLowerCase() === tag) { unwrap(el); changed = true; }
        });
      }
      // 合併相鄰
      Array.from(root.querySelectorAll(tag)).forEach(el=>{
        let next = el.nextSibling;
        while (next && next.nodeType === 3 && !(next.nodeValue||"").trim()) next = next.nextSibling;
        if (next && next.nodeType === 1 && next.tagName.toLowerCase() === tag) {
          while (next.firstChild) el.appendChild(next.firstChild);
          next.remove();
        }
      });
    });
  }

  function toggleCommand(cmd) {
    const ctx = getStoryAndRange(true);
    if (!ctx) return false;
    const { story } = ctx;
    return EditorCore.keepSelectionAround(story, () => {
      document.execCommand(cmd, false);
      sanitizeInlineBUI(story);
      afterChange(story);
      return true;
    });
  }
  function onBold(){ return toggleCommand("bold"); }
  function onItalic(){ return toggleCommand("italic"); }
  function onUnderline(){ return toggleCommand("underline"); }

  /* ========== A+/A- 工具 ========== */
  function parseEm(str) {
    if (!str) return NaN;
    const m = String(str).match(/([0-9.]+)\s*em$/i);
    return m ? parseFloat(m[1]) : NaN;
  }
  function getSpanSize(span) {
    if (!span) return NaN;
    if (span.dataset.fs) return parseFloat(span.dataset.fs);
    const p = parseEm(span.style.fontSize);
    return isNaN(p) ? NaN : p;
  }
  function setSpanSize(span, valEm) {
    const fs = clamp(valEm, EM_MIN, EM_MAX);
    span.dataset.fs = String(fs);
    span.style.fontSize = fs.toFixed(2).replace(/\.00$/, "") + "em";
  }
  function findFsWrapper(node) {
    let cur = node && node.nodeType === 1 ? node : node ? node.parentElement : null;
    while (cur && cur !== document) {
      if (cur.tagName === "SPAN" && (cur.dataset.fs || /em$/.test(cur.style.fontSize || ""))) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  function stripFsInFragment(node) {
    if (!node) return;
    if (node.nodeType !== 1) { Array.from(node.childNodes).forEach(stripFsInFragment); return; }
    const el = node;
    if (el.tagName === "SPAN" && (el.dataset.fs || /em$/.test(el.style.fontSize || ""))) {
      const p = el.parentNode;
      while (el.firstChild) p.insertBefore(el.firstChild, el);
      p.removeChild(el);
      return;
    }
    Array.from(el.childNodes).forEach(stripFsInFragment);
  }
  function mergeAdjacentFs(span) {
    if (!span || span.nodeType !== 1 || span.tagName !== "SPAN") return;
    const sizeKey = span.dataset.fs || (span.style.fontSize || "").replace("em", "");
    if (!sizeKey) return;
    // 左
    let prev = span.previousSibling;
    while (prev && prev.nodeType === 3 && !prev.nodeValue) prev = prev.previousSibling;
    if (prev && prev.nodeType === 1 && prev.tagName === "SPAN") {
      const prevKey = prev.dataset.fs || (prev.style.fontSize || "").replace("em","");
      if (prevKey === sizeKey) {
        while (span.firstChild) prev.appendChild(span.firstChild);
        span.parentNode && span.parentNode.replaceChild(prev, span);
        span = prev;
      }
    }
    // 右
    let next = span.nextSibling;
    while (next && next.nodeType === 3 && !next.nodeValue) next = next.nextSibling;
    if (next && next.nodeType === 1 && next.tagName === "SPAN") {
      const nextKey = next.dataset.fs || (next.style.fontSize || "").replace("em","");
      if (nextKey === sizeKey) {
        while (next.firstChild) span.appendChild(next.firstChild);
        next.parentNode && next.parentNode.removeChild(next);
      }
    }
  }
  function cleanupEmptyFs(root){
    Array.from(root.querySelectorAll('span[data-fs],span[style*="font-size"]')).forEach(el=>{
      // 若完全沒有可見內容，拆掉
      let hasText = false;
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      while (tw.nextNode()) {
        if ((tw.currentNode.nodeValue || "").replace(/\u00a0/g," ").trim()) { hasText = true; break; }
      }
      const hasElement = Array.from(el.childNodes).some(n=> n.nodeType===1 && n.tagName!=='BR');
      if (!hasText && !hasElement) unwrap(el);
    });
  }

  function computeBaseEmForSelection(range){
    // 1) 若完全在同一個 data-fs wrapper 內，以該值為 base
    const sw = findFsWrapper(range.startContainer);
    const ew = findFsWrapper(range.endContainer);
    if (sw && sw === ew) {
      const base = getSpanSize(sw);
      if (!isNaN(base)) return base;
    }
    // 2) 取起點的 data-fs；若沒有→1.0
    const base2 = sw ? getSpanSize(sw) : NaN;
    return isNaN(base2) ? 1.0 : base2;
  }

  /* ========== A+/A-（只動反白） ========== */
  function adjustFont(deltaStep) {
    const ctx = getStoryAndRange(false /* 必須有選取 */);
    if (!ctx) return false;
    const { story, range } = ctx;

    return EditorCore.keepSelectionAround(story, () => {
      // 1) 基準字級（選取起點）
      const base = computeBaseEmForSelection(range);
      const target = clamp( +(base + deltaStep).toFixed(2), EM_MIN, EM_MAX );

      // 2) 抽出 fragment，剝掉內部所有 data-fs（保留 B/I/U 等）
      const frag = range.extractContents();
      stripFsInFragment(frag);

      // 3) 包一層目標字級
      const span = document.createElement("span");
      setSpanSize(span, target);
      span.appendChild(frag);
      range.insertNode(span);

      // 4) 合併左右同字級、移除空 span
      mergeAdjacentFs(span);
      cleanupEmptyFs(story);

      // 5) 完成
      afterChange(story);
      return true;
    });
  }

  /* ========== 綁定 ========== */
  function bindButtons() {
    const btnB = document.getElementById("btnBold");
    const btnI = document.getElementById("btnItalic");
    const btnU = document.getElementById("btnUnderline");
    const btnUp = document.getElementById("btnFontUp");
    const btnDn = document.getElementById("btnFontDown");

    btnB && btnB.addEventListener("click", onBold);
    btnI && btnI.addEventListener("click", onItalic);
    btnU && btnU.addEventListener("click", onUnderline);

    btnUp && btnUp.addEventListener("click", () => adjustFont(+STEP));
    btnDn && btnDn.addEventListener("click", () => adjustFont(-STEP));
  }

  function bindShortcuts() {
    document.addEventListener("keydown", (e) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (e.key === "b" || e.key === "B") { e.preventDefault(); onBold(); }
      if (e.key === "i" || e.key === "I") { e.preventDefault(); onItalic(); }
      if (e.key === "u" || e.key === "U") { e.preventDefault(); onUnderline(); }
      if (e.key === "=" || e.key === "+") { e.preventDefault(); adjustFont(+STEP); }
      if (e.key === "-") { e.preventDefault(); adjustFont(-STEP); }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindButtons();
    bindShortcuts();
  });
})();
