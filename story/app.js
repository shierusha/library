(() => {
  /* ======================
     儲存：LocalStorage
     ====================== */
  const Store = {
    KEY:'ebook_integrated_v1',
    load(){ try{ return JSON.parse(localStorage.getItem(this.KEY)) }catch{ return null } },
    save(data){ localStorage.setItem(this.KEY, JSON.stringify(data)) }
  };

  /* ======================
     資料模型（含封面）
     ====================== */
  function newPage(){
    return {
      id:'local_'+Math.random().toString(36).slice(2,9),
      page_no:0,                // 內容頁會在 render 時重編 1..N；封面固定 0
      type:'novel',             // 'novel' | 'illustration' | 'divider-light' | 'divider-dark' | 'cover-front'
      content_text:'',
      content_html:'',
      image_url:null
    };
  }
  function newCover(){ return { id:'cover_front', page_no:0, type:'cover-front', content_text:'', content_html:'', image_url:null }; }

 let book = Store.load() || {
    title:'未命名書籍',
    direction:'ltr',       // 'ltr' 橫排；'rtl' 直排
    binding:'short',       // 'short' 直放；'long' 橫放
    viewMode:'double',     // 'single' | 'double'
    textStyle:{ fs:1.02, lh:1.8 },
    pages:[ newCover(), newPage(), newPage() ]
  };

  function ensureCover(){
    if (!book.pages.length || book.pages[0].type!=='cover-front'){
      book.pages.unshift(newCover());
    }
  }
  function ensureMinPages(){
    // 至少兩張內容頁（不含封面）
    const contents = book.pages.filter(p=>p.type!=='cover-front');
 while(contents.length<2){
      const extra = newPage();
      book.pages.push(extra);
      setChapterTitleMeta(extra, null);
      contents.push(1);
    }
  }
  const isCover = (p)=> p && p.type==='cover-front';

  initializeChapterMetadata();
  /* ======================
     DOM & 狀態
     ====================== */
  const $=(s,r=document)=>r.querySelector(s);
  const $all=(s,r=document)=>Array.from((r||document).querySelectorAll(s));
  const scaler=$('#scaler'), papersWrap=$('#papers'), leftPaper=$('#leftPaper'), rightPaper=$('#rightPaper'), flipOverlay=$('#flipOverlay');

  let idx=0;                 // 左頁 index（單頁=當前 index）
  let isFlipping=false;      // 動畫節流
  let activePageId=null;     // 目前操作頁（避免重編號時游標亂跳）

  /* ======================
     導覽列
     ====================== */
  const titleEl = $('#bookTitle');
  if (titleEl){
    titleEl.textContent = book.title;
    titleEl.addEventListener('input', ()=>{
      book.title = (titleEl.textContent||'').trim() || '未命名書籍';
      persist(); render();
    });
    // 雙擊書名 → 跳封面
    titleEl.addEventListener('dblclick', ()=>{ idx=0; render(); });
  }

  /* ======================
     工具列按鈕
     ====================== */
 $('#btnPrev')?.addEventListener('click', ()=> step(-1));
  $('#btnNext')?.addEventListener('click', ()=> step(+1));
  $('#btnInsertChapter')?.addEventListener('click', insertChapter);
  $('#btnInsertPage')?.addEventListener('click', insertAfter);
  $('#btnDeleteBlank')?.addEventListener('click', deleteBlank);
  $('#btnSave')?.addEventListener('click', ()=> alert('示範：已存 LocalStorage；未連 DB'));
  $('#btnBack')?.addEventListener('click', ()=> alert('示範：自行導回書單 URL'));

  $('#btnToggleView')?.addEventListener('click', ()=>{ book.viewMode = (book.viewMode==='single'?'double':'single'); render(); });
  $('#btnToggleDir') ?.addEventListener('click', ()=>{ book.direction = (book.direction==='rtl'?'ltr':'rtl'); render(); });
  $('#btnToggleBind')?.addEventListener('click', ()=>{ book.binding   = (book.binding==='long'?'short':'long'); render(); });

  // 文字工具（保留選取）
  const keepSel=btn=>btn?.addEventListener('mousedown',e=>e.preventDefault());
  ['#btnFontUp','#btnFontDown','#btnBold','#btnItalic','#btnUnderline'].forEach(s=>keepSel($(s)));
  $('#btnBold')     ?.addEventListener('click', ()=> document.execCommand('bold',false,null));
  $('#btnItalic')   ?.addEventListener('click', ()=> document.execCommand('italic',false,null));
  $('#btnUnderline')?.addEventListener('click', ()=> document.execCommand('underline',false,null));
  $('#btnFontUp')   ?.addEventListener('click', ()=> scaleSelection(1.15));
  $('#btnFontDown') ?.addEventListener('click', ()=> scaleSelection(0.87));

  // Dock：切模板
  $all('[data-style]').forEach(b=>{
    b.addEventListener('click',()=>{ setType(getCurPage(), b.dataset.style); });
  });

  // 目錄
  $('#btnTOC')?.addEventListener('click', ()=>{ buildTOC(); $('#tocDialog').showModal(); });

  // ❌ 移除方向鍵翻頁：不再綁 ArrowLeft/ArrowRight

  // Tab 縮排 / 反縮排（僅正文/章節中作用）
  document.addEventListener('keydown', (e)=>{
    const target = e.target?.closest?.('.body-text');
    if(!target) return;
    if(e.key === 'Tab'){
      e.preventDefault();
      if (e.shiftKey) outdentAtSelection(target);
      else indentAtSelection(target);
    }
  });

  // 貼上只留純文字
  document.addEventListener('paste', (e)=>{
    const target = e.target?.closest?.('.body-text');
    if(!target) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    const pageNo = Number(target.closest('.paper')?.querySelector('.page-no')?.textContent) || null;
    insertPlainTextAtCursor(text);
    persistEditableNow(target);
    if (pageNo) autoPaginateFrom(pageNo, target);
  });

  render(); fit();
  window.addEventListener('resize', fit);

  /* ======================
     渲染（頁碼每次 1..N 重編；封面固定單頁）
     ====================== */
  const userWantsSingle = ()=> (book.viewMode==='single');
  function effectiveSingleAt(i){ const L=book.pages[i], R=book.pages[i+1]; return isCover(L)||isCover(R) ? true : userWantsSingle(); }
  function renumberPages(){
    let n=1;
    for (let i=0;i<book.pages.length;i++){
      if (isCover(book.pages[i])) book.pages[i].page_no = 0;
      else book.pages[i].page_no = n++;
    }
  }

   function render(){
    ensureCover(); ensureMinPages(); renumberPages(); syncChapterMetadata();

    const effSingle = effectiveSingleAt(idx);
    document.body.classList.toggle('single', effSingle);
    papersWrap?.classList.toggle('landscape', book.binding==='long');
    scaler?.classList.toggle('vertical', book.direction==='rtl');

        // 顯示內容頁數（不含封面）
    const count = book.pages.reduce((acc,p)=> acc + (isCover(p)?0:1), 0);
    const lblCount = $('#lblCount');
    if (lblCount) lblCount.textContent = String(count);
    document.documentElement.style.setProperty('--fs', book.textStyle.fs+'rem');
    document.documentElement.style.setProperty('--lh', book.textStyle.lh);

    // 雙頁尾端自動補白
    if (!effSingle && !book.pages[idx+1]){
      const extra = newPage();
      book.pages.push(extra);
      setChapterTitleMeta(extra, null);
      renumberPages();
      syncChapterMetadata();
    }
                     
    const maxIndex = Math.max(0, book.pages.length - (effSingle?1:2));
    idx = clamp(idx, 0, maxIndex);

    leftPaper.innerHTML=''; rightPaper.innerHTML='';
    if (effSingle){
      renderOne(rightPaper, book.pages[idx], 'right');
    }else{
      const rtl=(book.direction==='rtl');
      const pL=book.pages[idx], pR=book.pages[idx+1] || newPage();
      if (!rtl){ renderOne(leftPaper,pL,'left'); renderOne(rightPaper,pR,'right'); }
      else     { renderOne(leftPaper,pR,'left'); renderOne(rightPaper,pL,'right'); }
   }

    buildTOC();
    fit();
    updateDockButtonsState();
    persist();
  }

  function templateClass(p){
    if(!p) return '';
    if(p.type==='divider-light')return 'tpl-divider-light';
    if(p.type==='divider-dark') return 'tpl-divider-dark';
    if(p.type==='illustration') return 'tpl-illustration';
    if(p.type==='cover-front')  return 'tpl-cover-front';
    return '';
  }

  function shouldShowPageMetadata(page){
    if (!page || isCover(page)) return false;
    const type = page.type;
    return type!=='divider-light' && type!=='divider-dark' && type!=='illustration';
  }

  function renderOne(host, page, side){
    if(!host || !page) return;
    host.className = 'paper ' + side + ' ' + templateClass(page);
    host.setAttribute('data-page-no', String(page.page_no||0));

    const el = document.createElement('div');
    el.className='page';

    if (isCover(page)){
     if (page.image_url){
        el.style.padding = '0';
        el.innerHTML = `<img src="${esc(page.image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`;
      }else{
        el.innerHTML = `
          <div style="display:grid;place-items:center;height:100%;text-align:center;padding:24px">
            <div style="font-size:1.6em;font-weight:700;line-height:1.2">${esc(book.title||'未命名書籍')}</div>
            <div style="margin-top:10px;opacity:.65">～ 封面 ～</div>
          </div>`;
      }
      host.innerHTML=''; host.appendChild(el);
      host.ondblclick = ()=>{
        const url = prompt('封面圖片網址：', page.image_url||'');
        if (url===null) return;
        const next = url.trim();
        page.image_url = next ? next : null;
        persist();
        render();
      };
      host.addEventListener('mousedown', ()=>{ setActivePage(page); }, {passive:true});
      return;
    }

   if (shouldShowPageMetadata(page)){
      // 角落章節籤（顯示：最近章名；雙擊：直接編輯該章起始頁的章名）
      const chTitle = nearestChapter(page.page_no);
      if (chTitle){
        const chip = document.createElement('div');
        chip.className='chapter-chip';
        chip.textContent = chTitle;
        chip.title = '雙擊可編輯章節名稱';
        chip.addEventListener('dblclick', ()=>{
          const originIdx = getChapterOriginIndex(page.page_no);
          if (originIdx<0) return;
          const origin = book.pages[originIdx];
          const cur = getChapterTitleMeta(origin) || '';
          const next = prompt('章節名稱：', cur);
          if (next===null) return;
          const title = (next||'').trim();
          if (title){
            applyHeadingToPage(origin, title);
            setChapterTitleMeta(origin, title);
          }else{
            setChapterTitleMeta(origin, null);
          }
          persist(); render();
        });
        el.appendChild(chip);
      }

      // 頁碼
      const no = document.createElement('div');
      no.className='page-no';
      no.textContent = page.page_no || '';
      el.appendChild(no);
    }

    // 點擊設為 active
    host.addEventListener('mousedown', ()=>{ setActivePage(page); }, {passive:true});

    if (page.type==='illustration'){
      el.innerHTML += page.image_url
        ? `<img src="${esc(page.image_url)}" alt="">`
        : `<div class="ph" style="color:#6b7280;display:grid;place-items:center;height:100%">（雙擊貼上圖片網址）</div>`;
      host.ondblclick = ()=>{
        const url = prompt('圖片網址：', page.image_url||'')?.trim()||'';
        page.image_url = url || null; persist(); render();
      };
    }else{
      // 正文（章名＝第一行大字 <span data-fs> + <br>）
      const body = document.createElement('div');
      body.className='body-text'; body.contentEditable='true';
      body.dataset.ph = (page.type==='novel' ? '正文…' : '置中文字…');
      if (page.content_html) body.innerHTML = page.content_html;
      else body.textContent = page.content_text || '';

      let tmr=null;
      body.addEventListener('focus', ()=>{ setActivePage(page); });
      body.addEventListener('input', ()=>{
        page.content_html = sanitizeEditableHTML(body);
        page.content_text = body.textContent || '';
        persist();
        clearTimeout(tmr); tmr=setTimeout(()=>autoPaginateFrom(page.page_no, body), 40);
      });

      el.appendChild(body);
      host.ondblclick = null;
    }

    host.innerHTML=''; host.appendChild(el);
  }

  /* ======================
     翻頁：先渲染目標在底，再疊動畫（看到底下真內容）
     ====================== */
  function isEffectiveSingleNow(){ return effectiveSingleAt(idx); }

  function step(sign){
    if (isFlipping) return;

    // 雙頁往後翻且逼近尾端 → 先補一頁（防呆）
    const effSingleNow = isEffectiveSingleNow();
       if (!effSingleNow && sign>0 && (idx + 2 >= book.pages.length)){
      const extra = newPage();
      book.pages.push(extra); renumberPages();
      setChapterTitleMeta(extra, null);
      syncChapterMetadata();
    }

    const effSingle = isEffectiveSingleNow();
    const delta    = effSingle? sign*1 : sign*2;
    const maxIndex = Math.max(0, book.pages.length - (effSingle?1:2));
    const target   = clamp(idx + delta, 0, maxIndex);
    if (target===idx) return;

    const dir = (sign>0)? 'next' : 'prev';
    if (effSingle) flipSingle(dir, target);
    else           flipDouble(dir, target);
  }

  function getOffsetInOverlay(hostPaper){
    const pr = hostPaper.getBoundingClientRect();
    const or = flipOverlay.getBoundingClientRect();
    return { left: pr.left-or.left, top: pr.top-or.top, width: pr.width, height: pr.height };
  }

  function flipDouble(dir, targetIdx){
    if (isFlipping) return;
    const rtl=(book.direction==='rtl');
    const L=idx, R=idx+1;
    let frontPage, backPage, placeLeft, hostPaper;
    if (!rtl){
      if (dir==='next'){ frontPage=getPageByIndex(R); backPage=getPageByIndex(R+1)||newPage(); placeLeft=false; hostPaper=rightPaper; }
      else             { frontPage=getPageByIndex(L); backPage=getPageByIndex(L-1);           placeLeft=true;  hostPaper=leftPaper; }
    }else{
      if (dir==='next'){ frontPage=getPageByIndex(L); backPage=getPageByIndex(L+1)||newPage(); placeLeft=true;  hostPaper=leftPaper; }
      else             { frontPage=getPageByIndex(R); backPage=getPageByIndex(R-1);           placeLeft=false; hostPaper=rightPaper; }
    }
    if (!hostPaper) return;

    const pos = getOffsetInOverlay(hostPaper);
    const turn = document.createElement('div');
    turn.className='turn';
    Object.assign(turn.style,{
      width:pos.width+'px', height:pos.height+'px', left:pos.left+'px', top:pos.top+'px',
      transformOrigin: placeLeft? 'right center':'left center'
    });

    const f = document.createElement('div'); f.className='face front';
    const b = document.createElement('div'); b.className='face back';
    f.appendChild(snapshot(frontPage, placeLeft?'left':'right'));
    b.appendChild(snapshot(backPage , placeLeft?'right':'left'));

    const shade=document.createElement('div'); shade.className='foldShade';
    shade.style.background = placeLeft
      ? 'linear-gradient(270deg, rgba(0,0,0,.22), rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, rgba(0,0,0,.12))'
      : 'linear-gradient(90deg,  rgba(0,0,0,.22), rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, rgba(0,0,0,.12))';
    turn.appendChild(f); turn.appendChild(b); turn.appendChild(shade);

    isFlipping=true; disableNav(true);
    idx = targetIdx; render();

    flipOverlay.innerHTML=''; flipOverlay.appendChild(turn);
    void turn.offsetWidth;
    turn.style.animation = placeLeft ? 'flipLeftPrev .42s ease both' : 'flipRightNext .42s ease both';
    turn.addEventListener('animationend', ()=>{ flipOverlay.innerHTML=''; isFlipping=false; disableNav(false); }, {once:true});
  }

  function flipSingle(dir, targetIdx){
    if (isFlipping) return;
    const pos = getOffsetInOverlay(rightPaper);
    const snap = snapshot(getPageByIndex(idx), 'right');

    isFlipping=true; disableNav(true);
    idx = targetIdx; render();

    const cover=document.createElement('div');
    cover.className='singleTurn';
    Object.assign(cover.style,{ width:pos.width+'px', height:pos.height+'px', left:pos.left+'px', top:pos.top+'px', transformOrigin:'left center' });
    cover.appendChild(snap);

    flipOverlay.innerHTML=''; flipOverlay.appendChild(cover);
    void cover.offsetWidth;
    cover.style.animation='singleCurl .32s ease both';
    cover.addEventListener('animationend', ()=>{ flipOverlay.innerHTML=''; isFlipping=false; disableNav(false); }, {once:true});
  }

  function disableNav(v){ const a=$('#btnPrev'), b=$('#btnNext'); if(a)a.disabled=v; if(b)b.disabled=v; }

  // 覆蓋層快照
  function snapshot(page, side){
    const host=document.createElement('div');
    host.className='paper '+side+' '+templateClass(page);
    const el=document.createElement('div'); el.className='page';

    if (isCover(page)){
     if (page.image_url){
        el.style.padding='0';
        el.innerHTML = `<img src="${esc(page.image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`;
      }else{
        el.innerHTML = `
          <div style="display:grid;place-items:center;height:100%;text-align:center;padding:24px">
            <div style="font-size:1.6em;font-weight:700;line-height:1.2">${esc(book.title||'未命名書籍')}</div>
            <div style="margin-top:10px;opacity:.65">～ 封面 ～</div>
          </div>`;
      }
      
      host.appendChild(el); return host;
    }

    if (shouldShowPageMetadata(page)){
      const ch = nearestChapter(page.page_no);
      if (ch){
        const chip=document.createElement('div');
        chip.className='chapter-chip';
        chip.textContent=ch;
        el.appendChild(chip);
      }
      const no=document.createElement('div');
      no.className='page-no';
      no.textContent=page.page_no||'';
      el.appendChild(no);
    };

    if (page.type==='illustration'){
      el.innerHTML += page.image_url ? `<img src="${esc(page.image_url)}" alt="">` : '';
    }else{
      const b=document.createElement('div'); b.className='body-text'; b.textContent = page.content_text||''; el.appendChild(b);
    }
    host.appendChild(el);
    return host;
  }

   /* ======================
     章節：偵測 / 編輯 / 目錄
     ====================== */
  function initializeChapterMetadata(){
    if (book.chapters && typeof book.chapters === 'object'){
      syncChapterMetadata();
      return;
    }
    book.chapters = {};
    book.pages.forEach(page=>{
      if (!page || !page.id) return;
      if (isCover(page)){ book.chapters[page.id] = null; return; }
      const inferred = getHeadingFromPage(page);
      book.chapters[page.id] = inferred ? { title: inferred } : null;
    });
  }

  function syncChapterMetadata(){
    if (!book.chapters || typeof book.chapters !== 'object') book.chapters = {};
    const ids = new Set(book.pages.map(p=>p.id));
    Object.keys(book.chapters).forEach(id=>{ if (!ids.has(id)) delete book.chapters[id]; });
    book.pages.forEach(page=>{
      if (!page || !page.id) return;
      if (!(page.id in book.chapters)) book.chapters[page.id] = null;
    });
  }

  function getChapterTitleMeta(page){
    if (!page) return '';
    if (!book.chapters || typeof book.chapters !== 'object') return '';
    const entry = book.chapters[page.id];
    if (entry && typeof entry === 'object' && entry.title) return entry.title;
    return '';
  }

  function setChapterTitleMeta(page, title){
    if (!page) return;
    if (!book.chapters || typeof book.chapters !== 'object') book.chapters = {};
    if (title && title.trim()) book.chapters[page.id] = { title: title.trim() };
    else book.chapters[page.id] = null;
  }

  // 章名規則：正文第一個節點若是 <span data-fs>=1.2 或 style.fontSize>=1.2em，就視為章名；其後需有 <br>
  function getHeadingFromHTML(html){
    if (!html) return '';
    const wrap=document.createElement('div'); wrap.innerHTML=html;
    let n=wrap.firstChild;
    while(n && n.nodeType===3 && !n.nodeValue.trim()){ n=n.nextSibling; } // 去開頭空白
    if (n && n.nodeType===1 && n.tagName==='SPAN'){
      const ds=parseFloat(n.getAttribute('data-fs'));
      const fs=parseFloat((n.style.fontSize||'').replace('em',''));
      if ((isFinite(ds) && ds>=1.2) || (isFinite(fs) && fs>=1.2)) return (n.textContent||'').trim();
    }
    return '';
  }
  function getHeadingFromPage(p){ return getHeadingFromHTML(p.content_html||''); }

function getChapterOriginIndex(pageNo){
    syncChapterMetadata();
    let i=book.pages.findIndex(p=>p.page_no===pageNo);
    if (i<0) return -1;
    for(let x=i; x>=0; x--){
      const p=book.pages[x];
      if (p.page_no>0 && getChapterTitleMeta(p)) return x;
    }
    return -1;
  }
  function nearestChapter(pageNo){
    syncChapterMetadata();
    let i=book.pages.findIndex(p=>p.page_no===pageNo);
    if (i<0) return '';
    for(let x=i; x>=0; x--){
      const p=book.pages[x];
      if (p.page_no>0){
        const h=getChapterTitleMeta(p);
        if (h) return h;
      }
    }
    return '';
  }

  function applyHeadingToPage(page, title){
    const tmp=document.createElement('div');
    tmp.innerHTML = page.content_html || '';
    // 去開頭空白
    let first=tmp.firstChild;
    while(first && first.nodeType===3 && !first.nodeValue.trim()){ const t=first; first=first.nextSibling; tmp.removeChild(t); }
    if (first && first.nodeType===1 && first.tagName==='SPAN'){
      const ds=parseFloat(first.getAttribute('data-fs'));
      const fs=parseFloat((first.style.fontSize||'').replace('em',''));
      if ((isFinite(ds)&&ds>=1.2) || (isFinite(fs)&&fs>=1.2)){
        first.textContent = title;
      }else{
        const span=document.createElement('span');
        span.setAttribute('data-fs','1.4'); span.style.fontSize='1.4em'; span.textContent=title;
        tmp.insertBefore(span, first);
      }
    }else{
      const span=document.createElement('span');
      span.setAttribute('data-fs','1.4'); span.style.fontSize='1.4em'; span.textContent=title;
      tmp.insertBefore(span, first||null);
    }
    // 確保下一個是 <br>
    if (!(spanOrFirst(tmp.firstChild).nextSibling && spanOrFirst(tmp.firstChild).nextSibling.tagName==='BR')){
      const br=document.createElement('br');
      tmp.insertBefore(br, spanOrFirst(tmp.firstChild).nextSibling || null);
    }
    page.content_html = sanitizeEditableHTML(tmp);
    page.content_text = tmp.textContent || '';
  }
  function spanOrFirst(n){ return (n && n.tagName==='SPAN') ? n : n; }
  function removeHeadingFromPage(page){
    const tmp=document.createElement('div'); tmp.innerHTML=page.content_html||'';
    let first=tmp.firstChild;
    while(first && first.nodeType===3 && !first.nodeValue.trim()){ const t=first; first=first.nextSibling; tmp.removeChild(t); }
    if (first && first.nodeType===1 && first.tagName==='SPAN'){
      const ds=parseFloat(first.getAttribute('data-fs'));
      const fs=parseFloat((first.style.fontSize||'').replace('em',''));
      if ((isFinite(ds)&&ds>=1.2) || (isFinite(fs)&&fs>=1.2)){
        // 刪掉 span 與緊接的 <br>
        const rm=first; const next=rm.nextSibling;
        tmp.removeChild(rm);
        if (next && next.nodeType===1 && next.tagName==='BR') tmp.removeChild(next);
      }
    }
    page.content_html = sanitizeEditableHTML(tmp);
    page.content_text = tmp.textContent || '';
  }

    function buildTOC(){
    const box=$('#tocList'); if(!box) return;

    syncChapterMetadata();

    const rows=[];
    // 封面列
    rows.push(`
      <div class="toc-row" data-cover="1"
           style="display:flex;gap:10px;align-items:baseline;padding:10px 12px;border-bottom:1px dashed #2a3555;cursor:pointer">
        <div style="white-space:nowrap;max-width:70%;overflow:hidden;text-overflow:ellipsis">封面</div>
        <div style="flex:1;border-bottom:1px dotted #2a3555;transform:translateY(-2px)"></div>
        <div style="color:#9aa3b2">—</div>
      </div>`);

    // 逐頁找「本頁第一行大字」作為章節起點
    for (let i=0;i<book.pages.length;i++){
      const p=book.pages[i];
      if (p.page_no<=0) continue;
      const ch=getChapterTitleMeta(p);
      if (!ch) continue;
      rows.push(`
      <div class="toc-row" data-no="${p.page_no}"
           style="display:flex;gap:10px;align-items:baseline;padding:10px 12px;border-bottom:1px dashed #2a3555;cursor:pointer">
        <div style="white-space:nowrap;max-width:70%;overflow:hidden;text-overflow:ellipsis">${esc(ch)}</div>
        <div style="flex:1;border-bottom:1px dotted #2a3555;transform:translateY(-2px)"></div>
        <div style="color:#9aa3b2">P${p.page_no}</div>
      </div>`);
    }

    if (rows.length===1){
      box.innerHTML='<div style="padding:12px;color:#9aa3b2">尚無章節</div>';
      return;
    }
    box.innerHTML = rows.join('');

    // 點封面
    box.querySelector('[data-cover]')?.addEventListener('click', ()=>{
      idx=0; render(); $('#tocDialog')?.close();
    });

    // 點章節
   $all('.toc-row[data-no]', box).forEach(row=>{
      const navigateToEntry = ()=>{
        const targetNo = parseInt(row.getAttribute('data-no'),10);
        const targetIdx= book.pages.findIndex(p=>p.page_no===targetNo);
        if (targetIdx<0) return null;
        const page = book.pages[targetIdx];
        const effSingle = effectiveSingleAt(targetIdx);
        idx = effSingle ? targetIdx : Math.max(0, targetIdx - (targetIdx%2));
        setActivePage(page);
        render(); $('#tocDialog')?.close();
        return page;
      };
      row.addEventListener('click', ()=>{ navigateToEntry(); });
      row.addEventListener('dblclick', ()=>{
        const page = navigateToEntry();
        if (!page) return;
                const currentTitle = getChapterTitleMeta(page) || '';
        const next = prompt('章節名稱：', currentTitle);
        if (next===null) return;
        const title = next.trim();
        if (title){
          applyHeadingToPage(page, title);
          setChapterTitleMeta(page, title);
        }else{
          setChapterTitleMeta(page, null);
        }
        persist();
        render();
      });
    });
  }

  /* ======================
     自動換頁（切出去的文字回預設樣式）
     ====================== */
  function autoPaginateFrom(pageNo, bodyEl){
    const i = book.pages.findIndex(p=>p.page_no===pageNo);
    if (i<0) return;
    const body = bodyEl || findBodyForPage(pageNo);
    if (!body) return;
    if (body.scrollHeight <= body.clientHeight) return;

    const originalHTML = body.innerHTML;
    const fullText = body.textContent || '';
    let lo=0, hi=fullText.length, fit=fullText.length;
    while(lo<=hi){
      const mid=(lo+hi>>1);
      body.textContent = fullText.slice(0,mid);
      if (body.scrollHeight <= body.clientHeight){ fit=mid; lo=mid+1; } else hi=mid-1;
    }
    body.innerHTML = originalHTML;
    if (fit >= fullText.length) return;

    // 第一頁保留樣式
    truncateEditableToChars(body, fit);
    const p = book.pages[i];
    p.content_html = sanitizeEditableHTML(body);
    p.content_text = body.textContent || '';

    // 下一可寫文本頁（跳過插圖/封面；不足補頁）
    let j=i+1;
    while(j<book.pages.length && (book.pages[j].type==='illustration' || isCover(book.pages[j]))) j++;
    if (j>=book.pages.length){
      const extra = newPage();
      book.pages.push(extra);
      setChapterTitleMeta(extra, null);
      j=book.pages.length-1;
      renumberPages();
      syncChapterMetadata();
    }
    const remain = fullText.slice(fit).trimStart();
    const before = book.pages[j].content_text || '';
    book.pages[j].content_text = remain + (before?('\n'+before):'');
    book.pages[j].content_html = '';

    const nextPageNo = book.pages[j].page_no;
    persist();
    render();

    if (remain){
      const nextBody = findBodyForPage(nextPageNo);
      const queueNext = () => autoPaginateFrom(nextPageNo, nextBody || undefined);
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(queueNext);
      else setTimeout(queueNext, 16);
    }
  }

  /* ======================
     操作
     ====================== */
function getCurPage(){
    if (activePageId){
      const p = book.pages.find(pp=>pp.id===activePageId);
      if (p) return p;
    }
    const rightNo = document.querySelector('.paper.right .page-no')?.textContent;
    if (rightNo){
      const p = book.pages.find(pp=>String(pp.page_no)===String(rightNo));
      if (p) return p;
    }
    return book.pages[idx];
  }

  function updateDockButtonsState(){
    const cur = getCurPage();
    const disabled = !cur || isCover(cur);
    $all('[data-style]').forEach(btn=>{
      btn.disabled = disabled;
    });
  }

  function setActivePage(page){
    activePageId = page?.id || null;
    updateDockButtonsState();
  }

    function insertChapter(){
    const raw = prompt('章節名稱：', '');
    if (raw===null) return;
    const title = raw.trim();
    if (!title) return;

    const cur = getCurPage();
    if (!cur || isCover(cur)) return;

    applyHeadingToPage(cur, title);
    setChapterTitleMeta(cur, title);

    const body = cur.page_no ? findBodyForPage(cur.page_no) : null;
    if (body){
      body.innerHTML = cur.content_html || '';
    }

    setActivePage(cur);
    persist();
    render();
  }

  function insertAfter(){
    const cur = getCurPage();
    const at  = book.pages.indexOf(cur);
        const page = newPage();
    book.pages.splice(at+1, 0, page);
    setChapterTitleMeta(page, null);
    renumberPages();
    // 讓新頁可見
    if (effectiveSingleAt(at+1)) idx = at+1;
    else idx = Math.max(0, (at+1) - ((at+1)%2));
    setActivePage(book.pages[at+1]);
    render();
  }

  function deleteBlank(){
    const cur = getCurPage();
    const i   = book.pages.indexOf(cur);
    if (i<=0) return; // 不刪封面
    const p = book.pages[i];
    const hasText=(p.content_text||'').trim().length>0;
    const hasImg = !!p.image_url;
    if (hasText||hasImg) return alert('此頁有內容或圖片，無法刪除');
    book.pages.splice(i,1); ensureMinPages(); renumberPages();
    const back = Math.max(0, i-1);
    idx = effectiveSingleAt(back) ? back : Math.max(0, back - (back%2));
    setActivePage(book.pages[idx] || null);
    render();
  }

  function setType(p, type){
    if (!p || isCover(p)) return;
    p.type=type;
    persist();
    render();
  }
  function setFont(nextRem){ const MIN=0.7, MAX=1.8; if(!isFinite(nextRem)||nextRem<=0)nextRem=1.02; book.textStyle.fs=Math.max(MIN,Math.min(MAX,nextRem)); persist(); render(); }

  /* ======================
     編輯輔助
     ====================== */
  function getActiveEditable(){
    const sel = window.getSelection();
    if(!sel || sel.rangeCount===0) return null;
    const range = sel.getRangeAt(0);
    const node = (range.commonAncestorContainer.nodeType===1)
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    return node?.closest?.('.body-text') || null;
  }
  function scaleSelection(mult){
    const sel = window.getSelection();
    if(!sel || sel.rangeCount===0){ setFont(book.textStyle.fs * mult); return; }
    const range = sel.getRangeAt(0);
    const editable = getActiveEditable();
    if (!editable || !editable.contains(range.commonAncestorContainer)) return;

    splitTextBoundaries(range);

    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, {
      acceptNode(n){
        if(!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const r = document.createRange(); r.selectNodeContents(n);
        if (range.compareBoundaryPoints(Range.END_TO_START, r)>=0)  return NodeFilter.FILTER_REJECT;
        if (range.compareBoundaryPoints(Range.START_TO_END, r)<=0)  return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const texts=[]; while(walker.nextNode()) texts.push(walker.currentNode);
    if (!texts.length) return;

    const firstText = texts[0];
    const lastText  = texts[texts.length-1];

    texts.forEach(text=>{
      let span = text.parentElement;
      if(!(span && span.tagName==='SPAN' && span.hasAttribute('data-fs'))){
        span = document.createElement('span');
        text.parentNode.insertBefore(span, text);
        span.appendChild(text);
        span.setAttribute('data-fs','1');
        span.style.fontSize='1em';
      }
      const cur  = parseFloat(span.getAttribute('data-fs')) || 1;
      let next   = cur * mult; next = Math.max(0.6, Math.min(3, next)); // 範圍
      span.setAttribute('data-fs', String(parseFloat(next.toFixed(3))));
      span.style.fontSize = next + 'em';
    });

    // 還原選取
    try{
      const r2 = document.createRange();
      r2.setStart(firstText, 0);
      r2.setEnd(lastText, lastText.nodeValue.length);
      sel.removeAllRanges(); sel.addRange(r2);
    }catch(_){}

    persistEditableNow(editable);
  }
  function splitTextBoundaries(range){
    if(range.startContainer.nodeType===3){
      const t=range.startContainer;
      if(range.startOffset>0 && range.startOffset<t.nodeValue.length){
        const after = t.splitText(range.startOffset);
        range.setStart(after, 0);
      }
    }
    if(range.endContainer.nodeType===3){
      const t=range.endContainer;
      if(range.endOffset>0 && range.endOffset<t.nodeValue.length){
        t.splitText(range.endOffset);
      }
    }
  }
  function indentAtSelection(target){
    insertPlainTextAtCursor('\t');
    persistEditableNow(target);
  }
  function outdentAtSelection(target){
    const sel = window.getSelection();
    if(!sel || sel.rangeCount===0) return;
    const r = sel.getRangeAt(0);
    if (r.collapsed){
      const node = r.startContainer;
      if (node.nodeType===3){
        const txt = node.nodeValue;
        const off = r.startOffset;
        const pre = txt.slice(Math.max(0,off-2), off);
        let remove = 0;
        if (pre.endsWith('\t')) remove = 1;
        else if (/\s{1,2}$/.test(pre)) remove = pre.match(/\s+$/)[0].length;
        if (remove>0){
          node.nodeValue = txt.slice(0, off-remove) + txt.slice(off);
          r.setStart(node, off-remove); r.collapse(true);
          sel.removeAllRanges(); sel.addRange(r);
        }
      }
    }
    persistEditableNow(target);
  }
  function insertPlainTextAtCursor(text){
    const sel = window.getSelection(); if(!sel || sel.rangeCount===0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node); range.setEndAfter(node);
    sel.removeAllRanges(); sel.addRange(range);
  }
  function persistEditableNow(target){
    const pageNo = Number(target.closest('.paper')?.querySelector('.page-no')?.textContent) || null;
    if (!pageNo) return;
    const p = book.pages.find(pp=>pp.page_no===pageNo);
    if(!p) return;
    setActivePage(p);
    p.content_html = sanitizeEditableHTML(target);
    p.content_text = target.textContent || '';
    persist();
  }

  /* ======================
     DOM 截斷（保留樣式）
     ====================== */
  function truncateEditableToChars(root, keep){
    let remain = keep;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const toRemove = [];
    while(walker.nextNode()){
      const t = walker.currentNode;
      const len = t.nodeValue.length;
      if (remain>=len){ remain -= len; continue; }
      t.nodeValue = t.nodeValue.slice(0, remain);
      remain = 0;
      collectSiblingsToRemove(t);
      break;
    }
    function collectSiblingsToRemove(node){
      let n = node;
      while(n){
        if (n.nextSibling){ markAll(n.nextSibling); }
        n = n.parentNode;
        if (n===root) break;
      }
    }
    function markAll(n){
      toRemove.push(n);
      let c = n.firstChild;
      while(c){ markAll(c); c = c.nextSibling; }
    }
    toRemove.forEach(n=> n.parentNode && n.parentNode.removeChild(n));
  }

  /* ======================
     找到畫面上的正文元素
     ====================== */
  function findBodyForPage(pageNo){
    const leftNo  = document.querySelector('.paper.left  .page-no')?.textContent;
    const rightNo = document.querySelector('.paper.right .page-no')?.textContent;
    if (String(pageNo)===leftNo)  return document.querySelector('.paper.left  .body-text:last-of-type');
    if (String(pageNo)===rightNo) return document.querySelector('.paper.right .body-text:last-of-type');
    return null;
  }

  /* ======================
     精簡 HTML 白名單
     ====================== */
  function sanitizeEditableHTML(rootEl){
    const allowed = new Set(['B','I','U','SPAN','BR']);
    const wrap = document.createElement('div');
    wrap.appendChild(rootEl.cloneNode(true));
    wrap.querySelectorAll('[contenteditable]').forEach(n=>n.removeAttribute('contenteditable'));
    wrap.querySelectorAll('[data-ph]').forEach(n=>n.removeAttribute('data-ph'));
    const all = wrap.querySelectorAll('*');
    for (const node of Array.from(all)){
      if (!allowed.has(node.tagName)){
        const parent=node.parentNode;
        while(node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
        continue;
      }
      if (node.tagName==='SPAN'){
        const ds = parseFloat(node.getAttribute('data-fs'));
        const fs = node.style.fontSize || (isFinite(ds)? (ds+'em') : '');
        [...node.attributes].forEach(a=>{
          if(a.name!=='data-fs' && a.name!=='style') node.removeAttribute(a.name);
        });
        if (isFinite(ds)) node.setAttribute('data-fs', String(ds));
        else node.removeAttribute('data-fs');
        node.style.cssText = fs ? ('font-size:'+fs) : '';
        if (!node.getAttribute('data-fs') && !node.getAttribute('style')){
          const p=node.parentNode; while(node.firstChild) p.insertBefore(node.firstChild,node); p.removeChild(node);
        }
      }else{
        [...node.attributes].forEach(a=>node.removeAttribute(a.name));
      }
    }
    // 回傳純內容（只保留允許的標籤）
    return wrap.innerHTML.replace(/\u200B/g,'');
  }

  /* ======================
     其它小工具
     ====================== */
  function fit(){
    const mm   = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mm'));
    const Wmm  = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--paper-w-mm'));
    const Hmm  = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--paper-h-mm'));
    const paperW = (book.binding==='long' ? Hmm*mm : Wmm*mm);
    const stageW = document.querySelector('.stage').clientWidth - 30;
    const needW  = effectiveSingleAt(idx)? paperW : paperW*2;
    const s = Math.min(1, stageW / needW);
    scaler.style.transform = `scale(${s})`;
  }
  function esc(s){return (s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
  function clamp(n,a,b){ return Math.max(a, Math.min(b, n)) }
  function persist(){ Store.save(book) }
  function getPageByIndex(i){ return book.pages[i] }
})();












