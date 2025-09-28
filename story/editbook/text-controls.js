
/* text-controls.js — Word-like toggle for B/I/U + safe A+/A-
 * 目標：
 * 1) B/I/U 真的「切換」，不會一直製造 <b><b>…
 * 2) 反白/游標皆可用（游標狀態＝之後輸入沿用）
 * 3) 操作後自動清理：合併相鄰、解除巢狀、移除空標籤（保留 <br>）
 * 4) A+ / A- 維持單層 <span data-fs style="font-size:…em">，避免碎片
 *
 * 相依：EditorCore.getFocusedDbIndex / getStoryByDbIndex / keepSelectionAround / updatePageJsonFromStory
 */
(function () {
  if (!window.EditorCore) return;

  /* ================== 工具 ================== */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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

  /* ========== 內聯清理（重點） ==========
   * - strong→b / em→i 統一標籤
   * - 解除巢狀：<b><b>…</b></b> → <b>…</b>
   * - 合併相鄰：</b><b> → 直接拼接
   * - 空標籤移除：<b></b> / <i> 只有空白 → 拆掉（保留裡面的 <br>）
   */
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

  function sanitizeInlineBUI(root) {
    if (!root) return;

    // 1) 統一標籤
    root.querySelectorAll("strong").forEach((n) => replaceTag(n, "b"));
    root.querySelectorAll("em").forEach((n) => replaceTag(n, "i"));

    // 2) 移除空標籤（僅空白或完全無子節點）
    ["b", "i", "u"].forEach((tag) => {
      Array.from(root.querySelectorAll(tag)).forEach((el) => {
        // 有非空白文字就保留
        let hasText = false;
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        while (tw.nextNode()) {
          if ((tw.currentNode.nodeValue || "").replace(/\u00a0/g, " ").trim()) {
            hasText = true;
            break;
          }
        }
        if (!hasText) {
          // 只保留結構（例如 <br>），外框拆掉
          unwrap(el);
        }
      });
    });

    // 3) 去巢狀：反覆將父子同標籤展平
    ["b", "i", "u"].forEach((tag) => {
      let changed = true;
      while (changed) {
        changed = false;
        root.querySelectorAll(tag).forEach((el) => {
          const p = el.parentElement;
          if (p && p.tagName.toLowerCase() === tag) {
            unwrap(el);
            changed = true;
          }
        });
      }
    });

    // 4) 合併相鄰同標籤（略過空白文字節點）
    ["b", "i", "u"].forEach((tag) => {
      Array.from(root.querySelectorAll(tag)).forEach((el) => {
        // 向右合併一次（外圈多次呼叫即可逐步收斂）
        let next = el.nextSibling;
        while (next && next.nodeType === 3 && !(next.nodeValue || "").trim()) {
          next = next.nextSibling;
        }
        if (next && next.nodeType === 1 && next.tagName.toLowerCase() === tag) {
          while (next.firstChild) el.appendChild(next.firstChild);
          next.remove();
        }
      });
    });
  }

  /* ================== B/I/U：純用 execCommand 切換 ==================
   * - 讓瀏覽器處理「已有→取消、沒有→套用」的邏輯
   * - 之後立刻做 sanitize，杜絕殘留巢狀/空標籤
   */
  function toggleCommand(cmd) {
    const ctx = getStoryAndRange(true);
    if (!ctx) return false;
    const { story } = ctx;
    return EditorCore.keepSelectionAround(story, () => {
      document.execCommand(cmd, false); // 反白/游標皆可
      sanitizeInlineBUI(story);
      afterChange(story);
      return true;
    });
  }

  function onBold() { return toggleCommand("bold"); }
  function onItalic() { return toggleCommand("italic"); }
  function onUnderline() { return toggleCommand("underline"); }

  /* ================== A+ / A-：單層 data-fs ================== */
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
    const fs = clamp(valEm, 0.2, 5);
    span.dataset.fs = String(fs);
    span.style.fontSize = fs.toFixed(2).replace(/\.00$/, "") + "em";
  }

  function findFsWrapper(node) {
    let cur = node && node.nodeType === 1 ? node : node ? node.parentElement : null;
    while (cur && cur !== document) {
      if (cur.tagName === "SPAN" && (cur.dataset.fs || /em$/.test(cur.style.fontSize || ""))) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function stripFsInFragment(node) {
    if (!node) return;
    if (node.nodeType !== 1) {
      Array.from(node.childNodes).forEach(stripFsInFragment);
      return;
    }
    const el = node;
    if (el.tagName === "SPAN" && (el.dataset.fs || /em$/.test(el.style.fontSize || ""))) {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
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
      const prevKey = prev.dataset.fs || (prev.style.fontSize || "").replace("em", "");
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
      const nextKey = next.dataset.fs || (next.style.fontSize || "").replace("em", "");
      if (nextKey === sizeKey) {
        while (next.firstChild) span.appendChild(next.firstChild);
        next.parentNode && next.parentNode.removeChild(next);
      }
    }
  }

  function expandRangeToWord(range) {
    const node = range.startContainer;
    if (!node || node.nodeType !== 3) return false;
    const text = node.nodeValue;
    const i = range.startOffset;
    let L = i, R = i;
    const isWord = (c) => /[^\s.,;:!?()\[\]{}"'\u3000\u3001\u3002]/.test(c || "");
    while (L > 0 && isWord(text[L - 1])) L--;
    while (R < text.length && isWord(text[R])) R++;
    if (L === R) return false;
    const sel = window.getSelection();
    range.setStart(node, L);
    range.setEnd(node, R);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  function adjustFont(deltaStep) {
    let ctx = getStoryAndRange(false);
    if (!ctx) {
      ctx = getStoryAndRange(true);
      if (!ctx) return false;
      const { range } = ctx;
      const wrap = findFsWrapper(range.startContainer);
      if (!wrap) {
        const ok = expandRangeToWord(range);
        if (!ok) return false;
      }
    }

    const { story, range } = ctx;
    return EditorCore.keepSelectionAround(story, () => {
      const startWrap = findFsWrapper(range.startContainer);
      const endWrap = findFsWrapper(range.endContainer);

      if (startWrap && startWrap === endWrap) {
        const cur = getSpanSize(startWrap) || 1;
        setSpanSize(startWrap, cur + deltaStep);
        mergeAdjacentFs(startWrap);
        afterChange(story);
        return true;
      }

      let base = getSpanSize(startWrap);
      if (isNaN(base)) base = getSpanSize(endWrap);
      if (isNaN(base)) base = 1.0;

      const frag = range.extractContents();
      stripFsInFragment(frag);
      const span = document.createElement("span");
      setSpanSize(span, base + deltaStep);
      span.appendChild(frag);
      range.insertNode(span);

      mergeAdjacentFs(span);
      afterChange(story);
      return true;
    });
  }

  /* ================== 綁定 ================== */
  function bindButtons() {
    const btnB = document.getElementById("btnBold");
    const btnI = document.getElementById("btnItalic");
    const btnU = document.getElementById("btnUnderline");
    const btnUp = document.getElementById("btnFontUp");
    const btnDn = document.getElementById("btnFontDown");

    btnB && btnB.addEventListener("click", onBold);
    btnI && btnI.addEventListener("click", onItalic);
    btnU && btnU.addEventListener("click", onUnderline);

    btnUp && btnUp.addEventListener("click", () => adjustFont(+0.1));
    btnDn && btnDn.addEventListener("click", () => adjustFont(-0.1));
  }

  function bindShortcuts() {
    document.addEventListener("keydown", (e) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (e.key === "b" || e.key === "B") { e.preventDefault(); onBold(); }
      if (e.key === "i" || e.key === "I") { e.preventDefault(); onItalic(); }
      if (e.key === "u" || e.key === "U") { e.preventDefault(); onUnderline(); }
      if (e.key === "=" || e.key === "+") { e.preventDefault(); adjustFont(+0.1); }
      if (e.key === "-") { e.preventDefault(); adjustFont(-0.1); }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindButtons();
    bindShortcuts();
  });
})();
