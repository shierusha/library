/* 所有功能.js — 整合：
 * 1) editor-core.js
 * 2) sheet-ops.js
 * 3) paste-flow.js
 * 4) text-controls.js
 * 5) page-style.js
 * 6) toc.js
 * （保留原模組 IIFE 與全域名稱：EditorCore / SheetOps / PasteFlow / TextControls / PageStyle / TOC_API）
 */



/* ===== editor-core.js ===== */

/* editor-core.js
 * 共用工具 + hookAllStories()
 * - novel / divider(白/黑) 會補 .story[contenteditable]（圖片頁不編輯）
 * - 初次掛 .story 會保留原頁文字（避免重整後文本消失）
 * - 角標鎖不可編輯
 * - MutationObserver：BookFlip 渲染後自動掛 .story
 */
(function(){
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

  function isImagePage(p){ return String(p?.type||'').toLowerCase().includes('image'); }
  function isDividerPage(p){
    const t = String(p?.type||'').toLowerCase().replace(/-/g,'_');
    return t === 'divider_white' || t === 'divider_light' || t === 'divider_dark' || t === 'divider_black';
  }
  function isNovelPage(p){ return String(p?.type||'').toLowerCase().replace(/-/g,'_') === 'novel'; }
  function isEditablePage(p){ return isNovelPage(p) || isDividerPage(p); }

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
    p.content_json.text_html  = storyEl.innerHTML || '';
    persist();
  }

  function ensureStoryOnPageEl(pageEl, dbIndex){
    const p = PAGES_DB[dbIndex - 1];
    if (!p || !isEditablePage(p)) return null;

    let story = pageEl.querySelector('.story');
    if (!story){
      // 蒐集原有非角標內容
      const metas = new Set(Array.from(pageEl.querySelectorAll('.page-meta')));
      const olds = Array.from(pageEl.childNodes).filter(n => !(n.nodeType===1 && metas.has(n)));
      const oldPlain = textOf(olds).trim();

      story = document.createElement('div');
      story.className = 'page-content story';
      story.setAttribute('contenteditable','true');
      story.dataset.dbIndex = String(dbIndex);

      story.style.whiteSpace='pre-wrap';
      story.style.wordBreak='break-word';
      story.style.overflow='hidden';
      story.style.userSelect='text';
      story.style.webkitUserSelect='text';
      story.style.msUserSelect='text';
      story.style.caretColor='auto';
      story.style.width='100%';
      story.style.boxSizing='border-box';
      story.style.minHeight = isNovelPage(p) ? '100%' : '1.2em';

      // === 垂直書寫時，黑/白置中頁的可編輯層不要吃滿寬，才能左右置中 ===
      if (isDividerPage(p)) {
        const vertical = document.body.classList.contains('mode-rtl');
        if (vertical) {
          story.style.width = 'auto';
          story.style.inlineSize = 'auto';
          story.style.maxWidth = '90%';
          story.style.alignSelf = 'center';
          story.style.margin = '0 auto';
          story.style.textAlign = 'center';
        }
      }

      pageEl.insertBefore(story, pageEl.firstChild);
      olds.forEach(n=> n.parentNode && n.parentNode.removeChild(n));

      // 初始化：DB 為主，沒資料時用舊 DOM 文字
      const plainInit = (p.content_json?.text_plain ?? '').trim() || oldPlain;
      if (plainInit) {
        story.textContent = plainInit;
        p.content_json = p.content_json || {};
        if (!p.content_json.text_plain) p.content_json.text_plain = plainInit;
        if (!p.content_json.text_html)  p.content_json.text_html  = plainInit.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>');
      }
    }

    // 綁貼上/輸入
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
      ensureStoryOnPageEl(list[i], dbIndex);
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

  // export
  window.EditorCore = {
    getDomPagesList, domIndexToDbIndex, dbIndexToDomIndex,
    isImagePage, isDividerPage, isNovelPage, isEditablePage,
    lockMeta, ensureStoryOnPageEl, getStoryByDbIndex,
    getFocusedDbIndex, updatePageJsonFromStory, hookAllStories
  };
  window.EditorFlow = { hookAllStories };

  document.addEventListener('DOMContentLoaded', ()=>{
    observeBook();
    setTimeout(hookAllStories, 0);
  });
})();


/* ===== sheet-ops.js ===== */

/* sheet-ops.js (no-insert-button version)
 * 插入/刪除白紙（兩頁 novel），重建 BookFlip 並正確定位游標
 * - 手動插入按鈕綁定已移除（UI 不再觸發），但函式仍保留供 paste-flow 自動加頁使用
 */
(function(){
  function persist(){ try{ persistDraft && persistDraft(); }catch(_){} }
  function genLocalId(){ return 'local_' + Math.random().toString(36).slice(2,9); }
  function getSheetStart(dbIndex){ return (dbIndex % 2 === 0) ? dbIndex - 1 : dbIndex; }

  function rebuildAndRedrawPreserveCursor(preferDbIndex){
    const startDb = Math.max(1, preferDbIndex || EditorCore.getFocusedDbIndex() || 1);
    rebuildTo(startDb);
  }

  function insertBlankSheetAfterCurrentSheet(){
    syncAllStoriesToDB();

    const focusBefore = EditorCore.getFocusedDbIndex();
    const sheetStart  = getSheetStart(focusBefore);
    const insertAt    = sheetStart + 2; // 下一張紙的 front

    const front = { id: genLocalId(), page_index: insertAt,   type:'novel', image_url:'', content_json:{text_plain:'', text_html:''} };
    const back  = { id: genLocalId(), page_index: insertAt+1, type:'novel', image_url:'', content_json:{text_plain:'', text_html:''} };

    for (const p of PAGES_DB){ if (p.page_index >= insertAt) p.page_index += 2; }
    PAGES_DB.push(front, back);
    PAGES_DB.sort((a,b)=>a.page_index - b.page_index);

    rebuildAndRedrawPreserveCursor(insertAt);
    persist();
    return insertAt;
  }

  function deleteBlankSheetIfPossible(){
    syncAllStoriesToDB();

    const db = EditorCore.getFocusedDbIndex();
    const sheetStart = getSheetStart(db);
    const a = PAGES_DB[sheetStart - 1];
    const b = PAGES_DB[sheetStart];

    function isBlankNovel(p){
      if (!p || String(p.type).toLowerCase().replace(/-/g,'_') !== 'novel') return false;
      return ((p.content_json?.text_plain || '').trim().length === 0);
    }
    if (!isBlankNovel(a) || !isBlankNovel(b)){
      alert('僅能刪除「正反兩面皆空白（一般文本）」的紙張。');
      return;
    }

    PAGES_DB = PAGES_DB.filter(x => x !== a && x !== b);
    for (const p of PAGES_DB){ if (p.page_index > sheetStart+1) p.page_index -= 2; }
    PAGES_DB.sort((x,y)=>x.page_index - y.page_index);

    const target = Math.max(1, sheetStart - 1);
    rebuildAndRedrawPreserveCursor(target);
    persist();
  }

  // 移除手動插入白紙的按鈕綁定（保留刪除空白紙功能）
  // document.getElementById('btnInsertPage')?.addEventListener('click', insertBlankSheetAfterCurrentSheet);
  document.getElementById('btnDeleteBlank')?.addEventListener('click', deleteBlankSheetIfPossible);

  window.SheetOps = {
    rebuildAndRedrawPreserveCursor,
    insertBlankSheetAfterCurrentSheet,  // 保留供 paste-flow 自動加頁
    deleteBlankSheetIfPossible,
    getSheetStart
  };
})();


/* ===== paste-flow.js ===== */

/* paste-flow.js
 * 貼上純文字 / Enter / 輸入 → 視覺溢出自動分頁到下一個 novel 頁
 * - 溢出判斷依 writing-mode 決定：直排看寬、橫排看高
 * - 沒有可寫頁就插入一張白紙（兩頁），並繼續流向新 front
 */
(function(){
  function isVerticalFlow(storyEl){
    const page = storyEl.closest('.page, .single-page') || storyEl;
    const wm = (page && getComputedStyle(page).writingMode) || '';
    return wm.indexOf('vertical') === 0; // vertical-rl / vertical-lr
  }
  function isOverflow(storyEl){
    if (!storyEl) return false;
    const v = isVerticalFlow(storyEl);
    if (v) { return (storyEl.scrollWidth  - storyEl.clientWidth ) > 0.5; }
    else   { return (storyEl.scrollHeight - storyEl.clientHeight) > 0.5; }
  }

  // 保留格式的子樹截斷（用視覺溢出判斷二分）
  function truncateHTMLPreserve(firstHTML, nChars){
    if (nChars <= 0) return '';
    const tmp = document.createElement('div'); tmp.innerHTML = firstHTML;
    let remain = nChars, stop = false;
    function cloneNodeLimited(node){
      if (stop) return null;
      if (node.nodeType === 3){
        const s = node.nodeValue || '';
        if (s.length <= remain){ remain -= s.length; return document.createTextNode(s); }
        const part = s.slice(0, remain); remain = 0; stop = true; return document.createTextNode(part);
      } else if (node.nodeType === 1){
        const clone = document.createElement(node.nodeName);
        if (node.hasAttribute('class')) clone.setAttribute('class', node.getAttribute('class'));
        if (node.hasAttribute('style')) clone.setAttribute('style', node.getAttribute('style'));
        for (let i=0;i<node.childNodes.length;i++){
          const cc = cloneNodeLimited(node.childNodes[i]); if (cc) clone.appendChild(cc);
          if (stop) break;
        }
        return clone;
      }
      return null;
    }
    const out = document.createElement('div');
    for (let i=0;i<tmp.childNodes.length;i++){
      const c = cloneNodeLimited(tmp.childNodes[i]); if (c) out.appendChild(c);
      if (stop) break;
    }
    return out.innerHTML;
  }

  function fitKeepWithFormat(storyEl){
    const fullHTML  = storyEl.innerHTML;
    const fullPlain = storyEl.textContent || '';
    let lo=0, hi=fullPlain.length, fit=0;

    while (lo <= hi){
      const mid = (lo + hi) >> 1;
      storyEl.innerHTML = truncateHTMLPreserve(fullHTML, mid);
      if (!isOverflow(storyEl)){ fit = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    storyEl.innerHTML = truncateHTMLPreserve(fullHTML, fit);
    if (isOverflow(storyEl)){
      const before  = storyEl.textContent || '';
      const lastNL  = before.lastIndexOf('\n');
      const target  = (lastNL >= 0) ? lastNL : Math.max(0, before.length - 1);
      storyEl.innerHTML = truncateHTMLPreserve(fullHTML, target);
      fit = target;
    }
    const restPlain = fullPlain.slice(fit);
    return { keepChars: fit, restPlain };
  }

  function setStoryPlain(storyEl, plain){
    storyEl.textContent = plain || '';
    if (!storyEl.style.minHeight) storyEl.style.minHeight = '1.2em';
  }

  function findNextNovel(fromDb){
    for (let i=fromDb+1; i<=PAGES_DB.length; i++){
      const p = PAGES_DB[i-1];
      const t = String(p?.type||'').toLowerCase().replace(/-/g,'_');
      if (t === 'novel') return i;
    }
    return 0;
  }

  function flowOverflowFrom(dbIndex){
    let curIdx = dbIndex, guard=0, MAX=2500;
    while (curIdx > 0 && curIdx <= PAGES_DB.length){
      if (++guard > MAX) break;

      const pageEl = EditorCore.getDomPagesList()[EditorCore.dbIndexToDomIndex(curIdx)-1];
      const story  = EditorCore.ensureStoryOnPageEl(pageEl, curIdx);
      if (!story){ curIdx++; continue; }

      const { restPlain } = fitKeepWithFormat(story);
      EditorCore.updatePageJsonFromStory(curIdx, story);

      if (!restPlain || restPlain.length === 0) break;

      // 下一個 novel；沒有就插一張白紙，拿新 front index
      let nextIdx = findNextNovel(curIdx);
      if (!nextIdx){
        nextIdx = SheetOps.insertBlankSheetAfterCurrentSheet();
        if (String(PAGES_DB[nextIdx-1]?.type||'').toLowerCase().replace(/-/g,'_') !== 'novel'){
          for (let k=curIdx+1;k<=PAGES_DB.length;k++){
            if (String(PAGES_DB[k-1]?.type||'').toLowerCase().replace(/-/g,'_') === 'novel') { nextIdx = k; break; }
          }
        }
      }

      const nextEl = EditorCore.getDomPagesList()[EditorCore.dbIndexToDomIndex(nextIdx)-1];
      const nextStory = EditorCore.ensureStoryOnPageEl(nextEl, nextIdx);
      if (!nextStory){ curIdx = nextIdx; continue; }
      const oldPlain = nextStory.textContent || '';
      setStoryPlain(nextStory, restPlain + oldPlain);
      EditorCore.updatePageJsonFromStory(nextIdx, nextStory);

      curIdx = nextIdx;
    }
    setTimeout(()=>{ try{ renderMetaForAllPages(); EditorCore.lockMeta(); }catch(e){} }, 0);
  }

  function bindTo(storyEl){
    const dbIndex = Number(storyEl.dataset.dbIndex||'0')|0;
    if (!dbIndex) return;

    storyEl.addEventListener('paste', (e)=>{
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
      document.execCommand('insertText', false, t);
      setTimeout(()=>{ flowOverflowFrom(dbIndex); }, 0);
    });

    storyEl.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter'){
        e.preventDefault();
        document.execCommand('insertText', false, '\n');
        setTimeout(()=>{ flowOverflowFrom(dbIndex); }, 0);
      }
    });

    storyEl.addEventListener('input', ()=>{
      EditorCore.updatePageJsonFromStory(dbIndex, storyEl);
      setTimeout(()=>{
        if (isOverflow(storyEl)) flowOverflowFrom(dbIndex);
        else { try{ renderMetaForAllPages(); EditorCore.lockMeta(); }catch(e){} }
      }, 0);
    });
  }

  window.PasteFlow = { bindTo, flowOverflowFrom };
})();


/* ===== text-controls.js ===== */

/* text-controls.js
 * 只作用於 .story 內「反白的文字」：B / I / U / 字級 ±0.2em
 * - 套用後維持反白（不取消選取）
 * - A+/A- 後呼叫 PasteFlow.flowOverflowFrom(db) → 放大字把溢出文本推到下一頁
 */
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
    restoreSelection(keep);
    setTimeout(()=>{ try{ PasteFlow.flowOverflowFrom(ctx.db); }catch(_){ } }, 0);
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

    if (node?.classList?.contains(FS_CLASS)){
      const cur = parseEm(node.style.fontSize); const base = isNaN(cur) ? 1 : cur;
      node.style.fontSize = clamp(+(base + delta).toFixed(2), FS_MIN, FS_MAX) + 'em';
      sel.removeAllRanges(); const r=document.createRange(); r.selectNodeContents(node); sel.addRange(r);
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
    }
    EditorCore.updatePageJsonFromStory(db, story);
    setTimeout(()=>{ try{ PasteFlow.flowOverflowFrom(db); }catch(_){ } }, 0);
  }

  document.getElementById('btnBold')?.addEventListener('click', ()=>applyExec('bold'));
  document.getElementById('btnItalic')?.addEventListener('click', ()=>applyExec('italic'));
  document.getElementById('btnUnderline')?.addEventListener('click', ()=>applyExec('underline'));
  document.getElementById('btnFontUp')?.addEventListener('click', ()=>sizeDelta(+0.2));
  document.getElementById('btnFontDown')?.addEventListener('click', ()=>sizeDelta(-0.2));

  window.TextControls = {};
})();


/* ===== page-style.js ===== */

/* page-style.js
 * 頁型切換（novel / divider-light / divider-dark / illustration）
 * - 只改本地資料＋輕量重畫（不重建 BookFlip）→ 不會壞翻頁
 * - 圖片頁雙擊可改網址（空值→回一般文本）
 */
(function(){
  function toHTMLFromPlain(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>'); }

  function getFocusedPage(){
    const db = EditorCore.getFocusedDbIndex();
    return { db, page: PAGES_DB[db - 1] };
  }

  function switchTo(style){
    syncAllStoriesToDB();

    const { db, page } = getFocusedPage();
    if (!page) return;

    const story = EditorCore.getStoryByDbIndex(db);
    const plainNow = story ? (story.textContent || '') : (page.content_json?.text_plain || '');

    if (style === 'novel'){
      page.type = 'novel';
      page.image_url = '';
      page.content_json = { text_plain: plainNow || '', text_html: toHTMLFromPlain(plainNow) };

    } else if (style === 'divider-light' || style === 'divider-dark'){
      page.type = (style === 'divider-light') ? 'divider_white' : 'divider_black';
      page.image_url = '';
      page.content_json = { text_plain: plainNow || '', text_html: toHTMLFromPlain(plainNow) };

    } else if (style === 'illustration'){
      if ((plainNow||'').trim().length > 0){
        alert('此頁仍有文本，請先清空文本再切換成圖片頁。');
        return;
      }
      const u = prompt('輸入圖片網址（留空=取消）', page.image_url || '');
      if (!u || !u.trim()){
        page.type = 'novel';
        page.image_url = '';
        page.content_json = { text_plain:'', text_html:'' };
      } else {
        page.type = 'image';
        page.image_url = u.trim();
        page.content_json = { text_plain:'', text_html:'' };
      }
    }

    lightRedraw();
    try{ persistDraft && persistDraft(); }catch(_){}
  }

  // 圖片頁雙擊：改網址；空值→回一般文本
  function bindImageEditors(){
    const list = EditorCore.getDomPagesList();
    for (let i=0;i<list.length;i++){
      const dbIndex = EditorCore.domIndexToDbIndex(i+1);
      if (dbIndex <= 0) continue;
      const p = PAGES_DB[dbIndex - 1];
      const pageEl = list[i];

      if (!EditorCore.isImagePage(p)) { pageEl.__imgEditBound = false; continue; }
      if (pageEl.__imgEditBound) continue;
      pageEl.__imgEditBound = true;

      pageEl.addEventListener('dblclick', ()=>{
        const u = prompt('輸入圖片網址（留空=改回一般頁）', p.image_url || '');
        if (!u || !u.trim()){
          p.type = 'novel';
          p.image_url = '';
          p.content_json = { text_plain:'', text_html:'' };
        } else {
          p.image_url = u.trim();
        }
        lightRedraw();
        try{ persistDraft && persistDraft(); }catch(_){}
      });
    }
  }

  document.querySelectorAll('.dock .btn[data-style]')?.forEach(btn=>{
    btn.addEventListener('click', ()=> switchTo(btn.getAttribute('data-style')));
  });

  window.PageStyle = { switchTo, bindImageEditors };
})();


/* ===== toc.js ===== */
/* toc.js — 目錄（TOC）純 UI：依 CHAPTERS_DB 渲染；點章節→跳頁 */
(function(){
  const tocModal = document.getElementById('tocModal');
  const tocBody  = document.getElementById('tocBody');
  const btnTOC   = document.getElementById('btnTOC');

  function escapeHTML(str){ return String(str||'').replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }

  function build(){
    if (!tocBody) return;
    const title = (window.ACTIVE_BOOK?.title || '未命名書籍').trim();
    const chapters = (window.CHAPTERS_DB || []).slice().sort((a,b)=>a.page_index - b.page_index);

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:2px 0 10px 0;';
    head.innerHTML = `<div style="font-weight:700;width:11em;letter-spacing:1px">${escapeHTML(title)}</div>
                      <button class="btn ghost" style="padding:2px 8px;border-color:#ffffff33;background:#ffffff00;color:#FFF;" id="tocGotoCover">去封面</button>`;
    tocBody.innerHTML = '';
    tocBody.appendChild(head);

    chapters.forEach(ch=>{
      const row = document.createElement('div');
      row.className = 'toc-row';
      row.innerHTML = `
        <div class="toc-title">${escapeHTML(ch.title)}</div>
        <div class="toc-page">${ch.page_index}</div>`;
      row.addEventListener('click', ()=>{
        window.gotoPageDomByDbIndex?.(ch.page_index);
        close();
      });
      tocBody.appendChild(row);
    });

    document.getElementById('tocGotoCover')?.addEventListener('click', ()=>{
      window.gotoDomPage?.(1);
      close();
    });
  }

  function open(){ build(); tocModal?.classList.add('show'); tocModal?.setAttribute('aria-hidden','false'); }
  function close(){ tocModal?.classList.remove('show'); tocModal?.setAttribute('aria-hidden','true'); }

  tocModal?.addEventListener('click', (e)=>{ if (e.target === tocModal) close(); });
  btnTOC  ?.addEventListener('click', open);

  window.TOC_API = { open, close, build };
})();
