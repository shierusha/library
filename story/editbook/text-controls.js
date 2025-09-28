/* text-controls.js — selection-only styling without wrapper spam
 * 功能：A+ / A- / B / I / U
 * 特色：
 *  - 只作用「反白區段」；不影響整段
 *  - 不產生一堆 <b><i><u> 或 <span> 巢狀；統一用一層 <span data-run>
 *  - 同樣支援你既有的自動分頁流程（更新 DB + 觸發 PasteFlow.forceReflow）
 *  - 會合併左右相鄰且樣式相同的 run，保持乾淨 DOM
 */
(function(){
  if (!window.EditorCore) return;

  /* ===================== 小工具 ===================== */
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const MARK_TAGS = new Set(['B','STRONG','I','EM','U']);

  function afterChange(story){
    const db = Number(story.dataset.dbIndex||'0')|0;
    try { EditorCore.updatePageJsonFromStory(db, story); } catch(_){}
    try {
      if (window.PasteFlow && typeof window.PasteFlow.forceReflow === 'function') {
        window.PasteFlow.forceReflow(story);
      } else {
        story.dispatchEvent(new Event('input', {bubbles:true}));
      }
    } catch(_){}
  }

  function getActiveStoryRange(){
    const dbIndex = EditorCore.getFocusedDbIndex();
    if (!dbIndex) return null;
    const story = EditorCore.getStoryByDbIndex(dbIndex);
    if (!story) return null;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const rng = sel.getRangeAt(0);
    if (!story.contains(rng.startContainer)) return null;
    return {story, range:rng, dbIndex};
  }

  function splitTextNodeAt(node, offset){
    if (!node || node.nodeType !== 3) return node;
    if (offset <= 0 || offset >= node.nodeValue.length) return node;
    return node.splitText(offset);
  }

  function normalizeRangeBoundaries(range){
    // 確保邊界切在 textNode 上，避免半截處理
    if (range.startContainer.nodeType === 3){
      splitTextNodeAt(range.startContainer, range.startOffset);
    } else {
      const sc = range.startContainer.childNodes[range.startOffset] || null;
      if (sc && sc.nodeType === 3) splitTextNodeAt(sc, 0);
    }
    if (range.endContainer.nodeType === 3){
      splitTextNodeAt(range.endContainer, range.endOffset);
    } else {
      const ec = range.endContainer.childNodes[range.endOffset-1] || null;
      if (ec && ec.nodeType === 3) splitTextNodeAt(ec, ec.nodeValue.length);
    }
  }

  function getTextNodesInRange(story, range){
    const list = [];
    const tw = document.createTreeWalker(story, NodeFilter.SHOW_TEXT, {
      acceptNode(node){
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        // 節點是否與選取相交
        try {
          if (typeof range.intersectsNode === 'function'){
            return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        } catch(_){}
        // 後備：用一個臨時區段檢測
        const r = document.createRange();
        r.selectNodeContents(node);
        const ok = !(range.compareBoundaryPoints(Range.END_TO_START, r) >= 0 ||
                     range.compareBoundaryPoints(Range.START_TO_END, r) <= 0);
        r.detach && r.detach();
        return ok ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let n;
    while ((n = tw.nextNode())) list.push(n);
    return list;
  }

  function ensureRunSpanFor(node){
    const p = node.parentElement;
    if (p && p.tagName === 'SPAN' && p.dataset && p.dataset.run === '1') return p;
    // 建立單層 run 包裹
    const span = document.createElement('span');
    span.dataset.run = '1';
    p ? p.replaceChild(span, node) : node.parentNode.replaceChild(span, node);
    span.appendChild(node);
    return span;
  }

  function readRunStyle(span){
    const st = span.style;
    const w = (st.fontWeight || '').toLowerCase();
    const it = (st.fontStyle || '').toLowerCase();
    const deco = (st.textDecoration || '').toLowerCase();
    const fs = (st.fontSize || '').trim();
    let em = 1;
    if (fs.endsWith('em')) {
      const n = parseFloat(fs);
      if (!Number.isNaN(n)) em = n;
    }
    return {
      bold: (w === 'bold' || parseInt(w,10) >= 600),
      italic: (it === 'italic'),
      underline: (deco.includes('underline')),
      sizeEm: em
    };
  }

  function writeRunStyle(span, st){
    span.style.fontWeight = st.bold ? 'bold' : '';
    span.style.fontStyle = st.italic ? 'italic' : '';
    span.style.textDecoration = st.underline ? 'underline' : '';
    span.style.fontSize = (st.sizeEm ? clamp(st.sizeEm, 0.2, 5) : 1).toFixed(2).replace(/\.00$/, '') + 'em';
  }

  function sameStyle(a, b){
    return a.bold===b.bold && a.italic===b.italic &&
           a.underline===b.underline && Math.abs(a.sizeEm-b.sizeEm) < 1e-6;
  }

  function mergeAdjacentRuns(span){
    if (!span || span.tagName !== 'SPAN' || span.dataset.run !== '1') return;
    const st = readRunStyle(span);

    // merge left
    let prev = span.previousSibling;
    while (prev && prev.nodeType === 3 && !prev.nodeValue) prev = prev.previousSibling;
    if (prev && prev.nodeType === 1 && prev.tagName === 'SPAN' && prev.dataset.run === '1'){
      if (sameStyle(st, readRunStyle(prev))){
        while (span.firstChild) prev.appendChild(span.firstChild);
        span.parentNode && span.parentNode.replaceChild(prev, span);
        span = prev;
      }
    }
    // merge right
    let next = span.nextSibling;
    while (next && next.nodeType === 3 && !next.nodeValue) next = next.nextSibling;
    if (next && next.nodeType === 1 && next.tagName === 'SPAN' && next.dataset.run === '1'){
      if (sameStyle(st, readRunStyle(next))){
        while (next.firstChild) span.appendChild(next.firstChild);
        next.remove();
      }
    }
  }

  function computeMarkPresence(range, story, kind){
    const nodes = getTextNodesInRange(story, range);
    if (nodes.length === 0) return {all:false, any:false};
    let any=false, all=true;
    for (const n of nodes){
      // 讀取有效樣式（包含祖先標籤的影響）
      let has=false;
      // 先看最近 run style
      const span = (n.parentElement && n.parentElement.tagName === 'SPAN' && n.parentElement.dataset.run==='1') ? n.parentElement : null;
      const local = span ? readRunStyle(span) : null;
      if (kind==='bold')      has = local ? local.bold : false;
      if (kind==='italic')    has = local ? local.italic : false;
      if (kind==='underline') has = local ? local.underline : false;
      // 若本地無標記，也看祖先（舊 DOM 可能有 <b>/<i>/<u>）
      if (!has){
        let cur = n.parentElement;
        while (cur && cur!==story){
          const tag = cur.tagName;
          if (kind==='bold'      && (tag==='B'||tag==='STRONG')) { has=true; break; }
          if (kind==='italic'    && (tag==='I'||tag==='EM'))     { has=true; break; }
          if (kind==='underline' && tag==='U')                   { has=true; break; }
          cur = cur.parentElement;
        }
      }
      any = any || has;
      all = all && has;
    }
    return {any, all};
  }

  function toggleMark(kind){
    const ctx = getActiveStoryRange(); if (!ctx) return;
    const {story, range} = ctx;
    if (range.collapsed) return;

    EditorCore.keepSelectionAround(story, ()=>{
      normalizeRangeBoundaries(range);
      const nodes = getTextNodesInRange(story, range);
      if (nodes.length === 0) return;

      const {all} = computeMarkPresence(range, story, kind);
      const enable = !all; // 如果全部都有 → 取消；否則 → 套用

      for (const n of nodes){
        const run = ensureRunSpanFor(n);
        const st = readRunStyle(run);
        if (kind==='bold')      st.bold = enable;
        if (kind==='italic')    st.italic = enable;
        if (kind==='underline') st.underline = enable;
        writeRunStyle(run, st);
        mergeAdjacentRuns(run);
      }

      // 不主動拆解舊 <b>/<i>/<u>，但本地 style 會覆蓋祖先效果；避免破壞選區外樣式
      afterChange(story);
    });
  }

  function adjustFont(deltaEm){
    const ctx = getActiveStoryRange(); if (!ctx) return;
    const {story, range} = ctx;
    if (range.collapsed) return;

    EditorCore.keepSelectionAround(story, ()=>{
      normalizeRangeBoundaries(range);
      const nodes = getTextNodesInRange(story, range);
      if (nodes.length === 0) return;

      // 以選取起點的 run 當基準（若無則 1.0）
      let base = 1.0;
      const firstRun = nodes[0].parentElement && nodes[0].parentElement.tagName==='SPAN' && nodes[0].parentElement.dataset.run==='1' ? nodes[0].parentElement : null;
      if (firstRun) base = readRunStyle(firstRun).sizeEm;

      const target = clamp(base + deltaEm, 0.2, 5);

      for (const n of nodes){
        const run = ensureRunSpanFor(n);
        const st = readRunStyle(run);
        st.sizeEm = target;
        writeRunStyle(run, st);
        mergeAdjacentRuns(run);
      }
      afterChange(story);
    });
  }

  /* ===================== 綁定 UI ===================== */
  function bind(){
    const btnB  = document.getElementById('btnBold');
    const btnI  = document.getElementById('btnItalic');
    const btnU  = document.getElementById('btnUnderline');
    const btnUp = document.getElementById('btnFontUp');
    const btnDn = document.getElementById('btnFontDown');

    btnB && btnB.addEventListener('click', ()=> toggleMark('bold'));
    btnI && btnI.addEventListener('click', ()=> toggleMark('italic'));
    btnU && btnU.addEventListener('click', ()=> toggleMark('underline'));
    btnUp && btnUp.addEventListener('click', ()=> adjustFont(+0.1));
    btnDn && btnDn.addEventListener('click', ()=> adjustFont(-0.1));
  }

  document.addEventListener('DOMContentLoaded', bind);
})();
