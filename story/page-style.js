/* page-style.js
 * 頁型切換（novel / divider-light / divider-dark / illustration）
 * - 只改「目前編輯頁」的本地 type → 輕量重畫（不重建 BookFlip）
 * - 圖片頁雙擊可改網址（空值→回一般文本）
 */
(function(){
  function isStoryVisuallyEmpty(storyEl){
    if (!storyEl) return true;
    const txt = (storyEl.textContent || '').replace(/\u200B/g,'').replace(/\u00A0/g,' ').trim();
    return txt.length === 0;
  }

  function getFocusedPage(){
    const db = EditorCore.getFocusedDbIndex();
    return { db, page: PAGES_DB[db - 1] };
  }

  function switchTo(style){
    syncAllStoriesToDB();

    const { db, page } = getFocusedPage();
    if (!page) return;

    const story = EditorCore.getStoryByDbIndex(db);
    const htmlNow = story ? (story.innerHTML || '') : (page.content_json?.text_html || '');

    if (style === 'novel'){
      page.type = 'novel';
      page.image_url = '';
      page.content_json = { text_html: htmlNow || '' };

    } else if (style === 'divider-light' || style === 'divider-dark'){
      page.type = (style === 'divider-light') ? 'divider_white' : 'divider_black';
      page.image_url = '';
      page.content_json = { text_html: htmlNow || '' };

    } else if (style === 'illustration'){
      // 只看目前編輯頁是否空白（視覺空白）
      if (!isStoryVisuallyEmpty(story)){
        alert('此頁仍有文本，請先清空文本再切換成圖片頁。');
        return;
      }
      const u = prompt('輸入圖片網址（留空=取消）', page.image_url || '');
      if (!u || !u.trim()){
        page.type = 'novel';
        page.image_url = '';
        page.content_json = { text_html:'' };
      } else {
        page.type = 'image';
        page.image_url = u.trim();
        page.content_json = { text_html:'' };
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

      const isImage = String(p?.type||'').toLowerCase().replace(/-/g,'_') === 'image';
      if (!isImage) { pageEl.__imgEditBound = false; continue; }
      if (pageEl.__imgEditBound) continue;
      pageEl.__imgEditBound = true;

      pageEl.addEventListener('dblclick', ()=>{
        const u = prompt('輸入圖片網址（留空=改回一般頁）', p.image_url || '');
        if (!u || !u.trim()){
          p.type = 'novel';
          p.image_url = '';
          p.content_json = { text_html:'' };
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
