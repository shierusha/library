/* text-controls.js — B/I/U（OK）+ A+/A-（只動反白、統一尺寸、截斷邊界；且不產生 data-fs 巢狀）
 * - B/I/U：原生 toggle + 清理
 * - A+/A-：先包選取 → strip 內部 data-fs → 再把這個包「提」到外層 data-fs 之外（分成左右/中三段）
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
    const n = document.createElement(newTag);
    while (el.firstChild) n.appendChild(el.firstChild);
    el.parentNode.replaceChild(n, el);
    return n;
  }
  const isFsSpan = el =>
    el && el.nodeType === 1 && el.tagName === 'SPAN' &&
    (el.dataset.fs || /font-size/i.test(el.getAttribute('style') || ''));

  /* ========== B/I/U 清理 ========== */
  function sanitizeInlineBUI(root) {
    if (!root) return;
    root.querySelectorAll("strong").forEach((n) => replaceTag(n, "b"));
    root.querySelectorAll("em").forEach((n) => replaceTag(n, "i"));

    ["b","i","u"].forEach(tag=>{
      // 移除空標（只有空白或沒有子節點）
      Array.from(root.querySelectorAll(tag)).forEach(el=>{
        let hasText = false;
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        while (tw.nextNode()) {
          if ((tw.currentNode.nodeValue || "").replace(/\u00a0/g, " ").trim()) { hasText = true; break; }
        }
        if (!hasText) unwrap(el);
      });

      // 去巢狀 + 合併相鄰
      let changed = true;
      while (changed) {
        changed = false;
        Array.from(root.querySelectorAll(tag)).forEach(el=>{
          const p = el.parentElement;
          if (p && p.tagName.toLowerCase() === tag) { unwrap(el); changed = true; }
        });
      }
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
    Array.from(el.childNodes).forEach(stripFsInFragment);
  }
  function mergeAdjacentFs(span) {
    if (!span || span.nodeType !== 1 || span.tagName !== "SPAN") return;
    const key = span.dataset.fs || (span.style.fontSize || "").replace("em", "");
    if (!key) return;
    // 左
    let prev = span.previousSibling;
    while (prev && prev.nodeType === 3 && !prev.nodeValue) prev = prev.previousSibling;
    if (prev && prev.nodeType === 1 && prev.tagName === "SPAN") {
      const k = prev.dataset.fs || (prev.style.fontSize || "").replace("em","");
      if (k === key) { while (span.firstChild) prev.appendChild(span.firstChild); span.replaceWith(prev); span = prev; }
    }
    // 右
    let next = span.nextSibling;
    while (next && next.nodeType === 3 && !next.nodeValue) next = next.nextSibling;
    if (next && next.nodeType === 1 && next.tagName === "SPAN") {
      const k = next.dataset.fs || (next.style.fontSize || "").replace("em","");
      if (k === key) { while (next.firstChild) span.appendChild(next.firstChild); next.remove(); }
    }
  }
  function cleanupEmptyFs(root){
    Array.from(root.querySelectorAll('span[data-fs],span[style*="font-size"]')).forEach(el=>{
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
    const findFsWrapper = (node)=>{
      let cur = node && node.nodeType === 1 ? node : node ? node.parentElement : null;
      while (cur && cur !== document) { if (isFsSpan(cur)) return cur; cur = cur.parentElement; }
      return null;
    };
    const sw = findFsWrapper(range.startContainer);
    const ew = findFsWrapper(range.endContainer);
    if (sw && sw === ew) {
      const base = getSpanSize(sw);
      if (!isNaN(base)) return base;
    }
    const base2 = sw ? getSpanSize(sw) : NaN;
    return isNaN(base2) ? 1.0 : base2;
  }

  /* ========== 把選取包「提級」出外層 data-fs（避免巢狀） ========== */
  function liftOutFromFs(wrapper) {
    let w = wrapper;
    while (w.parentElement && isFsSpan(w.parentElement)) {
      const p = w.parentElement;
      const gp = p.parentNode;

      // 左段
      const rL = document.createRange();
      rL.setStart(p, 0);
      rL.setEndBefore(w);
      const leftFrag = rL.extractContents();
      if (leftFrag.childNodes.length) {
        const sL = document.createElement('span');
        if (p.dataset.fs) sL.dataset.fs = p.dataset.fs;
        if (p.style.fontSize) sL.style.fontSize = p.style.fontSize;
        sL.appendChild(leftFrag);
        gp.insertBefore(sL, p);
      }

      // 右段
      const rR = document.createRange();
      rR.setStartAfter(w);
      rR.setEnd(p, p.childNodes.length);
      const rightFrag = rR.extractContents();
      if (rightFrag.childNodes.length) {
        const sR = document.createElement('span');
        if (p.dataset.fs) sR.dataset.fs = p.dataset.fs;
        if (p.style.fontSize) sR.style.fontSize = p.style.fontSize;
        sR.appendChild(rightFrag);
        gp.insertBefore(sR, p.nextSibling);
      }

      // 把 wrapper 提到 p 的位置
      gp.replaceChild(w, p);
    }
    // 清一下相鄰同字級
    mergeAdjacentFs(w);
  }

  /* ========== A+/A-（只動反白、分開而不包在舊 data-fs 裡） ========== */
  function collectTextBaseMap(range, story){
    const map = new Map();
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node){
          if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
          if (!story.contains(node)) return NodeFilter.FILTER_REJECT;
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    while (walker.nextNode()) {
      const text = walker.currentNode;
      let base = NaN;
      let cur = text.parentNode;
      while (cur && cur !== story) {
        if (isFsSpan(cur)) {
          const size = getSpanSize(cur);
          if (!isNaN(size)) { base = size; break; }
        }
        cur = cur.parentNode;
      }
      if (isNaN(base)) base = 1.0;
      map.set(text, base);
    }
    return map;
  }
  function adjustFont(deltaStep) {
    const ctx = getStoryAndRange(false /* 必須有選取 */);
    if (!ctx) return false;
    const { story, range } = ctx;

    return EditorCore.keepSelectionAround(story, () => {
    const defaultBase = computeBaseEmForSelection(range);
      const textBaseMap = collectTextBaseMap(range, story);
      const frag = range.extractContents();
 if (!frag || !frag.childNodes.length) return false;

      const spansToNormalize = [];

      function applyDelta(node, inheritedBase) {
        if (node.nodeType === 1) {
          const el = node;
          if (isFsSpan(el)) {
            const current = getSpanSize(el);
            const base = isNaN(current) ? inheritedBase : current;
            const target = clamp( +(base + deltaStep).toFixed(2), EM_MIN, EM_MAX );
            setSpanSize(el, target);
            spansToNormalize.push(el);
            // 仍須處理巢狀字級
            Array.from(el.childNodes).forEach(child => applyDelta(child, target));
            return;
          }
          Array.from(el.childNodes).forEach(child => applyDelta(child, inheritedBase));
          return;
        }

        if (node.nodeType === 3) {
          const text = node;
          if (!text.nodeValue || !text.nodeValue.trim()) return;

          let cur = text.parentNode;
          while (cur && cur !== frag && cur !== story) {
            if (isFsSpan(cur)) return; // 由外層處理
            cur = cur.parentNode;
          }

          const base = textBaseMap.has(text) ? textBaseMap.get(text) : inheritedBase;
          const target = clamp( +(base + deltaStep).toFixed(2), EM_MIN, EM_MAX );
          const span = document.createElement('span');
          setSpanSize(span, target);
          text.parentNode.insertBefore(span, text);
          span.appendChild(text);
          spansToNormalize.push(span);
          return;
        }
      }

      Array.from(frag.childNodes).forEach(child => applyDelta(child, defaultBase));

      const inserted = Array.from(frag.childNodes);
      const extraSpans = frag.querySelectorAll ? Array.from(frag.querySelectorAll('span[data-fs],span[style*="font-size"]')) : [];
      extraSpans.forEach(span => spansToNormalize.push(span));

      const marker = document.createTextNode('');
      range.insertNode(marker);
      inserted.forEach(node => marker.parentNode.insertBefore(node, marker));
      marker.remove();

      const uniqueSpans = Array.from(new Set(spansToNormalize.filter(span => span && span.nodeType === 1)));
      
      uniqueSpans
        .filter(span => span.parentElement)
        .forEach(span => liftOutFromFs(span));

      uniqueSpans
        .filter(span => span.parentElement)
        .forEach(span => mergeAdjacentFs(span));

        cleanupEmptyFs(story);

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

    btnB && btnB.addEventListener("click", () => toggleCommand("bold"));
    btnI && btnI.addEventListener("click", () => toggleCommand("italic"));
    btnU && btnU.addEventListener("click", () => toggleCommand("underline"));

    btnUp && btnUp.addEventListener("click", () => adjustFont(+STEP));
    btnDn && btnDn.addEventListener("click", () => adjustFont(-STEP));
  }

  function bindShortcuts() {
    document.addEventListener("keydown", (e) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (e.key === "b" || e.key === "B") { e.preventDefault(); toggleCommand("bold"); }
      if (e.key === "i" || e.key === "I") { e.preventDefault(); toggleCommand("italic"); }
      if (e.key === "u" || e.key === "U") { e.preventDefault(); toggleCommand("underline"); }
      if (e.key === "=" || e.key === "+") { e.preventDefault(); adjustFont(+STEP); }
      if (e.key === "-") { e.preventDefault(); adjustFont(-STEP); }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindButtons();
    bindShortcuts();
  });
})();
