/* text-controls.js v2 */
(function(){
  const FS_CLASS = 'fs-span';
  const FS_MIN = 0.6, FS_MAX = 3.0;

  function clamp(n,a,b){ return Math.min(b, Math.max(a,n)); }

  function getCtx(){
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const story = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer.closest?.('.story')
      : (range.commonAncestorContainer.parentElement && range.commonAncestorContainer.parentElement.closest('.story'));
    if (!story) return null;
    return { sel, range, story, db: Number(story.dataset.dbIndex||'0')|0 };
  }

  function saveSelection(){ const s=window.getSelection(); if(!s||s.rangeCount===0)return null; const r=s.getRangeAt(0); return {start:r.startContainer,startOffset:r.startOffset,end:r.endContainer,endOffset:r.endOffset}; }
  function restoreSelection(saved){ if(!saved)return; const r=document.createRange(); try{ r.setStart(saved.start,saved.startOffset); r.setEnd(saved.end,saved.endOffset); const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);}catch(_){ } }

  function applyExec(cmd){
    const ctx = getCtx(); if (!ctx) return;
    if (ctx.range.collapsed) return;
    const keep = saveSelection();
    ctx.story.focus();
    document.execCommand(cmd, false, null);
    EditorCore.updatePageJsonFromStory(ctx.db, ctx.story);
    if (!PasteFlow.isOverflow(ctx.story)) restoreSelection(keep);
    setTimeout(()=>{ if (PasteFlow.isOverflow(ctx.story)) PasteFlow.flowOverflowFrom(ctx.db); }, 0);
  }

  function parseEm(str){ const m=/([\d.]+)em/i.exec(str||''); return m?parseFloat(m[1]):NaN; }

  function sizeDelta(delta){
    const ctx = getCtx(); if (!ctx) return;
    const { sel, range, story, db } = ctx;
    if (range.collapsed) return;

    let node = range.commonAncestorContainer.nodeType===1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
    while (node && node !== story){
      if (node.classList?.contains(FS_CLASS)) break;
      node = node.parentNode;
    }

    let targetSpan = node?.classList?.contains(FS_CLASS) ? node : null;
    if (targetSpan){
      const cur = parseEm(targetSpan.style.fontSize); const base = isNaN(cur) ? 1 : cur;
      targetSpan.style.fontSize = clamp(+(base + delta).toFixed(2), FS_MIN, FS_MAX) + 'em';
      sel.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(targetSpan); sel.addRange(r);
    } else {
      const span = document.createElement('span');
      span.className = FS_CLASS;
      span.style.fontSize = clamp(1 + delta, FS_MIN, FS_MAX) + 'em';
      const frag = range.cloneContents();
      Array.from(frag.querySelectorAll ? frag.querySelectorAll('.'+FS_CLASS) : []).forEach(s=>{
        while(s.firstChild) s.parentNode.insertBefore(s.firstChild, s);
        s.parentNode.removeChild(s);
      });
      range.deleteContents();
      span.appendChild(frag);
      range.insertNode(span);
      sel.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(span); sel.addRange(r);
      targetSpan = span;
    }
    EditorCore.updatePageJsonFromStory(db, story);
    if (!PasteFlow.isOverflow(story)){
      // keep selection
    } else {
      setTimeout(()=>{ try{ PasteFlow.flowOverflowFrom(db); }catch(_){ } }, 0);
    }
  }

  document.getElementById('btnBold')?.addEventListener('click', ()=>applyExec('bold'));
  document.getElementById('btnItalic')?.addEventListener('click', ()=>applyExec('italic'));
  document.getElementById('btnUnderline')?.addEventListener('click', ()=>applyExec('underline'));
  document.getElementById('btnFontUp')?.addEventListener('click', ()=>sizeDelta(+0.2));
  document.getElementById('btnFontDown')?.addEventListener('click', ()=>sizeDelta(-0.2));

  window.TextControls = {};
})();
