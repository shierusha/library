/* toc.js — 目錄模組（本地版）
 * 功能：
 * - 打開/關閉目錄浮層
 * - 依 CHAPTERS_DB 產生 TOC；點項目可跳頁
 * - 支援「插入章節」：在目前頁新增/修改/刪除章節（留空 = 刪除）
 * - 跳頁/關閉時會重繪角標（renderMetaForAllPages + lockMeta），避免偶發消失
 *
 * 需求：全域可取用 ACTIVE_BOOK, CHAPTERS_DB, state, elBook, book,
 *       EditorCore (dbIndex<->domIndex, getFocusedDbIndex), lightRedraw, persistDraft
 */
(function () {
  const tocModal = document.getElementById('tocModal');
  const tocBody  = document.getElementById('tocBody');
  const btnTOC   = document.getElementById('btnTOC');
  const btnAdd   = document.getElementById('btnInsertChapter');

  function open() {
    build();
    tocModal.classList.add('show');
    tocModal.setAttribute('aria-hidden', 'false');
  }

  function close() {
    tocModal.classList.remove('show');
    tocModal.setAttribute('aria-hidden', 'true');
    // 關閉時補一次角標，避免頁碼/章節角標偶發消失
    setTimeout(() => {
      try { renderMetaForAllPages(); EditorCore.lockMeta(); } catch (_) {}
    }, 0);
  }

  function gotoCover() {
    try {
      // 封面在 DOM index 1
      window.book._cursorPage = 0;
      if (typeof book._mountCurrent === 'function') book._mountCurrent();
      setTimeout(() => { try { lightRedraw(); } catch (_) {} }, 0);
    } catch (_) {}
  }

  function gotoDbIndex(dbIndex) {
    try {
      const domIndex = EditorCore.dbIndexToDomIndex(dbIndex);
      const totalDom = (state.mode === 'spread')
        ? elBook.querySelectorAll('.paper').length * 2
        : elBook.querySelectorAll('.single-page').length;

      const clamped = Math.max(1, Math.min(totalDom, domIndex | 0));
      window.book._cursorPage = clamped - 1;
      if (typeof book._mountCurrent === 'function') book._mountCurrent();
      setTimeout(() => { try { lightRedraw(); } catch (_) {} }, 0);
    } catch (_) {}
  }

  function build() {
    if (!tocBody) return;
    tocBody.innerHTML = '';

    const title = (ACTIVE_BOOK?.title || '未命名書籍').trim();

    const head = document.createElement('div');
    head.className = 'toc-head';
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:2px 0 10px 0;gap:8px;';
    head.innerHTML = `
      <div style="font-weight:700;letter-spacing:1px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn ghost" style="padding:2px 8px;border-color:#ffffff33;background:#ffffff00;color:#FFF;" data-act="cover">去封面</button>
        <button class="btn" style="padding:2px 8px;" data-act="new">新增/修改章節</button>
      </div>`;
    tocBody.appendChild(head);

    if (!CHAPTERS_DB || CHAPTERS_DB.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'opacity:.9;padding:10px 4px;';
      empty.textContent = '尚無章節。可在當前頁按「新增/修改章節」建立，或關閉後按左下「插入章節」。';
      tocBody.appendChild(empty);
    } else {
      // 保險排序
      CHAPTERS_DB.sort((a, b) => (a.page_index | 0) - (b.page_index | 0));
      CHAPTERS_DB.forEach(ch => {
        const row = document.createElement('div');
        row.className = 'toc-row';
        row.innerHTML = `
          <div class="toc-title" title="${(ch.title || '').replace(/"/g, '&quot;')}">${ch.title || ''}</div>
          <div class="toc-page">${ch.page_index | 0}</div>`;
        row.addEventListener('click', () => { gotoDbIndex(ch.page_index | 0); close(); });
        tocBody.appendChild(row);
      });
    }

    // 頂部按鈕
    head.querySelector('[data-act="cover"]')?.addEventListener('click', () => { gotoCover(); close(); });
    head.querySelector('[data-act="new"]')?.addEventListener('click', () => { addOrEditChapterAtCurrent(); build(); });
  }

  function addOrEditChapterAtCurrent() {
    const dbIndex = EditorCore.getFocusedDbIndex();
    const idx = CHAPTERS_DB.findIndex(x => (x.page_index | 0) === (dbIndex | 0));
    const def = idx >= 0 ? (CHAPTERS_DB[idx].title || '') : '';
    const t = prompt('章節標題（留空=刪除此頁的章節）', def);
    if (t === null) return; // cancel

    const title = (t || '').trim();
    if (!title) {
      if (idx >= 0) CHAPTERS_DB.splice(idx, 1);
    } else {
      if (idx >= 0) { CHAPTERS_DB[idx].title = title; }
      else { CHAPTERS_DB.push({ title, page_index: dbIndex | 0 }); }
    }
    CHAPTERS_DB.sort((a, b) => (a.page_index | 0) - (b.page_index | 0));

    try { persistDraft && persistDraft(); } catch (_) {}
    try { renderMetaForAllPages(); EditorCore.lockMeta(); } catch (_) {}
  }

  // 綁定
  btnTOC?.addEventListener('click', open);
  tocModal?.addEventListener('click', (e) => { if (e.target === tocModal) close(); });
  btnAdd?.addEventListener('click', addOrEditChapterAtCurrent);

  // 對外 API
  window.TOC = {
    open, close, build, gotoDbIndex,
    addOrEditChapterAtCurrent,
    refresh: build
  };
})();
