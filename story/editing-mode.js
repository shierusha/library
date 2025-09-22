/* editing-mode.js — 內頁分頁推擠 + 角標不會被編輯 */
function isWritablePage(p){ return p && p.type === 'novel'; }
function getDomPagesList(){
  const list = [];
  if (state.mode === 'spread') {
    elBook.querySelectorAll('.paper').forEach(paper=>{
      const f = paper.querySelector('.page.front');
      const b = paper.querySelector('.page.back');
      if (f) list.push(f);
      if (b) list.push(b);
    });
  } else {
    elBook.querySelectorAll('.single-page').forEach(n => list.push(n));
  }
  return list;
}
function domIndexToDbIndex(domIndex){ if (domIndex <= 2) return 0; return domIndex - 2; }
function dbIndexToDomIndex(dbIndex){ return dbIndex + 2; }
function getEditorElForDbIndex(dbIndex){
  const domList = getDomPagesList();
  const domIdx0 = dbIndexToDomIndex(dbIndex) - 1;
  return domList[domIdx0] || null;
}
function getPlainTextFrom(el){ return (el && el.textContent) ? el.textContent : ''; }
function setPlainTextTo(el, plain){
  if (!el) return;
  el.textContent = plain || '';
  el.style.whiteSpace = 'pre-wrap';
  el.style.wordBreak  = 'break-word';
  el.style.overflow   = 'hidden';
  el.style.display    = 'block';
  el.style.userSelect = 'text';
  el.style.webkitUserSelect = 'text';
  el.style.msUserSelect = 'text';
  el.style.caretColor = 'auto';
}
function ensurePagePlainToJson(pageObj, plain){
  const html = (plain || '').split('\n').map(line => line ? line.replace(/&/g,'&amp;').replace(/</g,'&lt;') : '').join('<br>');
  pageObj.content_json = pageObj.content_json || {};
  pageObj.content_json.text_plain = plain || '';
  pageObj.content_json.text_html  = html || '';
}
function lockMetaEditabilityIn(root){
  (root || document).querySelectorAll('.page-meta').forEach(m=>{
    m.setAttribute('contenteditable', 'false');
    m.setAttribute('draggable', 'false');
    m.setAttribute('spellcheck','false');
    m.setAttribute('tabindex', '-1');
    m.style.userSelect = 'none';
    m.style.pointerEvents = 'none';
  });
}
const recallMeta = debounce(()=>{
  try{ renderMetaForAllPages(); lockMetaEditabilityIn(elBook); }catch(e){}
}, 0);
function debounce(fn, wait){
  let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); };
}
function observeMetaLock(){
  const mo = new MutationObserver((mutList)=>{
    for (const m of mutList){
      m.addedNodes && m.addedNodes.forEach(node=>{
        if (node.nodeType !== 1) return;
        if (node.classList && node.classList.contains('page-meta')) lockMetaEditabilityIn(node.parentNode || node);
        else lockMetaEditabilityIn(node);
      });
    }
  });
  mo.observe(elBook, { childList:true, subtree:true });
}
function patchBookMountOnce(){
  if (!window.book || window.book.__metaPatched) return;
  const orig = window.book._mountCurrent && window.book._mountCurrent.bind(window.book);
  if (!orig) return;
  window.book._mountCurrent = function(){
    const r = orig();
    setTimeout(()=>{ try{ renderMetaForAllPages(); lockMetaEditabilityIn(elBook); }catch(e){} }, 0);
    return r;
  };
  window.book.__metaPatched = true;
}
function isOverflow(el){
  if (!el) return false;
  const over = el.scrollHeight > el.clientHeight;
  if (over) return true;
  const cs = getComputedStyle(el);
  let lh = parseFloat(cs.lineHeight);
  if (!isFinite(lh)) lh = parseFloat(cs.fontSize || '16') * 1.2;
  const free = el.clientHeight - el.scrollHeight;
  return free < lh * 0.35;
}
function fitTextFor(el, text){
  let src = (text || '').replace(/\n+$/,'');
  let lo = 0, hi = src.length, fit = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    setPlainTextTo(el, src.slice(0, mid));
    if (!isOverflow(el)) { fit = mid; lo = mid + 1; }
    else { hi = mid - 1; }
  }
  let keep = src.slice(0, fit);
  setPlainTextTo(el, keep);
  if (isOverflow(el)) {
    const lastNL = keep.lastIndexOf('\n');
    const newKeep = (lastNL > -1) ? keep.slice(0, lastNL) : keep.slice(0, Math.max(0, keep.length - 1));
    keep = newKeep.replace(/\n+$/,'');
    setPlainTextTo(el, keep);
  }
  const rest = src.slice(keep.length);
  return { keep, rest };
}
function findNextWritableDbIndex(fromDbIndex){
  for (let i = fromDbIndex + 1; i <= PAGES_DB.length; i++){
    if (isWritablePage(PAGES_DB[i-1])) return i;
  }
  return 0;
}
function genLocalId(){ return 'local_' + Math.random().toString(36).slice(2, 9); }
function insertBlankSheetAfterDbIndex(dbIndex){
  const insertAt = dbIndex + 1;
  const newFront = { id: genLocalId(), page_index: insertAt,   type: 'novel', image_url: null, content_json: { text_plain: '', text_html: '' } };
  const newBack  = { id: genLocalId(), page_index: insertAt+1, type: 'novel', image_url: null, content_json: { text_plain: '', text_html: '' } };
  for (const p of PAGES_DB){ if (p.page_index >= insertAt) p.page_index += 2; }
  PAGES_DB.push(newFront, newBack);
  PAGES_DB.sort((a,b)=>a.page_index - b.page_index);
  safeRebuildAndRedraw();
  return insertAt;
}
function safeRebuildAndRedraw(){
  try{
    if (typeof buildPairsFromPages === 'function' && window.BookFlip && window.book) {
      const curDomIdx = (window.book._cursorPage || 0) + 1;
      const curDbIdx = Math.max(0, domIndexToDbIndex(curDomIdx));
      const pairs = buildPairsFromPages();
      const opts = {
        mode: state.mode,
        direction: state.direction,
        speed: 450,
        singleSpeed: 300,
        perspective: 2000,
        data: { pairs },
        startPageIndex: Math.max(0, dbIndexToDomIndex(curDbIdx) - 1),
        coverPapers: 1
      };
      window.book = new BookFlip('#bookCanvas', opts);
      patchBookMountOnce();
    }
    applyLayout();
    applyPageTypesNow();
    renderMetaForAllPages();
    lockMetaEditabilityIn(elBook);
    updateCount();
  }catch(e){ console.warn('safeRebuildAndRedraw failed:', e); }
}
function ensureEditableShell(dbIndex){
  const pageNode = getEditorElForDbIndex(dbIndex);
  if (!pageNode) return null;
  if (pageNode.getAttribute('data-editor') === '1') return pageNode;
  const p = PAGES_DB[dbIndex - 1];
  if (!isWritablePage(p)) {
    pageNode.removeAttribute('contenteditable');
    pageNode.removeAttribute('data-editor');
    return null;
  }
  pageNode.setAttribute('contenteditable', 'true');
  pageNode.setAttribute('data-editor', '1');
  pageNode.style.whiteSpace = 'pre-wrap';
  pageNode.style.wordBreak  = 'break-word';
  pageNode.style.overflow   = 'hidden';
  pageNode.style.display    = 'block';
  pageNode.style.userSelect = 'text';
  pageNode.style.webkitUserSelect = 'text';
  pageNode.style.msUserSelect = 'text';
  pageNode.style.caretColor = 'auto';
  bindInputEvents(pageNode, dbIndex);
  const pj = p.content_json || {};
  let basePlain = '';
  if (typeof pj.text_plain === 'string' && pj.text_plain.length > 0) basePlain = pj.text_plain;
  else if (typeof pj.text_html === 'string' && pj.text_html.length > 0) {
    const tmp = document.createElement('div'); tmp.innerHTML = pj.text_html; basePlain = tmp.textContent || '';
  }
  setPlainTextTo(pageNode, basePlain);
  return pageNode;
}
function flowOverflowFrom(dbIndex){
  let curIdx = dbIndex;
  while (curIdx > 0 && curIdx <= PAGES_DB.length){
    const curPage = PAGES_DB[curIdx - 1];
    if (!isWritablePage(curPage)) {
      let nextWritable = findNextWritableDbIndex(curIdx - 1);
      if (!nextWritable){ nextWritable = insertBlankSheetAfterDbIndex(PAGES_DB.length); }
      curIdx = nextWritable; continue;
    }
    const el = ensureEditableShell(curIdx);
    if (!el) { curIdx++; continue; }
    const text = getPlainTextFrom(el);
    const { keep, rest } = fitTextFor(el, text);
    setPlainTextTo(el, keep);
    ensurePagePlainToJson(curPage, keep);
    if (!rest || rest.length === 0){ recallMeta(); break; }
    let nextIdx = findNextWritableDbIndex(curIdx);
    if (!nextIdx){
      const anchor = (curIdx % 2 === 0) ? curIdx : curIdx + 1;
      nextIdx = insertBlankSheetAfterDbIndex(anchor);
    }
    const nextEl = ensureEditableShell(nextIdx);
    const oldPlain = getPlainTextFrom(nextEl);
    const merged = rest + oldPlain;
    setPlainTextTo(nextEl, merged);
    ensurePagePlainToJson(PAGES_DB[nextIdx-1], merged);
    curIdx = nextIdx;
  }
  persistDraft();
  recallMeta();
}
function bindInputEvents(editorEl, dbIndex){
  editorEl.addEventListener('paste', (e)=>{
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    if (!t) return;
    document.execCommand('insertText', false, t);
    setTimeout(()=>{ flowOverflowFrom(dbIndex); }, 0);
  });
  editorEl.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter'){
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
      setTimeout(()=>{ flowOverflowFrom(dbIndex); }, 0);
    }
  });
  editorEl.addEventListener('input', ()=>{
    const curPage = PAGES_DB[dbIndex - 1];
    ensurePagePlainToJson(curPage, getPlainTextFrom(editorEl));
    persistDraft();
    setTimeout(()=>{
      if (isOverflow(editorEl)) flowOverflowFrom(dbIndex);
      else recallMeta();
    }, 0);
  });
}
function mountEditors(){
  for (let i=1; i<=PAGES_DB.length; i++){
    if (!isWritablePage(PAGES_DB[i-1])) continue;
    ensureEditableShell(i);
  }
  lockMetaEditabilityIn(elBook);
  recallMeta();
}
const btnInsert = document.getElementById('btnInsertPage');
const btnDelete = document.getElementById('btnDeleteBlank');
function getFocusedDbIndex(){
  const activeEl = document.activeElement;
  if (activeEl && activeEl.hasAttribute('data-editor')){
    const domList = getDomPagesList();
    const idx0 = domList.indexOf(activeEl);
    const domIndex = idx0 >= 0 ? idx0 + 1 : 0;
    return domIndexToDbIndex(domIndex);
  }
  return 0;
}
btnInsert?.addEventListener('click', ()=>{
  let dbIndex = getFocusedDbIndex();
  if (!dbIndex) dbIndex = 1;
  const thisSheetStart = (dbIndex % 2 === 0) ? dbIndex - 1 : dbIndex;
  const afterThisSheet = thisSheetStart + 1;
  insertBlankSheetAfterDbIndex(afterThisSheet);
  persistDraft();
  setTimeout(()=>{ afterLayoutRedraw(); mountEditors(); }, 0);
});
btnDelete?.addEventListener('click', ()=>{
  const dbIndex = getFocusedDbIndex();
  if (!dbIndex){ alert('請先點到要刪除的紙張其中一頁（封面不行）。'); return; }
  const sheetStart = (dbIndex % 2 === 0) ? dbIndex - 1 : dbIndex;
  const a = PAGES_DB[sheetStart - 1];
  const b = PAGES_DB[sheetStart];
  function isBlankNovel(p){
    if (!p || p.type !== 'novel') return false;
    const t = (p.content_json && p.content_json.text_plain) || '';
    return t.length === 0;
  }
  if (!isBlankNovel(a) || !isBlankNovel(b)){
    alert('僅能刪除「正反兩面皆空白」的紙張。');
    return;
  }
  PAGES_DB = PAGES_DB.filter(x => x !== a && x !== b);
  for (const p of PAGES_DB){ if (p.page_index > sheetStart+1) p.page_index -= 2; }
  PAGES_DB.sort((x,y)=>x.page_index - y.page_index);
  safeRebuildAndRedraw();
  persistDraft();
  setTimeout(()=>{ afterLayoutRedraw(); mountEditors(); }, 0);
});
(function start(){
  document.addEventListener('DOMContentLoaded', ()=>{
    setTimeout(()=>{
      observeMetaLock();
      patchBookMountOnce();
      mountEditors();
    }, 0);
  });
  window.__mountEditors = mountEditors;
})();
