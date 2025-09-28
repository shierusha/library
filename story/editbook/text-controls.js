/* text-controls.js
 * 文字工具列：B / I / U / A+ / A-
 * - 只作用目前頁（EditorCore.getFocusedDbIndex）
 * - 只作用反白區段；保持選取（不會跳到第一字）
 * - A+ / A-：只包「一層」 <span data-fs style="font-size:...em">；連按持續累加；部分選取會切段只改選取
 * - B/I/U：部分選取只套未套用；全選已套用則取消；合併相鄰、清空殼
 * - 每次操作後：寫回 DB + 觸發 PasteFlow.forceReflow(story)
 */
(function(){

  /* ---------- 公用 ---------- */
  const clamp = (v,min,max)=> Math.max(min, Math.min(max, v));

  // 判斷是否為我們的字級 span
  function isOurFsSpan(el){
    return el && el.tagName === 'SPAN' &&
           (el.dataset.fs || /em$/.test((el.style && el.style.fontSize) || ''));
  }
  // 文字節點是否只含空白（含 NBSP）
  function isWhitespaceText(n){
    return n && n.nodeType === 3 &&
           !String(n.nodeValue||'').replace(/\u00a0/g,' ').trim();
  }

  // 清掃：移除沒有內容的 b/i/u 與空的字級 span（避免越按越累積空殼）
  function sweepInlineGarbage(root){
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    const trash = [];

    while (walker.nextNode()){
      const el = walker.currentNode;
      if (!el || el === root) continue;
      if (el.getAttribute && el.getAttribute('data-caret') === '1') continue;

      const tag = el.tagName;
      const isInline = /^(B|I|U|EM|STRONG|S|SMALL|MARK|SUB|SUP|SPAN)$/i.test(tag);
      if (!isInline) continue;
      if (tag === 'SPAN' && !isOurFsSpan(el)) continue; // 只處理我們的 fs-span

      const text = (el.textContent || '').replace(/\u00a0/g,' ').trim();
      const onlyBr = el.children.length === 1 &&
                     el.firstElementChild && el.firstElementChild.tagName === 'BR' &&
                     text === '';
      const noText = text === '';

      if (onlyBr || noText){
        trash.push(el);
      }
    }

    trash.forEach(el=>{
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild){
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
    });
  }

  function getActiveStory(){
    const dbIndex = EditorCore.getFocusedDbIndex();
    if (!dbIndex) return null;
    const story = EditorCore.getStoryByDbIndex(dbIndex);
    if (!story) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount===0) return null;
    const rng = sel.getRangeAt(0);
    if (!story.contains(rng.startContainer)) return null;
    if (rng.collapsed) return null;
    return {story, range:rng, dbIndex};
  }

  function afterChange(story){
    // 清掉空 b/i/u 與空的字級 span，避免殘留
    sweepInlineGarbage(story);

    const db = Number(story.dataset.dbIndex||'0')|0;
    EditorCore.updatePageJsonFromStory(db, story);
    if (window.PasteFlow && typeof window.PasteFlow.forceReflow === 'function') {
      window.PasteFlow.forceReflow(story);
    } else {
      story.dispatchEvent(new Event('input', { bubbles:true }));
    }
  }

  /* ---------- B / I / U：部分選取只套未套用；全選已套用則取消 ---------- */

  // 檢查 fragment 內「所有非空白文字節點」是否都在指定標籤內（例：B/I/U）
  function allTextInsideTag(root, TAG){
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
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
    return hasText ? true : false; // 沒文字則視為「不是全在」
  }

  // 把 fragment 裡 **未在 TAG 內** 的文字節點包一層 TAG
  function applyTagToUnstyledTextInFragment(root, TAG){
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const targets = [];
    while (tw.nextNode()){
      const t = tw.currentNode;
      if (isWhitespaceText(t)) continue;

      // 判斷 t 在 fragment 內是否已有 TAG 祖先
      let cur = t.parentElement, covered = false;
      while (cur && cur !== root){
        if (cur.tagName === TAG) { covered = true; break; }
        cur = cur.parentElement;
      }
      if (!covered) targets.push(t);
    }

    // 分別包起來（之後再做相鄰合併）
    targets.forEach(t=>{
      const wrap = document.createElement(TAG);
      const p = t.parentNode;
      if (!p) return;
      p.insertBefore(wrap, t);
      wrap.appendChild(t);
    });

    // 合併 fragment 內相鄰同 TAG
    mergeAdjacentTagsInFragment(root, TAG);
  }

  // 在 fragment 內把所有 TAG 拆掉（僅限 fragment 範圍）
  function unwrapTagDeep(root, TAG){
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (el)=> (el.tagName === TAG ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
    });
    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);
    targets.forEach(el=>{
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
  }

  // 合併相鄰同標籤（<b>..</b><b>..</b> → <b>....</b>）
  function mergeAdjacentTagAround(node, TAG){
    if (!node) return;
    const el = (node.nodeType===1) ? node : node.parentElement;
    if (!el || !el.parentNode) return;

    // 向左
    let prev = el.previousSibling;
    while (prev && isWhitespaceText(prev)) prev = prev.previousSibling;
    if (prev && prev.nodeType===1 && prev.tagName === TAG && el.tagName === TAG){
      while (el.firstChild) prev.appendChild(el.firstChild);
      el.parentNode && el.parentNode.replaceChild(prev, el);
    }

    // 基準點
    const base = (prev && prev.tagName===TAG) ? prev : el;

    // 向右
    let next = base.nextSibling;
    while (next && isWhitespaceText(next)) next = next.nextSibling;
    if (next && next.nodeType===1 && next.tagName === TAG){
      while (next.firstChild) base.appendChild(next.firstChild);
      next.parentNode && next.parentNode.removeChild(next);
    }
  }

  // 在 fragment 內遍歷所有 TAG，嘗試與左右鄰近 TAG 合併
  function mergeAdjacentTagsInFragment(root, TAG){
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
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

      // 用臨時容器包住 fragment，便於與外側節點做左右合併
      const container = document.createElement('span');
      container.setAttribute('data-tmp','1');

      if (allInside){
        // 整段都已套用 → 取消（只在選取範圍內拆掉）
        unwrapTagDeep(frag, TAG);
        container.appendChild(frag);
      } else {
        // 部分未套用 → 只對「未套用」的文字節點加 TAG，不動已套用者
        applyTagToUnstyledTextInFragment(frag, TAG);
        container.appendChild(frag);
      }

      // 插回原位置
      range.insertNode(container);

      // 把容器內的第一/最後一個符合 TAG 的元素，與容器外側相鄰同 TAG 合併
      const firstEl = container.firstElementChild;
      const lastEl  = container.lastElementChild;
      if (firstEl && firstEl.tagName === TAG) mergeAdjacentTagAround(firstEl, TAG);
      if (lastEl  && lastEl.tagName  === TAG) mergeAdjacentTagAround(lastEl, TAG);

      // 解除臨時容器
      const parent = container.parentNode;
      while (container.firstChild) parent.insertBefore(container.firstChild, container);
      parent.removeChild(container);

      afterChange(story);
      return true;
    });
  }

  /* ---------- A+ / A-：只調整選取；若選取只在同一個 fs-span 內則切段 ---------- */
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

    // 合併左：忽略純空白文字節點
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
    // 合併右：忽略純空白文字節點
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

  // 幫手：建立一個 data-fs span
  function createFsSpanWith(valEm){
    const s = document.createElement('span');
    setSpanSize(s, valEm);
    return s;
  }

  // 幫手：把同一個 data-fs wrapper（wrap）切成 [左] [mid] [右] 三段
  // 讓 mid（通常是新插入的選取段）從 wrap 裡「脫出」到與 wrap 同層，避免字級相乘
  function splitFsWrapperAroundChild(wrap, mid){
    if (!wrap || !mid || !wrap.parentNode) return;
    const parent = wrap.parentNode;
    const base = getSpanSize(wrap) || 1;

    const left  = createFsSpanWith(base);
    const right = createFsSpanWith(base);

    // 把 mid 左邊的節點移到 left
    while (wrap.firstChild && wrap.firstChild !== mid){
      left.appendChild(wrap.firstChild);
    }

    // 把 mid 自 wrap 中取出（若 mid 現在就在 wrap 內）
    if (mid.parentNode === wrap) wrap.removeChild(mid);

    // 把剩餘節點移到 right
    while (wrap.firstChild){
      right.appendChild(wrap.firstChild);
    }

    // 用 [left?][mid][right?] 取代原 wrap
    const ref = wrap.nextSibling;
    parent.removeChild(wrap);
    if (left.childNodes.length)  parent.insertBefore(left,  ref);
    parent.insertBefore(mid,  ref);
    if (right.childNodes.length) parent.insertBefore(right, ref);

    // 合併相鄰 data-fs，避免碎片
    if (left.childNodes.length)  mergeAdjacentFs(left);
    if (right.childNodes.length) mergeAdjacentFs(right);
  }

  function adjustFont(deltaStep){
    const ctx = getActiveStory(); if (!ctx) return false;
    const {story, range} = ctx;

    return EditorCore.keepSelectionAround(story, ()=>{
      const startWrap = findFsWrapper(range.startContainer);
      const endWrap   = findFsWrapper(range.endContainer);

      // 若選取完全在同一個 data-fs 內
      if (startWrap && startWrap === endWrap){
        const wrap = startWrap;
        const base = getSpanSize(wrap) || 1;

        // 是否剛好選到整個 wrapper 的全部內容
        const fullyCoversWrapper =
          range.startContainer === wrap && range.endContainer === wrap &&
          range.startOffset === 0 && range.endOffset === wrap.childNodes.length;

        if (fullyCoversWrapper){
          // 整個 wrapper 同步放大/縮小
          setSpanSize(wrap, base + deltaStep);
          mergeAdjacentFs(wrap);
          afterChange(story);
          return true;
        }

        // 只選到 wrapper 的一部分：抽出選取 → 只調整該段 → 把 wrapper 切成三段
        const frag = range.extractContents();
        stripFsInFragment(frag); // 先扁平化內部 fs，避免層層相乘

        const selSpan = createFsSpanWith(base + deltaStep);
        selSpan.appendChild(frag);

        // 先插回（仍在 wrap 裡），再把 wrap 切成 [左][selSpan][右]
        range.insertNode(selSpan);
        splitFsWrapperAroundChild(wrap, selSpan);

        // 兩側若出現相同大小的 fs 可再合併
        const prev = selSpan.previousSibling;
        const next = selSpan.nextSibling;
        if (prev && prev.tagName === 'SPAN') mergeAdjacentFs(prev);
        if (next && next.tagName === 'SPAN') mergeAdjacentFs(next);

        afterChange(story);
        return true;
      }

      // 否則（跨多個 fs-span 或沒有 fs-span）：
      // 取端點附近已存在的 data-fs 當基準，沒有就 1.0
      let base = getSpanSize(startWrap);
      if (isNaN(base)) base = getSpanSize(endWrap);
      if (isNaN(base)) base = 1.0;

      // 把選取抽出，扁平化裡面所有 data-fs，然後用一層新的包回
      const frag = range.extractContents();
      stripFsInFragment(frag);

      const span = createFsSpanWith(base + deltaStep);
      span.appendChild(frag);
      range.insertNode(span);

      mergeAdjacentFs(span);
      afterChange(story);
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

    // 步進 0.1em（連按可持續放大/縮小）
    btnUp && btnUp.addEventListener('click', ()=> adjustFont(+0.1));
    btnDn && btnDn.addEventListener('click', ()=> adjustFont(-0.1));
  }

  document.addEventListener('DOMContentLoaded', bind);
})();
