/* app.js — 輕量穩定版（一致化：.story > .story-inner 包裹 + 內層置中 + 行分隔正規化）
 * 規則：
 * - 封面（第一張 .paper 的 front/back）不算頁碼、不顯角標
 * - DB 的 page_index 從 1 起算，直接作為顯示頁碼（divider/image 也算頁）
 * - 頁型 enum：novel / divider_white / divider_black / image
 *   會正規化為：novel / divider_light / divider_dark / illustration（背景滿版）
 * - 單頁/雙頁、左右開切換，手勢：單頁內建、雙頁這裡加
 * - 與編輯器一致：文字輸出一律用 .story > .story-inner，白/黑置中頁用 .is-center
 * - 行分隔統一：\n → <br>；僅以 <div> 當斷行的 HTML 也轉為 <br>
 */

/* ===== DOM ===== */
const elStage  = document.getElementById('scaler');
const elBook   = document.getElementById('bookCanvas');
const lblCount = document.getElementById('lblCount');
const urlq = new URLSearchParams(location.search);
const BOOK_TITLE_Q = (urlq.get('book') || '').trim();

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
let CHAPTERS_DB = [];     // [{title,page_index}]
let book = null;
let detachSpreadSwipe = null;

/* ===== Utils ===== */
function escapeHTML(str){ return String(str || '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function normalizeType(t) {
  const x = String(t || '').trim().toLowerCase().replace(/-/g, '_');
  if (x === 'divider_black') return 'divider_dark';
  if (x === 'divider_white') return 'divider_light';
  if (x === 'image')        return 'illustration';
  if (x === 'novel' || x === 'divider_light' || x === 'divider_dark' || x === 'illustration') return x;
  return 'novel';
}

/* === 行分隔正規化 ===
 * - 僅用 <div> 當斷行時：<div>…</div> → \n
 * - 最終將所有 \n → <br>
 */
function normalizeHtmlLinebreaks(raw) {
  if (raw == null) return '';
  let s = String(raw);

  const hasDiv = /<div[\s>]/i.test(s);
  const hasOtherBlocks = /<\/?(p|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|blockquote|pre|section|article|figure)\b/i.test(s);
  if (hasDiv && !hasOtherBlocks) {
    s = s
      .replace(/<div[^>]*>/gi, '')   // 去開 div
      .replace(/<\/div>/gi, '\n');   // 關 div → \n
  }

  // 統一換行
  s = s.replace(/\r\n|\n\r|\r/g, '\n').replace(/\n/g, '<br>');
  return s;
}

/* 純文字 → 安全 HTML + <br> */
function plainToHtmlWithBr(text) {
  const safe = String(text || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;');
  return safe.replace(/\r\n|\n\r|\r|\n/g, '<br>');
}

/* 與編輯器一致的輸出：.story > .story-inner（置中交由 .is-center） */
function renderStoryHTML(raw, { center = false } = {}) {
  const html = raw || '';
  const cls  = center ? 'story-inner is-center' : 'story-inner';
  return `<div class="story"><div class="${cls}">${html}</div></div>`;
}

/* ===== Supabase 讀取 ===== */
async function fetchBookByTitleOrId() {
  if (BOOK_TITLE_Q) {
    const { data, error } = await SB
      .from('books')
      .select('id,title,cover_image,cover_color,binding,direction')
      .ilike('title', BOOK_TITLE_Q) // 書名全站唯一（忽略大小寫）
      .single();
    if (error) throw error;
    return data;
  } else if (BOOK_ID) {
    const { data, error } = await SB
      .from('books')
      .select('id,title,cover_image,cover_color,binding,direction')
      .eq('id', BOOK_ID)
      .single();
    if (error) throw error;
    return data;
  }
  throw new Error('缺少 book 參數或 BOOK_ID。');
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

/* 章節：用 page_id 對應到 pages.page_index，再本地排序 */
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

/* ===== 封面（第一張 .paper，不算頁碼） ===== */
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

  const titleNode = document.getElementById('bookTitle');
  if (titleNode) titleNode.textContent = title;
}

/* ===== DB → pairs（封面之外的內容）===== */
function htmlFromPage(p) {
  if (!p) return '';
  const t = normalizeType(p.type);
  if (t === 'illustration') return ''; // 圖片頁改以背景顯示

  const rawHtml  = p?.content_json?.text_html || '';
  const rawPlain = p?.content_json?.text_plain || '';

  // 行分隔統一
  const html = rawHtml.trim()
    ? normalizeHtmlLinebreaks(rawHtml)
    : plainToHtmlWithBr(rawPlain);

  const center = (t === 'divider_light' || t === 'divider_dark');
  return renderStoryHTML(html, { center });
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
    const rawHtml  = p?.content_json?.text_html || '';
    const rawPlain = p?.content_json?.text_plain || '';
    const html = rawHtml.trim() ? normalizeHtmlLinebreaks(rawHtml) : plainToHtmlWithBr(rawPlain);
    el.innerHTML = renderStoryHTML(html, { center: true });

  } else if (t === 'divider_dark') {
    el.classList.add('page--divider_dark');
    const rawHtml  = p?.content_json?.text_html || '';
    const rawPlain = p?.content_json?.text_plain || '';
    const html = rawHtml.trim() ? normalizeHtmlLinebreaks(rawHtml) : plainToHtmlWithBr(rawPlain);
    el.innerHTML = renderStoryHTML(html, { center: true });

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
    const rawHtml  = p?.content_json?.text_html || '';
    const rawPlain = p?.content_json?.text_plain || '';
    const html = rawHtml.trim() ? normalizeHtmlLinebreaks(rawHtml) : plainToHtmlWithBr(rawPlain);
    el.innerHTML = renderStoryHTML(html);
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

function renderMetaForAllPages(){
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

    const metaPage = document.createElement('div');
    metaPage.className = `page-meta meta-page ${pageCorner}`;
    metaPage.textContent = String(displayNo);

    node.appendChild(metaChapter);
    node.appendChild(metaPage);
  }
}

/* ===== 頁數顯示（封面不算，其他都算） ===== */
function updateCount(){
  lblCount.textContent = String(PAGES_DB.length);
}

/* ===== TOC（目錄） ===== */
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
                    <button class="btn ghost" style="padding:2px 8px;border-color: #ffffff33; background: #ffffff00; color: #FFF;" id="tocGotoCover">去封面</button>`;
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
  book._mountCurrent();
  afterLayoutRedraw();
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
document.getElementById('btnleft') .addEventListener('click', goLeft);
document.getElementById('btnright').addEventListener('click', goRight);

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
  applyCoverFromBook();     // 封面不顯角標
  applyPageTypesNow();      // 四種頁型（含 .story-inner 包裝 + 行分隔統一）
  renderMetaForAllPages();  // 內容頁角標（頁碼 = DB.page_index）
  updateCount();            // 計數：封面不算，其他都算
}

/* ===== 初始化 ===== */
(async function init(){
  try {
    ACTIVE_BOOK = await fetchBookByTitleOrId();
    if (ACTIVE_BOOK.direction === 'rtl' || ACTIVE_BOOK.direction === 'ltr') state.direction = ACTIVE_BOOK.direction;
    if (ACTIVE_BOOK.binding === 'long'  || ACTIVE_BOOK.binding === 'short') state.bind = ACTIVE_BOOK.binding;
    document.body.classList.toggle('mode-rtl', state.direction === 'rtl');
    document.body.classList.toggle('mode-ltr', state.direction === 'ltr');

    const pages = await fetchPages(ACTIVE_BOOK.id);
    PAGES_DB = pages || [];

    // 章節：page_id → page_index
    const idToIndex = new Map(PAGES_DB.map(r => [r.id, r.page_index]));
    CHAPTERS_DB = await fetchChaptersSimple(ACTIVE_BOOK.id, idToIndex);

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
    afterLayoutRedraw(); // 單頁封面也立即處理

  } catch (e) {
    console.error(e);
    alert('載入書籍資料失敗：' + (e?.message || e));
  }
})();
