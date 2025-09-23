/* editor-core.js
 * 共用工具 + hookAllStories()
 * novel / divider(白/黑) 會補 .story[contenteditable]（圖片頁不編輯）
 * 修正：初次掛 story 會先讀取頁面既有文字，避免重整後文本消失
 * 修正：用 MutationObserver 確保 BookFlip 渲染後再掛，避免首進入不可編輯
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

  function textContentOfNodes(nodes){
    let s = '';
    nodes.forEach(n => { s += (n.textContent || ''); });
    return s.replace(/\u00a0/g, ' '); // nbsp -> space
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
      // 先抓舊內容（非角標）
      const metas = new Set(Array.from(pageEl.querySelectorAll('.page-meta')));
      const olds = Array.from(pageEl.childNodes).filter(n => !(n.nodeType===1 && metas.has(n)));
      const oldPlain = textContentOfNodes(olds).trim();

      // 建立 .story
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

      if (isNovelPage(p)){
        story.style.width='100%';
        story.style.minHeight='100%';
        story.style.flex='1 1 auto';
        story.style.alignSelf='stretch';
        story.style.boxSizing='border-box';
      } else {
        story.style.minHeight='1.2em';
        pageEl.addEventListener('mousedown', (e)=>{
          if (e.target.closest('.page-meta')) return;
          story.focus();
        });
      }

      // 插入在最前面，保留角標
      pageEl.insertBefore(story, pageEl.firstChild);
      // 移除舊內容
      olds.forEach(n=> n.parentNode && n.parentNode.removeChild(n));

      // 初始化純文字：優先 DB.text_plain；若空則用舊 DOM 文字
      const plainInit = (p.content_json?.text_plain ?? '').trim() || oldPlain;
      if (plainInit) {
        story.textContent = plainInit;
        p.content_json = p.content_json || {};
        if (!p.content_json.text_plain) p.content_json.text_plain = plainInit;
        if (!p.content_json.text_html)  p.content_json.text_html  = plainInit.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>');
      }
    }

    // 綁貼上/輸入事件
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

  // 用 MutationObserver 確保 BookFlip 渲染後我們再掛 story
  let mo;
  function observeBook(){
    if (mo) mo.disconnect();
    mo = new MutationObserver(()=> {
      // debounce 一下
      clearTimeout(observeBook._t);
      observeBook._t = setTimeout(()=>{ try{ hookAllStories(); }catch(e){} }, 30);
    });
    mo.observe(document.getElementById('bookCanvas'), { childList:true, subtree:true });
  }

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
