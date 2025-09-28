
/* 928text-controls.js — FS boundary-safe A+/A-, selection-only (no spillover), with B/I/U fixed
 * 改善點：
 * 1) 在選取兩端插入「邊界註解節點」(<!--fs-boundary-->)，包裝/合併時絕不跨越邊界
 * 2) A+/A- 僅變更反白選取，後面的文字不會被一併放大（避免越界合併）
 * 3) 一位小數的字級（避免 1.2000000002），相鄰同字級合併且不穿越邊界
 * 4) 不產生空 data-fs；游標狀態時會擴到「一個字詞」再調整
 *
 * 依賴：EditorCore.getFocusedDbIndex / getStoryByDbIndex / keepSelectionAround / updatePageJsonFromStory
 */
(function(){
  if (!window.EditorCore) return;

  /* ===== Helpers ===== */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round1 = (v) => Math.round(v * 10) / 10;
  const BOUNDARY_TOKEN = 'fs-boundary';

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

  /* ===== B/I/U (同上版) ===== */
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
    root.querySelectorAll("strong").forEach(n => replaceTag(n, "b"));
    root.querySelectorAll("em").forEach(n => replaceTag(n, "i"));
    ["b","i","u"].forEach(tag=>{
      Array.from(root.querySelectorAll(tag)).forEach(el=>{
        let hasRenderable = false;
        for (let n=el.firstChild;n;n=n.nextSibling){
          if (n.nodeType===3 && (n.nodeValue||"").replace(/\u00a0/g,' ').trim()){ hasRenderable=true; break; }
          if (n.nodeType===1 && n.tagName==='BR'){ hasRenderable=true; break; }
        }
        if (!hasRenderable) unwrap(el);
      });
    });
    ["b","i","u"].forEach(tag=>{
      let changed=true;
      while(changed){
        changed=false;
        root.querySelectorAll(tag).forEach(el=>{
          const p=el.parentElement;
          if (p && p.tagName.toLowerCase()===tag){ unwrap(el); changed=true; }
        });
      }
    });
    ["b","i","u"].forEach(tag=>{
      Array.from(root.querySelectorAll(tag)).forEach(el=>{
        let next = el.nextSibling;
        while (next && next.nodeType===3 && !(next.nodeValue||"").trim()) next = next.nextSibling;
        if (next && next.nodeType===1 && next.tagName.toLowerCase()===tag){
          while(next.firstChild) el.appendChild(next.firstChild);
          next.remove();
        }
      });
    });
  }
  function toggleCommand(cmd){
    const ctx = getStoryAndRange(true);
    if (!ctx) return false;
    const {story} = ctx;
    return EditorCore.keepSelectionAround(story, ()=>{
      document.execCommand(cmd,false);
      sanitizeInlineBUI(story);
      afterChange(story);
      return true;
    });
  }
  function onBold(){ return toggleCommand("bold"); }
  function onItalic(){ return toggleCommand("italic"); }
  function onUnderline(){ return toggleCommand("underline"); }

  /* ===== FS utilities ===== */
  function parseEm(str){
    if (!str) return NaN;
    const m = String(str).match(/([0-9.]+)\s*em$/i);
    return m ? parseFloat(m[1]) : NaN;
  }
  function isFsSpan(el){
    return el && el.nodeType===1 && el.tagName==='SPAN' && (el.dataset.fs || /em$/.test(el.style.fontSize||''));
  }
  function getSpanSize(span){
    if (!span) return NaN;
    if (span.dataset.fs) return parseFloat(span.dataset.fs);
    const p = parseEm(span.style.fontSize);
    return isNaN(p) ? NaN : p;
  }
  function setSpanSize(span, valEm){
    const fs = clamp(round1(valEm), 0.2, 5.0);
    span.dataset.fs = String(fs);
    span.style.fontSize = (Math.round(fs*10)/10).toFixed(1).replace(/\.0$/,'') + 'em';
  }
  function normalizeFsSpan(el){
    if (!isFsSpan(el)) return;
    if (!el.dataset.fs){
      const v = parseEm(el.style.fontSize);
      if (!isNaN(v)) setSpanSize(el, v);
    }else{
      setSpanSize(el, parseFloat(el.dataset.fs));
    }
    // remove if empty
    if (!hasRenderableContent(el)) unwrap(el);
  }
  function hasRenderableContent(el){
    let tw = document.createTreeWalker(el, NodeFilter.SHOW_ALL, null);
    while (tw.nextNode()){
      const n = tw.currentNode;
      if (n.nodeType===3 && (n.nodeValue||"").replace(/\u00a0/g,' ').trim()) return true;
      if (n.nodeType===1 && n.tagName==='BR') return true;
    }
    return false;
  }

  function isBoundaryNode(n){
    return n && n.nodeType === 8 && String(n.nodeValue||'').indexOf(BOUNDARY_TOKEN) >= 0;
  }
  function nextSiblingSkipWSStopBoundary(n){
    let s = n && n.nextSibling;
    while (s){
      if (s.nodeType===8 && isBoundaryNode(s)) return null; // hit boundary → stop
      if (s.nodeType===3 && !(s.nodeValue||'').trim()){ s = s.nextSibling; continue; }
      return s;
    }
    return null;
  }
  function prevSiblingSkipWSStopBoundary(n){
    let s = n && n.previousSibling;
    while (s){
      if (s.nodeType===8 && isBoundaryNode(s)) return null; // hit boundary → stop
      if (s.nodeType===3 && !(s.nodeValue||'').trim()){ s = s.previousSibling; continue; }
      return s;
    }
    return null;
  }

  function mergeAdjacentFs(root){
    const spans = Array.from(root.querySelectorAll('span[data-fs], span[style*="font-size"]'));
    spans.forEach(normalizeFsSpan);

    Array.from(root.querySelectorAll('span[data-fs]')).forEach(span=>{
      if (!span.isConnected) return;
      const key = span.dataset.fs;

      // LEFT merge if no boundary in-between
      const left = prevSiblingSkipWSStopBoundary(span);
      if (left && left.nodeType===1 && left.tagName==='SPAN' && isFsSpan(left)){
        normalizeFsSpan(left);
        if (left.dataset.fs === key){
          while (span.firstChild) left.appendChild(span.firstChild);
          span.replaceWith(left);
          span = left;
        }
      }
      // RIGHT merge if no boundary in-between
      const right = nextSiblingSkipWSStopBoundary(span);
      if (right && right.nodeType===1 && right.tagName==='SPAN' && isFsSpan(right)){
        normalizeFsSpan(right);
        if (right.dataset.fs === key){
          while (right.firstChild) span.appendChild(right.firstChild);
          right.remove();
        }
      }
    });
  }

  function stripFsInFragment(node){
    if (!node) return;
    if (node.nodeType!==1){ Array.from(node.childNodes).forEach(stripFsInFragment); return; }
    const el = node;
    if (isFsSpan(el)){
      const p = el.parentNode;
      while (el.firstChild) p.insertBefore(el.firstChild, el);
      p.removeChild(el);
      return;
    }
    Array.from(el.childNodes).forEach(stripFsInFragment);
  }

  function expandRangeToWord(range){
    const node = range.startContainer;
    if (!node || node.nodeType!==3) return false;
    const text = node.nodeValue, i = range.startOffset;
    let L=i, R=i;
    const isWord = c => /[^\s.,;:!?()\[\]{}"'\u3000\u3001\u3002]/.test(c||"");
    while (L>0 && isWord(text[L-1])) L--;
    while (R<text.length && isWord(text[R])) R++;
    if (L===R) return false;
    const sel = window.getSelection();
    range.setStart(node, L);
    range.setEnd(node, R);
    sel.removeAllRanges(); sel.addRange(range);
    return true;
  }

  function placeBoundaryMarkers(range){
    // Insert end then start to avoid offset shift
    const endMarker = document.createComment(BOUNDARY_TOKEN);
    const endRange = range.cloneRange();
    endRange.collapse(false);
    endRange.insertNode(endMarker);

    const startMarker = document.createComment(BOUNDARY_TOKEN);
    const startRange = range.cloneRange();
    startRange.collapse(true);
    startRange.insertNode(startMarker);

    return { startMarker, endMarker };
  }

  function removeBoundaryMarkers(markers){
    if (!markers) return;
    const { startMarker, endMarker } = markers;
    if (startMarker && startMarker.parentNode) startMarker.parentNode.removeChild(startMarker);
    if (endMarker && endMarker.parentNode) endMarker.parentNode.removeChild(endMarker);
  }

  /* ===== A+/A- main ===== */
  function adjustFont(deltaStep){
    let ctx = getStoryAndRange(false);
    if (!ctx){
      ctx = getStoryAndRange(true);
      if (!ctx) return false;
      const { range } = ctx;
      const wrap = findFsWrapper(range.startContainer);
      if (!wrap){
        const ok = expandRangeToWord(range);
        if (!ok) return false;
      }
    }
    const { story, range } = ctx;

    return EditorCore.keepSelectionAround(story, ()=>{
      // Put boundary markers so merge never crosses selection ends
      const markers = placeBoundaryMarkers(range);

      // Build an innerRange from start->end markers
      const inner = document.createRange();
      inner.setStartAfter(markers.startMarker);
      inner.setEndBefore(markers.endMarker);

      const startWrap = findFsWrapper(inner.startContainer);
      const endWrap   = findFsWrapper(inner.endContainer);

      // Same wrapper case
      if (startWrap && startWrap === endWrap){
        const cur = getSpanSize(startWrap) || 1.0;
        setSpanSize(startWrap, cur + deltaStep);
        // Keep markers to block cross-boundary merge, then cleanup
        mergeAdjacentFs(story);
        removeBoundaryMarkers(markers);
        afterChange(story);
        return true;
      }

      // Multi-run selection
      const baseA = getSpanSize(startWrap);
      const baseB = getSpanSize(endWrap);
      const base = !isNaN(baseA) ? baseA : (!isNaN(baseB) ? baseB : 1.0);

      const frag = inner.extractContents();
      stripFsInFragment(frag);
      if (!frag.hasChildNodes()){
        removeBoundaryMarkers(markers);
        return false;
      }
      const span = document.createElement('span');
      setSpanSize(span, base + deltaStep);
      span.appendChild(frag);
      inner.insertNode(span);

      // 邊界仍在新 span 左右 → 合併時不會越界
      mergeAdjacentFs(story);
      removeBoundaryMarkers(markers);
      afterChange(story);
      return true;
    });
  }

  /* Helper: find FS wrapper from node (used before definition) */
  function findFsWrapper(node){
    let cur = (node && node.nodeType===1) ? node : (node ? node.parentElement : null);
    while(cur && cur!==document){
      if (isFsSpan(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  /* ===== Bindings ===== */
  function bindButtons(){
    const btnB = document.getElementById("btnBold");
    const btnI = document.getElementById("btnItalic");
    const btnU = document.getElementById("btnUnderline");
    const btnUp= document.getElementById("btnFontUp");
    const btnDn= document.getElementById("btnFontDown");

    btnB && btnB.addEventListener("click", ()=>toggleCommand("bold"));
    btnI && btnI.addEventListener("click", ()=>toggleCommand("italic"));
    btnU && btnU.addEventListener("click", ()=>toggleCommand("underline"));
    btnUp&& btnUp.addEventListener("click", ()=>adjustFont(+0.1));
    btnDn&& btnDn.addEventListener("click", ()=>adjustFont(-0.1));
  }
  function bindShortcuts(){
    document.addEventListener("keydown", (e)=>{
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (e.key==='b'||e.key==='B'){ e.preventDefault(); toggleCommand("bold"); }
      if (e.key==='i'||e.key==='I'){ e.preventDefault(); toggleCommand("italic"); }
      if (e.key==='u'||e.key==='U'){ e.preventDefault(); toggleCommand("underline"); }
      if (e.key==='='||e.key==='+'){ e.preventDefault(); adjustFont(+0.1); }
      if (e.key==='-'){ e.preventDefault(); adjustFont(-0.1); }
    });
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    bindButtons();
    bindShortcuts();
  });
})();
