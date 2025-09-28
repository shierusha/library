/* text-controls.js — B/I/U（OK）+ A+/A-（只動反白、可連按、不擴選）
 * 連按 A+ / A- 的祕訣：當選取覆蓋「單一 data-fs 區塊」時，直接改那個區塊的 font-size 並維持選取
 */
(function () {
  if (!window.EditorCore) return;

  // ===== 工具 =====
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
    const p = el.parentNode; if (!p) return;
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

  // ===== B/I/U 清理與切換（略） =====
  function sanitizeInlineBUI(root) {
    if (!root) return;
    root.querySelectorAll("strong").forEach((n) => replaceTag(n, "b"));
    root.querySelectorAll("em").forEach((n) => replaceTag(n, "i"));
    ["b","i","u"].forEach(tag=>{
      Array.from(root.querySelectorAll(tag)).forEach(el=>{
        let hasText = false;
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
        while (tw.nextNode()) {
          if ((tw.currentNode.nodeValue || "").replace(/\u00a0/g, " ").trim()) { hasText = true; break; }
        }
        if (!hasText) unwrap(el);
      });
      let changed = true;
      while (changed) {
        changed = false;
        Array.from(root.querySelectorAll(tag)).forEach(el=>{
          const p = el.parentElement;
          if (p && p.tagName.toLowerCase() === tag) { unwrap(el); changed = true; }
        });
      }
    });
  }
  function toggleCommand(cmd) {
    const ctx = getStoryAndRange(true); if (!ctx) return false;
    const { story } = ctx;
    document.execCommand(cmd, false);
    sanitizeInlineBUI(story);
    afterChange(story);
    return true;
  }
  function onBold(){ return toggleCommand("bold"); }
  function onItalic(){ return toggleCommand("italic"); }
  function onUnderline(){ return toggleCommand("underline"); }

  // ===== 字級工具 =====
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
  function stripFsInFragment(node) {
    if (!node) return;
    if (node.nodeType !== 1) { Array.from(node.childNodes).forEach(stripFsInFragment); return; }
    const el = node;
    if (isFsSpan(el)) { const p = el.parentNode; while (el.firstChild) p.insertBefore(el.firstChild, el); p.removeChild(el); return; }
    Array.from(el.childNodes).forEach(stripFsInFragment);
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
  function findFsWrapper(node) {
    let cur = node && node.nodeType === 1 ? node : node ? node.parentElement : null;
    while (cur && cur !== document) { if (isFsSpan(cur)) return cur; cur = cur.parentElement; }
    return null;
  }
  function computeBaseEmForSelection(range){
    const sw = findFsWrapper(range.startContainer);
    const ew = findFsWrapper(range.endContainer);
    if (sw && sw === ew) {
      const base = getSpanSize(sw);
      if (!isNaN(base)) return base;
    }
    const base2 = sw ? getSpanSize(sw) : NaN;
    return isNaN(base2) ? 1.0 : base2;
  }
  function liftOutFromFs(wrapper) {
    let w = wrapper;
    while (w.parentElement && isFsSpan(w.parentElement)) {
      const p = w.parentElement;
      const gp = p.parentNode;

      // 左段
      const rL = document.createRange();
      rL.setStart(p, 0); rL.setEndBefore(w);
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
      rR.setStartAfter(w); rR.setEnd(p, p.childNodes.length);
      const rightFrag = rR.extractContents();
      if (rightFrag.childNodes.length) {
        const sR = document.createElement('span');
        if (p.dataset.fs) sR.dataset.fs = p.dataset.fs;
        if (p.style.fontSize) sR.style.fontSize = p.style.fontSize;
        sR.appendChild(rightFrag);
        gp.insertBefore(sR, p.nextSibling);
      }
      // 提級
      gp.replaceChild(w, p);
    }
  }
  function selectionCoversWhole(el, range) {
    // 選取是否「完整覆蓋」某個元素的內容
    const r2 = document.createRange();
    r2.selectNodeContents(el);
    return (
      range.startContainer === r2.startContainer &&
      range.startOffset   === r2.startOffset   &&
      range.endContainer  === r2.endContainer  &&
      range.endOffset     === r2.endOffset
    );
  }

  // ===== A+ / A-：只動反白、可連按、不擴選 =====
  function adjustFont(deltaStep) {
    const ctx = getStoryAndRange(false /* 必須有選取 */);
    if (!ctx) return false;
    const { story, range } = ctx;

    // 情況 A：選取完整覆蓋「單一 data-fs 區塊」→ 直接就地調整，並保持選取
    const directWrapper = (()=>{
      const sw = findFsWrapper(range.startContainer);
      const ew = findFsWrapper(range.endContainer);
      if (sw && sw === ew && selectionCoversWhole(sw, range)) return sw;
      return null;
    })();

    if (directWrapper) {
      const base = getSpanSize(directWrapper) || 1;
      const target = clamp( +(base + deltaStep).toFixed(2), EM_MIN, EM_MAX );
      setSpanSize(directWrapper, target);

      // 維持選取在這個 wrapper，支援連按
      const sel = window.getSelection();
      sel.removeAllRanges();
      const nr = document.createRange();
      nr.selectNodeContents(directWrapper);
      sel.addRange(nr);

      afterChange(story);
      return true;
    }

    // 情況 B：選取是混雜內容 → 抽出、清掉內部 fs、包新 fs、提級、不合併鄰居，最後把選取鎖到新包
    const base = computeBaseEmForSelection(range);
    const target = clamp( +(base + deltaStep).toFixed(2), EM_MIN, EM_MAX );

    // 抽出 fragment 並清掉 fs（保留 B/I/U）
    const frag = range.extractContents();
    stripFsInFragment(frag);

    // 包目標字級
    const newSpan = document.createElement("span");
    setSpanSize(newSpan, target);
    newSpan.appendChild(frag);
    range.insertNode(newSpan);

    // 提級到任何外層 fs 之外（切成左/中/右三段，避免影響未選取）
    liftOutFromFs(newSpan);

    // 清掉空 wrapper（不和左右合併，避免擴選）
    cleanupEmptyFs(story);

    // 鎖定選取在新包 → 可以一直連按
    const sel = window.getSelection();
    sel.removeAllRanges();
    const nr = document.createRange();
    nr.selectNodeContents(newSpan);
    sel.addRange(nr);

    afterChange(story);
    return true;
  }

  // ===== 綁定 =====
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
