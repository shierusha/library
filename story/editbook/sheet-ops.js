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
        const dbIndex = EditorCore.domIndexToDomIndex ? EditorCore.domIndexToDbIndex(i+1)
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
      const pi = (ch.page_index|0);
      if (pi >= thresholdDb) ch.page_index = Math.max(1, pi + delta);
    }
  }

  function normalizeType(t) {
    const x = String(t || '').trim().toLowerCase().replace(/-/g, '_');
    if (x === 'divider_black') return 'divider_dark';
    if (x === 'divider_white') return 'divider_light';
    if (x === 'image')        return 'illustration';
    if (x === 'novel' || x === 'divider_light' || x === 'divider_dark' || x === 'illustration') return x;
    return 'novel';
  }

  /* --------------------------------------------------
   * ① 固定末端插入，焦點/游標完全保留
   * -------------------------------------------------- */
  function insertBlankSheetAtEndKeepFocus(){
    if (!window.EditorCore) return 0;
    window.syncAllStoriesToDB(); // ← 改成全域呼叫，且有 fallback

    const focusBefore = EditorCore.getFocusedDbIndex() || 1;

    // 保存原 story 與選取（若目前 focus 在其他地方則略過）
    const activeStory =
      (document.activeElement?.classList?.contains('story')
        ? document.activeElement
        : EditorCore.getStoryByDbIndex(focusBefore));
    const savedSel = activeStory ? EditorCore.getOffsets(activeStory) : null;

    // 找到最後頁碼
    let last = 0;
    for (const p of PAGES_DB){ const n = (p.page_index|0); if (n > last) last = n; }
    const insertAt = Math.max(1, (last|0) + 1); // 新增紙張的 front dbIndex

    // 兩頁皆 novel
    const front = { id: genLocalId(), page_index: insertAt,   type:'novel', image_url:'', content_json:{ text_plain:'', text_html:'' } };
    const back  = { id: genLocalId(), page_index: insertAt+1, type:'novel', image_url:'', content_json:{ text_plain:'', text_html:'' } };

    PAGES_DB.push(front, back);
    PAGES_DB.sort((a,b)=> (a.page_index|0) - (b.page_index|0));

    // 章節索引往後平移
    shiftChaptersAfter(insertAt, +2);

    // 重建並鎖回原頁（避免在最後一頁時視覺被往前帶）
    rebuildAndRedrawPreserveCursor(focusBefore);
    if (typeof window.lockToDbIndex === 'function') lockToDbIndex(focusBefore);

    // 還原游標/選取
    setTimeout(()=>{
      const storyAfter = EditorCore.getStoryByDbIndex(focusBefore);
      if (storyAfter && savedSel) {
        try { EditorCore.setOffsets(storyAfter, savedSel.start, savedSel.end); } catch(_){}
        storyAfter.focus?.();
      }
      try{ renderMetaForAllPages(); EditorCore.lockMeta(); }catch(_){}
    }, 0);

    persist();
    return insertAt;
  }

  /* --------------------------------------------------
   * ② 在目前「紙張」後插入，回傳新 front 的 dbIndex（供 paste-flow 使用）
   * -------------------------------------------------- */
  function insertBlankSheetAfterCurrentSheet(){
    window.syncAllStoriesToDB(); // ← 改成全域呼叫

    const cur = EditorCore.getFocusedDbIndex() || 1;
    const sheetStart = getSheetStart(cur);
    const insertAt = sheetStart + 2; // 下一張紙的 front

    // 調整後面所有頁的 page_index（+2）
    for (const p of PAGES_DB){ if ((p.page_index|0) >= insertAt) p.page_index = (p.page_index|0) + 2; }

    const front = { id: genLocalId(), page_index: insertAt,   type:'novel', image_url:'', content_json:{ text_plain:'', text_html:'' } };
    const back  = { id: genLocalId(), page_index: insertAt+1, type:'novel', image_url:'', content_json:{ text_plain:'', text_html:'' } };
    PAGES_DB.push(front, back);
    PAGES_DB.sort((a,b)=> (a.page_index|0) - (b.page_index|0));

    // 章節索引平移
    shiftChaptersAfter(insertAt, +2);

    // 重建：維持原本的可視頁（cur）不跳動
    rebuildAndRedrawPreserveCursor(cur);
    if (typeof window.lockToDbIndex === 'function') lockToDbIndex(cur);

    persist();
    try{ renderMetaForAllPages(); EditorCore.lockMeta(); }catch(_){}

    return insertAt;
  }

  /* --------------------------------------------------
   * ③ 刪除空白「紙張」（兩頁皆為空 novel 才允許）
   * -------------------------------------------------- */
  function deleteBlankSheetIfPossible(){
    window.syncAllStoriesToDB(); // ← 改成全域呼叫

    const db = EditorCore.getFocusedDbIndex() || 1;
    const sheetStart = getSheetStart(db);
    const a = PAGES_DB[sheetStart - 1];
    const b = PAGES_DB[sheetStart];

    function isBlankNovel(p){
      if (!p) return false;
      if (normalizeType(p.type) !== 'novel') return false;
      const txt = (p.content_json?.text_plain || '').trim();
      const html = (p.content_json?.text_html || '').replace(/<br\s*\/?>/gi,'').replace(/\s+/g,'').trim();
      return !txt && !html;
    }

    if (!isBlankNovel(a) || !isBlankNovel(b)) return false;

    const focusBefore = db;

    // 先把後面全部往前 −2
    const after = sheetStart + 2;
    for (const p of PAGES_DB){ if ((p.page_index|0) >= after) p.page_index = (p.page_index|0) - 2; }

    // 移除這兩頁
    PAGES_DB = PAGES_DB.filter(p => (p !== a && p !== b));

    // 章節索引平移
    shiftChaptersAfter(after, -2);

    // 重建並鎖回原頁
    rebuildAndRedrawPreserveCursor(focusBefore);
    if (typeof window.lockToDbIndex === 'function') lockToDbIndex(focusBefore);

    persist();
    try{ renderMetaForAllPages(); EditorCore.lockMeta(); }catch(_){}
    return true;
  }

  // 綁定按鈕
  document.getElementById('btnInsertPage')?.addEventListener('click', insertBlankSheetAtEndKeepFocus);
  document.getElementById('btnDeleteBlank')?.addEventListener('click', deleteBlankSheetIfPossible);

  window.SheetOps = {
    rebuildAndRedrawPreserveCursor,
    insertBlankSheetAfterCurrentSheet,  // 給 paste-flow 使用
    insertBlankSheetAtEndKeepFocus,
    deleteBlankSheetIfPossible,
    getSheetStart
  };
})();
