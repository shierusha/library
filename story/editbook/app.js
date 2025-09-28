/* app.js — 本地化編輯模式 + BookFlip 掛載（完整版，含 TOC、章節初始化、游標同步）
 * 重點：
 * - 以 ?bookid=UUID 讀一次 Supabase → 寫進 localStorage
 * - 後續操作都走 LOCAL（persistDraft() 只寫 localStorage）
 * - 封面：書名同步、雙擊可輸入封面圖片網址（空值=移除）
 * - 版面縮放以面積推字級（--scale），不動你的 CSS
 * - ★ 修正：章節載入 + TOC 綁定 + BookFlip 游標同步 + 書名輸入不重置游標
 * - ★ 重要：任何「重建/插頁/跳頁」都以『硬鎖當前 DB 頁』為準，不做四捨五入，不跳頁
 */

(function(){
  /* ===== DOM ===== */
  window.elStage  = document.getElementById('scaler');
  window.elBook   = document.getElementById('bookCanvas');
  const lblCount  = document.getElementById('lblCount');
  const elTitle   = document.getElementById('bookTitle');

  // TOC DOM
  const tocModal = document.getElementById('tocModal');
  const tocBody  = document.getElementById('tocBody');

  /* ===== 狀態 ===== */
  window.state = {
    mode: 'spread',        // 'spread' | 'single'
    direction: 'ltr',      // 'ltr' | 'rtl'
    bind: 'short',         // 'short' | 'long'
    aspectShort: 5/7,      // 高/寬
    aspectLong:  7/5
  };

  /* ===== 顯示錨點（新增） =====
   * 'self' = 顯示當前頁；'next' = 顯示下一頁（你要的效果）
   */
  window.PAGE_ANCHOR = 'next';
  function anchorDbIndex(dbIndex){
    const len = (Array.isArray(window.PAGES_DB) ? PAGES_DB.length : 0) | 0;
    const cur = Math.max(1, dbIndex|0);
    // 只在 spread 模式才偏移到下一頁；單頁模式維持當前頁更直覺
    const wantNext = (window.PAGE_ANCHOR === 'next') && (window.state?.mode === 'spread');
    return wantNext ? Math.min(len || cur, cur + 1) : cur;
  }

  /* ===== 全域資料 ===== */
  const urlq = new URLSearchParams(location.search);
  const BOOK_ID_Q = (urlq.get('bookid') || '').trim();
  const LS_KEY_BOOK   = (id)=>`book:${id}`;
  const LS_KEY_PAGES  = (id)=>`pages:${id}`;
  const LS_KEY_CHAP   = (id)=>`chapters:${id}`;

  window.ACTIVE_BOOK = null;
  window.PAGES_DB = [];        // [{id,page_index,type,image_url,content_json:{text_plain,text_html}}]
  window.CHAPTERS_DB = [];     // [{title,page_index}]
  window.book = null;          // BookFlip 實例

  /* ===== 小工具 ===== */
  function escapeHTML(str){ return String(str || '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
  function normalizeType(t) {
    const x = String(t || '').trim().toLowerCase().replace(/-/g, '_');
    if (x === 'divider_black') return 'divider_dark';
    if (x === 'divider_white') return 'divider_light';
    if (x === 'image')        return 'illustration';
    if (x === 'novel' || x === 'divider_light' || x === 'divider_dark' || x === 'illustration') return x;
    return 'novel';
  }
  function toHTMLFromPlain(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>'); }

  /* ===== 本地儲存 ===== */
  function readLS(key, fallback=null){
    try{ const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }catch(_){ return fallback; }
  }
  function writeLS(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch(_){}
  }

  /* ===== 封面（第一張 .paper，不算頁碼） ===== */
  function applyCoverFromBook(isFromTitleTyping = false) {
    const title = ACTIVE_BOOK?.title || '未命名書籍';
    const coverURL = (ACTIVE_BOOK?.cover_image || '').trim();

    if (state.mode === 'spread') {
      const coverFront = elBook.querySelector('.paper .page.front');
      const coverBack  = elBook.querySelector('.paper .page.back');
      if (!coverFront) return;

      if (coverURL) {
        coverFront.classList.add('page--illustration');
        coverFront.style.backgroundImage = `url("${coverURL}")`;
        coverFront.innerHTML = '';
      } else {
        coverFront.classList.remove('page--illustration');
        coverFront.style.backgroundImage = '';
        coverFront.style.background = '#fff';
        coverFront.style.display = 'flex';
        coverFront.style.alignItems = 'center';
        coverFront.style.justifyContent = 'center';
        coverFront.innerHTML = `<div class="cover-title" style="font-size:1.8em;font-weight:700">${escapeHTML(title)}</div>`;
      }
      if (coverBack) coverBack.style.background = '#fff';
    } else {
      const sp = elBook.querySelectorAll('.single-page');
      const front = sp[0], back = sp[1];
      if (!front) return;

      if (coverURL) {
        front.classList.add('page--illustration');
        front.style.backgroundImage = `url("${coverURL}")`;
        front.innerHTML = '';
      } else {
        front.classList.remove('page--illustration');
        front.style.backgroundImage = '';
        front.style.background = '#fff';
        front.style.display = 'flex';
        front.style.alignItems = 'center';
        front.style.justifyContent = 'center';
        front.innerHTML = `<div class="cover-title" style="font-size:1.8em;font-weight:700">${escapeHTML(title)}</div>`;
      }
      if (back) back.style.background = '#fff';
    }

    // ★ 修正：輸入期間不要回寫 #bookTitle，避免游標跳到第一字
    if (!isFromTitleTyping) {
      const titleNode = document.getElementById('bookTitle');
      if (titleNode && titleNode.textContent !== title) {
        titleNode.textContent = title;
      }
    }
  }

  // 封面雙擊：輸入封面 URL，空=移除
  function bindCoverEdit(){
    const target = (state.mode === 'spread')
      ? elBook.querySelector('.paper .page.front')
      : elBook.querySelectorAll('.single-page')[0];
    if (!target) return;
    if (target.__coverBound) return;
    target.__coverBound = true;

    target.addEventListener('dblclick', ()=>{
      const u = prompt('輸入封面圖片網址（留空=移除封面圖片）', ACTIVE_BOOK?.cover_image || '');
      ACTIVE_BOOK.cover_image = (u && u.trim()) ? u.trim() : '';
      applyCoverFromBook(true);
      persistDraft();
    });
  }

  /* ===== DB → pairs（封面之外的內容）===== */
  function htmlFromPage(p) {
    if (!p) return '';
    const t = normalizeType(p.type);
    if (t === 'illustration') return '';
    return (p.content_json && p.content_json.text_html)
      ? p.content_json.text_html
      : (p.content_json?.text_plain || '');
  }
  window.buildPairsFromPages = function buildPairsFromPages(){
    const pairs = [];
    for (let i = 0; i < PAGES_DB.length; i += 2) {
      const pFront = PAGES_DB[i];
      const pBack  = PAGES_DB[i + 1];
      pairs.push({ frontHTML: htmlFromPage(pFront), backHTML: htmlFromPage(pBack) });
    }
    return pairs;
  };

  /* ===== 版面（實寬高 + 字級比例） ===== */
  window.applyLayout = function applyLayout(){
    const stageW   = elStage.clientWidth;
    const isSpread = state.mode === 'spread';
    const aspect   = (state.bind === 'short') ? state.aspectShort : state.aspectLong;
    const desiredW = isSpread ? stageW / 2 : stageW;
    const desiredH = Math.round(desiredW * aspect);

    elBook.style.width  = desiredW + 'px';
    elBook.style.height = desiredH + 'px';
    elBook.style.transform = '';

    const BASE_W = 700, BASE_H_SHORT = BASE_W * (5/7);
    const scale = Math.sqrt((desiredW * desiredH) / (BASE_W * BASE_H_SHORT));
    elBook.classList.add('book-scope');
    elBook.style.setProperty('--scale', String(scale));

    elBook.style.left  = (state.direction === 'rtl') ? '0' : '';
    elBook.style.right = (state.direction === 'ltr') ? '0' : '';

    document.body.classList.toggle('mode-rtl', state.direction === 'rtl');
    document.body.classList.toggle('mode-ltr', state.direction === 'ltr');
  };

  /* ===== 四種頁型（底線版） ===== */
  function setPageTypeOnElement(el, p){
    const t = normalizeType(p.type);
    el.classList.remove('page--novel','page--divider_light','page--divider_dark','page--illustration');
    el.style.backgroundImage = '';
    el.dataset.type = t;

    if (t === 'divider_light') {
      el.classList.add('page--divider_light');
      if (p.content_json?.text_html) el.innerHTML = p.content_json.text_html;

    } else if (t === 'divider_dark') {
      el.classList.add('page--divider_dark');
      if (p.content_json?.text_html) el.innerHTML = p.content_json.text_html;

    } else if (t === 'illustration') {
      el.classList.add('page--illustration');
      if (p.image_url && String(p.image_url).trim()) {
        el.style.backgroundImage = `url("${p.image_url}")`;
      } else {
        el.style.backgroundImage = 'linear-gradient(45deg,#fbb,#fdd)';
        el.innerHTML = '<div style="margin:auto;color:#900;font-weight:700">缺少 image_url</div>';
      }
      el.innerHTML = '';

    } else {
      el.classList.add('page--novel');
      if (p.content_json?.text_html) el.innerHTML = p.content_json.text_html;
    }
  }

  window.applyPageTypesNow = function applyPageTypesNow(){
    if (!PAGES_DB.length) return;

    let domPages = [];
    if (state.mode === 'spread') {
      elBook.querySelectorAll('.paper').forEach(paper=>{
        const f = paper.querySelector('.page.front');
        const b = paper.querySelector('.page.back');
        if (f) domPages.push(f);
        if (b) domPages.push(b);
      });
    } else {
      domPages = Array.from(elBook.querySelectorAll('.single-page'));
    }

    for (const p of PAGES_DB) {
      const domIdx = (p.page_index + 2) - 1; // DB 1-based → DOM 1-based(含封面) → 0-based
      const el = domPages[domIdx];
      if (!el) continue;
      setPageTypeOnElement(el, p);
    }
  };

  /* ===== 頁碼／章節角標 ===== */
  function getChapterForDbIndex(dbIndex){
    let cur = null;
    for (const ch of CHAPTERS_DB){
      if (ch.page_index <= dbIndex) cur = ch; else break;
    }
    return cur;
  }
  window.renderMetaForAllPages = function renderMetaForAllPages(){
    function renderMetaOnDomPage(node, pageDomIndex){
      node.querySelectorAll('.page-meta').forEach(m => m.remove());
      if (pageDomIndex <= 2) return;

      const dbIndex = pageDomIndex - 2;
      const p = PAGES_DB[dbIndex - 1];
      if (!p) return;

      const t = String(p.type||'').toLowerCase().replace(/-/g,'_');
      const showCorner = !(t === 'divider_light' || t === 'divider_dark' || t === 'illustration');
      const displayNo  = dbIndex;
      const chapter = getChapterForDbIndex(dbIndex);

      let chapterCorner = 'meta-tr', pageCorner = 'meta-br';
      if (state.mode === 'single') {
        chapterCorner = 'meta-tr'; pageCorner = 'meta-br';
      } else {
        const isFront = node.classList.contains('front');
        if (state.direction === 'rtl') {
          if (isFront) { chapterCorner = 'meta-tl'; pageCorner = 'meta-bl'; }
          else         { chapterCorner = 'meta-tr'; pageCorner = 'meta-br'; }
        } else {
          if (isFront) { chapterCorner = 'meta-tr'; pageCorner = 'meta-br'; }
          else         { chapterCorner = 'meta-tl'; pageCorner = 'meta-bl'; }
        }
      }

      if (showCorner) {
        const metaChapter = document.createElement('div');
        metaChapter.className = `page-meta meta-chapter ${chapterCorner}`;
        metaChapter.textContent = chapter ? chapter.title : '';
        metaChapter.setAttribute('contenteditable','false');

        const metaPage = document.createElement('div');
        metaPage.className = `page-meta meta-page ${pageCorner}`;
        metaPage.textContent = String(displayNo);
        metaPage.setAttribute('contenteditable','false');

        node.appendChild(metaChapter);
        node.appendChild(metaPage);
      }
    }

    if (state.mode === 'spread') {
      const list = [];
      elBook.querySelectorAll('.paper').forEach(paper=>{
        const f = paper.querySelector('.page.front');
        const b = paper.querySelector('.page.back');
        if (f) list.push(f);
        if (b) list.push(b);
      });
      list.forEach((node, domIdx)=> renderMetaOnDomPage(node, domIdx + 1));
    } else {
      elBook.querySelectorAll('.single-page').forEach((node, domIdx)=> renderMetaOnDomPage(node, domIdx + 1));
    }
  };

  /* ===== 頁數顯示（封面不算，其他都算） ===== */
  window.updateCount = function updateCount(){
    lblCount && (lblCount.textContent = String(PAGES_DB.length));
  };

  /* ===== 輕量重繪（不動頁數） ===== */
  window.lightRedraw = function lightRedraw(){
    applyPageTypesNow();
    renderMetaForAllPages();
    if (window.EditorCore) EditorCore.hookAllStories();
    if (window.PageStyle) PageStyle.bindImageEditors();
    updateCount();
    applyCoverFromBook();
    bindCoverEdit();
  };

  /* ===== 同步畫面到資料（重要） ===== */
  window.syncAllStoriesToDB = function syncAllStoriesToDB(){
    if (!window.EditorCore) return;
    const domList = EditorCore.getDomPagesList();
    for (let i=0;i<domList.length;i++){
      const dbIndex = EditorCore.domIndexToDbIndex(i+1);
      if (dbIndex <= 0) continue;
      const story = domList[i].querySelector('.story');
      if (!story) continue;
      EditorCore.updatePageJsonFromStory(dbIndex, story);
    }
  };

  /* ===== ★ 核心：硬鎖到指定 DB 頁（不跳頁，不取整） ===== */
function lockToDbIndex(dbIndex){
  if (!dbIndex || dbIndex < 1) dbIndex = 1;

  // 顯示錨點：spread 模式下顯示「下一頁」
  const viewDb   = anchorDbIndex(dbIndex);
  const domIndex = viewDb + 2;        // DB 1-based → DOM 1-based(含封面)
  const domZero  = domIndex - 1;      // 0-based

  // 第一拍：立即鎖
  if (book){
    book._cursorPage = domZero;
    if (typeof book._mountCurrent === 'function') book._mountCurrent();
  }

  // 第二拍：下一個 animation frame 再鎖一次（避免外掛在 mount 後回調把頁面拉走）
  requestAnimationFrame(()=>{
    if (book){
      book._cursorPage = domZero;
      if (typeof book._mountCurrent === 'function') book._mountCurrent();
    }
    // 第三拍：再保險一次
    requestAnimationFrame(()=>{
      if (book){
        book._cursorPage = domZero;
        if (typeof book._mountCurrent === 'function') book._mountCurrent();
      }
    });
  });

  // 同步樣式區塊用的最後互動頁（單純映射）
  if (window.EditorCore && typeof EditorCore.setLastDbIndex === 'function'){
    EditorCore.setLastDbIndex(dbIndex);
  }
  lightRedraw();
}

  /* ===== 跳頁（公開 API） ===== */
  window.gotoPageDomByDbIndex = function gotoPageDomByDbIndex(dbIndex){
    lockToDbIndex(dbIndex);
  };
  window.gotoDomPage = function gotoDomPage(domIndex){
    const isSpread = state.mode === 'spread';
    const totalDom = isSpread
      ? elBook.querySelectorAll('.paper').length * 2
      : elBook.querySelectorAll('.single-page').length;
    const clamped = Math.max(1, Math.min(totalDom, domIndex|0));
    const dbIndex = Math.max(1, clamped - 2);
    lockToDbIndex(dbIndex);
  };

  /* ===== 重建（動到頁數時） =====
 * 關鍵：new BookFlip 後，不做任何推算；直接鎖到 targetDbIndex（含雙 rAF 硬鎖）
 */
window.rebuildTo = function rebuildTo(targetDbIndex){
  try{
    if (!targetDbIndex || targetDbIndex < 1) targetDbIndex = 1;

    const pairs = buildPairsFromPages();

    // ★ 第一次 mount 就站在「錨點頁」（spread=下一頁；single=當前頁）
    const viewDb  = anchorDbIndex(targetDbIndex);
    const domZero = Math.max(
      0,
      ((window.EditorCore?.dbIndexToDomIndex?.(viewDb) || (viewDb + 2)) - 1)
    );

    window.book = new BookFlip('#bookCanvas', {
      mode: state.mode,
      direction: state.direction,
      speed: 450,
      singleSpeed: 300,
      perspective: 2000,
      data: { pairs },
      startPageIndex: domZero,   // ← 不要 0，直接用正確頁起跑
      coverPapers: 1
    });

    // mount 後只做視覺鉤子，不改游標
    if (typeof book._mountCurrent === 'function'){
      const _origMount = book._mountCurrent.bind(book);
      book._mountCurrent = function(){
        const r = _origMount();
        setTimeout(()=>{ 
          // 同步最後互動頁（單純映射）
          if (window.EditorCore && typeof EditorCore.setLastDbIndex === 'function'){
            const dom = (book?._cursorPage || 0) + 1;
            const db  = EditorCore.domIndexToDbIndex(dom) || 1;
            EditorCore.setLastDbIndex(db);
          }
          lightRedraw(); 
        }, 0);
        return r;
      };
    }

    // ★ 重建完成 → 立刻硬鎖到「指定的 DB 頁」（也會依錨點顯示）
    lockToDbIndex(targetDbIndex);

    applyLayout();
    if (typeof window.ensureSwipeBinding === 'function') ensureSwipeBinding();
    lightRedraw();

  }catch(e){ console.warn('rebuild failed:', e); }
};


  /* ===== 左右鍵 ===== */
  function goLeft(){
    if (state.mode === 'single') book.prev();
    else { if (state.direction === 'rtl') book.next(); else book.prev(); }
  }
  function goRight(){
    if (state.mode === 'single') book.next();
    else { if (state.direction === 'rtl') book.prev(); else book.next(); }
  }
  document.getElementById('btnleft') ?.addEventListener('click', goLeft);
  document.getElementById('btnright')?.addEventListener('click', goRight);

  /* ===== 三顆主控 ===== */
  function toggleDir(){ state.direction = (state.direction === 'ltr') ? 'rtl' : 'ltr'; book.setDirection(state.direction); applyLayout(); lightRedraw(); }
  function toggleBind(){ state.bind = (state.bind === 'short') ? 'long' : 'short'; applyLayout(); lightRedraw(); }
  function toggleView(){
  state.mode = (state.mode === 'spread') ? 'single' : 'spread';
  const db = (window.EditorCore && typeof EditorCore.getFocusedDbIndex === 'function')
    ? (EditorCore.getFocusedDbIndex() || 1)
    : 1;
  book?.setMode?.(state.mode);
  // ★ 切換模式後，立刻硬鎖回目前 DB 頁（會依錨點顯示）
  lockToDbIndex(db);
  applyLayout(); 
  ensureSwipeBinding(); 
  lightRedraw();
}

  document.getElementById('btnToggleDir') .addEventListener('click', toggleDir);
  document.getElementById('btnToggleBind').addEventListener('click', toggleBind);
  document.getElementById('btnToggleView').addEventListener('click', toggleView);

  /* ===== 雙頁手勢（單頁由插件內建） ===== */
  window.ensureSwipeBinding = function ensureSwipeBinding(){
    if (state.mode !== 'spread') { if (window.__detachSwipe) { window.__detachSwipe(); window.__detachSwipe=null; } return; }
    const THRESH = 50;
    let startX = 0;
    function onStart(e){ const t = e.touches && e.touches[0]; if (!t) return; startX = t.clientX; }
    function onEnd(e){
      const t = (e.changedTouches && e.changedTouches[0]) || null; if (!t) return;
      const dx = t.clientX - startX; if (Math.abs(dx) < THRESH) return;
      if (dx < 0) { if (state.direction === 'rtl') book.prev(); else book.next(); }
      else       { if (state.direction === 'rtl') book.next(); else book.prev(); }
    }
    elBook.addEventListener('touchstart', onStart, { passive:true });
    elBook.addEventListener('touchend',   onEnd,   { passive:true });
    window.__detachSwipe = () => {
      elBook.removeEventListener('touchstart', onStart);
      elBook.removeEventListener('touchend',   onEnd);
    };
  };

  /* ===== 書名 inline 編輯：輸入時只更新封面；blur 後才同步回欄位 ===== */
  (function bindTitleInlineEditing(){
    const el = elTitle;
    if (!el) return;

    let typing = false;
    function normTitle(t) {
      const s = String(t || '').replace(/\s+/g, ' ').trim();
      return s || '未命名書籍';
    }

    el.addEventListener('focus', () => { typing = true; });

    // 輸入時：更新 ACTIVE_BOOK.title 與封面（不回寫 el.textContent）
    el.addEventListener('input', () => {
      typing = true;
      ACTIVE_BOOK = ACTIVE_BOOK || {};
      ACTIVE_BOOK.title = normTitle(el.textContent);
      applyCoverFromBook(true); // 來自輸入中 → 不回寫 #bookTitle
      try { window.persistDraft && window.persistDraft(); } catch(_) {}
    });

    // Enter 行為：避免新段落導致怪異游標，改為插入換行
    el.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter') {
        e.preventDefault();
        document.execCommand && document.execCommand('insertLineBreak');
      }
    });

    // 離開欄位：最後再同步一次（允許回寫）
    el.addEventListener('blur', () => {
      ACTIVE_BOOK = ACTIVE_BOOK || {};
      ACTIVE_BOOK.title = normTitle(el.textContent);
      typing = false;
      applyCoverFromBook(false);
      try { window.persistDraft && window.persistDraft(); } catch(_) {}
    });
  })();

  /* ===== Draft 持久化（LOCAL） ===== */
  window.persistDraft = function persistDraft(){
    if (!ACTIVE_BOOK?.id) return;
    writeLS(LS_KEY_BOOK(ACTIVE_BOOK.id), ACTIVE_BOOK);
    writeLS(LS_KEY_PAGES(ACTIVE_BOOK.id), PAGES_DB);
    writeLS(LS_KEY_CHAP(ACTIVE_BOOK.id), CHAPTERS_DB);
  };

  /* ===== 章節擷取（robust） ===== */
  async function fetchChaptersForBook(bookId, pages) {
    const pageMap = new Map((pages || []).map(p => [p.id, p.page_index]));
    let rows = [];
    try {
      const { data: chsJoin, error: errJoin } = await SB
        .from('chapters')
        .select('title,page_id,created_at,pages!inner(id,page_index)')
        .eq('book_id', bookId)
        .order('created_at', { ascending: true });
      if (!errJoin && Array.isArray(chsJoin) && chsJoin.length) {
        rows = chsJoin.map(r => ({
          title: r.title,
          page_index: (r.pages && r.pages.page_index) || pageMap.get(r.page_id) || 1
        }));
      }
    } catch (_) {}
    if (!rows.length) {
      const { data: chs, error } = await SB
        .from('chapters')
        .select('title,page_id,created_at')
        .eq('book_id', bookId)
        .order('created_at', { ascending: true });
      if (!error && Array.isArray(chs)) {
        rows = chs.map(r => ({
          title: r.title,
          page_index: pageMap.get(r.page_id) || 1
        }));
      }
    }
    rows.sort((a, b) => a.page_index - b.page_index);
    return rows;
  }

  /* ===== 初始化：讀取 book & pages & chapters ===== */
  async function fetchFromSupabase(bookId){
    const { data:bookData, error:err1 } = await SB
      .from('books')
      .select('id,title,cover_image,cover_color,binding,direction')
      .eq('id', bookId).single();
    if (err1) throw err1;

    const { data:pages, error:err2 } = await SB
      .from('pages')
      .select('id,page_index,type,image_url,content_json')
      .eq('book_id', bookId)
      .order('page_index', { ascending: true });
    if (err2) throw err2;

    const chapters = await fetchChaptersForBook(bookId, pages || []);
    return { bookData, pages, chapters };
  }

  function loadFromLocal(bookId){
    const book = readLS(LS_KEY_BOOK(bookId));
    const pages = readLS(LS_KEY_PAGES(bookId));
    const chaps = readLS(LS_KEY_CHAP(bookId)) || [];
    if (!book || !pages) return null;
    return { bookData:book, pages, chapters: chaps };
  }

  async function initData(){
    if (!BOOK_ID_Q) { alert('缺少 ?bookid= 參數'); return; }

    let local = loadFromLocal(BOOK_ID_Q);
    if (local){
      ACTIVE_BOOK = local.bookData;
      PAGES_DB = local.pages || [];
      CHAPTERS_DB = local.chapters || [];
    }else{
      // 首次：打 DB 取回 → 寫入 LS
      const { bookData, pages, chapters } = await fetchFromSupabase(BOOK_ID_Q);
      ACTIVE_BOOK = bookData;
      PAGES_DB = pages || [];
      CHAPTERS_DB = chapters || [];
      persistDraft();
    }

    // 若走 LOCAL 但章節為空，補打一槍把章節塞回 LOCAL
    if (CHAPTERS_DB.length === 0) {
      try {
        const chapters = await fetchChaptersForBook(BOOK_ID_Q, PAGES_DB);
        if (chapters && chapters.length) {
          CHAPTERS_DB = chapters;
          persistDraft();
        }
      } catch (e) { console.warn('fallback chapters fetch failed:', e); }
    }

    // 套用方向/裝訂
    if (ACTIVE_BOOK.direction === 'rtl' || ACTIVE_BOOK.direction === 'ltr') state.direction = ACTIVE_BOOK.direction;
    if (ACTIVE_BOOK.binding === 'long'  || ACTIVE_BOOK.binding === 'short') state.bind = ACTIVE_BOOK.binding;
    document.body.classList.toggle('mode-rtl', state.direction === 'rtl');
    document.body.classList.toggle('mode-ltr', state.direction === 'ltr');
  }

  /* ===== TOC（目錄） ===== */
  function openTOC(){ buildTOC(); tocModal.classList.add('show'); tocModal.setAttribute('aria-hidden','false'); }
  function closeTOC(){ tocModal.classList.remove('show'); tocModal.setAttribute('aria-hidden','true'); }
  function buildTOC(){
    if (!tocBody) return;
    const title = (ACTIVE_BOOK?.title || '未命名書籍').trim();

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:2px 0 10px 0;';
    head.innerHTML = `<div style="font-weight:700;width: 11em;letter-spacing:1px">${escapeHTML(title)}</div>
                      <button class="btn ghost" style="padding:2px 8px;border-color:#ffffff33;background:#ffffff00;color:#FFF;" id="tocGotoCover">去封面</button>`;
    tocBody.innerHTML = '';
    tocBody.appendChild(head);

    CHAPTERS_DB.forEach(ch=>{
      const row = document.createElement('div');
      row.className = 'toc-row';
      row.innerHTML = `
        <div class="toc-title">${escapeHTML(ch.title)}</div>
        <div class="toc-page">${ch.page_index}</div>`;
      row.addEventListener('click', ()=>{
        gotoPageDomByDbIndex(ch.page_index);
        closeTOC();
      });
      tocBody.appendChild(row);
    });

    document.getElementById('tocGotoCover')?.addEventListener('click', ()=>{
      gotoDomPage(1);
      closeTOC();
    });
  }
  tocModal?.addEventListener('click', (e)=>{ if (e.target === tocModal) closeTOC(); });
  document.getElementById('btnTOC')?.addEventListener('click', openTOC);

  /* ===== 初始化 ===== */
  async function init(){
    try {
      await initData();

      // 以「目前聚焦頁」為起點硬鎖（確保第一次就不跳）
      const focus = (window.EditorCore && typeof EditorCore.getFocusedDbIndex === 'function')
        ? (EditorCore.getFocusedDbIndex() || 1)
        : 1;
      rebuildTo(focus);

      // 初次也包一層 mount 後重繪
      if (typeof book._mountCurrent === 'function'){
        const _origMount = book._mountCurrent.bind(book);
        book._mountCurrent = function(){
          const r = _origMount();
          setTimeout(()=>{ lightRedraw(); }, 0);
          return r;
        };
      }

      window.addEventListener('resize', ()=>{ applyLayout(); lightRedraw(); });
      applyLayout();
      ensureSwipeBinding();
      lightRedraw();
      bindCoverEdit();

    } catch (e) {
      console.error(e);
      alert('載入書籍資料失敗：' + (e?.message || e));
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
