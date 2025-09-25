/* sheet-ops.js
 * 插入/刪除白紙（兩頁 novel），重建 BookFlip 並正確定位游標
 * - 插入回傳新 front 的 dbIndex（供大量貼上繼續流向）
 * - 移除「手動插入白紙」按鈕綁定；保留內部插入 API 給 PasteFlow 自動使用
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

  // ❌ 取消手動插入白紙按鈕（仍保留刪除白紙）
  // document.getElementById('btnInsertPage')?.addEventListener('click', insertBlankSheetAfterCurrentSheet);
  document.getElementById('btnDeleteBlank')?.addEventListener('click', deleteBlankSheetIfPossible);

  window.SheetOps = {
    rebuildAndRedrawPreserveCursor,
    insertBlankSheetAfterCurrentSheet, // 提供給 PasteFlow 自動加頁
    deleteBlankSheetIfPossible,
    getSheetStart
  };
})();
