/* text-controls.js
 * 文字工具列：B / I / U / A+ / A-
 * - 部分選取：只作用未套用區；已套用處不重複包
 * - 全選皆已套用：只在選取範圍內取消（unwrap）
 * - 合併相鄰同義標籤：B/STRONG、I/EM、U
 * - A+ / A-：只包一層 <span data-fs style="font-size:...em">；可只調整選取段（會切三段）
 * - 每次操作後：寫回 DB + 觸發 PasteFlow.forceReflow(story)
 */
(function(){

  /* ---------- 公用 ---------- */
  const clamp = (v,min,max)=> Math.max(min, Math.min(max, v));

  // 同義群組定義
  const GROUPS = {
    B: { canonical:'B', all:['B','STRONG'] },
    I: { canonical:'I', all:['I','EM']     },
    U: { canonical:'U', all:['U']          },
  };
  function getGroupForTAG(TAG){
    const t = String(TAG||'').toUpperCase();
    return GROUPS[t] || { canonical:t, all:[t] };
  }
  function isInGroup(tagName, group){
    return group.all.includes(String(tagName||'').toUpperCase());
  }
  function ensureCanonicalTag(el, group){
    if (!el || el.nodeType!==1) return el;
    if (el.tagName === group.canonical) return el;
    const canon = document.createElement(group.canonical);
    while (el.firstChild) canon.appendChild(el.firstChild);
    el.parentNode && el.parentNode.replaceChild(canon, el);
    return canon;
  }

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

  // 清掃：移除沒有內容的 b/i/u(含同義) 與空的字級 span
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
      while (el.firstChild){ parent.insertBefore(el.firstChild, el); }
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
    sweepInlineGarbage(story);
    const db = Number(story.dataset.dbIndex||'0')|0;
    EditorCore.updatePageJsonFromStory(db, story);
    if (window.PasteFlow?.forceReflow) window.PasteFlow.forceReflow(story);
    else story.dispatchEvent(new Event('input', { bubbles:true }));
  }

  /* ---------- B / I / U：部分選取只套未套用；全選已套用則取消 ---------- */

  // 檢查 fragment 內「所有非空白文字節點」是否都在指定群組內
  function allTextInsideGroup(root, group){
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let hasText = false;
    while (tw.nextNode()){
      const t = tw.currentNode;
      if (isWhitespaceText(t)) continue;
      hasText = true;
      let cur = t.parentElement, ok = false;
      while (cur && cur !== root){
        if (isInGroup(cur.tagName, group)) { ok = true; break; }
        cur = cur.parentElement;
      }
      if (!ok) return false;
    }
    return hasText ? true : false;
  }

  // 在 fragment 中，把 **未在群組內** 的文字節點包一層 canonical tag
  function applyGroupToUnstyledTextInFragment(root, group){
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const targets = [];
    while (tw.nextNode()){
      const t = tw.currentNode;
      if (isWhitespaceText(t)) continue;

      let cur = t.parentElement, covered = false;
      while (cur && cur !== root){
        if (isInGroup(cur.tagName, group)) { covered = true; break; }
        cur = cur.parentElement;
      }
      if (!covered) targets.push(t);
    }

    targets.forEach(t=>{
      const wrap = document.createElement(group.canonical);
      const p = t.parentNode; if (!p) return;
      p.insertBefore(wrap, t);
      wrap.appendChild(t);
    });

    mergeAdjacentGroupTagsInFragment(root, group);
  }

  // 把 fragment 中的群組標籤移除（僅限 fragment 範圍）
  function unwrapGroupDeep(root, group){
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    const targets = [];
    while (walker.nextNode()){
      const el = walker.currentNode;
      if (isInGroup(el.tagName, group)) targets.push(el);
    }
    targets.forEach(el=>{
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
  }

  // 合併相鄰同義標籤（例：<strong>…</strong><b>…</b> → <b>…</b>）
  function mergeAdjacentGroupAround(node, group){
    if (!node || !node.parentNode) return;
    let el = (node.nodeType===1) ? node : node.parentElement;
    if (!el) return;
    el = ensureCanonicalTag(el, group);

    // 向左
    let prev = el.previousSibling;
    while (prev && isWhitespaceText(prev)) prev = prev.previousSibling;
    if (prev && prev.nodeType===1 && isInGroup(prev.tagName, group)){
      prev = ensureCanonicalTag(prev, group);
      while (el.firstChild) prev.appendChild(el.firstChild);
      el.parentNode && el.parentNode.replaceChild(prev, el);
      el = prev;
    }

    // 向右
    let next = el.nextSibling;
    while (next && isWhitespaceText(next)) next = next.nextSibling;
    if (next && next.nodeType===1 && isInGroup(next.tagName, group)){
      next = ensureCanonicalTag(next, group);
      while (next.firstChild) el.appendChild(next.firstChild);
      next.parentNode && next.parentNode.removeChild(next);
    }
  }

  function mergeAdjacentGroupTagsInFragment(root, group){
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    const list = [];
    while (walker.nextNode()){
      const el = walker.currentNode;
      if (isInGroup(el.tagName, group)) list.push(el);
    }
    list.forEach(el=> mergeAdjacentGroupAround(el, group));
  }

  // 找出 fragment 內「最左/最右」的頂層群組標籤
  function findEdgeGroupTagsInFragment(root, group){
    let firstTag = null, lastTag = null;
    for (let i=0;i<root.childNodes.length;i++){
      const n = root.childNodes[i];
      if (n.nodeType===1 && isInGroup(n.tagName, group)){ firstTag = n; break; }
    }
    for (let i=root.childNodes.length-1;i>=0;i--){
      const n = root.childNodes[i];
      if (n.nodeType===1 && isInGroup(n.tagName, group)){ lastTag = n; break; }
    }
    return { firstTag, lastTag };
  }

  function toggleInline(tag){
    const group = getGroupForTAG(tag);
    const ctx = getActiveStory(); if (!ctx) return false;
    const {story, range} = ctx;

    return EditorCore.keepSelectionAround(story, ()=>{
      const frag = range.extractContents();
      const allInside = allTextInsideGroup(frag, group);

      if (allInside){
        // 整段都已套用 → 取消（只在選取範圍內拆掉）
        unwrapGroupDeep(frag, group);
        range.insertNode(frag);
      } else {
        // 部分未套用 → 只對「未套用」的文字節點加 canonical tag，不動已套用者
        applyGroupToUnstyledTextInFragment(frag, group);
        const { firstTag, lastTag } = findEdgeGroupTagsInFragment(frag, group);
        range.insertNode(frag);

        // 邊界與外側同義合併，並統一為 canonical
        if (firstTag) mergeAdjacentGroupAround(firstTag, group);
        if (lastTag && lastTag !== firstTag) mergeAdjacentGroupAround(lastTag, group);
      }

      afterChange(story);
      return true;
    });
  }

  /* ---------- A+ / A-：只調整選取；若在同一 fs-span 內則切段 ---------- */
  function parseEm(str){ const m = String(str||'').match(/([0-9.]+)\s*em$/i); return m ? parseFloat(m[1]) : NaN; }
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
      if (cur.tagName === 'SPAN' && (cur.dataset.fs || /em$/.test(cur.style.fontSize||''))) return cur;
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

    // 左
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
    // 右
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

    while (wrap.firstChild && wrap.firstChild !== mid){ left.appendChild(wrap.firstChild); }
    if (mid.parentNode === wrap) wrap.removeChild(mid);
    while (wrap.firstChild){ right.appendChild(wrap.firstChild); }

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
