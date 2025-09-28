/* sheet-ops.js
 * 插入/刪除白紙（兩頁 novel），重建 BookFlip 並正確定位游標 / 焦點
 * - insertBlankSheetAtEndKeepFocus()：固定插在書末，畫面與游標都維持在原頁
 * - insertBlankSheetAfterCurrentSheet()：在目前「紙張」後方插入，回傳新 front 的 dbIndex（供 paste-flow 使用）
 * - 刪除紙張：若兩頁皆為空 novel 才可刪，並調整 CHAPTERS_DB 的 page_index
 */
(function(){
  /* ---------- Fallback：若全域沒有 syncAllStoriesToDB，就補上一個 ---------- */
  if (typeof window.syncAllStoriesToDB !== 'function') {
    window.syncAllStoriesToDB = function syncAllStoriesToDB(){
      if (!window.EditorCore) return;
      const domList = EditorCore.getDomPagesList();
      for (let i=0;i<domList.length;i++){
        const dbIndex = EditorCore.domIndexToDbIndex ? EditorCore.domIndexToDbIndex(i+1)
                      : (i+1 <= 2 ? 0 : (i+1) - 2); // 保險：無對應函式時的簡易換算
        if (dbIndex <= 0) continue;
        const story = domList[i].querySelector('.story');
        if (!story) continue;
        EditorCore.updatePageJsonFromStory(dbIndex, story);
      }
    };
  }

  function persist(){ try{ persistDraft && persistDraft(); }catch(_){} }
  function genLocalId(){ return 'local_' + Math.random().toString(36).slice(2,9); }
  function getSheetStart(dbIndex){ return (dbIndex % 2 === 0) ? dbIndex - 1 : dbIndex; }

  function rebuildAndRedrawPreserveCursor(preferDbIndex){
    const startDb = Math.max(1, preferDbIndex || (window.EditorCore?.getFocusedDbIndex?.() || 1));
    if (typeof window.rebuildTo === 'function') rebuildTo(startDb);
  }

  function shiftChaptersAfter(thresholdDb, delta){
    if (!Array.isArray(window.CHAPTERS_DB)) return;
    for (const ch of CHAPTERS_DB){
      const pi = ch?.page_index|0;
      if (pi > thresholdDb) ch.page_index = pi + delta;
    }
  }

  /* --------------------------------------------------
   * ① 在書末插入白紙（兩頁 novel），保留目前焦點頁
   * -------------------------------------------------- */
  window.insertBlankSheetAtEndKeepFocus = function insertBlankSheetAtEndKeepFocus(){
    syncAllStoriesToDB();

    const focusBefore = EditorCore.getFocusedDbIndex() || 1;
    const len = (Array.isArray(PAGES_DB) ? PAGES_DB.length : 0)|0;

    // 追加兩頁
    const front = { id: genLocalId(), page_index: len+1, type:'novel', content_json:{ text_html:'', text_plain:'' } };
    const back  = { id: genLocalId(), page_index: len+2, type:'novel', content_json:{ text_html:'', text_plain:'' } };
    PAGES_DB.push(front, back);

    rebuildAndRedrawPreserveCursor(focusBefore);
    persist();
  };

  /* --------------------------------------------------
   * ② 在目前「紙張」後插入，回傳新 front
   * -------------------------------------------------- */
  window.insertBlankSheetAfterCurrentSheet = function insertBlankSheetAfterCurrentSheet(){
    syncAllStoriesToDB();

    const cur = EditorCore.getFocusedDbIndex() || 1;           // 例如 5
    const start = getSheetStart(cur);                           // 紙張起點（奇數）
    const insertAt = start + 2;                                 // 要插入的位置（新 front 的 dbIndex）

    // 調整後面頁的 index
    for (let i=PAGES_DB.length-1;i>=insertAt-1;i--){
      const p = PAGES_DB[i]; if (!p) continue;
      p.page_index = (p.page_index|0) + 2;
    }

    // 插入兩頁
    const front = { id: genLocalId(), page_index: insertAt,   type:'novel', content_json:{ text_html:'', text_plain:'' } };
    const back  = { id: genLocalId(), page_index: insertAt+1, type:'novel', content_json:{ text_html:'', text_plain:'' } };
    PAGES_DB.splice(insertAt-1, 0, front, back);

    // 章節 page_index 往後推
    shiftChaptersAfter(insertAt-1, +2);

    // 重建 & 還原游標
    const savedSel = (function(){
      const story = EditorCore.getStoryByDbIndex(cur);
      return story ? EditorCore.getOffsets(story) : null;
    })();

    rebuildAndRedrawPreserveCursor(cur);

    setTimeout(()=>{
      const storyAfter = EditorCore.getStoryByDbIndex(cur);
      if (storyAfter && savedSel) {
        try { EditorCore.setOffsets(storyAfter, savedSel.start, savedSel.end); } catch(_){}
        storyAfter.focus?.();
      }
      try{ renderMetaForAllPages(); EditorCore.lockMeta(); }catch(_){}
    }, 0);

    persist();
    return insertAt;
  };

  /* --------------------------------------------------
   * ③ 刪除整張白紙（兩頁都是空 novel 時才允許）
   * -------------------------------------------------- */
  window.deleteCurrentBlankSheetIfPossible = function deleteCurrentBlankSheetIfPossible(){
    syncAllStoriesToDB();

    const cur = EditorCore.getFocusedDbIndex() || 1;
    const start = getSheetStart(cur);

    function isEmptyNovel(db){
      const p = PAGES_DB[db-1];
      if (!p || String(p.type).toLowerCase().replace(/-/g,'_') !== 'novel') return false;
      const t = String(p?.content_json?.text_plain || '').trim();
      const h = String(p?.content_json?.text_html  || '').replace(/<br\s*\/?>/gi,'').replace(/&nbsp;/g,' ').trim();
      return (!t && !h);
    }

    // 必須兩頁都是空 novel
    if (!isEmptyNovel(start) || !isEmptyNovel(start+1)) return false;

    // 移除兩頁
    PAGES_DB.splice(start-1, 2);

    // 後面頁 index -2
    for (let i=start-1;i<PAGES_DB.length;i++){
      const p = PAGES_DB[i]; if (!p) continue;
      p.page_index = Math.max(1, (p.page_index|0) - 2);
    }

    // 章節 page_index 往前拉
    shiftChaptersAfter(start+1, -2);

    rebuildAndRedrawPreserveCursor(Math.max(1, start-1));
    persist();
    return true;
  };
})();
