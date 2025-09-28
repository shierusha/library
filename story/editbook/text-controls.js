/* text-controls.js
 * 文字工具列：B / I / U / A+ / A-
 * - 只作用目前頁（EditorCore.getFocusedDbIndex）
 * - 只作用反白區段；保持選取（不會跳到第一字）
 * - A+ / A-：只包「一層」 <span data-fs style="font-size:...em">；連按持續累加
 * - 變更後合併左右同級的 data-fs，避免產生一堆 span
 * - 每次操作後：寫回 DB + 觸發 PasteFlow.forceReflow(story)
 */
(function () {

  /* ---------- 公用 ---------- */
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  // 判斷是否為我們的字級 span
  function isOurFsSpan(el) {
    return el && el.tagName === 'SPAN' &&
      (el.dataset.fs || /em$/.test((el.style && el.style.fontSize) || ''));
  }
  // 文字節點是否只含空白（含 NBSP）
  function isWhitespaceText(n) {
    return n && n.nodeType === 3 &&
      !String(n.nodeValue || '').replace(/\u00a0/g, ' ').trim();
  }

  // 清掃：移除沒有內容的 b/i/u 與空的字級 span（避免越按越累積空殼）
  function sweepInlineGarbage(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    const trash = [];

    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (!el || el === root) continue;
      if (el.getAttribute && el.getAttribute('data-caret') === '1') continue;

      const tag = el.tagName;
      const isInline = /^(B|I|U|EM|STRONG|S|SMALL|MARK|SUB|SUP|SPAN)$/i.test(tag);
      if (!isInline) continue;
      if (tag === 'SPAN' && !isOurFsSpan(el)) continue; // 只處理我們的 fs-span

      const text = (el.textContent || '').replace(/\u00a0/g, ' ').trim();
      const onlyBr = el.children.length === 1 &&
        el.firstElementChild && el.firstElementChild.tagName === 'BR' &&
        text === '';
      const noText = text === '';

      if (onlyBr || noText) {
        trash.push(el);
      }
    }

    trash.forEach(el => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
    });
  }

  // 取得當前作用中的 story 與選取
  function getActiveStory() {
    const dbIndex = EditorCore.getFocusedDbIndex();
    if (dbIndex == null) return null; // 允許 0
    const story = EditorCore.getStoryByDbIndex(dbIndex);
    if (!story) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const rng = sel.getRangeAt(0);
    if (!story.contains(rng.startContainer)) return null;
    if (rng.collapsed) return null;
    return { story, range: rng, dbIndex };
  }

  function afterChange(story) {
    // 先清掉空 b/i/u 與空的字級 span，避免殘留
    sweepInlineGarbage(story);

    const db = Number(story.dataset.dbIndex || '0') | 0;
    EditorCore.updatePageJsonFromStory(db, story);
    if (window.PasteFlow && typeof window.PasteFlow.forceReflow === 'function') {
      window.PasteFlow.forceReflow(story);
    } else {
      story.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /* ---------- B / I / U：真正的 toggle ---------- */

  // 尋找 node 向上最近的指定標籤（限制不超過 stop 節點）
  function findAncestorTag(node, upperTag, stop) {
    let cur = (node && node.nodeType === 1) ? node : (node ? node.parentElement : null);
    while (cur && cur !== stop && cur !== document) {
      if (cur.tagName === upperTag) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  // 選取是否整段都在某一個（同一個或巢狀的）指定標籤內；若是則回傳「覆蓋此選取的那個標籤元素」，否則 null
  function selectionFullyInsideSingleTag(range, upperTag, stop) {
    const a = findAncestorTag(range.startContainer, upperTag, stop);
    const b = findAncestorTag(range.endContainer, upperTag, stop);
    if (!a || !b) return null;
    // 同一顆或其中一顆包含另一顆，都代表整段落在同一組 <tag> 之內
    if (a === b) return a;
    if (a.contains(b)) return a;
    if (b.contains(a)) return b;
    return null;
  }

  // 在某個 root/frag 內把指定標籤全部「解包」（保留內容、移除標籤）
  function unwrapAllTagIn(root, upperTag) {
    if (!root || !upperTag) return;
    const list = root.querySelectorAll(upperTag);
    list.forEach(node => {
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
    });
  }

  // 合併左右相鄰、相同標籤（避免 <b>..</b><b>..</b>）
  function mergeAdjacentSameTag(el, upperTag) {
    if (!el || el.nodeType !== 1) return;

    const isWS = n => n && n.nodeType === 3 && !String(n.nodeValue || '').replace(/\u00a0/g, ' ').trim();

    // 左合併
    let prev = el.previousSibling;
    while (prev && isWS(prev)) prev = prev.previousSibling;
    if (prev && prev.nodeType === 1 && prev.tagName === upperTag) {
      while (el.firstChild) prev.appendChild(el.firstChild);
      el.parentNode && el.parentNode.replaceChild(prev, el);
      el = prev;
    }
    // 右合併
    let next = el.nextSibling;
    while (next && isWS(next)) next = next.nextSibling;
    if (next && next.nodeType === 1 && next.tagName === upperTag) {
      while (next.firstChild) el.appendChild(next.firstChild);
      next.parentNode && next.parentNode.removeChild(next);
    }
  }

  function wrapInline(tag) {
    const ctx = getActiveStory(); if (!ctx) return false;
    const { story, range } = ctx;
    const U = String(tag || '').toUpperCase();

    return EditorCore.keepSelectionAround(story, () => {
      // Toggle：若整段都在 <tag> 內，就把選取範圍內的 <tag> 解包掉
      const host = selectionFullyInsideSingleTag(range, U, story);
      if (host) {
        const frag = range.extractContents();
        unwrapAllTagIn(frag, U);  // 只把選到的部分解除
        range.insertNode(frag);
        afterChange(story);
        return true;
      }

      // 否則：先扁平化內部同標籤，再外包一層，最後把左右鄰居同標籤合併
      const frag = range.extractContents();
      unwrapAllTagIn(frag, U);
      const el = document.createElement(U);
      el.appendChild(frag);
      range.insertNode(el);
      mergeAdjacentSameTag(el, U);

      afterChange(story);
      return true;
    });
  }

  /* ---------- A+ / A- 專用 ---------- */
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
      if (cur.tagName === 'SPAN' && (cur.dataset.fs || /em$/.test(cur.style.fontSize || ''))) {
        return cur;
      }
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

    // 合併左：忽略純空白文字節點
    let prev = span.previousSibling;
    while (prev && isWhitespaceText(prev)) prev = prev.previousSibling;
    if (prev && prev.nodeType === 1 && prev.tagName === 'SPAN') {
      const prevKey = prev.dataset.fs || (prev.style.fontSize || '').replace('em', '');
      if (prevKey === sizeKey) {
        while (span.firstChild) prev.appendChild(span.firstChild);
        span.parentNode && span.parentNode.replaceChild(prev, span);
        span = prev;
      }
    }
    // 合併右：忽略純空白文字節點
    let next = span.nextSibling;
    while (next && isWhitespaceText(next)) next = next.nextSibling;
    if (next && next.nodeType === 1 && next.tagName === 'SPAN') {
      const nextKey = next.dataset.fs || (next.style.fontSize || '').replace('em', '');
      if (nextKey === sizeKey) {
        while (next.firstChild) span.appendChild(next.firstChild);
        next.parentNode && next.parentNode.removeChild(next);
      }
    }
  }

  function adjustFont(deltaStep) {
    const ctx = getActiveStory(); if (!ctx) return false;
    const { story, range } = ctx;

    return EditorCore.keepSelectionAround(story, () => {
      const startWrap = findFsWrapper(range.startContainer);
      const endWrap = findFsWrapper(range.endContainer);

      // 1) 如果選取完全在同一個 data-fs 裡 → 直接在那一層累加
      if (startWrap && startWrap === endWrap) {
        const cur = getSpanSize(startWrap) || 1;
        setSpanSize(startWrap, cur + deltaStep);
        mergeAdjacentFs(startWrap);
        afterChange(story);
        return true;
      }

      // 2) 跨多段或只有一端有 data-fs：以端點附近的 data-fs 當基準，沒有就 1.0
      let base = getSpanSize(startWrap);
      if (isNaN(base)) base = getSpanSize(endWrap);
      if (isNaN(base)) base = 1.0;

      // 把選取抽出，扁平化裡面所有 data-fs，然後用一層新的包回
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

  /* ---------- 綁定 ---------- */
  function bind() {
    const btnB = document.getElementById('btnBold');
    const btnI = document.getElementById('btnItalic');
    const btnU = document.getElementById('btnUnderline');
    const btnUp = document.getElementById('btnFontUp');
    const btnDn = document.getElementById('btnFontDown');

    btnB && btnB.addEventListener('click', () => wrapInline('b'));
    btnI && btnI.addEventListener('click', () => wrapInline('i'));
    btnU && btnU.addEventListener('click', () => wrapInline('u'));

    // 步進 0.1em（連按可持續放大/縮小）
    btnUp && btnUp.addEventListener('click', () => adjustFont(+0.1));
    btnDn && btnDn.addEventListener('click', () => adjustFont(-0.1));
  }

  document.addEventListener('DOMContentLoaded', bind);
})();
