
/* sheet-ops.js
 * 插入/刪除白紙（兩頁 novel），重建 BookFlip 並正確定位游標
 * - 插入回傳新 front 的 dbIndex（供大量貼上繼續流向）
 * - ★ 同步維護 CHAPTERS_DB 的 page_index（插入時 +2；刪除時 -2；被刪掉那兩頁上的章節會移除）
 */
(function(){
  function persist(){ try{ persistDraft && persistDraft(); }catch(_){} }
  function genLocalId(){ return 'local_' + Math.random().toString(36).slice(2,9); }
  function getSheetStart(dbIndex){ return (dbIndex % 2 === 0) ? dbIndex - 1 : dbIndex; }

  function rebuildAndRedrawPreserveCursor(preferDbIndex){
    const startDb = Math.max(1, preferDbIndex || EditorCore.getFocusedDbIndex() || 1);
    rebuildTo(startDb);
  }

  function shiftChaptersAfter(insertAt, delta){
    if (!Array.isArray(window.CHAPTERS_DB) || !CHAPTERS_DB.length) return;
    // delta: +2（插入）或 -2（刪除後調整）
    CHAPTERS_DB.forEach(ch => {
      if ((ch.page_index|0) >= (insertAt|0)) ch.page_index = (ch.page_index|0) + delta;
    });
    CHAPTERS_DB.sort((a,b)=>(a.page_index|0)-(b.page_index|0));
  }

  function removeChaptersOnRange(start, end){
    // 把剛被刪掉的兩頁上的章節刪掉
    if (!Array.isArray(window.CHAPTERS_DB) || !CHAPTERS_DB.length) return;
    CHAPTERS_DB = CHAPTERS_DB.filter(ch => (ch.page_index|0) < (start|0) || (ch.page_index|0) > (end|0));
  }

  function insertBlankSheetAfterCurrentSheet(){
    syncAllStoriesToDB();

    const focusBefore = EditorCore.getFocusedDbIndex();
    const sheetStart  = getSheetStart(focusBefore);
    const insertAt    = sheetStart + 2; // 下一張紙的 front

    const front = { id: genLocalId(), page_index: insertAt,   type:'novel', image_url:'', content_json:{text_plain:'', text_html:''} };
    const back  = { id: genLocalId(), page_index: insertAt+1, type:'novel', image_url:'', content_json:{text_plain:'', text_html:''} };

    // 先平移既有頁
    for (const p of PAGES_DB){ if ((p.page_index|0) >= (insertAt|0)) p.page_index = (p.page_index|0) + 2; }
    // ★ 章節也跟著平移
    shiftChaptersAfter(insertAt, +2);

    PAGES_DB.push(front, back);
    PAGES_DB.sort((a,b)=> (a.page_index|0) - (b.page_index|0));

    rebuildAndRedrawPreserveCursor(insertAt);
    persist();
    try{ renderMetaForAllPages(); EditorCore.lockMeta(); }catch(_){}
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

    // 移除這兩頁
    PAGES_DB = PAGES_DB.filter(x => x !== a && x !== b);

    // ★ 章節：先移除剛好在這兩頁上的章節
    removeChaptersOnRange(sheetStart, sheetStart+1);

    // 後面的頁往前平移 2
    for (const p of PAGES_DB){ if ((p.page_index|0) > (sheetStart+1|0)) p.page_index = (p.page_index|0) - 2; }
    // ★ 章節也一起平移
    shiftChaptersAfter(sheetStart+2, -2);

    PAGES_DB.sort((x,y)=> (x.page_index|0) - (y.page_index|0));

    const target = Math.max(1, sheetStart - 1);
    rebuildAndRedrawPreserveCursor(target);
    persist();
    try{ renderMetaForAllPages(); EditorCore.lockMeta(); }catch(_){}
  }

  // 綁定按鈕（維持你原本的 ID）
  document.getElementById('btnInsertPage')?.addEventListener('click', insertBlankSheetAfterCurrentSheet);
  document.getElementById('btnDeleteBlank')?.addEventListener('click', deleteBlankSheetIfPossible);

  window.SheetOps = {
    rebuildAndRedrawPreserveCursor,
    insertBlankSheetAfterCurrentSheet,
    deleteBlankSheetIfPossible,
    getSheetStart
  };
})();

