/* app.js — 啟動、資料存取、BookFlip 掛載、基礎事件
   - 保留 editbook.html 與 book-flip.js 不變
   - 其餘功能拆到「所有功能.js」
*/

(function(){
  /* ========== 全域狀態（修正：避免 state 未定義） ========== */
  window.state = window.state || {
    mode: 'spread',      // 'spread' | 'single'
    direction: 'ltr',    // 'ltr' | 'rtl'
    bind: 'short'        // 'short' | 'long'（暫留位）
  };

  /* ========== DOM ========== */
  const elStage   = document.getElementById('scaler');
  const elBook    = document.getElementById('bookCanvas');
  const elTitle   = document.getElementById('bookTitle');
  const lblCount  = document.getElementById('lblCount');
  const btnLeft   = document.getElementById('btnleft');
  const btnRight  = document.getElementById('btnright');
  const btnToggle = document.getElementById('btnToggleView');
  const btnTOC    = document.getElementById('btnTOC');
  const btnSave   = document.getElementById('btnSave');  // 尚未實作存檔（依你的說明保留）
  const btnBack   = document.getElementById('btnBack');  // 尚未實作回書單（依你的說明保留）

  /* ========== LocalStorage ========== */
  const LS_KEY = 'xer_book_draft_v1';

  function loadDraft(){
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object') return null;
      return obj;
    } catch(e){ console.warn('[draft] load fail', e); return null; }
  }
  function saveDraft(data){
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch(e){ console.warn('[draft] save fail', e); }
  }

  /* ========== 資料模型 ========== */
  function newPage(){
    return { type:'novel', html:'', image_url:null };
  }
  function defaultBook(){
    return {
      title: '未命名書籍',
      cover_url: null,
      chapters: [],              // [{title, page_index}]
      pages: [ newPage(), newPage(), newPage(), newPage() ] // 至少兩張紙
    };
  }

  // 供其他模組讀取/寫入
  window.getBook = ()=> window.ACTIVE_BOOK;
  window.getPages = ()=> window.PAGES_DB;
  window.getChapters = ()=> window.CHAPTERS_DB;
  window.persistDraft = ()=> saveDraft({ title: ACTIVE_BOOK.title, cover_url: ACTIVE_BOOK.cover_url, chapters: CHAPTERS_DB, pages: PAGES_DB });

  /* ========== 啟動：讀草稿 or 初始化 ========== */
  function bootData(){
    const draft = loadDraft();
    if (draft && Array.isArray(draft.pages) && draft.pages.length){
      window.ACTIVE_BOOK = { title: draft.title || '未命名書籍', cover_url: draft.cover_url || null };
      window.PAGES_DB    = draft.pages.slice();
      window.CHAPTERS_DB = Array.isArray(draft.chapters) ? draft.chapters.slice() : [];
    }else{
      const b = defaultBook();
      window.ACTIVE_BOOK = { title: b.title, cover_url: b.cover_url };
      window.PAGES_DB    = b.pages;
      window.CHAPTERS_DB = b.chapters;
      saveDraft({ title: b.title, cover_url: b.cover_url, chapters: b.chapters, pages: b.pages });
    }
  }

  /* ========== 書名（修正游標卡在第一字 & 封面同步） ========== */
  function applyTitleToUI(){
    if (!elTitle) return;
    if (document.activeElement !== elTitle) elTitle.textContent = (ACTIVE_BOOK.title || '未命名書籍');
  }
  function bindTitleEdit(){
    if (!elTitle) return;
    elTitle.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter'){ e.preventDefault(); document.execCommand('insertLineBreak'); }
    });
    elTitle.addEventListener('input', ()=>{
      ACTIVE_BOOK.title = (elTitle.textContent || '').trim() || '未命名書籍';
      persistDraft();
      // 封面同步
      try{ applyCover(); }catch(_){}
    });
  }

  /* ========== 封面（雙擊換圖，空值=移除圖） ========== */
  function applyCover(){
    // 交由 Features 裡的 cover 渲染器完成（這裡只觸發）
    if (window.PageRender && typeof PageRender.applyCoverFromBook === 'function') {
      PageRender.applyCoverFromBook();
    }
  }
  function bindCoverDblClick(){
    // 封面在第一張 .paper .front
    const coverFront = elBook.querySelector('.paper .front');
    if (!coverFront) return;
    coverFront.addEventListener('dblclick', ()=>{
      const url = prompt('輸入封面圖片網址（留白=移除圖片）', ACTIVE_BOOK.cover_url || '');
      if (url === null) return;
      const v = String(url).trim();
      ACTIVE_BOOK.cover_url = v ? v : null;
      persistDraft();
      applyCover();
    });
  }

  /* ========== BookFlip 掛載 ========== */
  window.book = null;

  function buildPairsFromPages(){
    // PAGES_DB 是扁平陣列（每兩頁=一張紙）
    const pairs = [];
    for (let i=0;i<PAGES_DB.length;i+=2){
      const front = PAGES_DB[i]   || newPage();
      const back  = PAGES_DB[i+1] || newPage();
      pairs.push({
        frontHTML: PageRender.pageHTML(front, i+1),
        backHTML:  PageRender.pageHTML(back,  i+2)
      });
    }
    return pairs;
  }

  function mountBook(){
    if (!window.BookFlip) return console.error('BookFlip not found');
    const pairs = buildPairsFromPages();
    window.book = new BookFlip('#bookCanvas', {
      mode: state.mode,
      direction: state.direction,
      perspective: 1800,
      speed: 480,
      singleSpeed: 320,
      coverPapers: 1,        // ✅ 第一張紙視為封面，保留
      data: { pairs },
      startPageIndex: (window._cursorPageIndex || 0)
    });
    lblCount && (lblCount.textContent = String(PAGES_DB.length));
  }

  // 每次 BookFlip 重新渲染後，重新掛上編輯器 hook
  function afterMounted(){
    if (!window.EditorCore || !window.EditorCore.hookAllStories){
      console.warn('[EditorCore] not ready'); return;
    }
    EditorCore.hookAllStories();
    applyCover(); // 重設封面視覺
    PageRender.renderMetaForAllPages(); // 章節角標+頁碼
  }

  /* ========== 導覽（左右、模式切換） ========== */
  function gotoDomPage(domIndex){
    window._cursorPageIndex = Math.max(0, Math.min((PAGES_DB.length-1), Number(domIndex-1)||0));
    if (window.book) {
      window.book._cursorPage = window._cursorPageIndex;
      if (typeof window.book._mountCurrent === 'function') window.book._mountCurrent();
    } else {
      mountBook();
    }
  }
  window.gotoDomPage = gotoDomPage;

  function bindNav(){
    btnLeft && btnLeft.addEventListener('click', ()=> { window.book?.prev(); try{ window.__updateChapterBtnLabel?.(); }catch(_){} });
    btnRight&& btnRight.addEventListener('click', ()=> { window.book?.next(); try{ window.__updateChapterBtnLabel?.(); }catch(_){} });
    btnToggle&& btnToggle.addEventListener('click', ()=>{
      const newMode = (state.mode === 'spread') ? 'single' : 'spread';
      state.mode = newMode;
      if (window.book?.setMode) window.book.setMode(newMode);
      setTimeout(afterMounted, 0);
    });
  }

  /* ========== 初始化 ========== */
  function ensureStorySelectable(){
    // 強制覆寫 .book, .book * 的 user-select:none，讓 .story 可編輯/選取
    if (document.getElementById('enable-story-select')) return;
    const css = `.story, .story * { 
      -webkit-user-select: text !important; 
      -moz-user-select: text !important; 
      -ms-user-select: text !important; 
      user-select: text !important; 
      pointer-events: auto !important; 
      caret-color: auto !important;
    }`;
    const st = document.createElement('style');
    st.id = 'enable-story-select';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function init(){
    bootData();
    ensureStorySelectable();
    applyTitleToUI();
    bindTitleEdit();
    bindNav();

    mountBook();
    // 若掛載事件過早觸發導致漏接，直接執行一次
    try { (function(){
      if (window.EditorCore?.hookAllStories) window.EditorCore.hookAllStories();
      if (window.PageRender?.applyCoverFromBook) window.PageRender.applyCoverFromBook();
      if (window.PageRender?.renderMetaForAllPages) window.PageRender.renderMetaForAllPages();
    })(); } catch(_) {}

    bindCoverDblClick();

    // BookFlip mount 完成事件
    elBook.addEventListener('bookflip:mounted', ()=>{ try{ window.__updateChapterBtnLabel?.(); }catch(_){}; 
      afterMounted();
    });

    // 初始 TOC 構建
    if (window.TOC_API?.build) window.TOC_API.build();
  }

  document.addEventListener('DOMContentLoaded', init);

  // 暴露給功能模組
  window.PageRender = window.PageRender || {}; // namespace 由 所有功能.js 填充
  window.persistDraft = window.persistDraft || function(){};

})();

 
