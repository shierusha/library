
/* editor-core.js
 * - 自動在可編輯頁插入 .story[contenteditable]
 * - 初始化 .story 優先用 content_json.text_html（不洗掉 B/I/U/字級 <span>）
 * - 置中頁 sizing 修正 + 直排 padding，切回 novel 會還原父層
 * - 記錄最後互動頁，工具列針對目前頁
 * - Enter 修正：用「游標標記」跨重繪復位 + 觸發 PasteFlow 分頁
 * - 導出選取保存/還原工具給其他模組用
 */
(function(){
  /* ---------- 基本工具 ---------- */
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');

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

  const typeStr = p => String(p?.type||'').toLowerCase().replace(/-/g,'_');
  const isImagePage   = p => (typeStr(p) === 'image' || typeStr(p) === 'illustration');
  const isDividerPage = p => (typeStr(p) === 'divider_white' || typeStr(p) === 'divider_light' || typeStr(p) === 'divider_dark' || typeStr(p) === 'divider_black');
  const isNovelPage   = p => (typeStr(p) === 'novel');
  const isEditablePage= p => (isNovelPage(p) || isDividerPage(p));

  function lockMeta(){
    elBook.querySelectorAll('.page-meta').forEach(m=>{
      m.setAttribute('contenteditable','false');
      m.style.pointerEvents='none';
      m.style.userSelect='none';
    });
  }

  function persist(){ try{ persistDraft && persistDraft(); }catch(_){} }

  function textOf(nodes){
    let s = '';
    nodes.forEach(n => { s += (n.textContent || ''); });
    return s.replace(/\u00a0/g, ' ');
  }

  function updatePageJsonFromStory(dbIndex, storyEl){
    const p = PAGES_DB[dbIndex - 1]; if (!p) return;
    p.content_json = p.content_json || {};
    p.content_json.text_plain = storyEl.textContent || '';
    p.content_json.text_html  = storyEl.innerHTML  || '';
    persist();
  }

  /* ---------- 選取保存/還原（以文字 offset 計算） ---------- */
  function getOffsets(container){
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const rng = sel.getRangeAt(0);
    if (!container.contains(rng.startContainer)) return null;

    function off(node, offset, root){
      let acc = 0;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      while (w.nextNode()){
        const t = w.currentNode, len = t.nodeValue.length;
        if (t === node) return acc + offset;
        acc += len;
      }
      return acc;
    }
    return { start: off(rng.startContainer, rng.startOffset, container),
             end:   off(rng.endContainer,   rng.endOffset,   container) };
  }
  function setOffsets(container, start, end){
    const rng = document.createRange();
    let sNode=null, sOff=0, eNode=null, eOff=0, acc=0;
    const w = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    while (w.nextNode()){
      const t = w.currentNode, len = t.nodeValue.length;
      if (sNode==null && acc + len >= start){ sNode=t; sOff=start-acc; }
      if (eNode==null && acc + len >= end)  { eNode=t; eOff=end-acc; break; }
      acc += len;
    }
    if (!sNode) { sNode = container; sOff = container.childNodes.length; }
    if (!eNode) { eNode = sNode;     eOff = sOff; }
    rng.setStart(sNode, sOff); rng.setEnd(eNode, eOff);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
  }
  function keepSelectionAround(story, fn){
    const saved = getOffsets(story);
    const ok = fn();
    if (saved) setOffsets(story, saved.start, saved.end);
    return ok;
  }

  /* ---------- 置中/一般頁 sizing ---------- */
  function applySizingForStory(story, p){
    if (!story || !p) return;

    const vertical  = document.body.classList.contains('mode-rtl');
    const padInline = vertical ? '0.6em' : '0';
    const padBlock  = vertical ? '0.2em' : '0';

    const pageEl = story.closest('.page, .single-page');

    if (isDividerPage(p)) {
      if (pageEl){
        pageEl.style.display = 'flex';
        pageEl.style.justifyContent = 'center';
        pageEl.style.alignItems = 'center';
        pageEl.style.textAlign = 'center';
      }
      story.style.width       = 'auto';
      story.style.minHeight   = 'auto';
      story.style.maxWidth    = '92%';
      story.style.maxHeight   = '92%';
      story.style.margin      = '0 auto';
      story.style.alignSelf   = 'center';
      story.style.textAlign   = 'center';
      story.style.display     = 'inline-block';
      story.style.overflow    = 'hidden';
      story.style.paddingInline = padInline;
      story.style.paddingBlock  = padBlock;
    } else {
      if (pageEl){
        pageEl.style.display = '';
        pageEl.style.justifyContent = '';
        pageEl.style.alignItems = '';
        pageEl.style.textAlign = '';
      }
      story.style.width       = '100%';
      story.style.minHeight   = '100%';
      story.style.maxWidth    = '';
      story.style.maxHeight   = '';
      story.style.margin      = '0';
      story.style.alignSelf   = '';
      story.style.textAlign   = '';
      story.style.display     = '';
      story.style.overflow    = 'hidden';
      story.style.paddingInline = padInline;
      story.style.paddingBlock  = padBlock;
    }
  }

  /* ---------- Enter 修正：用「游標標記」跨重繪復位 ---------- */
  function placeCaretMarker(story){
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const rng = sel.getRangeAt(0);

    const marker = document.createElement('span');
    marker.id = 'caret-' + Math.random().toString(36).slice(2);
    marker.setAttribute('data-caret','1');
    marker.style.cssText = 'display:inline-block;width:0;height:0;overflow:hidden;line-height:0;';
    rng.insertNode(marker);

    // caret 暫時放到標記後
    rng.setStartAfter(marker);
    rng.collapse(true);
    sel.removeAllRanges(); sel.addRange(rng);
    return marker.id;
  }
  function restoreCaretFromMarker(markerId){
    const marker = document.getElementById(markerId);
    if (!marker) return false;
    const sel = window.getSelection();
    const rng = document.createRange();
    rng.setStartAfter(marker);
    rng.collapse(true);
    sel.removeAllRanges(); sel.addRange(rng);
    marker.parentNode && marker.parentNode.removeChild(marker);
    return true;
  }
  function bindEnterFix(story){
    if (story.__enterFixBound) return;
    story.__enterFixBound = true;

    story.addEventListener('keydown', e=>{
      if (e.key !== 'Enter') return;
e.preventDefault();
e.stopImmediatePropagation(); // ← 關鍵：避免 paste-flow 的 Enter 再跑一次

      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const rng = sel.getRangeAt(0);
      if (!story.contains(rng.startContainer)) return;

      // 刪掉反白
      if (!rng.collapsed) rng.deleteContents();

      // 插入 <br> 並把 caret 放到 <br> 後
      const br = document.createElement('br');
      rng.insertNode(br);
      rng.setStartAfter(br);
      rng.collapse(true);
      sel.removeAllRanges(); sel.addRange(rng);

      // 下游標標記（跨重繪復位）
      const markerId = placeCaretMarker(story);

      // 寫回當前頁內容（此時 HTML 內含標記）
      const db = Number(story.dataset.dbIndex||'0')|0;
      updatePageJsonFromStory(db, story);

      // 觸發你的分頁/推擠
      if (window.PasteFlow && typeof window.PasteFlow.forceReflow === 'function') {
        window.PasteFlow.forceReflow(story);
      } else {
        story.dispatchEvent(new Event('input', { bubbles:true }));
      }

      // 重繪後把 caret 復位並清掉標記，再回寫一次乾淨內容
      let tries = 20;
      (function tryRestore(){
        requestAnimationFrame(()=>{
          const ok = restoreCaretFromMarker(markerId);
          if (!ok && --tries > 0) {
            tryRestore();
          } else if (ok) {
            updatePageJsonFromStory(db, story);
          }
        });
      })();
    });
  }

  /* ---------- story 的建立 ---------- */
  let LAST_DB_INDEX = 1;

  function ensureStoryOnPageEl(pageEl, dbIndex){
    const p = PAGES_DB[dbIndex - 1];
    if (!p || !isEditablePage(p)) return null;

    let story = pageEl.querySelector('.story');
    if (!story){
      const metas = new Set(Array.from(pageEl.querySelectorAll('.page-meta')));
      const olds  = Array.from(pageEl.childNodes).filter(n => !(n.nodeType===1 && metas.has(n)));
      const oldPlain = textOf(olds).trim();

      story = document.createElement('div');
      story.className = 'page-content story';
      story.setAttribute('contenteditable','true');
      story.dataset.dbIndex = String(dbIndex);

      // 基礎編輯樣式
      story.style.whiteSpace='pre-wrap';
      story.style.wordBreak='break-word';
      story.style.overflow='hidden';
      story.style.userSelect='text';
      story.style.webkitUserSelect='text';
      story.style.msUserSelect='text';
      story.style.caretColor='auto';
      story.style.boxSizing='border-box';
      story.style.width='100%';
      story.style.minHeight = isNovelPage(p) ? '100%' : '1.2em';

      pageEl.insertBefore(story, pageEl.firstChild);
      olds.forEach(n=> n.parentNode && n.parentNode.removeChild(n));

      // 優先用 DB 的 HTML；再退回 plain；再退舊 DOM 純文字
      const htmlFromDb  = (p.content_json?.text_html  || '').trim();
      const plainFromDb = (p.content_json?.text_plain || '').trim();

      if (htmlFromDb) {
        story.innerHTML = htmlFromDb;
      } else if (plainFromDb) {
        story.innerHTML = esc(plainFromDb).replace(/\n/g,'<br>');
        p.content_json.text_html = story.innerHTML;
      } else if (oldPlain) {
        story.textContent = oldPlain;
        p.content_json = p.content_json || {};
        p.content_json.text_plain = oldPlain;
        p.content_json.text_html  = esc(oldPlain).replace(/\n/g,'<br>');
      }
    }

    // sizing + Enter 修正
    applySizingForStory(story, p);
    bindEnterFix(story);

    // 記錄最後互動頁
    if (!story.__lastBind){
      story.__lastBind = true;
      const setLast = ()=>{ LAST_DB_INDEX = dbIndex; };
      story.addEventListener('focusin', setLast);
      story.addEventListener('mousedown', setLast);
      pageEl.addEventListener('mousedown', setLast, {capture:true});
      pageEl.addEventListener('touchstart', setLast, {passive:true,capture:true});
    }

    // 綁貼上/輸入（大量貼上與分頁邏輯在 paste-flow.js）
    if (window.PasteFlow && typeof window.PasteFlow.bindTo === 'function' && !story.__pfBound){
      story.__pfBound = true; window.PasteFlow.bindTo(story);
    }
    return story;
  }

  function getStoryByDbIndex(dbIndex){
    const domList = getDomPagesList();
    const domIdx0 = dbIndexToDomIndex(dbIndex) - 1;
    const pageEl = domList[domIdx0];
    if (!pageEl) return null;
    return pageEl.querySelector('.story') || null;
  }

  function getFocusedDbIndex(){
    const active = document.activeElement;
    if (active && active.classList?.contains('story')){
      return Number(active.dataset.dbIndex||'0')|0;
    }
    if (LAST_DB_INDEX && LAST_DB_INDEX > 0) return LAST_DB_INDEX;
    const curDom = (window.book?._cursorPage || 0) + 1;
    return domIndexToDbIndex(curDom) || 1;
  }

  function hookAllStories(){
    const list = getDomPagesList();
    for (let i=0;i<list.length;i++){
      const dbIndex = domIndexToDbIndex(i+1);
      if (dbIndex <= 0) continue; // 封面不編輯
      const p = PAGES_DB[dbIndex - 1];
      if (isImagePage(p)) continue;
      const story = ensureStoryOnPageEl(list[i], dbIndex);
      applySizingForStory(story, p); // 保險
    }
    lockMeta();
    try { window.PageStyle?.bindImageEditors?.(); } catch(_){}
  }

  // 觀察 BookFlip DOM 完成後再掛 .story
  let mo;
  function observeBook(){
    if (mo) mo.disconnect();
    mo = new MutationObserver(()=> {
      clearTimeout(observeBook._t);
      observeBook._t = setTimeout(()=>{ try{ hookAllStories(); }catch(e){} }, 30);
    });
    mo.observe(document.getElementById('bookCanvas'), { childList:true, subtree:true });
  }

  function applyStorySizingFor(dbIndex){
    if (!dbIndex || dbIndex <= 0) return;
    const p = PAGES_DB[dbIndex - 1]; if (!p) return;
    const list = getDomPagesList();
    const pageEl = list[dbIndexToDomIndex(dbIndex)-1];
    if (!pageEl) return;
    const story = pageEl.querySelector('.story') || ensureStoryOnPageEl(pageEl, dbIndex);
    applySizingForStory(story, p);
  }

  // export
  window.EditorCore = {
    getDomPagesList, domIndexToDbIndex, dbIndexToDomIndex,
    isImagePage, isDividerPage, isNovelPage, isEditablePage,
    lockMeta, ensureStoryOnPageEl, getStoryByDbIndex,
    getFocusedDbIndex, updatePageJsonFromStory, hookAllStories,
    setLastDbIndex(db){ LAST_DB_INDEX = db|0; },
    applyStorySizingFor,
    // 提供給外部使用的選取工具
    getOffsets, setOffsets, keepSelectionAround
  };
  window.EditorFlow = { hookAllStories };

  document.addEventListener('DOMContentLoaded', ()=>{
    observeBook();
    setTimeout(hookAllStories, 0);
  });
})();
