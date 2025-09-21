/* app.js — 輕量穩定版（在地編輯 + 封面同步 + 封面雙擊換圖）
 * 僅做 4 件事：
 * 1) 用 ?bookid=<uuid> 讀書；不再用書名/BOOK_ID
 * 2) 第一次抓 Supabase → seed 到 localStorage（db 快照 + draft）；之後都走本地
 * 3) 改左上角書名 → 立即同步封面標題（只影響本地 draft）
 * 4) 封面雙擊 → 輸入圖片網址；空字串 => cover_image = null（只影響本地 draft）
 *
 * 其它規則完全保留你的版本：
 * - 封面（第一張 .paper 的 front/back）不算頁碼、不顯角標
 * - DB 的 page_index 從 1 起算，顯示頁碼 = page_index（divider/image 也算頁）
 * - 頁型 enum：novel / divider_white / divider_black / image
 *   會正規化為：novel / divider_light / divider_dark / illustration（背景滿版）
 * - 單頁/雙頁、左右開切換與手勢；字級比例 = 依面積縮放（不要亂動 ✓）
 */

/* ===== DOM ===== */
const elStage  = document.getElementById('scaler');
const elBook   = document.getElementById('bookCanvas');
const lblCount = document.getElementById('lblCount');

const urlq = new URLSearchParams(location.search);
const BOOK_ID_Q = (urlq.get('bookid') || '').trim();   // ★ 改成用 ?bookid

/* ===== 狀態 ===== */
const state = {
  mode: 'spread',        // 'spread' | 'single'
  direction: 'ltr',      // 'ltr' | 'rtl'
  bind: 'short',         // 'short' | 'long'
  aspectShort: 5/7,      // 高/寬
  aspectLong:  7/5
};

/* ===== 本地儲存（local-first）===== */
const LS = {
  key(bookId){ return `ebook_local_${bookId}`; },
  load(bookId){
    try{ return JSON.parse(localStorage.getItem(this.key(bookId))) }catch{ return null }
  },
  save(bookId, payload){
    localStorage.setItem(this.key(bookId), JSON.stringify(payload));
  },
  seed(book, pages, chapters){
    const base = {
      book: pickBookFields(book),
      pages: pages.map(normalizePageFromDB),
      chapters: chapters.map(c => ({ title: c.title, page_index: c.page_index }))
    };
    const payload = {
      draft: deepClone(base),  // 工作稿
      db: deepClone(base),     // 上次雲端快照
      meta: { bookId: book.id, fromDBAt: Date.now(), version: 1 }
    };
    this.save(book.id, payload);
    return payload;
  }
};

/* ===== 變數 ===== */
let STORE = null;         // { draft, db, meta }
let ACTIVE_BOOK = null;   // = STORE.draft.book
let PAGES_DB = [];        // = STORE.draft.pages
let CHAPTERS_DB = [];     // = STORE.draft.chapters
let book = null;
let detachSpreadSwipe = null;

/* ===== Utils ===== */
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
function escapeHTML(str){ return String(str || '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function pickBookFields(b){
  return {
    id: b.id,
    title: b.title,
    cover_image: b.cover_image || null,
    cover_color: b.cover_color || null,
    binding: (b.binding==='long'?'long':'short'),
    direction: (b.direction==='rtl'?'rtl':'ltr')
  };
}
function normalizeType(t) {
  const x = String(t || '').trim().toLowerCase().replace(/-/g, '_');
  if (x === 'divider_black') return 'divider_dark';
  if (x === 'divider_white') return 'divider_light';
  if (x === 'image')         return 'illustration';
  if (x === 'novel' || x === 'divider_light' || x === 'divider_dark' || x === 'illustration') return x;
  return 'novel';
}
function normalizePageFromDB(p){
  return {
    id: p.id,
    page_index: p.page_index,
    type: normalizeType(p.type),
    image_url: p.image_url || null,
    content_json: p.content_json || null
  };
}

/* ===== Supabase 讀取（bookid 專用）===== */
async function fetchBookById(requiredId) {
  if (!requiredId) throw new Error('缺少 ?bookid 參數');
  const { data, error } = await SB
    .from('books')
    .select('id,title,cover_image,cover_color,binding,direction')
    .eq('id', requiredId)
    .single();
  if (error) throw error;
  return data;
}
async function fetchPages(bookId) {
  const { data, error } = await SB
    .from('pages')
    .select('id,page_index,type,image_url,content_json')
    .eq('book_id', bookId)
    .order('page_index', { ascending: true });
  if (error) throw error;
  return data || [];
}
async function fetchChaptersSimple(bookId, pageIndexMap) {
  const { data, error } = await SB
    .from('chapters')
    .select('title,page_id,created_at')
    .eq('book_id', bookId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(r => ({
    title: r.title,
    page_index: pageIndexMap.get(r.page_id) || 1
  })).sort((a,b)=>a.page_index - b.page_index);
}

/* ===== 封面 ===== */
function getCoverFrontEl(){
  if (state.mode === 'spread') {
    return elBook.querySelector('.paper .page.front');
  } else {
    return elBook.querySelectorAll('.single-page')[0] || null;
  }
}
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

  const titleNode = document.getElementById('bookTitle');
  if (titleNode) titleNode.textContent = title;
}

/* 封面雙擊：輸入圖片網址；空值 = 取消封面圖（null） */
function bindCoverDblClick(){
  const front = getCoverFrontEl();
  if (!front) return;
  front.addEventListener('dblclick', ()=>{
    const url = window.prompt('輸入封面圖片網址（留空代表移除封面圖片）：', ACTIVE_BOOK.cover_image || '');
    if (url === null) return; // 取消
    const trimmed = (url || '').trim();
    ACTIVE_BOOK.cover_image = trimmed ? trimmed : null;
    persistDraft();
    applyCoverFromBook();
  });
}

/* ===== DB → pairs（封面之外的內容）===== */
function htmlFromPage(p) {
  if (!p) return '';
  const t = normalizeType(p.type);
  if (t === 'illustration') return ''; // 圖片頁改用背景顯示
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

/* ===== 版面（保留你「面積算字級」）===== */
function applyLayout(){
  const stageW   = elStage.clientWidth;
  const isSpread = state.mode === 'spread';
  const aspect   = (state.bind === 'short') ? state.aspectShort : state.aspectLong;
  const desiredW = isSpread ? stageW / 2 : stageW;
  const desiredH = Math.round(desiredW * aspect);

  // 尺寸
  elBook.style.width  = desiredW + 'px';
  elBook.style.height = desiredH + 'px';

  // 定位：spread 依左右開靠邊；single 置中
  elBook.style.left = ''; elBook.style.right = ''; elBook.style.transform = '';
  if (isSpread){
    elBook.style.left  = (state.direction === 'rtl') ? '0' : '';
    elBook.style.right = (state.direction === 'ltr') ? '0' : '';
  } else {
    elBook.style.left = '50%';
    elBook.style.transform = 'translateX(-50%)';
  }

  // 字級比例（面積）
  const BASE_W = 700, BASE_H_SHORT = BASE_W * (5/7);
  const scale = Math.sqrt((desiredW * desiredH) / (BASE_W * BASE_H_SHORT));
  elBook.classList.add('book-scope');
  elBook.style.setProperty('--scale', String(scale));

  // 外觀（直/橫排 class）
  document.body.classList.toggle('mode-rtl', state.direction === 'rtl');
  document.body.classList.toggle('mode-ltr', state.direction === 'ltr');
}

/* ===== 四種頁型（底線版，純顯示） ===== */
function setPageTypeOnElement(el, p){
  const t = normalizeType(p.type);
  el.classList.remove('page--novel','page--divider_light','page--divider_dark','page--illustration');
  el.style.backgroundImage = '';
  el.dataset.type = t;

  if (t === 'divider_light') {
    el.classList.add('page--divider_light');
    el.innerHTML = p.content_json?.text_html || '';

  } else if (t === 'divider_dark') {
    el.classList.add('page--divider_dark');
    el.innerHTML = p.content_json?.text_html || '';

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
    el.innerHTML = p.content_json?.text_html || '';
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

/* ===== 頁碼／章節角標（純顯示） ===== */
function getChapterForDbIndex(dbIndex){
  let cur = null;
  for (const ch of CHAPTERS_DB){
    if (ch.page_index <= dbIndex) cur = ch; else break;
  }
  return cur;
}
function renderMetaForAllPages(){
  const list = [];
  if (state.mode === 'spread') {
    elBook.querySelectorAll('.paper').forEach(paper=>{
      const f = paper.querySelector('.page.front');
      const b = paper.querySelector('.page.back');
      if (f) list.push(f);
      if (b) list.push(b);
    });
  } else {
    elBook.querySelectorAll('.single-page').forEach(n => list.push(n));
  }
  list.forEach((node, idx0)=>{
    const domIndex = idx0 + 1;
    node.querySelectorAll('.page-meta').forEach(m => m.remove());
    if (domIndex <= 2) return; // 封面不顯

    const dbIndex = domIndex - 2;     // DB page_index
    const p = PAGES_DB[dbIndex - 1];
    if (!p) return;

    const t = normalizeType(p.type);
    const showCorner = !(t === 'divider_light' || t === 'divider_dark' || t === 'illustration');
    const chapter = getChapterForDbIndex(dbIndex);
    const displayNo = dbIndex;

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

      const metaPage = document.createElement('div');
      metaPage.className = `page-meta meta-page ${pageCorner}`;
      metaPage.textContent = String(displayNo);

      node.appendChild(metaChapter);
      node.appendChild(metaPage);
    }
  });
}

/* ===== 頁數顯示 ===== */
function updateCount(){ lblCount.textContent = String(PAGES_DB.length); }

/* ===== TOC ===== */
const tocModal = document.getElementById('tocModal');
const tocBody  = document.getElementById('tocBody');

function openTOC(){ buildTOC(); tocModal.classList.add('show'); tocModal.setAttribute('aria-hidden','false'); }
function closeTOC(){ tocModal.classList.remove('show'); tocModal.setAttribute('aria-hidden','true'); }
tocModal?.addEventListener('click', (e)=>{ if (e.target === tocModal) closeTOC(); });
document.getElementById('btnTOC')?.addEventListener('click', openTOC);

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
    row.innerHTML = `<div class="toc-title">${escapeHTML(ch.title)}</div><div class="toc-page">${ch.page_index}</div>`;
    row.addEventListener('click', ()=>{ gotoPageDomByDbIndex(ch.page_index); closeTOC(); });
    tocBody.appendChild(row);
  });

  document.getElementById('tocGotoCover')?.addEventListener('click', ()=>{ gotoDomPage(1); closeTOC(); });
}

function gotoPageDomByDbIndex(dbIndex){ gotoDomPage(dbIndex + 2); }
function gotoDomPage(domIndex){
  const isSpread = state.mode === 'spread';
  const totalDom = isSpread
    ? elBook.querySelectorAll('.paper').length * 2
    : elBook.querySelectorAll('.single-page').length;

  const clamped = Math.max(1, Math.min(totalDom, domIndex|0));
  book._cursorPage = clamped - 1;
  book._mountCurrent();
  afterLayoutRedraw();
}

/* ===== 左右鍵（保留原邏輯） ===== */
function goLeft(){
  if (state.mode === 'single') book.prev();
  else { if (state.direction === 'rtl') book.next(); else book.prev(); }
}
function goRight(){
  if (state.mode === 'single') book.next();
  else { if (state.direction === 'rtl') book.prev(); else book.next(); }
}
document.getElementById('btnleft') .addEventListener('click', goLeft);
document.getElementById('btnright').addEventListener('click', goRight);

/* ===== 三顆主控（只切視圖/方向/裝訂；不動資料） ===== */
function toggleDir(){ state.direction = (state.direction === 'ltr') ? 'rtl' : 'ltr'; book.setDirection(state.direction); applyLayout(); afterLayoutRedraw(); }
function toggleBind(){ state.bind = (state.bind === 'short') ? 'long' : 'short'; applyLayout(); afterLayoutRedraw(); }
function toggleView(){ state.mode = (state.mode === 'spread') ? 'single' : 'spread'; book.setMode(state.mode); applyLayout(); ensureSwipeBinding(); afterLayoutRedraw(); }
document.getElementById('btnToggleDir') .addEventListener('click', toggleDir);
document.getElementById('btnToggleBind').addEventListener('click', toggleBind);
document.getElementById('btnToggleView').addEventListener('click', toggleView);

/* ===== 雙頁手勢（單頁由外掛內建） ===== */
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
function ensureSwipeBinding(){ if (state.mode === 'spread') { if (!detachSpreadSwipe) attachSpreadSwipe(); } else { if (detachSpreadSwipe) detachSpreadSwipe(); } }

/* ===== 共同重繪 ===== */
function afterLayoutRedraw(){
  applyCoverFromBook();     // 封面（同步書名 or 圖片）
  bindCoverDblClick();      // ★ 封面雙擊換圖
  applyPageTypesNow();      // 內頁型別
  renderMetaForAllPages();  // 章節角標/頁碼
  updateCount();            // 頁數顯示
}

/* ===== Draft 持久化（本地） ===== */
function persistDraft(){
  STORE.draft.book = pickBookFields(ACTIVE_BOOK);
  STORE.draft.pages = PAGES_DB.map(p=>({...p}));
  STORE.draft.chapters = CHAPTERS_DB.map(c=>({...c}));
  LS.save(STORE.meta.bookId, STORE);
}

/* ===== 書名即時同步封面（本地） ===== */
document.getElementById('bookTitle')?.addEventListener('input', (e)=>{
  ACTIVE_BOOK.title = e.currentTarget.textContent || '';
  persistDraft();
  applyCoverFromBook(); // ★ 立刻改封面標題
});

/* ===== 初始化 ===== */
(async function init(){
  try {
    // 1) 先讀 localStorage；若沒有，再打 DB seed 一次
    const local = LS.load(BOOK_ID_Q);
    if (local && local.draft && local.db) {
      STORE = local;
    } else {
      const bookFromDB = await fetchBookById(BOOK_ID_Q);
      const pagesDB = await fetchPages(bookFromDB.id);
      const idToIndex = new Map((pagesDB||[]).map(r => [r.id, r.page_index]));
      const chaptersDB = await fetchChaptersSimple(bookFromDB.id, idToIndex);
      STORE = LS.seed(bookFromDB, pagesDB, chaptersDB);
    }

    // 2) 將 draft 載入到執行態
    ACTIVE_BOOK = deepClone(STORE.draft.book);
    PAGES_DB = deepClone(STORE.draft.pages);
    CHAPTERS_DB = deepClone(STORE.draft.chapters);

    // 3) 初始外觀
    if (ACTIVE_BOOK.direction === 'rtl' || ACTIVE_BOOK.direction === 'ltr') state.direction = ACTIVE_BOOK.direction;
    if (ACTIVE_BOOK.binding === 'long'  || ACTIVE_BOOK.binding === 'short') state.bind = ACTIVE_BOOK.binding;
    document.body.classList.toggle('mode-rtl', state.direction === 'rtl');
    document.body.classList.toggle('mode-ltr', state.direction === 'ltr');

    // 4) 初始化 BookFlip（封面保留 1 張 .paper）
    const pairs = buildPairsFromPages();
    book = new BookFlip('#bookCanvas', {
      mode: state.mode,
      direction: state.direction,
      speed: 450,
      singleSpeed: 300,
      perspective: 2000,
      data: { pairs },
      startPageIndex: 0,
      coverPapers: 1
    });

    // 5) 初次排版/繪製
    window.addEventListener('resize', ()=>{ applyLayout(); afterLayoutRedraw(); });
    applyLayout();
    ensureSwipeBinding();
    afterLayoutRedraw();

  } catch (e) {
    console.error(e);
    alert('載入書籍資料失敗：' + (e?.message || e));
  }
})();
