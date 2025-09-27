/* sheet-ops.js
 * 插入/刪除白紙（兩頁 novel），重建 BookFlip 並正確定位游標
 * - 插入回傳新 front 的 dbIndex（供大量貼上繼續流向）
 * - ★ 同步維護 CHAPTERS_DB 的 page_index（插入時 +2；刪除時 -2）
 */
(function(){
  function persist(){ try{ persistDraft && persistDraft(); }catch(_){} }
  function genLocalId(){ return 'local_' + Math.random().toString(36).slice(2,9); }
  function getSheetStart(dbIndex){ return (dbIndex % 2 === 0) ? dbIndex - 1 : dbIndex; }

  function rebuildAndRedrawPreserveCursor(preferDbIndex){
    const startDb = Math.max(1, preferDbIndex || (window.EditorCore?.getFocusedDbIndex?.() || 1));
    if (typeof window.rebuildTo === 'function') rebuildTo(startDb);
  }

  function shiftChaptersAfter(insertAt, delta){
    if (!Array.isArray(window.CHAPTERS_DB) || !CHAPTERS_DB.length) return;
    CHAPTERS_DB.forEach(ch => {
      if ((ch.page_index|0) >= (insertAt|0)) ch.page_index = (ch.page_index|0) + delta;
    });
    CHAPTERS_DB.sort((a,b)=>(a.page_index|0)-(b.page_index|0));
  }

  function insertBlankSheetAfterCurrentSheet(){
    syncAllStoriesToDB();
    const focusBefore = EditorCore.getFocusedDbIndex();
    const sheetStart  = getSheetStart(focusBefore);
    const insertAt    = sheetStart + 2; // 下一張紙的 front

    const front = { id: genLocalId(), page_index: insertAt,   type:'novel', image_url:'', content_json:{text_plain:'', text_html:''} };
    const back  = { id: genLocalId(), page_index: insertAt+1, type:'novel', image_url:'', content_json:{text_plain:'', text_html:''} };

    for (const p of PAGES_DB){ if ((p.page_index|0) >= (insertAt|0)) p.page_index = (p.page_index|0) + 2; }
    shiftChaptersAfter(insertAt, +2);

    PAGES_DB.push(front, back);
    PAGES_DB.sort((a,b)=> (a.page_index|0) - (b.page_index|0));

    // 原本：rebuildAndRedrawPreserveCursor(insertAt); → 會跳去新頁
    // 改成：維持舊頁焦點
    rebuildAndRedrawPreserveCursor(focusBefore);
    persist();
    try{ renderMetaForAllPages(); EditorCore.lockMeta(); }catch(_){}
    return insertAt;
  }

  // ★ 固定末端插入，並維持焦點在原頁（不跳頁）
  function insertBlankSheetAtEndKeepFocus(){
    syncAllStoriesToDB();

    const focusBefore = EditorCore.getFocusedDbIndex() || 1;
    let last = 0;
    for (const p of PAGES_DB){ const n = (p.page_index|0); if (n > last) last = n; }
    const insertAt = Math.max(1, (last|0) + 1); // 新增紙張的 front

    const front = { id: genLocalId(), page_index: insertAt,   type:'novel', image_url:'', content_json:{text_plain:'', text_html:''} };
    const back  = { id: genLocalId(), page_index: insertAt+1, type:'novel', image_url:'', content_json:{text_plain:'', text_html:''} };

    PAGES_DB.push(front, back);
    PAGES_DB.sort((a,b)=> (a.page_index|0) - (b.page_index|0));

    rebuildAndRedrawPreserveCursor(focusBefore);
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
    if (!isBlankNovel(a) || !isBlankNovel(b)) { toast('只有「空白 novel ×2」才允許刪除'); return; }

    PAGES_DB = PAGES_DB.filter(p => (p.page_index|0) < (sheetStart|0) || (p.page_index|0) > (sheetStart+1|0));

    for (const p of PAGES_DB){ if ((p.page_index|0) > (sheetStart+1|0)) p.page_index = (p.page_index|0) - 2; }
    shiftChaptersAfter(sheetStart+2, -2);

    PAGES_DB.sort((x,y)=> (x.page_index|0) - (y.page_index|0));

    const target = Math.max(1, sheetStart - 1);
    rebuildAndRedrawPreserveCursor(target);
    persist();
    try{ renderMetaForAllPages(); EditorCore.lockMeta(); }catch(_){}
  }

  // 綁定按鈕
  document.getElementById('btnInsertPage')?.addEventListener('click', insertBlankSheetAtEndKeepFocus);
  document.getElementById('btnDeleteBlank')?.addEventListener('click', deleteBlankSheetIfPossible);

  window.SheetOps = {
    rebuildAndRedrawPreserveCursor,
    insertBlankSheetAfterCurrentSheet,  // 保留舊的，給 paste-flow 可能會用到
    insertBlankSheetAtEndKeepFocus,     // 新：固定末端插入且維持焦點
    deleteBlankSheetIfPossible,
    getSheetStart
  };
})();
