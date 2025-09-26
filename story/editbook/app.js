/* app.js — 本地化編輯模式 + BookFlip 掛載
 * 重點：
 * - 以 ?bookid=UUID 讀取一次資料（可直接用 Supabase），讀到後寫入 localStorage
 * - 之後操作皆以 PAGES_DB (LOCAL) 為主；persistDraft() 只寫 localStorage
 * - 封面：書名同步、雙擊可輸入封面圖片網址（空值=移除）
 * - 版面縮放以面積推字級（--scale），不動你的 CSS
 * - 提供 applyPageTypesNow / renderMetaForAllPages 等給子模組使用
 */

(function(){
  /* ===== DOM ===== */
  window.elStage  = document.getElementById('scaler');
  window.elBook   = document.getElementById('bookCanvas');
  const lblCount  = document.getElementById('lblCount');
  const elTitle   = document.getElementById('bookTitle');

  /* ===== 狀態 ===== */
  window.state = {
    mode: 'spread',        // 'spread' | 'single'
    direction: 'ltr',      // 'ltr' | 'rtl'
    bind: 'short',         // 'short' | 'long'
    aspectShort: 5/7,      // 高/寬
    aspectLong:  7/5
  };

  /* ===== 變數 ===== */
  const urlq = new URLSearchParams(location.search);
  const BOOK_ID_Q = (urlq.get('bookid') || '').trim();
  window.ACTIVE_BOOK = null;
  window.PAGES_DB = [];     // [{id,page_index,type,image_url,content_json:{text_plain,text_html}}]
  window.CHAPTERS_DB = [];  // [{title,page_index}]（可選）
  window.book = null;       // BookFlip 實例

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

  const LS_KEY_BOOK  = (id)=>`book:${id}`;
  const LS_KEY_PAGES = (id)=>`pages:${id}`;
  const LS_KEY_CHAP  = (id)=>`chapters:${id}`;

  function writeLS(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch(_){}
  }
  function readLS(key){
    try{
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : null;
    }catch(_){ return null; }
  }
  function clearLS(key){
    try{ localStorage.removeItem(key); }catch(_){}
  }

  /* ===== 封面 ===== */
  function applyCoverFromBook() {
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
        coverFront.innerHTML = `<div style="font-size:1.8em;font-weight:700">${escapeHTML(title)}</div>`;
      }
      if (coverBack) coverBack.style.background = '#fff';
    } else {
      // 單頁模式：第 1、2 頁為封面正反
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
        front.innerHTML = `<div style="font-size:1.8em;font-weight:700">${escapeHTML(title)}</div>`;
      }
      if (back) back.style.background = '#fff';
    }

    if (elTitle && document.activeElement !== elTitle) elTitle.textContent = title;
  }

  /* ===== DB → pairs（封面之外的內容）===== */
  function htmlFromPage(p) {
    if (!p) return '';
    const t = normalizeType(p.type);
    if (t === 'illustration') return ''; // 圖片頁改以背景顯示
    return (p.content_json && p.content_json.text_html) ? p.content_json.text_html : '';
  }
  function buildPairsFromPages() {
    const pairs = [];
    for (let i = 0; i < PAGES_DB.length; i += 2) {
      const pFront = PAGES_DB[i];
      const pBack  = PAGES_DB[i + 1];
      pairs.push({ frontHTML: htmlFromPage(pFront), backHTML: htmlFromPage(pBack) });
    }
    return pairs;
  }

  /* ===== 版面（實寬高 + 字級比例） ===== */
  function applyLayout(){
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

    // 對齊
    elBook.style.left  = (state.direction === 'rtl') ? '0' : '';
    elBook.style.right = (state.direction === 'ltr') ? '0' : '';

    document.body.classList.toggle('mode-rtl', state.direction === 'rtl');
    document.body.classList.toggle('mode-ltr', state.direction === 'ltr');
  }

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
      if (p.image_url && p.image_url.trim()) {
        el.style.backgroundImage = `url("${p.image_url}")`;
      } else {
        el.style.backgroundImage = 'linear-gradient(45deg,#fbb,#fdd)';
        el.innerHTML = '<div style="margin:auto;color:#900;font-weight:700">缺少 image_url</div>';
      }
      el.innerHTML = ''; // 圖片頁不顯文字

    } else {
      el.classList.add('page--novel');
      if (p.content_json?.text_html) el.innerHTML = p.content_json.text_html;
    }
  }

  function applyPageTypesNow(){
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

    // DB.page_index 從 1 開始；DOMIndex = DB.page_index + 2（封面佔 1、2）
    for (const p of PAGES_DB) {
      const domIdx = (p.page_index + 2) - 1; // 0-based
      const el = domPages[domIdx];
      if (!el) continue;
      setPageTypeOnElement(el, p);
    }
  }

  /* ===== 頁碼／章節角標 =====
   * - 封面（DOM 1,2）不顯示
   * - divider/image 也算頁碼，但不顯角標
   * - 顯示頁碼 = DB.page_index（1-based）
   */
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
      if (pageDomIndex <= 2) return; // 封面不顯

      const dbIndex = pageDomIndex - 2;     // DB page_index
      const p = PAGES_DB[dbIndex - 1];
      if (!p) return;

      const t = normalizeType(p.type);
      const showCorner = !(t === 'divider_light' || t === 'divider_dark' || t === 'illustration');
      const displayNo  = dbIndex;           // 直接使用 DB page_index
      const chapter = getChapterForDbIndex(dbIndex);

      // 角落位置
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

        // 連點章節角標：跳到章節定義頁並編輯名稱；空值/取消＝不變動（不插入）
        metaChapter.addEventListener('dblclick', ()=>{
          const cur = getChapterForDbIndex(dbIndex);
          if (cur){
            window.gotoPageDomByDbIndex?.(cur.page_index);
            const input = prompt('編輯章節名稱', cur.title || '');
            if (input === null) return;
            const name = String(input).trim();
            if (!name) return;
            cur.title = name;
          } else {
            const input = prompt('插入章節名稱（留空=不插入）', '');
            if (input === null) return;
            const name = String(input).trim();
            if (!name) return;
            (window.CHAPTERS_DB = window.CHAPTERS_DB || []).push({ title: name, page_index: dbIndex });
            window.CHAPTERS_DB.sort((a,b)=> a.page_index - b.page_index);
          }
          try{ persistDraft(); }catch(_){}
          try{ renderMetaForAllPages(); }catch(_){}
          try{ window.TOC_API?.build?.(); }catch(_){}
        });

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
  function updateCount(){
    if (lblCount) lblCount.textContent = String(PAGES_DB.length);
  }

  /* ===== 雙擊封面圖片可更換 ===== */
  function bindCoverEdit(){
    const coverFront = (state.mode === 'spread')
      ? elBook.querySelector('.paper .page.front')
      : elBook.querySelector('.single-page');
    if (!coverFront) return;
    coverFront.addEventListener('dblclick', ()=>{
      const url = prompt('封面圖片網址（留空移除）', ACTIVE_BOOK?.cover_image||'');
      if (url === null) return;
      const u = String(url||'').trim();
      ACTIVE_BOOK.cover_image = u;
      try{ persistDraft(); }catch(_){}
      applyCoverFromBook();
    });
  }

  /* ===== TOC（目錄）— 由 toc.js 負責 UI，這裡不處理 ===== */

  /* ===== 版面切換 / 方向 / 手勢 ===== */
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

  function toggleDir(){ state.direction = (state.direction === 'ltr') ? 'rtl' : 'ltr'; book.setDirection(state.direction); applyLayout(); lightRedraw(); }
  function toggleBind(){ state.bind = (state.bind === 'short') ? 'long' : 'short'; applyLayout(); lightRedraw(); }
  function toggleView(){ state.mode = (state.mode === 'spread') ? 'single' : 'spread'; book.setMode(state.mode); applyLayout(); ensureSwipeBinding(); lightRedraw(); }
  document.getElementById('btnToggleDir') ?.addEventListener('click', toggleDir);
  document.getElementById('btnToggleBind')?.addEventListener('click', toggleBind);
  document.getElementById('btnToggleView')?.addEventListener('click', toggleView);

  function attachSpreadSwipe() {
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
    detachSpreadSwipe = () => {
      elBook.removeEventListener('touchstart', onStart);
      elBook.removeEventListener('touchend',   onEnd);
      detachSpreadSwipe = null;
    };
  }
  function ensureSwipeBinding(){
    if (state.mode === 'spread') { if (!detachSpreadSwipe) attachSpreadSwipe(); }
    else { if (detachSpreadSwipe) detachSpreadSwipe(); }
  }
  let detachSpreadSwipe = null;

  /* ===== 輕量重繪 ===== */
  function lightRedraw(){
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
      if (dbIndex<=0) continue;
      const node = domList[i];
      const story = node.querySelector('.story');
      const t = (story?.innerHTML || '');
      const p = PAGES_DB[dbIndex-1];
      if (p) {
        p.content_json = p.content_json || {};
        p.content_json.text_html = t;
        p.content_json.text_plain = (story?.innerText || '');
      }
    }
  };

  /* ===== localStorage 持久化 ===== */
  function persistDraft(){
    if (!ACTIVE_BOOK?.id) return;
    writeLS(LS_KEY_BOOK(ACTIVE_BOOK.id), ACTIVE_BOOK);
    writeLS(LS_KEY_PAGES(ACTIVE_BOOK.id), PAGES_DB);
    writeLS(LS_KEY_CHAP(ACTIVE_BOOK.id), CHAPTERS_DB);
  };

  /* ===== 初始化：讀取 book & pages ===== */
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

    return { bookData, pages };
  }

  // 依 pages 的 id→page_index 映射，把 chapters.page_id 轉為 chapters.page_index
  async function fetchChaptersSimple(bookId, pageIndexMap) {
    const { data, error } = await SB
      .from('chapters')
      .select('title,page_id,created_at')
      .eq('book_id', bookId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || [])
      .map(r => ({ title: r.title, page_index: pageIndexMap.get(r.page_id) || 1 }))
      .sort((a,b) => a.page_index - b.page_index);
  }

  function loadFromLocal(bookId){
    const book  = readLS(LS_KEY_BOOK(bookId));
    const pages = readLS(LS_KEY_PAGES(bookId));
    const chaps = readLS(LS_KEY_CHAP(bookId)) || [];
    if (!book || !pages) return null;
    return { bookData:book, pages, chaps };
  }

  async function initData(){
    if (!BOOK_ID_Q) { alert('缺少 ?bookid= 參數'); return; }

    let local = loadFromLocal(BOOK_ID_Q);
    if (local){
      ACTIVE_BOOK = local.bookData;
      PAGES_DB = local.pages;
      CHAPTERS_DB = local.chaps || [];

      // 若本地沒有章節，補抓一次 DB 的章節並寫回本地
      if (!CHAPTERS_DB.length) {
        const idToIndex = new Map((PAGES_DB || []).map(r => [r.id, r.page_index]));
        CHAPTERS_DB = await fetchChaptersSimple(BOOK_ID_Q, idToIndex);
        persistDraft();
      }
    }else{
      // 首次：打 DB 取回 → 同時取章節
      const { bookData, pages } = await fetchFromSupabase(BOOK_ID_Q);
      ACTIVE_BOOK = bookData;
      PAGES_DB = pages || [];
      const idToIndex = new Map((PAGES_DB || []).map(r => [r.id, r.page_index]));
      CHAPTERS_DB = await fetchChaptersSimple(BOOK_ID_Q, idToIndex);
      persistDraft();
    }

    // 套用方向/裝訂
    if (ACTIVE_BOOK.direction === 'rtl' || ACTIVE_BOOK.direction === 'ltr') state.direction = ACTIVE_BOOK.direction;
    if (ACTIVE_BOOK.binding === 'long'  || ACTIVE_BOOK.binding === 'short') state.bind = ACTIVE_BOOK.binding;
    document.body.classList.toggle('mode-rtl', state.direction === 'rtl');
    document.body.classList.toggle('mode-ltr', state.direction === 'ltr');
  }

  /* ===== 書名同步（不破壞輸入游標） ===== */
  function bindTitleEdit(){
    if (!elTitle) return;
    elTitle.addEventListener('keydown', (e)=>{
      // 防止 Enter 產生 div；維持單行
      if (e.key === 'Enter'){ e.preventDefault(); document.execCommand('insertLineBreak'); }
    });
    elTitle.addEventListener('input', ()=>{
      const t = (elTitle.textContent || '').trim();
      window.ACTIVE_BOOK = window.ACTIVE_BOOK || {};
      ACTIVE_BOOK.title = t || '未命名書籍';
      try{ persistDraft(); }catch(_){}
      // 即時更新封面（內部已避免覆寫正在輸入的書名元素）
      applyCoverFromBook();
    });
  }

  /* ===== 插入/編輯章節（按鈕） ===== */
  function bindInsertChapter(){
    const btn = document.getElementById('btnInsertChapter');
    if (!btn) return;
    btn.addEventListener('click', ()=>{
      try{ syncAllStoriesToDB && syncAllStoriesToDB(); }catch(_){}
      const dbIndex = (window.EditorCore?.getFocusedDbIndex?.() || 1);
      const exist = (window.CHAPTERS_DB || []).find(ch => ch.page_index === dbIndex) || null;
      const tip = exist ? '編輯章節名稱（留空=取消/刪除章節）' : '插入章節名稱（留空=取消）';
      const input = prompt(tip, exist?.title || '');
      if (input === null) return;
      const name = String(input).trim();
      if (!name){
        if (exist) window.CHAPTERS_DB = (window.CHAPTERS_DB || []).filter(x => x !== exist);
      } else {
        if (exist) exist.title = name;
        else { (window.CHAPTERS_DB = window.CHAPTERS_DB || []).push({ title: name, page_index: dbIndex }); }
        window.CHAPTERS_DB.sort((a,b)=> a.page_index - b.page_index);
      }
      try{ persistDraft(); }catch(_){}
      try{ renderMetaForAllPages(); }catch(_){}
      try{ window.TOC_API?.build?.(); }catch(_){}
    });
  }

  async function init(){
    try {
      await initData();
      bindTitleEdit();
      bindInsertChapter();

      // 初始化 BookFlip（封面保留 1 張 .paper）
      const pairs = buildPairsFromPages();
      window.book = new BookFlip('#bookCanvas', {
        mode: state.mode,
        direction: state.direction,
        speed: 450,
        singleSpeed: 300,
        perspective: 2000,
        data: { pairs },
        startPageIndex: 0,
        coverPapers: 1
      });

      const orig = book._mountCurrent?.bind(book);
      if (orig){
        book._mountCurrent = function(){
          const r = orig();
          setTimeout(()=>{ try{ lightRedraw(); }catch(e){} }, 0);
          return r;
        };
      }

      window.addEventListener('resize', ()=>{ applyLayout(); lightRedraw(); });
      applyLayout();
      ensureSwipeBinding();
      lightRedraw(); // 單頁封面也立即處理
      bindCoverEdit();
    } catch (e) {
      console.error(e);
      alert('載入書籍資料失敗：' + (e?.message || e));
    }
  }

  /* ===== 跳頁工具（供 TOC / 角標雙擊 使用） ===== */
  window.gotoPageDomByDbIndex = function(dbIndex){
    const domIndex = (window.EditorCore?.dbIndexToDomIndex?.(Number(dbIndex)||1) || 1);
    window.gotoDomPage(domIndex);
  };
  window.gotoDomPage = function(domIndex){
    const list = (window.EditorCore?.getDomPagesList?.() || []);
    const clamped = Math.max(1, Math.min(list.length || 1, Number(domIndex) || 1));
    if (window.book){
      window.book._cursorPage = clamped - 1;
      if (typeof window.book._mountCurrent === 'function') window.book._mountCurrent();
    }
    try{ lightRedraw(); }catch(_){}
  };

  document.addEventListener('DOMContentLoaded', init);
})();
