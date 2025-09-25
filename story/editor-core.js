/* editor-core.js
 * 共用工具 + hookAllStories()
 * - 保底 window.state，避免引用時未定義
 * - novel / divider(白/黑) 會補 .story[contenteditable]（圖片頁不編輯）
 * - 初次掛 .story 會保留原頁文字（避免重整後文本消失）
 * - 角標鎖不可編輯
 * - MutationObserver：BookFlip 渲染後自動掛 .story
 */
(function(){
  /** 保底全域參考 **/
  window.state  = window.state  || { mode:'spread', direction:'ltr', bind:'short', aspectShort:5/7, aspectLong:7/5 };
  window.elBook = window.elBook || document.getElementById('bookCanvas');

  const state  = window.state;
  const elBook = window.elBook;

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

  function normType(t){ return String(t||'').toLowerCase().replace(/-/g,'_'); }
  function isImagePage(p){ return normType(p?.type||'') === 'image'; }
  function isDividerPage(p){ const t = normType(p?.type||''); return t === 'divider_white' || t === 'divider_light' || t === 'divider_dark' || t === 'divider_black'; }
  function isNovelPage(p){ return normType(p?.type||'') === 'novel'; }
  function isEditablePage(p){ return isNovelPage(p) || isDividerPage(p); }

  function lockMeta(){
    elBook.querySelectorAll('.page-meta').forEach(m=>{
      m.setAttribute('contenteditable','false');
      m.style.pointerEvents='none';
      m.style.userSelect='none';
    });
  }

  function isVisuallyEmpty(el){
    if (!el) return true;
    const txt = (el.textContent || '').replace(/\u200B/g,'').replace(/\u00A0/g,' ').trim();
    return txt.length === 0;
  }

  function persist(){ try{ persistDraft && persistDraft(); }catch(_){} }

  function updatePageJsonFromStory(dbIndex, storyEl){
    const p = PAGES_DB[dbIndex - 1]; if (!p) return;
    const html = isVisuallyEmpty(storyEl) ? '' : (storyEl.innerHTML || '');
    p.content_json = { text_html: html }; // 僅存 HTML
    persist();
  }

  function ensureStoryOnPageEl(pageEl, dbIndex){
    const p = PAGES_DB[dbIndex - 1];
    if (!p || !isEditablePage(p)) return null;

    let story = pageEl.querySelector('.story');
    if (!story){
      // 收集原先非角標內容
      const metas = new Set(Array.from(pageEl.querySelectorAll('.page-meta')));
      const olds = Array.from(pageEl.childNodes).filter(n => !(n.nodeType===1 && metas.has(n)));

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

      // 垂直黑/白置中：不要吃滿寬，視覺置中
      if (isDividerPage(p) && document.body.classList.contains('mode-rtl')) {
        story.style.width = 'auto';
        story.style.inlineSize = 'auto';
        story.style.maxWidth = '90%';
        story.style.alignSelf = 'center';
        story.style.margin = '0 auto';
        story.style.textAlign = 'center';
      }

      // 初始化：DB 為主；沒有時用舊 DOM 文本（轉為安全 HTML）
      const htmlInit = (p.content_json?.text_html ?? '');
      if (htmlInit) story.innerHTML = htmlInit;
      else {
        const tmp = document.createElement('div');
        olds.forEach(n=> tmp.appendChild(n.cloneNode(true)));
        const plain = (tmp.textContent || '').trim();
        if (plain){
          const safe = plain.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>');
          story.innerHTML = safe;
          p.content_json = { text_html: safe };
        }
      }

      // 清掉舊內容，插入 story
      pageEl.insertBefore(story, pageEl.firstChild);
      olds.forEach(n=> n.parentNode && n.parentNode.removeChild(n));
    }

    // 綁貼上/輸入（去格式、溢出才分頁）
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
