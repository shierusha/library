/* editor-core.js
 * 共用工具 + hookAllStories()
 * 讓 novel / divider(白/黑) 都有 .story[contenteditable]（圖片頁不編輯）
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
      // 保留角標，清掉舊內容（非角標）
      const metas = new Set(Array.from(pageEl.querySelectorAll('.page-meta')));
      Array.from(pageEl.childNodes).forEach(n=>{
        if (n.nodeType===1 && metas.has(n)) return;
        pageEl.removeChild(n);
      });

      story = document.createElement('div');
      story.className = 'page-content story';
      story.setAttribute('contenteditable','true');
      story.dataset.dbIndex = String(dbIndex);

      // 基本輸入＋空白可點
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
        // 整頁點擊也能進入輸入
        pageEl.addEventListener('mousedown', (e)=>{
          if (e.target.closest('.page-meta')) return;
          story.focus();
        });
      }
      pageEl.insertBefore(story, pageEl.firstChild);
    }

    // 初始化純文字
    const plain = (p.content_json?.text_plain) || '';
    if (story.textContent !== plain) story.textContent = plain;

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
    // 圖片頁雙擊可改網址
    try { window.PageStyle?.bindImageEditors?.(); } catch(_){}
  }

  window.EditorCore = {
    getDomPagesList, domIndexToDbIndex, dbIndexToDomIndex,
    isImagePage, isDividerPage, isNovelPage, isEditablePage,
    lockMeta, ensureStoryOnPageEl, getStoryByDbIndex,
    getFocusedDbIndex, updatePageJsonFromStory, hookAllStories
  };

  // 讓 app.js 既有呼叫可用
  window.EditorFlow = { hookAllStories };

  document.addEventListener('DOMContentLoaded', ()=> setTimeout(hookAllStories, 0));
})();
