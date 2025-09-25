/* sheet-ops.js — 插入/刪除白紙（兩頁） v2 */
(function(){
  function persist(){ try{ persistDraft && persistDraft(); }catch(_){} }
  function genLocalId(){ return 'local_' + Math.random().toString(36).slice(2,9); }

  function rebuildAndRedrawPreserveCursor(preferDbIndex){
    const currentDom = (window.book?._cursorPage || 0) + 1;
    const currentDb  = EditorCore.domIndexToDbIndex(currentDom) || 1;
    const startDb    = Math.max(1, preferDbIndex || currentDb);
    rebuildTo(startDb);
    try{
      const backDom = Math.max(0, currentDom - 1);
      window.book._cursorPage = backDom;
      window.book._mountCurrent();
    }catch(_){}
  }

  function insertBlankSheetAfterCurrentSheet(){
    syncAllStoriesToDB();

    const insertAt = (PAGES_DB.length > 0)
      ? (PAGES_DB[PAGES_DB.length - 1].page_index + 1)
      : 1;

    const front = { id: genLocalId(), page_index: insertAt,   type:'novel', image_url:'', content_json:{text_plain:'', text_html:''} };
    const back  = { id: genLocalId(), page_index: insertAt+1, type:'novel', image_url:'', content_json:{text_plain:'', text_html:''} };

    PAGES_DB.push(front, back);
    PAGES_DB.sort((a,b)=>a.page_index - b.page_index);

    rebuildAndRedrawPreserveCursor();
    persist();
    return insertAt;
  }

  function deleteBlankSheetIfPossible(){
    syncAllStoriesToDB();

    const currentDom = (window.book?._cursorPage || 0) + 1;
    const db = EditorCore.domIndexToDbIndex(currentDom) || 1;
    const sheetStart = (db % 2 === 0) ? db - 1 : db;
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

    rebuildAndRedrawPreserveCursor(Math.max(1, sheetStart - 1));
    persist();
  }

  document.getElementById('btnInsertPage')?.addEventListener('click', insertBlankSheetAfterCurrentSheet);
  document.getElementById('btnDeleteBlank')?.addEventListener('click', deleteBlankSheetIfPossible);

  window.SheetOps = { rebuildAndRedrawPreserveCursor, insertBlankSheetAfterCurrentSheet, deleteBlankSheetIfPossible };
})();
