/* text-controls.js — Word-like 手感：B/I/U 支援游標黏著輸入、A+/A- 跨段合併與就地調整
 * - B/I/U：有選取時包裹並保留選取；無選取時使用瀏覽器 typing state（之後輸入沿用）
 * - A+/A-：單層 <span data-fs style="font-size:...em">；跨段統一基準並合併相鄰
 * - 無選取時：若在 data-fs 內就地調整；否則擴到「當前字詞」再調整
 * - 每次操作後：寫回 DB + 觸發 PasteFlow.forceReflow(story)
 */
(function () {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  /* ------- 共同取得：目前頁的 story + range ------- */
  function getStoryAndRange(allowCollapsed = false) {
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
    const db = Number(story.dataset.dbIndex || '0') | 0;
    EditorCore.updatePageJsonFromStory(db, story);
    if (window.PasteFlow && typeof window.PasteFlow.forceReflow === 'function') {
      window.PasteFlow.forceReflow(story);
    } else {
      story.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /* ===================== B / I / U ===================== */
  function flatWrapInline(tag) {
    // 有選取（反白）版本：保持原本做法 + 保留選取
    const ctx = getStoryAndRange(false); if (!ctx) return false;
    const { story, range } = ctx;

    return EditorCore.keepSelectionAround(story, () => {
      const frag = range.extractContents();
      const el = document.createElement(tag); el.appendChild(frag);
      range.insertNode(el);

      // 扁平化避免 <b><b>…>
      const parent = el.parentElement;
      if (parent && parent.tagName === tag.toUpperCase()) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
      afterChange(story);
      return true;
    });
  }

  function toggleInlineTypingState(tag) {
    // 無選取（游標）版本：使用瀏覽器的 typing state（和 Word 一樣好用）
    const ctx = getStoryAndRange(true); if (!ctx) return false;
    const { story } = ctx;
    // execCommand 雖被標示 deprecated，但在 contenteditable 的 typing state 仍普遍可用
    // 可帶來「之後輸入沿用 / 再按一次關閉」的體感
    const map = { b: 'bold', i: 'italic', u: 'underline' };
    document.execCommand(map[tag], false);
    afterChange(story);
    return true;
  }

  function onBold() {
    const hasSel = !!getStoryAndRange(false);
    if (hasSel) return flatWrapInline('b');
    return toggleInlineTypingState('b');
  }
  function onItalic() {
    const hasSel = !!getStoryAndRange(false);
    if (hasSel) return flatWrapInline('i');
    return toggleInlineTypingState('i');
  }
  function onUnderline() {
    const hasSel = !!getStoryAndRange(false);
    if (hasSel) return flatWrapInline('u');
    return toggleInlineTypingState('u');
  }

  /* ===================== A+ / A- ===================== */
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
    span.style.fontSize = fs.toFixed(2).replace(/\.00$/, '') + 'em';
  }
  function findFsWrapper(node) {
    let cur = (node && node.nodeType === 1) ? node : (node ? node.parentElement : null);
    while (cur && cur !== document) {
      if (cur.tagName === 'SPAN' && (cur.dataset.fs || /em$/.test(cur.style.fontSize || ''))) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  function stripFsInFragment(node) {
    if (!node) return;
    if (node.nodeType !== 1) { Array.from(node.childNodes).forEach(stripFsInFragment); return; }
    const el = node;
    if (el.tagName === 'SPAN' && (el.dataset.fs || /em$/.test(el.style.fontSize || ''))) {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      return;
    }
    Array.from(el.childNodes).forEach(stripFsInFragment);
  }
  function mergeAdjacentFs(span) {
    if (!span || span.nodeType !== 1 || span.tagName !== 'SPAN') return;
    const sizeKey = span.dataset.fs || (span.style.fontSize || '').replace('em', '');
    if (!sizeKey) return;
    // 合併左
    let prev = span.previousSibling;
    while (prev && prev.nodeType === 3 && !prev.nodeValue) prev = prev.previousSibling;
    if (prev && prev.nodeType === 1 && prev.tagName === 'SPAN') {
      const prevKey = prev.dataset.fs || (prev.style.fontSize || '').replace('em', '');
      if (prevKey === sizeKey) {
        while (span.firstChild) prev.appendChild(span.firstChild);
        span.parentNode && span.parentNode.replaceChild(prev, span);
        span = prev;
      }
    }
    // 合併右
    let next = span.nextSibling;
    while (next && next.nodeType === 3 && !next.nodeValue) next = next.nextSibling;
    if (next && next.nodeType === 1 && next.tagName === 'SPAN') {
      const nextKey = next.dataset.fs || (next.style.fontSize || '').replace('em', '');
      if (nextKey === sizeKey) {
        while (next.firstChild) span.appendChild(next.firstChild);
        next.parentNode && next.parentNode.removeChild(next);
      }
    }
  }

  function expandRangeToWord(range) {
    // 盡量模擬 Word：無選取時，擴到「當前字詞」
    const node = range.startContainer;
    if (!node || node.nodeType !== 3) return false;
    const text = node.nodeValue;
    const i = range.startOffset;
    let L = i, R = i;
    const isWord = c => /[^\s.,;:!?()\[\]{}"'\u3000\u3001\u3002]/.test(c || '');
    while (L > 0 && isWord(text[L - 1])) L--;
    while (R < text.length && isWord(text[R])) R++;
    if (L === R) return false;
    const sel = window.getSelection();
    range.setStart(node, L);
    range.setEnd(node, R);
    sel.removeAllRanges(); sel.addRange(range);
    return true;
  }

  function adjustFont(deltaStep) {
    // 有選取 → 原本流程；無選取 → 就地調整或擴字詞
    let ctx = getStoryAndRange(false);
    if (!ctx) {
      ctx = getStoryAndRange(true);
      if (!ctx) return false;
      const { range } = ctx;
      // 若在 data-fs 中 → 就地調整；否則試著擴到字詞
      const wrap = findFsWrapper(range.startContainer);
      if (!wrap) {
        const ok = expandRangeToWord(range);
        if (!ok) return false; // 找不到字詞就不處理
      }
    }

    const { story, range } = ctx;
    return EditorCore.keepSelectionAround(story, () => {
      const startWrap = findFsWrapper(range.startContainer);
      const endWrap = findFsWrapper(range.endContainer);

      // 1) 同一個 data-fs 內 → 直接累加
      if (startWrap && startWrap === endWrap) {
        const cur = getSpanSize(startWrap) || 1;
        setSpanSize(startWrap, cur + deltaStep);
        mergeAdjacentFs(startWrap);
        afterChange(story);
        return true;
      }

      // 2) 跨多段：端點已存在的 data-fs 為基準，否則 1.0
      let base = getSpanSize(startWrap);
      if (isNaN(base)) base = getSpanSize(endWrap);
      if (isNaN(base)) base = 1.0;

      const frag = range.extractContents();
      stripFsInFragment(frag);
      const span = document.createElement('span');
      setSpanSize(span, base + deltaStep);
      span.appendChild(frag);
      range.insertNode(span);

      mergeAdjacentFs(span);
      afterChange(story);
      return true;
    });
  }

  /* ===================== 綁定 ===================== */
  function bindButtons() {
    const btnB = document.getElementById('btnBold');
    const btnI = document.getElementById('btnItalic');
    const btnU = document.getElementById('btnUnderline');
    const btnUp = document.getElementById('btnFontUp');
    const btnDn = document.getElementById('btnFontDown');

    btnB && btnB.addEventListener('click', onBold);
    btnI && btnI.addEventListener('click', onItalic);
    btnU && btnU.addEventListener('click', onUnderline);

    // 步進 0.1em（連按可持續放大/縮小）
    btnUp && btnUp.addEventListener('click', () => adjustFont(+0.1));
    btnDn && btnDn.addEventListener('click', () => adjustFont(-0.1));
  }

  function bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); onBold(); }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); onItalic(); }
      if (e.key === 'u' || e.key === 'U') { e.preventDefault(); onUnderline(); }
      if (e.key === '=' || e.key === '+') { e.preventDefault(); adjustFont(+0.1); }
      if (e.key === '-') { e.preventDefault(); adjustFont(-0.1); }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindButtons();
    bindShortcuts();
  });
})();
