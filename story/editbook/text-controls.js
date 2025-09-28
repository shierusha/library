
/* text-controls.js — Fix A+/A-: single-layer data-fs, no empty spans, precise rounding
 * This file keeps previous B/I/U toggle behavior and replaces A+/A- with a safer pipeline.
 * Key improvements:
 * - Round to 1 decimal (e.g., 1.2) to avoid 1.2000000000000002
 * - Never insert empty <span data-fs> (guard on fragment.hasChildNodes())
 * - Normalize & merge adjacent same-size spans; unwrap empty spans
 * - Collapsed-caret: adjust the current wrapper if present; otherwise expand to word
 */
(function(){
  if (!window.EditorCore) return;

  /* ===== Helpers ===== */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round1 = (v) => Math.round(v * 10) / 10;

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

  /* ====== Inline B/I/U toggle stays from previous fixed version ====== */
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
        // remove if no visible text and no <br>
        let hasRenderable = false;
        for (let n=el.firstChild;n;n=n.nextSibling){
          if (n.nodeType===3 && (n.nodeValue||"").replace(/\u00a0/g,' ').trim()){ hasRenderable=true; break; }
          if (n.nodeType===1){ // element
            if (n.tagName==='BR'){ hasRenderable=true; break; }
            // nested wrappers will be handled by flatten/merge; don't count them
          }
        }
        if (!hasRenderable) unwrap(el);
      });
    });
    // flatten nested
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
    // merge adjacent
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

  /* ====== FS (A+/A-) utilities ====== */
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
    const fs = clamp(round1(valEm), 0.2, 5.0);
    span.dataset.fs = String(fs);
    // keep 1 decimal (avoid long floats)
    span.style.fontSize = (Math.round(fs*10)/10).toFixed(1).replace(/\.0$/,'') + 'em';
  }
  function isFsSpan(el){
    return el && el.nodeType===1 && el.tagName==='SPAN' && (el.dataset.fs || /em$/.test(el.style.fontSize||''));
  }
  function findFsWrapper(node){
    let cur = (node && node.nodeType===1) ? node : (node ? node.parentElement : null);
    while(cur && cur!==document){
      if (isFsSpan(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
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
  function normalizeFsSpan(el){
    if (!isFsSpan(el)) return;
    // If style has em but no data-fs, set data-fs
    if (!el.dataset.fs){
      const v = parseEm(el.style.fontSize);
      if (!isNaN(v)) setSpanSize(el, v);
    }else{
      setSpanSize(el, parseFloat(el.dataset.fs));
    }
    // remove empty
    if (!hasRenderableContent(el)) unwrap(el);
  }
  function mergeAdjacentFs(root){
    const spans = Array.from(root.querySelectorAll('span[data-fs], span[style*="font-size"]'));
    spans.forEach(normalizeFsSpan);
    // merge left-right equal
    Array.from(root.querySelectorAll('span[data-fs]')).forEach(span=>{
      if (!span.isConnected) return;
      const key = span.dataset.fs;
      // left
      let prev = span.previousSibling;
      while (prev && prev.nodeType===3 && !(prev.nodeValue||"").trim()) prev = prev.previousSibling;
      if (prev && prev.nodeType===1 && prev.tagName==='SPAN' && isFsSpan(prev)){
        normalizeFsSpan(prev);
        if (prev.dataset.fs === key){
          while (span.firstChild) prev.appendChild(span.firstChild);
          span.replaceWith(prev);
          span = prev;
        }
      }
      // right
      let next = span.nextSibling;
      while (next && next.nodeType===3 && !(next.nodeValue||"").trim()) next = next.nextSibling;
      if (next && next.nodeType===1 && next.tagName==='SPAN' && isFsSpan(next)){
        normalizeFsSpan(next);
        if (next.dataset.fs === key){
          while (next.firstChild) span.appendChild(next.firstChild);
          next.remove();
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

  /* ====== A+/A- main ====== */
  function adjustFont(deltaStep){
    let ctx = getStoryAndRange(false);
    if (!ctx){
      ctx = getStoryAndRange(true);
      if (!ctx) return false;
      const { range } = ctx;
      const wrap = findFsWrapper(range.startContainer);
      if (!wrap){
        const ok = expandRangeToWord(range);
        if (!ok) return false; // caret on boundary w/o word: ignore
      }
    }
    const { story, range } = ctx;

    return EditorCore.keepSelectionAround(story, ()=>{
      const startWrap = findFsWrapper(range.startContainer);
      const endWrap   = findFsWrapper(range.endContainer);

      // Case 1: inside the same fs wrapper => just adjust it.
      if (startWrap && startWrap === endWrap){
        const cur = getSpanSize(startWrap) || 1.0;
        setSpanSize(startWrap, cur + deltaStep);
        mergeAdjacentFs(story);
        afterChange(story);
        return true;
      }

      // Case 2: selection spanning multiple runs => wrap whole selection to a single fs span
      const baseA = getSpanSize(startWrap);
      const baseB = getSpanSize(endWrap);
      const base = !isNaN(baseA) ? baseA : (!isNaN(baseB) ? baseB : 1.0);

      const frag = range.extractContents();
      stripFsInFragment(frag);
      if (!frag.hasChildNodes()){
        // nothing selected (avoid creating empty spans)
        return false;
      }
      const span = document.createElement('span');
      setSpanSize(span, base + deltaStep);
      span.appendChild(frag);
      range.insertNode(span);

      // Normalize: merge neighbors with same fs and cleanup empties
      mergeAdjacentFs(story);
      afterChange(story);
      return true;
    });
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
