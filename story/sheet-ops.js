/* sheet-ops.js
 * 插入/刪除白紙（兩頁 novel），重建 BookFlip 並正確定位游標
 * - 插入回傳新 front 的 dbIndex（供大量貼上繼續流向）
 */

(function(){
  function persist(){ try{ persistDraft && persistDraft(); }catch(_){} }
  function genLocalId(){ return 'local_' + Math.random().toString(36).slice(2,9); }
  function getSheetStart(dbIndex){ return (dbIndex % 2 === 0) ? dbIndex - 1 : dbIndex; }

  function rebuildAndRedrawPreserveCursor(preferDbIndex){
    try{
      const startDb = preferDbIndex || EditorCore.getFocusedDbIndex() || 1;
      const pairs = buildPairsFromPages();

      window.book = new BookFlip('#bookCanvas', {
        mode: state.mode,
        direction: state.direction,
        speed: 450,
        singleSpeed: 300,
        perspective: 2000,
        data: { pairs },
        startPageIndex: Math.max(0, EditorCore.dbIndexToDomIndex(startDb) - 1),
        coverPapers: 1
      });

      const orig = book._mountCurrent?.bind(book);
      if (orig){
        book._mountCurrent = function(){
          const r = orig();
          setTimeout(()=>{ try{ afterLayoutRedraw(); EditorCore.hookAllStories(); }catch(e){} }, 0);
          return r;
        };
      }
      book._cursorPage = Math.max(0, EditorCore.dbIndexToDomIndex(startDb) - 1);
      if (typeof book._mountCurrent === 'function') book._mountCurrent();

      applyLayout(); afterLayoutRedraw(); EditorCore.hookAllStories();
      if (typeof window.ensureSwipeBinding === 'function') ensureSwipeBinding();
    }catch(e){ console.warn('rebuild failed:', e); }
  }

  function insertBlankSheetAfterCurrentSheet(){
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

  // 綁定按鈕
  document.getElementById('btnInsertPage')?.addEventListener('click', insertBlankSheetAfterCurrentSheet);
  document.getElementById('btnDeleteBlank')?.addEventListener('click', deleteBlankSheetIfPossible);

  window.SheetOps = {
    rebuildAndRedrawPreserveCursor,
    insertBlankSheetAfterCurrentSheet,
    deleteBlankSheetIfPossible,
    getSheetStart
  };
})();
