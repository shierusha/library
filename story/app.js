/* app.js — 本地化編輯模式 + BookFlip 掛載 (v2: TOC 綁定強化) */
(function(){
  window.elStage  = document.getElementById('scaler');
  window.elBook   = document.getElementById('bookCanvas');
  const lblCount  = document.getElementById('lblCount');
  const elTitle   = document.getElementById('bookTitle');

  window.state = { mode:'spread', direction:'ltr', bind:'short', aspectShort:5/7, aspectLong:7/5 };

  const urlq = new URLSearchParams(location.search);
  const BOOK_ID_Q = (urlq.get('bookid') || '').trim();
  const LS_KEY_BOOK   = (id)=>`book:${id}`;
  const LS_KEY_PAGES  = (id)=>`pages:${id}`;
  const LS_KEY_CHAP   = (id)=>`chapters:${id}`;

  window.ACTIVE_BOOK = null;
  window.PAGES_DB = [];
  window.CHAPTERS_DB = [];
  window.book = null;

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

  function readLS(key, fallback=null){ try{ const s=localStorage.getItem(key); return s?JSON.parse(s):fallback; }catch(_){ return fallback; } }
  function writeLS(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(_){ } }

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
    const titleNode = document.getElementById('bookTitle'); if (titleNode) titleNode.textContent = title;
  }

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
      applyCoverFromBook();
      persistDraft();
    });
  }

  function htmlFromPage(p) {
    if (!p) return '';
    const t = normalizeType(p.type);
    if (t === 'illustration') return '';
    return (p.content_json && p.content_json.text_html) ? p.content_json.text_html : (p.content_json?.text_plain || '');
  }
  window.buildPairsFromPages = function(){
    const pairs = [];
    for (let i = 0; i < PAGES_DB.length; i += 2) {
      const pFront = PAGES_DB[i];
      const pBack  = PAGES_DB[i + 1];
      pairs.push({ frontHTML: htmlFromPage(pFront), backHTML: htmlFromPage(pBack) });
    }
    return pairs;
  };

  window.applyLayout = function(){
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

  window.applyPageTypesNow = function(){
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
      const domIdx = (p.page_index + 2) - 1;
      const el = domPages[domIdx];
      if (!el) continue;
      setPageTypeOnElement(el, p);
    }
  };

  function getChapterForDbIndex(dbIndex){
    let cur = null;
    for (const ch of CHAPTERS_DB){ if (ch.page_index <= dbIndex) cur = ch; else break; }
    return cur;
  }
  window.renderMetaForAllPages = function(){
    function renderMetaOnDomPage(node, pageDomIndex){
      node.querySelectorAll('.page-meta').forEach(m => m.remove());
      if (pageDomIndex <= 2) return;

      const dbIndex = pageDomIndex - 2;
      const p = PAGES_DB[dbIndex - 1];
      if (!p) return;

      const t = normalizeType(p.type);
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

  window.updateCount = function(){ lblCount && (lblCount.textContent = String(PAGES_DB.length)); };

  function ensureTOCBinding(){
    const tocModal = document.getElementById('tocModal');
    const tocBody  = document.getElementById('tocBody');
    function openTOC(){ buildTOC(); tocModal.classList.add('show'); tocModal.setAttribute('aria-hidden','false'); }
    function closeTOC(){ tocModal.classList.remove('show'); tocModal.setAttribute('aria-hidden','true'); }
    if (tocModal && !tocModal.__bound){
      tocModal.addEventListener('click', (e)=>{ if (e.target === tocModal) closeTOC(); });
      tocModal.__bound = true;
    }
    const btn = document.getElementById('btnTOC');
    if (btn && !btn.__bound){ btn.addEventListener('click', openTOC); btn.__bound = true; }
    window.buildTOC = function(){
      if (!tocBody) return;
      const title = (ACTIVE_BOOK?.title || '未命名書籍').trim();
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin:2px 0 10px 0;';
      head.innerHTML = `<div style="font-weight:700;width: 11em;letter-spacing:1px">${escapeHTML(title)}</div>
                        <button class="btn ghost" style="padding:2px 8px;border-color: #ffffff33; background: #ffffff00; color: #FFF;" id="tocGotoCover">去封面</button>`;
      tocBody.innerHTML = ''; tocBody.appendChild(head);

      (CHAPTERS_DB || []).forEach(ch=>{
        const row = document.createElement('div');
        row.className = 'toc-row';
        row.innerHTML = `<div class="toc-title">${escapeHTML(ch.title)}</div><div class="toc-page">${ch.page_index}</div>`;
        row.addEventListener('click', ()=>{ gotoPageDomByDbIndex(ch.page_index); tocModal.classList.remove('show'); tocModal.setAttribute('aria-hidden','true'); });
        tocBody.appendChild(row);
      });

      document.getElementById('tocGotoCover')?.addEventListener('click', ()=>{ gotoDomPage(1); tocModal.classList.remove('show'); tocModal.setAttribute('aria-hidden','true'); });
    };
  }

  function gotoPageDomByDbIndex(dbIndex){
    const domIndex = dbIndex + 2; gotoDomPage(domIndex);
  }
  function gotoDomPage(domIndex){
    const isSpread = state.mode === 'spread';
    const totalDom = isSpread
      ? elBook.querySelectorAll('.paper').length * 2
      : elBook.querySelectorAll('.single-page').length;
    const clamped = Math.max(1, Math.min(totalDom, domIndex|0));
    book._cursorPage = clamped - 1;
    book._mountCurrent();
    lightRedraw();
  }
  window.gotoPageDomByDbIndex = gotoPageDomByDbIndex;
  window.gotoDomPage = gotoDomPage;

  window.lightRedraw = function(){
    applyPageTypesNow();
    renderMetaForAllPages();
    if (window.EditorCore) EditorCore.hookAllStories();
    if (window.PageStyle) PageStyle.bindImageEditors();
    updateCount();
    applyCoverFromBook();
    bindCoverEdit();
    ensureTOCBinding();
  };

  window.syncAllStoriesToDB = function(){
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

  window.rebuildTo = function(targetDbIndex){
    try{
      const pairs = buildPairsFromPages();
      window.book = new BookFlip('#bookCanvas', {
        mode: state.mode, direction: state.direction, speed: 450, singleSpeed: 300, perspective: 2000,
        data: { pairs }, startPageIndex: Math.max(0, EditorCore.dbIndexToDomIndex(targetDbIndex) - 1), coverPapers: 1
      });
      const orig = book._mountCurrent?.bind(book);
      if (orig){
        book._mountCurrent = function(){
          const r = orig();
          setTimeout(()=>{ try{ lightRedraw(); }catch(e){} }, 0);
          return r;
        };
      }
      book._cursorPage = Math.max(0, EditorCore.dbIndexToDomIndex(targetDbIndex) - 1);
      if (typeof book._mountCurrent === 'function') book._mountCurrent();
      applyLayout(); lightRedraw();
      if (typeof window.ensureSwipeBinding === 'function') ensureSwipeBinding();
    }catch(e){ console.warn('rebuild failed:', e); }
  };

  function goLeft(){ if (state.mode === 'single') book.prev(); else { if (state.direction === 'rtl') book.next(); else book.prev(); } }
  function goRight(){ if (state.mode === 'single') book.next(); else { if (state.direction === 'rtl') book.prev(); else book.next(); } }
  document.getElementById('btnleft') ?.addEventListener('click', goLeft);
  document.getElementById('btnright')?.addEventListener('click', goRight);

  function toggleDir(){ state.direction = (state.direction === 'ltr') ? 'rtl' : 'ltr'; book.setDirection(state.direction); applyLayout(); lightRedraw(); }
  function toggleBind(){ state.bind = (state.bind === 'short') ? 'long' : 'short'; applyLayout(); lightRedraw(); }
  function toggleView(){ state.mode = (state.mode === 'spread') ? 'single' : 'spread'; book.setMode(state.mode); applyLayout(); ensureSwipeBinding(); lightRedraw(); }
  document.getElementById('btnToggleDir') .addEventListener('click', toggleDir);
  document.getElementById('btnToggleBind').addEventListener('click', toggleBind);
  document.getElementById('btnToggleView').addEventListener('click', toggleView);

  window.ensureSwipeBinding = function(){
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

  elTitle?.addEventListener('input', ()=>{ ACTIVE_BOOK.title = elTitle.textContent || '未命名書籍'; applyCoverFromBook(); persistDraft(); });

  window.persistDraft = function(){ if (!ACTIVE_BOOK?.id) return;
    writeLS(LS_KEY_BOOK(ACTIVE_BOOK.id), ACTIVE_BOOK);
    writeLS(LS_KEY_PAGES(ACTIVE_BOOK.id), PAGES_DB);
    writeLS(LS_KEY_CHAP(ACTIVE_BOOK.id), CHAPTERS_DB);
  };

  async function fetchFromSupabase(bookId){
    const { data:bookData, error:err1 } = await SB.from('books').select('id,title,cover_image,cover_color,binding,direction').eq('id', bookId).single();
    if (err1) throw err1;
    const { data:pages, error:err2 } = await SB.from('pages').select('id,page_index,type,image_url,content_json').eq('book_id', bookId).order('page_index', { ascending: true });
    if (err2) throw err2;
    return { bookData, pages };
  }
  function loadFromLocal(bookId){
    const book = readLS(LS_KEY_BOOK(bookId));
    const pages = readLS(LS_KEY_PAGES(bookId));
    const chaps = readLS(LS_KEY_CHAP(bookId)) || [];
    if (!book || !pages) return null;
    return { bookData:book, pages, chaps };
  }
  async function initData(){
    if (!BOOK_ID_Q) { alert('缺少 ?bookid= 參數'); return; }
    let local = loadFromLocal(BOOK_ID_Q);
    if (local){
      ACTIVE_BOOK = local.bookData; PAGES_DB = local.pages; CHAPTERS_DB = local.chaps || [];
    }else{
      const { bookData, pages } = await fetchFromSupabase(BOOK_ID_Q);
      ACTIVE_BOOK = bookData; PAGES_DB = pages || []; CHAPTERS_DB = [];
      try{ persistDraft(); }catch(_){}
    }
    if (ACTIVE_BOOK.direction === 'rtl' || ACTIVE_BOOK.direction === 'ltr') state.direction = ACTIVE_BOOK.direction;
    if (ACTIVE_BOOK.binding === 'long'  || ACTIVE_BOOK.binding === 'short') state.bind = ACTIVE_BOOK.binding;
    document.body.classList.toggle('mode-rtl', state.direction === 'rtl');
    document.body.classList.toggle('mode-ltr', state.direction === 'ltr');
  }

  async function init(){
    try {
      await initData();
      const pairs = buildPairsFromPages();
      window.book = new BookFlip('#bookCanvas', {
        mode: state.mode, direction: state.direction, speed: 450, singleSpeed: 300, perspective: 2000,
        data: { pairs }, startPageIndex: 0, coverPapers: 1
      });
      window.addEventListener('resize', ()=>{ applyLayout(); lightRedraw(); });
      applyLayout();
      ensureSwipeBinding();
      lightRedraw();
      bindCoverEdit();
      ensureTOCBinding();
    } catch (e) {
      console.error(e);
      alert('載入書籍資料失敗：' + (e?.message || e));
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
