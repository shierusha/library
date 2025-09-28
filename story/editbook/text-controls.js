/* text-controls.js — B/I/U（OK）+ A+/A-（只動反白、分段提級、不合併鄰居、可連按）
 * - B/I/U：原生 toggle + 清理
 * - A+/A-：僅在有選取時運作；抽出→去內部 data-fs→包目標字級→把包「提」到任何外層 data-fs 之外
 *          不與左右同字級合併，然後把選取重設到剛剛那段，方便一直 ++++ / ----
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

      // 去巢狀
      let changed = true;
      while (changed) {
        changed = false;
        Array.from(root.querySelectorAll(tag)).forEach(el=>{
          const p = el.parentElement;
          if (p && p.tagName.toLowerCase() === tag) { unwrap(el); changed = true; }
        });
      }

      // 不做相鄰合併，避免影響下次選取範圍
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
  function stripFsInFragment(node) {
    if (!node) return;
    if (node.nodeType !== 1) { Array.from(node.childNodes).forEach(stripFsInFragment); return; }
    const el = node;
    if (isFsSpan(el)) {
      const p = el.parentNode;
      while (el.firstChild) p.insertBefore(el.firstChild, el);
      p.removeChild(el);
      return;
    }
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

  /* ========== 把選取包「提級」出外層 data-fs（避免巢狀），且不合併鄰居 ========== */
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
    // 不與左右同字級合併，避免擴大範圍
  }

  /* ========== A+/A-（只動反白、不影響未選取，且可連按） ========== */
  function adjustFont(deltaStep) {
    const ctx = getStoryAndRange(false /* 必須有選取 */);
    if (!ctx) return false;
    const { story, range } = ctx;

    return EditorCore.keepSelectionAround(story, () => {
      const base = computeBaseEmForSelection(range);
      const target = clamp( +(base + deltaStep).toFixed(2), EM_MIN, EM_MAX );

      // 1) 抽出 fragment，剝掉內部 data-fs（但保留 B/I/U）
      const frag = range.extractContents();
      stripFsInFragment(frag);

      // 2) 包一層目標字級（暫時）
      const span = document.createElement("span");
      setSpanSize(span, target);
      span.appendChild(frag);
      range.insertNode(span);

      // 3) 把這個「包」往外提到任何 data-fs 之外 → 形成左右(原尺寸)/中(新尺寸) 三段
      liftOutFromFs(span);

      // 4) 清空空 wrapper
      cleanupEmptyFs(story);

      // 5) 重新選取剛剛那段，支援連按 A+ / A-
      const sel = window.getSelection();
      sel.removeAllRanges();
      const nr = document.createRange();
      nr.selectNodeContents(span);
      sel.addRange(nr);

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
