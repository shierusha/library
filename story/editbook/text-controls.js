/* text-controls.js — v2 safe
 * 文字工具列：B / I / U / A+ / A-
 * - 部分選取只套未套用；全選已套用則取消
 * - A+/A- 只調整反白段；同一 fs-span 內會切 [左][選取][右]
 * - 操作後鎖回選取，方便連按
 * - 自動合併相鄰同標籤/字級，清空殼
 */
(function(){

  /* ---------- 常數（具後備） ---------- */
  const NF = (typeof NodeFilter !== 'undefined') ? NodeFilter : {
    SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3
  };

  /* ---------- 公用 ---------- */
  const clamp = (v,min,max)=> Math.max(min, Math.min(max, v));

  function isOurFsSpan(el){
    return el && el.tagName === 'SPAN' &&
           (el.dataset.fs || /em$/.test((el.style && el.style.fontSize) || ''));
  }
  function isWhitespaceText(n){
    return n && n.nodeType === 3 &&
           !String(n.nodeValue||'').replace(/\u00a0/g,' ').trim();
  }

  function sweepInlineGarbage(root){
    if (!root) return;
    const walker = document.createTreeWalker(root, NF.SHOW_ELEMENT, null);
    const trash = [];
    while (walker.nextNode()){
      const el = walker.currentNode;
      if (!el || el === root) continue;
      if (el.getAttribute && el.getAttribute('data-caret') === '1') continue;

      const tag = el.tagName;
      const isInline = /^(B|I|U|EM|STRONG|S|SMALL|MARK|SUB|SUP|SPAN)$/i.test(tag);
      if (!isInline) continue;
      if (tag === 'SPAN' && !isOurFsSpan(el)) continue;

      const text = (el.textContent || '').replace(/\u00a0/g,' ').trim();
      const onlyBr = el.children.length === 1 &&
                     el.firstElementChild && el.firstElementChild.tagName === 'BR' &&
                     text === '';
      const noText = text === '';

      if (onlyBr || noText) trash.push(el);
    }

    trash.forEach(el=>{
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
  }

  function getActiveStory(){
    const dbIndex = EditorCore.getFocusedDbIndex && EditorCore.getFocusedDbIndex();
    if (!dbIndex) return null;
    const story = EditorCore.getStoryByDbIndex && EditorCore.getStoryByDbIndex(dbIndex);
    if (!story) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount===0) return null;
    const rng = sel.getRangeAt(0);
    if (!story.contains(rng.startContainer)) return null;
    if (rng.collapsed) return null;
    return {story, range:rng, dbIndex};
  }

  function afterChange(story){
    sweepInlineGarbage(story);
    const db = Number(story.dataset.dbIndex||'0')|0;
    if (EditorCore.updatePageJsonFromStory) EditorCore.updatePageJsonFromStory(db, story);
    if (window.PasteFlow && typeof window.PasteFlow.forceReflow === 'function') {
      window.PasteFlow.forceReflow(story);
    } else {
      story.dispatchEvent(new Event('input', { bubbles:true }));
    }
  }

  /* === 選取輔助 === */
  function setSelectionToNodeContents(node){
    try {
      if (!node) return;
      const sel = window.getSelection(); if (!sel) return;
      const rng = document.createRange();
      rng.selectNodeContents(node);
      sel.removeAllRanges();
      sel.addRange(rng);
    } catch(_){}
  }

  function setSelectionBetweenMarkers(startMarker, endMarker){
    try {
      const sel = window.getSelection(); if (!sel) return;
      const rng = document.createRange();
      rng.setStartAfter(startMarker);
      rng.setEndBefore(endMarker);
      sel.removeAllRanges();
      sel.addRange(rng);
    } catch(_){}
  }

  /* ---------- B / I / U：部分選取只套未套用；全選已套用則取消 ---------- */

  function allTextInsideTag(root, TAG){
    const tw = document.createTreeWalker(root, NF.SHOW_TEXT, null);
    let hasText = false;
    while (tw.nextNode()){
      const t = tw.currentNode;
      if (isWhitespaceText(t)) continue;
      hasText = true;
      let cur = t.parentElement, ok = false;
      while (cur && cur !== root){
        if (cur.tagName === TAG) { ok = true; break; }
        cur = cur.parentElement;
      }
      if (!ok) return false;
    }
    return hasText ? true : false;
  }

  function applyTagToUnstyledTextInFragment(root, TAG){
    const tw = document.createTreeWalker(root, NF.SHOW_TEXT, null);
    const targets = [];
    while (tw.nextNode()){
      const t = tw.currentNode;
      if (isWhitespaceText(t)) continue;

      let cur = t.parentElement, covered = false;
      while (cur && cur !== root){
        if (cur.tagName === TAG) { covered = true; break; }
        cur = cur.parentElement;
      }
      if (!covered) targets.push(t);
    }

    targets.forEach(t=>{
      const wrap = document.createElement(TAG);
      const p = t.parentNode; if (!p) return;
      p.insertBefore(wrap, t);
      wrap.appendChild(t);
    });

    mergeAdjacentTagsInFragment(root, TAG);
  }

  function unwrapTagDeep(root, TAG){
    const filter = el => (el.tagName === TAG ? NF.FILTER_ACCEPT : NF.FILTER_SKIP);
    const walker = document.createTreeWalker(root, NF.SHOW_ELEMENT, filter);
    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);
    targets.forEach(el=>{
      const parent = el.parentNode; if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
  }

  function mergeAdjacentTagAround(node, TAG){
    if (!node) return;
    const el = (node.nodeType===1) ? node : node.parentElement;
    if (!el || !el.parentNode) return;

    let prev = el.previousSibling;
    while (prev && isWhitespaceText(prev)) prev = prev.previousSibling;
    if (prev && prev.nodeType===1 && prev.tagName === TAG && el.tagName === TAG){
      while (el.firstChild) prev.appendChild(el.firstChild);
      el.parentNode && el.parentNode.replaceChild(prev, el);
    }

    const base = (prev && prev.tagName===TAG) ? prev : el;

    let next = base.nextSibling;
    while (next && isWhitespaceText(next)) next = next.nextSibling;
    if (next && next.nodeType===1 && next.tagName === TAG){
      while (next.firstChild) base.appendChild(next.firstChild);
      next.parentNode && next.parentNode.removeChild(next);
    }
  }

  function mergeAdjacentTagsInFragment(root, TAG){
    const walker = document.createTreeWalker(root, NF.SHOW_ELEMENT, null);
    const list = [];
    while (walker.nextNode()){
      const el = walker.currentNode;
      if (el.tagName === TAG) list.push(el);
    }
    list.forEach(el=> mergeAdjacentTagAround(el, TAG));
  }

  function toggleInline(tag){
    const TAG = String(tag||'').toUpperCase();
    const ctx = getActiveStory(); if (!ctx) return false;
    const {story, range} = ctx;

    return EditorCore.keepSelectionAround(story, ()=>{
      const frag = range.extractContents();
      const allInside = allTextInsideTag(frag, TAG);

      // 臨時容器 + 邊界標記，確保操作後能恢復原選取
      const container = document.createElement('span');
      container.setAttribute('data-tmp','1');

      if (allInside){
        unwrapTagDeep(frag, TAG);
        container.appendChild(frag);
      } else {
        applyTagToUnstyledTextInFragment(frag, TAG);
        container.appendChild(frag);
      }

      range.insertNode(container);

      const mStart = document.createComment('sel-start');
      const mEnd   = document.createComment('sel-end');
      container.insertBefore(mStart, container.firstChild);
      container.appendChild(mEnd);

      const parent = container.parentNode;
      while (container.firstChild) parent.insertBefore(container.firstChild, container);
      parent.removeChild(container);

      // 全文合併一次，避免邊界雙層
      mergeAdjacentTagsInFragment(story, TAG);

      setSelectionBetweenMarkers(mStart, mEnd);
      mStart.parentNode && mStart.parentNode.removeChild(mStart);
      mEnd.parentNode && mEnd.parentNode.removeChild(mEnd);

      afterChange(story);
      return true;
    });
  }

  /* ---------- A+ / A-：只調整選取；同 fs-span 內切段 ---------- */
  function parseEm(str){
    if (!str) return NaN;
    const m = String(str).match(/([0-9.]+)\s*em$/i);
    return m ? parseFloat(m[1]) : NaN;
  }
  function getSpanSize(span){
    if (!span) return NaN;
    if (span.dataset.fs) return parseFloat(span.dataset.fs);
    const p = parseEm(span.style.fontSize);
    return isNaN(p) ? NaN : p;
  }
  function setSpanSize(span, valEm){
    const fs = clamp(valEm, 0.2, 5);
    span.dataset.fs = String(fs);
    span.style.fontSize = fs.toFixed(2).replace(/\.00$/,'') + 'em';
  }
  function findFsWrapper(node){
    let cur = (node && node.nodeType===1) ? node : (node ? node.parentElement : null);
    while (cur && cur !== document){
      if (cur.tagName === 'SPAN' && (cur.dataset.fs || /em$/.test(cur.style.fontSize||''))){
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }
  function stripFsInFragment(node){
    if (!node) return;
    if (node.nodeType !== 1) { Array.from(node.childNodes).forEach(stripFsInFragment); return; }
    const el = node;
    if (el.tagName === 'SPAN' && (el.dataset.fs || /em$/.test(el.style.fontSize||''))){
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      return;
    }
    Array.from(el.childNodes).forEach(stripFsInFragment);
  }
  function mergeAdjacentFs(span){
    if (!span || span.nodeType !== 1 || span.tagName !== 'SPAN') return;
    const sizeKey = span.dataset.fs || (span.style.fontSize||'').replace('em','');
    if (!sizeKey) return;

    let prev = span.previousSibling;
    while (prev && isWhitespaceText(prev)) prev = prev.previousSibling;
    if (prev && prev.nodeType===1 && prev.tagName==='SPAN'){
      const prevKey = prev.dataset.fs || (prev.style.fontSize||'').replace('em','');
      if (prevKey === sizeKey){
        while (span.firstChild) prev.appendChild(span.firstChild);
        span.parentNode && span.parentNode.replaceChild(prev, span);
        span = prev;
      }
    }
    let next = span.nextSibling;
    while (next && isWhitespaceText(next)) next = next.nextSibling;
    if (next && next.nodeType===1 && next.tagName==='SPAN'){
      const nextKey = next.dataset.fs || (next.style.fontSize||'').replace('em','');
      if (nextKey === sizeKey){
        while (next.firstChild) span.appendChild(next.firstChild);
        next.parentNode && next.parentNode.removeChild(next);
      }
    }
  }
  function createFsSpanWith(valEm){
    const s = document.createElement('span');
    setSpanSize(s, valEm);
    return s;
  }
  function splitFsWrapperAroundChild(wrap, mid){
    if (!wrap || !mid || !wrap.parentNode) return;
    const parent = wrap.parentNode;
    const base = getSpanSize(wrap) || 1;

    const left  = createFsSpanWith(base);
    const right = createFsSpanWith(base);

    while (wrap.firstChild && wrap.firstChild !== mid){
      left.appendChild(wrap.firstChild);
    }
    if (mid.parentNode === wrap) wrap.removeChild(mid);
    while (wrap.firstChild){
      right.appendChild(wrap.firstChild);
    }

    const ref = wrap.nextSibling;
    parent.removeChild(wrap);
    if (left.childNodes.length)  parent.insertBefore(left,  ref);
    parent.insertBefore(mid,  ref);
    if (right.childNodes.length) parent.insertBefore(right, ref);

    if (left.childNodes.length)  mergeAdjacentFs(left);
    if (right.childNodes.length) mergeAdjacentFs(right);
  }

  function adjustFont(deltaStep){
    const ctx = getActiveStory(); if (!ctx) return false;
    const {story, range} = ctx;

    return EditorCore.keepSelectionAround(story, ()=>{
      const startWrap = findFsWrapper(range.startContainer);
      const endWrap   = findFsWrapper(range.endContainer);

      if (startWrap && startWrap === endWrap){
        const wrap = startWrap;
        const base = getSpanSize(wrap) || 1;

        const fullyCoversWrapper =
          range.startContainer === wrap && range.endContainer === wrap &&
          range.startOffset === 0 && range.endOffset === wrap.childNodes.length;

        if (fullyCoversWrapper){
          setSpanSize(wrap, base + deltaStep);
          mergeAdjacentFs(wrap);
          afterChange(story);
          setSelectionToNodeContents(wrap);
          return true;
        }

        const frag = range.extractContents();
        stripFsInFragment(frag);
        const selSpan = createFsSpanWith(base + deltaStep);
        selSpan.appendChild(frag);
        range.insertNode(selSpan);
        splitFsWrapperAroundChild(wrap, selSpan);

        const prev = selSpan.previousSibling;
        const next = selSpan.nextSibling;
        if (prev && prev.tagName === 'SPAN') mergeAdjacentFs(prev);
        if (next && next.tagName === 'SPAN') mergeAdjacentFs(next);

        afterChange(story);
        setSelectionToNodeContents(selSpan);
        return true;
      }

      let base = getSpanSize(startWrap);
      if (isNaN(base)) base = getSpanSize(endWrap);
      if (isNaN(base)) base = 1.0;

      const frag = range.extractContents();
      stripFsInFragment(frag);

      const span = createFsSpanWith(base + deltaStep);
      span.appendChild(frag);
      range.insertNode(span);

      mergeAdjacentFs(span);
      afterChange(story);
      setSelectionToNodeContents(span);
      return true;
    });
  }

  /* ---------- 綁定 ---------- */
  function bind(){
    const btnB  = document.getElementById('btnBold');
    const btnI  = document.getElementById('btnItalic');
    const btnU  = document.getElementById('btnUnderline');
    const btnUp = document.getElementById('btnFontUp');
    const btnDn = document.getElementById('btnFontDown');

    btnB && btnB.addEventListener('click', ()=> toggleInline('b'));
    btnI && btnI.addEventListener('click', ()=> toggleInline('i'));
    btnU && btnU.addEventListener('click', ()=> toggleInline('u'));
    btnUp && btnUp.addEventListener('click', ()=> adjustFont(+0.1));
    btnDn && btnDn.addEventListener('click', ()=> adjustFont(-0.1));
  }

  document.addEventListener('DOMContentLoaded', bind);
})();
