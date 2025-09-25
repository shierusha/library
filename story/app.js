/* app.js — 本地化穩定版（僅此檔）
 * 功能：
 * - 以 ?bookid=UUID 讀 DB（books/pages/chapters）→ 寫入 localStorage；之後以本地為主
 * - TOC（目錄）恢復：從 CHAPTERS_DB 產生清單、可跳頁
 * - 插入章節：在當前頁新增章節（DB 頁直接寫 DB；local_ 頁先本地暫存）
 * - 封面：書名同步、雙擊可改封面圖（空值=移除）
 * - 不改你其他檔、也不改 CSS；文字流動/面積判斷請維持原有檔案
 */

/* ===== DOM ===== */
const elStage  = document.getElementById('scaler');
const elBook   = document.getElementById('bookCanvas');
const lblCount = document.getElementById('lblCount');
const elTitle  = document.getElementById('bookTitle');
const tocModal = document.getElementById('tocModal');
const tocBody  = document.getElementById('tocBody');
const btnTOC   = document.getElementById('btnTOC');
const btnInsertChapter = document.getElementById('btnInsertChapter');

/* ===== 狀態 ===== */
const state = {
  mode: 'spread',        // 'spread' | 'single'
  direction: 'ltr',      // 'ltr' | 'rtl'
  bind: 'short',         // 'short' | 'long'
  aspectShort: 5/7,      // 高/寬
  aspectLong:  7/5
};

/* ===== 變數 ===== */
let ACTIVE_BOOK = null;
let PAGES_DB = [];        // [{id,page_index,type,image_url,content_json}]
let CHAPTERS_DB = [];     // [{id,title,page_id,page_index,local?}]
let book = null;
let detachSpreadSwipe = null;

/* ===== URL / LS key ===== */
const urlq = new URLSearchParams(location.search);
const BOOK_ID_Q = (urlq.get('bookid') || '').trim();
const LS_KEY_BOOK   = id => `book:${id}`;
const LS_KEY_PAGES  = id => `pages:${id}`;
const LS_KEY_CHAP   = id => `chapters:${id}`;

/* ===== Utils ===== */
function escapeHTML(str){ return String(str || '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function normalizeType(t) {
  const x = String(t || '').trim().toLowerCase().replace(/-/g, '_');
  if (x === 'divider_black') return 'divider_dark';
  if (x === 'divider_white') return 'divider_light';
  if (x === 'image')         return 'illustration';
  if (x === 'novel' || x === 'divider_light' || x === 'divider_dark' || x === 'illustration') return x;
  return 'novel';
}
function toHTMLFromPlain(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\n/g,'<br>'); }
function readLS(key, fallback=null){ try{ const s = localStorage.getItem(key); return s? JSON.parse(s): fallback; }catch(_){ return fallback; } }
function writeLS(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(_){} }

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

  const titleNode = document.getElementById('bookTitle');
  if (titleNode) titleNode.textContent = title;
}
function bindCoverEdit(){
  // 只綁一次
  const target = (state.mode === 'spread')
    ? elBook.querySelector('.paper .page.front')
    : elBook.querySelectorAll('.single-page')[0];
  if (!target || target.__coverBound) return;
  target.__coverBound = true;
  target.addEventListener('dblclick', ()=>{
    const u = prompt('輸入封面圖片網址（留空=移除封面圖片）', ACTIVE_BOOK?.cover_image || '');
    ACTIVE_BOOK.cover_image = (u && u.trim()) ? u.trim() : '';
    applyCoverFromBook();
    persistDraft();
  });
}

/* ===== DB → pairs（封面之外的內容）===== */
function htmlFromPage(p) {
  if (!p) return '';
  const t = normalizeType(p.type);
  if (t === 'illustration') return ''; // 圖片頁改以背景顯示
  return (p.content_json && p.content_json.text_html)
    ? p.content_json.text_html
    : (p.content_json?.text_plain || '');
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

  for (const p of PAGES_DB) {
    const domIdx = (p.page_index + 2) - 1; // DB.page_index 從 1 開；DOMIndex = DB.page_index + 2（封面佔 1、2）
    const el = domPages[domIdx];
    if (!el) continue;
    setPageTypeOnElement(el, p);
  }
}

/* ===== 章節 / TOC ===== */
function getChapterForDbIndex(dbIndex){
  let cur = null;
  for (const ch of CHAPTERS_DB){
    if ((ch.page_index|0) <= dbIndex) cur = ch; else break;
  }
  return cur;
}
function reindexChaptersByPageId(){
  const idToIndex = new Map(PAGES_DB.map(r => [String(r.id), r.page_index]));
  let changed = false;
  CHAPTERS_DB.forEach(ch=>{
    if (ch.page_id && idToIndex.has(String(ch.page_id))){
      const newIdx = idToIndex.get(String(ch.page_id));
      if (newIdx && newIdx !== ch.page_index){ ch.page_index = newIdx; changed = true; }
    }
  });
  if (changed) persistDraft();
}

function renderMetaForAllPages(){
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
}

/* ===== 頁數顯示（封面不算，其他都算） ===== */
function updateCount(){ lblCount.textContent = String(PAGES_DB.length); }

/* ===== TOC ===== */
function openTOC(){ buildTOC(); tocModal.classList.add('show'); tocModal.setAttribute('aria-hidden','false'); }
function closeTOC(){ tocModal.classList.remove('show'); tocModal.setAttribute('aria-hidden','true'); }
tocModal?.addEventListener('click', (e)=>{ if (e.target === tocModal) closeTOC(); });
btnTOC?.addEventListener('click', openTOC);

function buildTOC(){
  if (!tocBody) return;
  const title = (ACTIVE_BOOK?.title || '未命名書籍').trim();

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:2px 0 10px 0;';
  head.innerHTML = `<div style="font-weight:700;width: 11em;letter-spacing:1px">${escapeHTML(title)}</div>
                    <button class="btn ghost" style="padding:2px 8px;border-color: #ffffff33; background: #ffffff00; color: #FFF;" id="tocGotoCover">去封面</button>`;
  tocBody.innerHTML = '';
  tocBody.appendChild(head);

  const list = [...CHAPTERS_DB].sort((a,b)=> (a.page_index||0) - (b.page_index||0));
  list.forEach(ch=>{
    const row = document.createElement('div');
    row.className = 'toc-row';
    row.innerHTML = `
      <div class="toc-title">${escapeHTML(ch.title)}</div>
      <div class="toc-page">${ch.page_index||''}</div>`;
    row.addEventListener('click', ()=>{
      if (ch.page_index) gotoPageDomByDbIndex(ch.page_index);
      closeTOC();
    });
    tocBody.appendChild(row);
  });

  document.getElementById('tocGotoCover')?.addEventListener('click', ()=>{
    gotoDomPage(1);
    closeTOC();
  });
}

/* ===== 跳頁（TOC） ===== */
function gotoPageDomByDbIndex(dbIndex){
  const domIndex = dbIndex + 2; // 封面佔 1、2
  gotoDomPage(domIndex);
}
function gotoDomPage(domIndex){
  const isSpread = state.mode === 'spread';
  const totalDom = isSpread
    ? elBook.querySelectorAll('.paper').length * 2
    : elBook.querySelectorAll('.single-page').length;

  const clamped = Math.max(1, Math.min(totalDom, domIndex|0));
  book._cursorPage = clamped - 1;
  if (typeof book._mountCurrent === 'function') book._mountCurrent();
  // 交還給既有編輯模組去掛 story；我們這邊只刷新角標/類型/封面
  setTimeout(()=>{ try{ applyPageTypesNow(); renderMetaForAllPages(); }catch(e){} }, 0);
}

/* ===== 左右鍵（保留你的邏輯） ===== */
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
function toggleDir(){ state.direction = (state.direction === 'ltr') ? 'rtl' : 'ltr'; book.setDirection(state.direction); applyLayout(); afterLayoutRedraw(); }
function toggleBind(){ state.bind = (state.bind === 'short') ? 'long' : 'short'; applyLayout(); afterLayoutRedraw(); }
function toggleView(){ state.mode = (state.mode === 'spread') ? 'single' : 'spread'; book.setMode(state.mode); applyLayout(); ensureSwipeBinding(); afterLayoutRedraw(); }
document.getElementById('btnToggleDir') .addEventListener('click', toggleDir);
document.getElementById('btnToggleBind').addEventListener('click', toggleBind);
document.getElementById('btnToggleView').addEventListener('click', toggleView);

/* ===== 雙頁手勢（單頁由插件內建） ===== */
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

/* ===== 共同重繪 ===== */
function afterLayoutRedraw(){
  reindexChaptersByPageId();
  applyCoverFromBook();
  applyPageTypesNow();
  renderMetaForAllPages();
  updateCount();
  bindCoverEdit();
}

/* ===== Draft 持久化（LOCAL） ===== */
function persistDraft(){
  if (!ACTIVE_BOOK?.id) return;
  writeLS(LS_KEY_BOOK(ACTIVE_BOOK.id), ACTIVE_BOOK);
  writeLS(LS_KEY_PAGES(ACTIVE_BOOK.id), PAGES_DB);
  writeLS(LS_KEY_CHAP(ACTIVE_BOOK.id), CHAPTERS_DB);
}

/* ===== 初始化資料：先 local，再 DB ===== */
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

  const { data:chapters, error:err3 } = await SB
    .from('chapters')
    .select('id,title,page_id,created_at')
    .eq('book_id', bookId)
    .order('created_at', { ascending: true });
  if (err3) throw err3;

  return { bookData, pages, chapters };
}
function loadFromLocal(bookId){
  const book = readLS(LS_KEY_BOOK(bookId));
  const pages = readLS(LS_KEY_PAGES(bookId));
  const chaps = readLS(LS_KEY_CHAP(bookId));
  if (!book || !pages) return null;
  return { bookData:book, pages, chapters: chaps || [] };
}

/* ===== 插入章節 ===== */
async function insertChapterHere(){
  // 取目前頁：若有 EditorCore 就用；否則用游標頁估算
  let dbIndex = 1;
  if (window.EditorCore?.getFocusedDbIndex) dbIndex = EditorCore.getFocusedDbIndex();
  else {
    const curDom = (window.book?._cursorPage || 0) + 1;
    dbIndex = Math.max(1, curDom - 2);
  }
  const page = PAGES_DB[dbIndex - 1];
  if (!page){ alert('找不到當前頁。'); return; }

  const title = prompt('輸入章節標題（必填）', '');
  if (!title || !title.trim()) return;

  const record = { id: null, title: title.trim(), page_id: page.id || null, page_index: page.page_index || dbIndex };

  // DB：只有當 page_id 存在且不是 local_ 時才能寫入，否則先本地暫存
  let savedToDB = false;
  if (record.page_id && !String(record.page_id).startsWith('local_')){
    try{
      const { data, error } = await SB
        .from('chapters')
        .insert({ book_id: ACTIVE_BOOK.id, page_id: record.page_id, title: record.title })
        .select('id,title,page_id,created_at')
        .single();
      if (!error && data){
        record.id = data.id;
        savedToDB = true;
      }
    }catch(_){ /* 網路失敗 → 掉到本地 */ }
  }
  if (!savedToDB){ record.local = true; }

  CHAPTERS_DB.push(record);
  CHAPTERS_DB.sort((a,b)=> (a.page_index||0) - (b.page_index||0));
  persistDraft();
  renderMetaForAllPages();
}
btnInsertChapter?.addEventListener('click', insertChapterHere);

/* ===== 初始化 ===== */
(async function init(){
  try {
    if (!BOOK_ID_Q) { alert('缺少 ?bookid= 參數'); return; }

    // 嘗試先讀本地
    const local = loadFromLocal(BOOK_ID_Q);
    if (local){
      ACTIVE_BOOK = local.bookData;
      PAGES_DB    = local.pages;
      CHAPTERS_DB = local.chapters || [];
    } else {
      // 首次：打 DB 取回 → 寫入 LS
      const { bookData, pages, chapters } = await fetchFromSupabase(BOOK_ID_Q);
      ACTIVE_BOOK = bookData;
      PAGES_DB    = pages || [];
      const idToIndex = new Map(PAGES_DB.map(r => [String(r.id), r.page_index]));
      CHAPTERS_DB = (chapters||[]).map(c => ({
        id: c.id, title: c.title, page_id: c.page_id, page_index: idToIndex.get(String(c.page_id)) || 1
      }));
      persistDraft();
    }

    // 套用方向/裝訂
    if (ACTIVE_BOOK.direction === 'rtl' || ACTIVE_BOOK.direction === 'ltr') state.direction = ACTIVE_BOOK.direction;
    if (ACTIVE_BOOK.binding === 'long'  || ACTIVE_BOOK.binding === 'short') state.bind = ACTIVE_BOOK.binding;
    document.body.classList.toggle('mode-rtl', state.direction === 'rtl');
    document.body.classList.toggle('mode-ltr', state.direction === 'ltr');

    // 初始化 BookFlip（封面保留 1 張 .paper）
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

    window.addEventListener('resize', ()=>{ applyLayout(); afterLayoutRedraw(); });
    applyLayout();
    ensureSwipeBinding();
    afterLayoutRedraw();

    // 事件：Title 同步封面
    elTitle?.addEventListener('input', ()=>{
      ACTIVE_BOOK.title = elTitle.textContent || '未命名書籍';
      applyCoverFromBook();
      persistDraft();
    });

  } catch (e) {
    console.error(e);
    alert('載入書籍資料失敗：' + (e?.message || e));
  }
})();
