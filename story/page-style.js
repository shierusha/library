/* page-style.js
 * 下方 Dock 的頁型切換（novel / divider-light / divider-dark / illustration）
 * 並支援：圖片頁雙擊可改網址（空值→轉回一般文本）
 */

(function(){
  function toHTMLFromPlain(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>'); }

  function getFocusedPage(){
    const db = EditorCore.getFocusedDbIndex();
    return { db, page: PAGES_DB[db - 1] };
  }

  function switchTo(style){
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
        // 取消 → 回一般文本
        page.type = 'novel';
        page.image_url = '';
        page.content_json = { text_plain:'', text_html:'' };
      } else {
        page.type = 'image';
        page.image_url = u.trim();
        page.content_json = { text_plain:'', text_html:'' };
      }
    }

    SheetOps.rebuildAndRedrawPreserveCursor(db);
    try{ persistDraft && persistDraft(); }catch(_){}
    setTimeout(()=>{ try{ afterLayoutRedraw(); EditorCore.hookAllStories(); bindImageEditors(); }catch(e){} }, 0);
  }

  // 綁定圖片頁雙擊：改網址；空值→轉回一般文本
  function bindImageEditors(){
    const list = EditorCore.getDomPagesList();
    for (let i=0;i<list.length;i++){
      const dbIndex = EditorCore.domIndexToDbIndex(i+1);
      if (dbIndex <= 0) continue;
      const p = PAGES_DB[dbIndex - 1];
      if (!EditorCore.isImagePage(p)) continue;
      const pageEl = list[i];

      if (pageEl.__imgEditBound) continue;
      pageEl.__imgEditBound = true;

      pageEl.addEventListener('dblclick', ()=>{
        const u = prompt('輸入圖片網址（留空=改回一般頁）', p.image_url || '');
        if (!u || !u.trim()){
          // 回一般頁
          p.type = 'novel';
          p.image_url = '';
          p.content_json = { text_plain:'', text_html:'' };
        }else{
          p.image_url = u.trim();
        }
        SheetOps.rebuildAndRedrawPreserveCursor(dbIndex);
        try{ persistDraft && persistDraft(); }catch(_){}
        setTimeout(()=>{ try{ afterLayoutRedraw(); EditorCore.hookAllStories(); bindImageEditors(); }catch(e){} }, 0);
      });
    }
  }

  document.querySelectorAll('.dock .btn[data-style]')?.forEach(btn=>{
    btn.addEventListener('click', ()=> switchTo(btn.getAttribute('data-style')));
  });

  window.PageStyle = { switchTo, bindImageEditors };
})();
