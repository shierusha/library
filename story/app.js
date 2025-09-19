(() => {
  /* ======================
     本檔負責：資料模型 / 編輯工具 / 章節與目錄 / 自動換頁 / 版面縮放
     👉 翻頁顯示交給 BookFlip（book-flip.js + bookflip-integration.js）
  ====================== */

  /* ======================
     0) 公用小工具
  ====================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $all = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const esc = (s) => (s || '').replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"' }[c]));

  /* ======================
     1) 儲存：LocalStorage
  ====================== */
  const Store = {
    KEY: 'ebook_integrated_v2',
    load() { try { return JSON.parse(localStorage.getItem(this.KEY)); } catch { return null; } },
    save(data) { localStorage.setItem(this.KEY, JSON.stringify(data)); }
  };

  /* ======================
     2) 資料模型（含封面）
  ====================== */
  function newPage() {
    return {
      id: 'local_' + Math.random().toString(36).slice(2, 9),
      page_no: 0, // 內容頁會在 renumberPages() 時重編 1..N；封面固定 0
      type: 'novel', // 'novel' | 'illustration' | 'divider-light' | 'divider-dark' | 'cover-front'
      content_text: '',
      content_html: '',
      image_url: null
    };
  }
    
  function newCover() { return { id: 'cover_front', page_no: 0, type: 'cover-front', content_text: '', content_html: '', image_url: null }; }
  function newBlank() {
    return {
      id: 'blank_' + Math.random().toString(36).slice(2, 9),
      page_no: 0,
      type: 'blank',
      content_text: '',
      content_html: '',
      image_url: null
    };
  }
  const isCover = (page) => !!(page && page.type === 'cover-front');

  // 初始資料
  window.book = Store.load() || {
    title: '未命名書籍',
    direction: 'ltr',       // 'ltr' 橫排；'rtl' 直排
    binding: 'short',       // 'short' 直放；'long' 橫放
    viewMode: 'double',     // 'single' | 'double'
    textStyle: { fs: 1.02, lh: 1.8 },
    chapters: {},
    // 封面 + 固定白紙 + 兩頁正文
    pages: [newCover(), newBlank(), newPage(), newPage()]
  };


  // 保證開頭是封面、至少兩張內容頁
  function ensureCover() {
    if (!book.pages.length || book.pages[0].type !== 'cover-front') {
      book.pages.unshift(newCover());
    }
  }

   function ensureLeadingBlankAfterCover() {
    if (book.pages.length < 2 || book.pages[0].type !== 'cover-front' || book.pages[1].type !== 'blank') {
      // 若第 2 頁不是白紙，就插入
      book.pages.splice(1, 0, newBlank());
    }
  }

  function ensureMinPages() {
    const contents = book.pages.filter(p => p.type !== 'cover-front' && p.type !== 'blank');
    while (contents.length < 2) {
      const extra = newPage();
      book.pages.push(extra);
      setChapterTitleMeta(extra, null);
      contents.push(extra);
    }
  }
  function renumberPages() {
    let n = 1;
    for (let i = 0; i < book.pages.length; i++) {
      const p = book.pages[i];
      if (p.type === 'cover-front' || p.type === 'blank') {
        p.page_no = 0; // 不編號
      } else {
        p.page_no = n++;
      }
    }
  }


  /* ======================
     3) 章節中繼資料
  ====================== */
  function initializeChapterMetadata() {
    if (book.chapters && typeof book.chapters === 'object') { syncChapterMetadata(); return; }
    book.chapters = {};
    book.pages.forEach(page => {
      if (!page || !page.id) return;
      if (page.type === 'cover-front') { book.chapters[page.id] = null; return; }
      const inferred = getHeadingFromPage(page);
      book.chapters[page.id] = inferred ? { title: inferred } : null;
    });
  }
  function syncChapterMetadata() {
    if (!book.chapters || typeof book.chapters !== 'object') book.chapters = {};
    const ids = new Set(book.pages.map(p => p.id));
    Object.keys(book.chapters).forEach(id => { if (!ids.has(id)) delete book.chapters[id]; });
    book.pages.forEach(page => { if (page && page.id && !(page.id in book.chapters)) book.chapters[page.id] = null; });
  }
  function getChapterTitleMeta(page) {
    if (!page) return '';
    if (!book.chapters || typeof book.chapters !== 'object') return '';
    const entry = book.chapters[page.id];
    if (entry && typeof entry === 'object' && entry.title) return entry.title;
    return '';
  }
  function setChapterTitleMeta(page, title) {
    if (!page) return;
    if (!book.chapters || typeof book.chapters !== 'object') book.chapters = {};
    if (title && title.trim()) book.chapters[page.id] = { title: title.trim() };
    else book.chapters[page.id] = null;
  }

  // 從 HTML 的第一行大字判斷章名（規則與舊版一致）
  function getHeadingFromHTML(html) {
    if (!html) return '';
    const wrap = document.createElement('div'); wrap.innerHTML = html;
    let n = wrap.firstChild;
    while (n && n.nodeType === 3 && !n.nodeValue.trim()) { const t = n; n = n.nextSibling; wrap.removeChild(t); }
    if (n && n.nodeType === 1 && n.tagName === 'SPAN') {
      const ds = parseFloat(n.getAttribute('data-fs'));
      const fs = parseFloat((n.style.fontSize || '').replace('em', ''));
      if ((isFinite(ds) && ds >= 1.2) || (isFinite(fs) && fs >= 1.2)) return (n.textContent || '').trim();
    }
    return '';
  }
  function getHeadingFromPage(p) { return getHeadingFromHTML(p.content_html || ''); }

  function applyHeadingToPage(page, title) {
    const tmp = document.createElement('div');
    tmp.innerHTML = page.content_html || '';
    // 去開頭空白
    let first = tmp.firstChild;
    while (first && first.nodeType === 3 && !first.nodeValue.trim()) { const t = first; first = first.nextSibling; tmp.removeChild(t); }
    const ensureSpan = () => {
      const span = document.createElement('span');
      span.setAttribute('data-fs', '1.4'); span.style.fontSize = '1.4em'; span.textContent = title;
      tmp.insertBefore(span, first || null);
      return span;
    };
    let span = null;
    if (first && first.nodeType === 1 && first.tagName === 'SPAN') {
      const ds = parseFloat(first.getAttribute('data-fs'));
      const fs = parseFloat((first.style.fontSize || '').replace('em', ''));
      if ((isFinite(ds) && ds >= 1.2) || (isFinite(fs) && fs >= 1.2)) { span = first; span.textContent = title; }
      else { span = ensureSpan(); }
    } else { span = ensureSpan(); }
    // 確保下一個是 <br>
    if (!(span.nextSibling && span.nextSibling.tagName === 'BR')) {
      const br = document.createElement('br');
      tmp.insertBefore(br, span.nextSibling || null);
    }
    page.content_html = sanitizeEditableHTML(tmp);
    page.content_text = tmp.textContent || '';
  }
  function removeHeadingFromPage(page) {
    const tmp = document.createElement('div'); tmp.innerHTML = page.content_html || '';
    let first = tmp.firstChild;
    while (first && first.nodeType === 3 && !first.nodeValue.trim()) { const t = first; first = first.nextSibling; tmp.removeChild(t); }
    if (first && first.nodeType === 1 && first.tagName === 'SPAN') {
      const ds = parseFloat(first.getAttribute('data-fs'));
      const fs = parseFloat((first.style.fontSize || '').replace('em', ''));
      if ((isFinite(ds) && ds >= 1.2) || (isFinite(fs) && fs >= 1.2)) {
        const rm = first; const next = rm.nextSibling; tmp.removeChild(rm); if (next && next.tagName === 'BR') tmp.removeChild(next);
      }
    }
    page.content_html = sanitizeEditableHTML(tmp);
    page.content_text = tmp.textContent || '';
  }

  // 最近章名（供右上角章節籤用；integration 也有一份同名邏輯）
  function nearestChapter(pageNo) {
    syncChapterMetadata();
    let i = book.pages.findIndex(p => p.page_no === pageNo);
    if (i < 0) return '';
    for (let x = i; x >= 0; x--) {
      const p = book.pages[x];
      if (p.page_no > 0) {
        const h = getChapterTitleMeta(p);
        if (h) return h;
      }
    }
    return '';
  }

  /* ======================
     4) 目錄（TOC）
  ====================== */
  function buildTOC() {
    const box = $('#tocList'); if (!box) return;
    syncChapterMetadata();
    const rows = [];
    // 封面列
    rows.push(`
      <div class="toc-row" data-cover="1" style="display:flex;gap:10px;align-items:baseline;padding:10px 12px;border-bottom:1px dashed #2a3555;cursor:pointer">
        <div style="white-space:nowrap;max-width:70%;overflow:hidden;text-overflow:ellipsis">封面</div>
        <div style="flex:1;border-bottom:1px dotted #2a3555;transform:translateY(-2px)"></div>
        <div style="color:#9aa3b2">—</div>
      </div>`);
    // 章節列
    for (let i = 0; i < book.pages.length; i++) {
      const p = book.pages[i];
      if (p.page_no <= 0) continue;
      const ch = getChapterTitleMeta(p);
      if (!ch) continue;
      rows.push(`
        <div class="toc-row" data-no="${p.page_no}" style="display:flex;gap:10px;align-items:baseline;padding:10px 12px;border-bottom:1px dashed #2a3555;cursor:pointer">
          <div style="white-space:nowrap;max-width:70%;overflow:hidden;text-overflow:ellipsis">${esc(ch)}</div>
          <div style="flex:1;border-bottom:1px dotted #2a3555;transform:translateY(-2px)"></div>
          <div style="color:#9aa3b2">P${p.page_no}</div>
        </div>`);
    }
    box.innerHTML = rows.length ? rows.join('') : '<div style="padding:12px;color:#9aa3b2">尚無章節</div>';

    // 點封面 → 跳到第 1 頁（或封面）
    box.querySelector('[data-cover]')?.addEventListener('click', () => {
      if (window.BookFlipGoTo) { window.BookFlipGoTo(0); } // 若 integration 有提供
      else { rerenderBook(true); }
      $('#tocDialog')?.close();
    });

    // 點章節 → 跳到該頁
    $all('.toc-row[data-no]', box).forEach(row => {
      row.addEventListener('click', () => {
        const targetNo = parseInt(row.getAttribute('data-no'), 10);
        const targetIdx = book.pages.findIndex(p => p.page_no === targetNo);
        const flatIndex = Math.max(0, targetIdx); // 以「頁」為單位
        if (window.BookFlipGoTo) window.BookFlipGoTo(flatIndex); else rerenderBook(true);
        $('#tocDialog')?.close();
      });
    });
  }

  /* ======================
     5) 編輯工具列 / 事件
  ====================== */
  const titleEl = $('#bookTitle');
  if (titleEl) {
    titleEl.textContent = book.title;
    titleEl.addEventListener('input', () => {
      book.title = (titleEl.textContent || '').trim() || '未命名書籍';
      persist();
      // 書名變動 → 重繪（封面需要）
      rerenderBook(true);
    });
    // 雙擊書名 → 開啟目錄
    titleEl.addEventListener('dblclick', () => { $('#tocDialog')?.showModal(); });
  }

  // 左側：粗斜底線與字級
  const keepSel = btn => btn?.addEventListener('mousedown', e => e.preventDefault());
  ['#btnFontUp', '#btnFontDown', '#btnBold', '#btnItalic', '#btnUnderline'].forEach(s => keepSel($(s)));
  $('#btnBold')?.addEventListener('click', () => document.execCommand('bold', false, null));
  $('#btnItalic')?.addEventListener('click', () => document.execCommand('italic', false, null));
  $('#btnUnderline')?.addEventListener('click', () => document.execCommand('underline', false, null));
  $('#btnFontUp')?.addEventListener('click', () => setFont(book.textStyle.fs * 1.15));
  $('#btnFontDown')?.addEventListener('click', () => setFont(book.textStyle.fs * 0.87));

  // Dock：切模板
  $all('[data-style]').forEach(b => b.addEventListener('click', () => { setType(getCurPage(), b.dataset.style); }));

  // 目錄
  $('#btnTOC')?.addEventListener('click', () => { buildTOC(); $('#tocDialog').showModal(); });

  // 右側：切文字方向 / 長短邊 / 單雙頁 → 交由 integration 負責綁定翻頁；本檔只需維持狀態
  $('#btnToggleBind')?.addEventListener('click', () => { book.binding = (book.binding === 'long') ? 'short' : 'long'; fit(); persist(); });

  // 編輯器內的 Tab 縮排 / 反縮排（僅正文/章節中作用）
  document.addEventListener('keydown', (e) => {
    const target = e.target?.closest?.('.body-text');
    if (!target) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) outdentAtSelection(target); else indentAtSelection(target);
    }
  });

  // 貼上只留純文字（保留 <span data-fs> 的字級需自行另做；本處簡化）
  document.addEventListener('paste', (e) => {
    const target = e.target?.closest?.('.body-text');
    if (!target) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    insertPlainTextAtCursor(text);
    persistEditableNow(target);
    const pageNo = Number(target.closest('.page')?.querySelector('.page-no')?.textContent) || null;
    if (pageNo) autoPaginateFrom(pageNo, target);
  });

  // 右下角三顆：插入章節 / 插入頁面 / 刪除空白頁
  $('#btnInsertChapter')?.addEventListener('click', insertChapter);
  $('#btnInsertPage')?.addEventListener('click', insertAfter);
  $('#btnDeleteBlank')?.addEventListener('click', deleteBlank);

  // 上方：儲存 / 返回（示範）
  $('#btnSave')?.addEventListener('click', () => alert('示範：已存 LocalStorage；未連 DB'));
  $('#btnBack')?.addEventListener('click', () => alert('示範：自行導回書單 URL'));

  /* ======================
     6) 版面縮放（同一個 .scaler，依單/雙頁調整）
  ====================== */
  const scaler = $('#scaler');
  const stage = $('.stage');
  function applyBindingClass() {
    const root = document.documentElement;
    if (!root) return;
    root.classList.toggle('binding-long', book.binding === 'long');
    root.classList.toggle('binding-short', book.binding !== 'long');
  }
  function fit() {
    if (!scaler || !stage) return;
    applyBindingClass();
    const bookEl = $('#bookCanvas');
    if (!bookEl) return;
    const bookW = bookEl.offsetWidth;
    const stageW = Math.max(0, stage.clientWidth - 30);
    const needW = (book.viewMode === 'single') ? bookW : bookW * 2;
    const s = needW > 0 ? Math.min(1, stageW / needW) : 1;
    scaler.style.transform = `scale(${s})`;
    if (window.updateStageLayout) window.updateStageLayout();
  }
  function queueFit() {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fit());
    else setTimeout(() => fit(), 16);
  }
  function rerenderBook(keepPage = true) {
    if (window.BookFlipRefresh) window.BookFlipRefresh(keepPage);
    queueFit();
  }
  window.addEventListener('resize', fit)

  /* ======================
     7) 自動換頁（維持你原本的二分法量測）
  ====================== */
  function autoPaginateFrom(pageNo, bodyEl) {
    const i = book.pages.findIndex(p => p.page_no === pageNo);
    if (i < 0) return;
    const body = bodyEl || findBodyForPage(pageNo);
    if (!body) return;
    if (body.scrollHeight <= body.clientHeight) return;

    const originalHTML = body.innerHTML;
    const fullText = body.textContent || '';
    let lo = 0, hi = fullText.length, fitLen = fullText.length;
    while (lo <= hi) {
      const mid = (lo + hi >> 1);
      body.textContent = fullText.slice(0, mid);
      if (body.scrollHeight <= body.clientHeight) { fitLen = mid; lo = mid + 1; } else hi = mid - 1;
    }
    body.innerHTML = originalHTML;
    if (fitLen >= fullText.length) return;

    // 第一頁保留樣式
    truncateEditableToChars(body, fitLen);
    const p = book.pages[i];
    p.content_html = sanitizeEditableHTML(body);
    p.content_text = body.textContent || '';

    // 下一可寫文本頁（跳過插圖/封面；不足補頁）
    let j = i + 1;
while(j<book.pages.length && (book.pages[j].type==='illustration' || isCover(book.pages[j]) || book.pages[j].type==='blank')) j++;
    if (j >= book.pages.length) {
      const extra = newPage(); book.pages.push(extra); setChapterTitleMeta(extra, null); j = book.pages.length - 1; renumberPages(); syncChapterMetadata();
    }
    const remain = fullText.slice(fitLen).trimStart();
    const before = book.pages[j].content_text || '';
    book.pages[j].content_text = remain + (before ? ('\n' + before) : '');
    book.pages[j].content_html = '';

    const nextPageNo = book.pages[j].page_no;
    persist();
    // 重繪 BookFlip 畫面
    rerenderBook(true);

    if (remain) {
      const nextBody = findBodyForPage(nextPageNo);
      const queueNext = () => autoPaginateFrom(nextPageNo, nextBody || undefined);
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(queueNext); else setTimeout(queueNext, 16);
    }
  }

  /* ======================
     8) 目前頁、樣式、插入/刪除
  ====================== */
  function getCurPage() {
    // 嘗試以畫面上的右頁 page-no 為準
    const no = document.querySelector('#bookCanvas .page-no')?.textContent;
    if (no) {
      const p = book.pages.find(pp => String(pp.page_no) === String(no));
      if (p) return p;
    }
    // 找不到就回第一個內容頁
    return book.pages.find(p => p.page_no > 0) || book.pages[0];
  }

  function setType(p, type) { if (!p || p.type === 'cover-front') return; p.type = type; persist(); rerenderBook(true); }
  function setFont(nextRem) {
    const MIN = 0.7, MAX = 1.8; if (!isFinite(nextRem) || nextRem <= 0) nextRem = 1.02;
    book.textStyle.fs = Math.max(MIN, Math.min(MAX, nextRem));
    document.documentElement.style.setProperty('--fs', book.textStyle.fs + 'rem');
    persist(); rerenderBook(true);
  }

  function insertChapter() {
    const raw = prompt('章節名稱：', '');
    if (raw === null) return; const title = raw.trim(); if (!title) return;
    const cur = getCurPage(); if (!cur || cur.type === 'cover-front') return;
        applyHeadingToPage(cur, title); setChapterTitleMeta(cur, title); persist(); rerenderBook(true);
  }
function insertAfter() {
    const cur = getCurPage();
    const at = book.pages.indexOf(cur);
    if (at < 0) return;

    // 一次插入兩頁（同一張紙：front/back）
    const p1 = newPage();
    const p2 = newPage();
    book.pages.splice(at + 1, 0, p1, p2);

    setChapterTitleMeta(p1, null);
    setChapterTitleMeta(p2, null);
    renumberPages(); persist();

    // 重新渲染 BookFlip
    rerenderBook(true);
  }
  function isPageReallyBlank(p) {
    if (!p) return false;
    if (p.type === 'cover-front') return false;
    if (p.type === 'illustration') return !p.image_url;
    if (p.type === 'blank') return true; // 固定白紙 or 動態白紙
    // 其他（novel/divider-*）：看有無文字
    return !(p.content_text && p.content_text.trim().length > 0);
  }

  function deleteBlank() {
    // 至少保留：封面 + 固定白紙 + 一張紙（兩頁）
    if (book.pages.length <= 4) { alert('已是最少頁數，無法刪除'); return; }

    const a = book.pages[book.pages.length - 1];
    const b = book.pages[book.pages.length - 2];

    // 不允許刪到固定白紙（index 1）
    const idxA = book.pages.length - 1;
    const idxB = book.pages.length - 2;
    if (idxA <= 1 || idxB <= 1) { alert('無可刪除的末尾空白紙'); return; }

    if (isPageReallyBlank(a) && isPageReallyBlank(b)) {
      book.pages.splice(book.pages.length - 2, 2);
      ensureMinPages(); renumberPages(); persist();
      rerenderBook(true);
    } else {
      alert('最後一張不是雙面空白紙');
    }
  }


  /* ======================
     9) 編輯輔助（選取調整、縮排、貼上處理、sanitize）
  ====================== */
  function getActiveEditable() {
    const sel = window.getSelection(); if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const node = (range.commonAncestorContainer.nodeType === 1)
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    return node?.closest?.('.body-text') || null;
  }
  function scaleSelection(mult) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { setFont(book.textStyle.fs * mult); return; }
    const range = sel.getRangeAt(0);
    const editable = getActiveEditable(); if (!editable || !editable.contains(range.commonAncestorContainer)) return;
    splitTextBoundaries(range);
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const r = document.createRange(); r.selectNodeContents(n);
        if (range.compareBoundaryPoints(Range.END_TO_START, r) >= 0) return NodeFilter.FILTER_REJECT;
        if (range.compareBoundaryPoints(Range.START_TO_END, r) <= 0) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
    if (!texts.length) return;
    const firstText = texts[0]; const lastText = texts[texts.length - 1];
    texts.forEach(text => {
      let span = text.parentElement;
      if (!(span && span.tagName === 'SPAN' && span.hasAttribute('data-fs'))) {
        span = document.createElement('span');
        text.parentNode.insertBefore(span, text);
        span.appendChild(text);
        span.setAttribute('data-fs', '1');
        span.style.fontSize = '1em';
      }
      const cur = parseFloat(span.getAttribute('data-fs')) || 1;
      let next = cur * mult; next = Math.max(0.6, Math.min(3, next));
      span.setAttribute('data-fs', String(parseFloat(next.toFixed(3))));
      span.style.fontSize = next + 'em';
    });
    try {
      const r2 = document.createRange(); r2.setStart(firstText, 0); r2.setEnd(lastText, lastText.nodeValue.length); sel.removeAllRanges(); sel.addRange(r2);
    } catch (_) { }
    persistEditableNow(editable);
  }
  function splitTextBoundaries(range) {
    if (range.startContainer.nodeType === 3) {
      const t = range.startContainer;
      if (range.startOffset > 0 && range.startOffset < t.nodeValue.length) {
        const after = t.splitText(range.startOffset);
        range.setStart(after, 0);
      }
    }
    if (range.endContainer.nodeType === 3) {
      const t = range.endContainer;
      if (range.endOffset > 0 && range.endOffset < t.nodeValue.length) {
        t.splitText(range.endOffset);
      }
    }
  }
  function indentAtSelection(target) { insertPlainTextAtCursor('\t'); persistEditableNow(target); }
  function outdentAtSelection(target) {
    const sel = window.getSelection(); if (!sel || sel.rangeCount === 0) return; const r = sel.getRangeAt(0);
    if (r.collapsed) {
      const node = r.startContainer; if (node.nodeType === 3) {
        const txt = node.nodeValue; const off = r.startOffset; const pre = txt.slice(Math.max(0, off - 2), off);
        let remove = 0; if (pre.endsWith('\t')) remove = 1; else if (/\s{1,2}$/.test(pre)) remove = pre.match(/\s+$/)[0].length;
        if (remove > 0) { node.nodeValue = txt.slice(0, off - remove) + txt.slice(off); r.setStart(node, off - remove); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); }
      }
    }
    persistEditableNow(target);
  }
  function insertPlainTextAtCursor(text) {
    const sel = window.getSelection(); if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0); range.deleteContents(); const node = document.createTextNode(text);
    range.insertNode(node); range.setStartAfter(node); range.setEndAfter(node); sel.removeAllRanges(); sel.addRange(range);
  }
  function persistEditableNow(target) {
    const pageNo = Number(target.closest('.page')?.querySelector('.page-no')?.textContent) || null;
    if (!pageNo) return;
    const p = book.pages.find(pp => pp.page_no === pageNo); if (!p) return;
    p.content_html = sanitizeEditableHTML(target);
    p.content_text = target.textContent || '';
    persist();
  }
  function truncateEditableToChars(root, keep) {
    let remain = keep; const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null); const toRemove = [];
    while (walker.nextNode()) {
      const t = walker.currentNode; const len = t.nodeValue.length;
      if (remain >= len) { remain -= len; continue; }
      t.nodeValue = t.nodeValue.slice(0, remain); remain = 0; collectSiblingsToRemove(t); break;
    }
    function collectSiblingsToRemove(node) { let n = node; while (n) { if (n.nextSibling) markAll(n.nextSibling); n = n.parentNode; if (n === root) break; } }
    function markAll(n) { toRemove.push(n); let c = n.firstChild; while (c) { markAll(c); c = c.nextSibling; } }
    toRemove.forEach(n => n.parentNode && n.parentNode.removeChild(n));
  }
  function findBodyForPage(pageNo) {
    // 根據畫面上的 page-no 找到對應 .body-text
    const candidates = $all('#bookCanvas .page');
    for (const page of candidates) {
      const no = page.querySelector('.page-no')?.textContent;
      if (String(no) === String(pageNo)) return page.querySelector('.body-text');
    }
    return null;
  }
  function sanitizeEditableHTML(rootEl) {
    // 白名單：B I U SPAN BR
    const allowed = new Set(['B', 'I', 'U', 'SPAN', 'BR']);
    const wrap = document.createElement('div');
    wrap.appendChild(rootEl.cloneNode(true));
    wrap.querySelectorAll('[contenteditable]')?.forEach(n => n.removeAttribute('contenteditable'));
    wrap.querySelectorAll('[data-ph]')?.forEach(n => n.removeAttribute('data-ph'));
    const all = wrap.querySelectorAll('*');
    for (const node of Array.from(all)) {
      if (!allowed.has(node.tagName)) {
        const parent = node.parentNode; while (node.firstChild) parent.insertBefore(node.firstChild, node); parent.removeChild(node); continue;
      }
      if (node.tagName === 'SPAN') {
        const ds = parseFloat(node.getAttribute('data-fs'));
        const fs = node.style.fontSize || (isFinite(ds) ? (ds + 'em') : '');
        [...node.attributes].forEach(a => { if (a.name !== 'data-fs' && a.name !== 'style') node.removeAttribute(a.name); });
        if (isFinite(ds)) node.setAttribute('data-fs', String(ds)); else node.removeAttribute('data-fs');
        node.style.cssText = fs ? ('font-size:' + fs) : '';
        if (!node.getAttribute('data-fs') && !node.getAttribute('style')) {
          const p = node.parentNode; while (node.firstChild) p.insertBefore(node.firstChild, node); p.removeChild(node);
        }
      } else { [...node.attributes].forEach(a => node.removeAttribute(a.name)); }
    }
    return wrap.innerHTML.replace(/\u200B/g, '');
  }

  /* ======================
     10) 初始化與狀態刷新
  ====================== */
  function persist() { Store.save(book); updateCountAndTypography(); }
  function updateCountAndTypography() {
    // 顯示內容頁數（不含封面）
const count = book.pages.reduce((acc, p) => acc + ((p.type==='cover-front'||p.type==='blank')?0:1), 0);
    const lblCount = $('#lblCount'); if (lblCount) lblCount.textContent = String(count);
    document.documentElement.style.setProperty('--fs', book.textStyle.fs + 'rem');
    document.documentElement.style.setProperty('--lh', book.textStyle.lh);
  }

  // 首次啟動：確保封面、頁碼、章節；並縮放
ensureCover(); ensureLeadingBlankAfterCover(); ensureMinPages(); renumberPages(); initializeChapterMetadata(); syncChapterMetadata(); updateCountAndTypography(); fit(); rerenderBook(false);

  // 將重要 API 掛到 window，提供 integration 使用
  window.persist = persist;
  window.autoPaginateFrom = autoPaginateFrom;
  window.applyHeadingToPage = applyHeadingToPage;
  window.setChapterTitleMeta = setChapterTitleMeta;
  window.getChapterTitleMeta = getChapterTitleMeta;
  window.nearestChapter = nearestChapter;
  window.buildTOC = buildTOC;
   window.setType = setType;
  window.setFont = setFont;
  window.requestStageFit = queueFit;
})();


