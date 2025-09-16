(() => {
  /* ======================
     儲存：LocalStorage 版
     ====================== */
  const Store = {
    KEY: 'ebook_integrated_v1',
    load(){ try{ return JSON.parse(localStorage.getItem(this.KEY)) }catch{ return null } },
    save(data){ localStorage.setItem(this.KEY, JSON.stringify(data)) }
  };

  /* ======================
     Book 初始資料
     ====================== */
  function newPage(no){
    return {
      id: 'local_'+Math.random().toString(36).slice(2,9),
      page_no: no,
      type: 'novel',          // 'novel' | 'illustration' | 'divider-light' | 'divider-dark'
      content_text: '',
      content_html: '',
      image_url: null
    };
  }
  let book = Store.load() || {
    title: '未命名書籍',
    direction: 'ltr',               // 'ltr' 橫排；'rtl' 直排
    binding: 'short',               // 'short' 直放；'long' 橫放（影響紙張旋轉）
    viewMode: 'double',             // 'single' | 'double'
    textStyle: { fs: 1.02, lh: 1.8 },
    pages: [ newPage(1), newPage(2) ]
  };
  function ensureMinPages(){
    while (book.pages.length < 2) {
      const maxNo = Math.max(0, ...book.pages.map(p=>p.page_no||0));
      book.pages.push(newPage(maxNo+1));
    }
  }

  /* ======================
     DOM 參照 & 狀態
     ====================== */
  const $ = (s,r=document)=>r.querySelector(s);
  const scaler      = $('#scaler');
  const papersWrap  = $('#papers');
  const leftPaper   = $('#leftPaper');
  const rightPaper  = $('#rightPaper');
  const flipOverlay = $('#flipOverlay');

  let idx = 0;               // 雙頁：左頁 index；單頁：該頁 index
  let isFlipping = false;    // 翻頁鎖
  let activePageNo = null;   // 你「最近點過 / 正在編輯」的頁碼（插入章節 / 插頁 / 刪頁都依這個）



  /* ======================
     工具列按鈕
     ====================== */
  $('#btnPrev').onclick = ()=> step(-1);
  $('#btnNext').onclick = ()=> step(+1);
  $('#btnInsertPage').onclick = insertAfter;
  $('#btnDeleteBlank').onclick = deleteBlank;
  $('#btnSave').onclick = ()=> alert('示範：目前存 LocalStorage；未連 DB');
  $('#btnBack').onclick = ()=> alert('示範：自行導回書單 URL');

  $('#btnToggleView').onclick = ()=>{ book.viewMode = (book.viewMode==='single'?'double':'single'); render(); };
  $('#btnToggleDir').onclick  = ()=>{ book.direction = (book.direction==='rtl'?'ltr':'rtl'); render(); };
  $('#btnToggleBind').onclick = ()=>{ book.binding   = (book.binding==='long'?'short':'long'); render(); };

  // 書名可編輯
  const titleEl = $('#bookTitle');
  titleEl.textContent = book.title;
  titleEl.addEventListener('input', ()=>{
    book.title = titleEl.textContent.trim() || '未命名書籍';
    persist();
  });

  // 文字樣式（保留選取）
  $('#btnBold').onclick      = ()=> document.execCommand('bold',false,null);
  $('#btnItalic').onclick    = ()=> document.execCommand('italic',false,null);
  $('#btnUnderline').onclick = ()=> document.execCommand('underline',false,null);
  $('#btnFontUp').onclick    = ()=> scaleSelection(1.15);
  $('#btnFontDown').onclick  = ()=> scaleSelection(0.87);
  function keepSelectionOnToolbar(btn){ btn.addEventListener('mousedown', e=> e.preventDefault()); }
  ['#btnFontUp','#btnFontDown','#btnBold','#btnItalic','#btnUnderline']
    .forEach(sel=> keepSelectionOnToolbar($(sel)));

  // Dock：切模板
  document.querySelectorAll('[data-style]').forEach(b=>{
    b.addEventListener('click',()=>{ setType(getCurPage(), b.dataset.style); });
  });

  // 插入章節（修好：針對「目前頁」）
  $('#btnInsertChapter').onclick = insertChapter;

  // 目錄
  $('#btnTOC').onclick = ()=>{ buildTOC(); $('#tocDialog').showModal(); };

  // RWD & 鍵盤翻頁
  window.addEventListener('resize', fit);
  document.addEventListener('keydown',(e)=>{
    if (e.key==='ArrowLeft')  $('#btnPrev').click();
    if (e.key==='ArrowRight') $('#btnNext').click();
  });

  // Tab 縮排 / 反縮排（僅正文/章節）
  document.addEventListener('keydown', (e)=>{
    const target = e.target?.closest?.('.body-text, .chapter-block');
    if(!target) return;
    if(e.key === 'Tab'){
      e.preventDefault();
      if (e.shiftKey) outdentAtSelection(target);
      else indentAtSelection(target);
    }
  });

  // 貼上只留純文字
  document.addEventListener('paste', (e)=>{
    const target = e.target?.closest?.('.body-text, .chapter-block');
    if(!target) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    insertPlainTextAtCursor(text);
    persistEditableNow(target);
  });

  // 初始
  render(); fit();

  /* ======================
     渲染
     ====================== */
  const isSingle = ()=> (book.viewMode === 'single');
  function renumberPages(){ book.pages.forEach((p,i)=> p.page_no = i+1); }

  function render(){
    ensureMinPages();
    renumberPages(); // 每次渲染都重編 1..N

    document.body.classList.toggle('single', isSingle());
    papersWrap.classList.toggle('landscape', book.binding==='long');
    scaler.classList.toggle('vertical', book.direction==='rtl');

    $('#lblCount').textContent = book.pages.length;
    document.documentElement.style.setProperty('--fs', book.textStyle.fs+'rem');
    document.documentElement.style.setProperty('--lh', book.textStyle.lh);

    idx = clamp(idx, 0, Math.max(0, book.pages.length-1));

    if (isSingle()){
      leftPaper.innerHTML = '';
      renderOne(rightPaper, book.pages[idx], 'right');
    } else {
      const pL = book.pages[idx];
      let pR   = book.pages[idx+1] || autoAppendAndGet(idx+1);
      const rtl = (book.direction==='rtl');
      leftPaper.innerHTML=''; rightPaper.innerHTML='';

      if (!rtl){
        renderOne(leftPaper , pL, 'left');
        renderOne(rightPaper, pR, 'right');
      }else{
        renderOne(leftPaper , pR, 'left'); // 直排顯示左右互換
        renderOne(rightPaper, pL, 'right');
      }
    }
    buildTOC();
    fit();
    persist();
  }

  function templateClass(p){
    if(p.type==='divider-light')return 'tpl-divider-light';
    if(p.type==='divider-dark') return 'tpl-divider-dark';
    if(p.type==='illustration') return 'tpl-illustration';
    return '';
  }

  function renderOne(host, page, side){
    host.className = 'paper ' + side + ' ' + templateClass(page);
    host.dataset.pageNo = page.page_no;

    const el = document.createElement('div');
    el.className='page';

    // 角標：最近章節
    const chRun = nearestChapter(page.page_no);
    if (chRun){
      const chip = document.createElement('div');
      chip.className='chapter-chip';
      chip.textContent = chRun;
      el.appendChild(chip);
    }

    // 頁碼
    const no = document.createElement('div');
    no.className='page-no';
    no.textContent = page.page_no || '';
    el.appendChild(no);

    // 互動：點一下就把這頁設成 active
    host.addEventListener('mousedown', ()=>{ activePageNo = page.page_no; }, {passive:true});

    if (page.type==='illustration'){
      el.innerHTML += page.image_url
        ? `<img src="${esc(page.image_url)}" alt="">`
        : `<div class="ph" style="color:#6b7280;display:grid;place-items:center;height:100%">（雙擊貼上圖片網址）</div>`;
      host.ondblclick = ()=>{
        const url = prompt('圖片網址：', page.image_url||'')?.trim()||'';
        page.image_url = url || null; persist(); render();
      };
    }else{
      // 章節（只有設定了才出現）
      if (Object.prototype.hasOwnProperty.call(page,'chapter')){
        const chbox = document.createElement('div');
        chbox.className='chapter-block';
        chbox.contentEditable='true';
        chbox.dataset.ph='章節名稱…';
        chbox.textContent = page.chapter || '';
        chbox.addEventListener('focus', ()=>{ activePageNo = page.page_no; });
        chbox.addEventListener('input', ()=>{
          page.chapter = chbox.textContent.trim();
          persist(); // 章名變更即存
        });
        el.appendChild(chbox);
      }

      // 正文：保留極簡 HTML（B/I/U + span font-size）
      const body = document.createElement('div');
      body.className='body-text';
      body.contentEditable='true';
      body.dataset.ph = (page.type==='novel' ? '正文…' : '置中文字…');
      if (page.content_html){ body.innerHTML = page.content_html; }
      else { body.textContent = page.content_text || ''; }

      let tmr = null;
      body.addEventListener('focus', ()=>{ activePageNo = page.page_no; });
      body.addEventListener('input', ()=>{
        page.content_html = sanitizeEditableHTML(body);
        page.content_text = body.textContent || '';
        persist();
        clearTimeout(tmr);
        tmr = setTimeout(()=>autoPaginateFrom(page.page_no, body), 40);
      });

      el.appendChild(body);
      host.ondblclick = null;
    }

    host.innerHTML=''; host.appendChild(el);
  }

  /* ======================
     翻頁（先渲染 → 再演動畫）
     ====================== */
  function step(sign){
    if (isFlipping) return; // 節流
    const delta    = isSingle()? sign*1 : sign*2;
    const maxIndex = Math.max(0, book.pages.length - (isSingle()?1:2));
    const target   = clamp(idx + delta, 0, maxIndex);
    if (target === idx) return;

    const dir = (sign>0)? 'next' : 'prev';
    if (isSingle()) flipSingle(dir, target);
    else            flipDouble(dir, target);
  }

  // 雙頁高級 page-curl
  function flipDouble(dir, targetIdx){
  if (isFlipping) return;
  const rtl   = (book.direction==='rtl');
  const rectL = leftPaper.getBoundingClientRect();
  const pageW = rectL.width, pageH = rectL.height;

  const L = idx, R = idx+1;
  let frontPage, backPage, placeLeft;
  if (!rtl){
    if (dir==='next'){ frontPage=getPageByIndex(R); backPage=getPageByIndex(R+1)||autoAppendAndGet(R+1); placeLeft=false; }
    else             { frontPage=getPageByIndex(L); backPage=getPageByIndex(L-1); placeLeft=true;  }
  }else{
    if (dir==='next'){ frontPage=getPageByIndex(L); backPage=getPageByIndex(L+1)||autoAppendAndGet(L+1); placeLeft=true;  }
    else             { frontPage=getPageByIndex(R); backPage=getPageByIndex(R-1); placeLeft=false; }
  }
  if (!backPage) return;

  // 覆蓋層：把「翻出去」的面拍成快照
  const turn = document.createElement('div');
  turn.className='turn';
  turn.style.width  = pageW+'px';
  turn.style.height = pageH+'px';
  turn.style.left   = (placeLeft? 0 : pageW) + 'px';
  turn.style.top    = '0px';
  turn.style.transformOrigin = placeLeft? 'right center' : 'left center';

  const f = document.createElement('div'); f.className='face front';
  const b = document.createElement('div'); b.className='face back';
  f.appendChild(snapshot(frontPage, placeLeft? 'left':'right'));
  b.appendChild(snapshot(backPage , placeLeft? 'right':'left'));

  const shade = document.createElement('div'); shade.className='foldShade';
  shade.style.background = placeLeft
    ? 'linear-gradient(270deg, rgba(0,0,0,.22), rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, rgba(0,0,0,.12))'
    : 'linear-gradient(90deg,  rgba(0,0,0,.22), rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, rgba(0,0,0,.12))';
  turn.appendChild(f); turn.appendChild(b); turn.appendChild(shade);

  // 先渲染目標頁在「底下」，動畫只是在上面跑
  isFlipping = true;
  $('#btnPrev').disabled = $('#btnNext').disabled = true;
  idx = targetIdx;
  render();

  flipOverlay.innerHTML='';
  flipOverlay.appendChild(turn);

  void turn.offsetWidth;
  turn.style.animation = placeLeft ? 'flipLeftPrev .42s ease both'
                                   : 'flipRightNext .42s ease both';

  turn.addEventListener('animationend', ()=>{
    flipOverlay.innerHTML='';
    isFlipping = false;
    $('#btnPrev').disabled = $('#btnNext').disabled = false;
  }, {once:true});
}


  // 單頁簡易卷葉
  function flipSingle(dir, targetIdx){
  if (isFlipping) return;

  const rect  = rightPaper.getBoundingClientRect();
  const pageW = rect.width, pageH = rect.height;

  const snap = snapshot(getPageByIndex(idx), 'right'); // 舊頁快照

  isFlipping = true;
  $('#btnPrev').disabled = $('#btnNext').disabled = true;

  // 先把目標頁渲染到底層
  idx = targetIdx;
  render();

  // 疊上捲頁覆蓋層
  const cover = document.createElement('div');
  cover.className='singleTurn';
  cover.style.width  = pageW+'px';
  cover.style.height = pageH+'px';
  cover.style.right  = '0px';
  cover.style.top    = '0px';
  cover.style.transformOrigin = 'left center';
  cover.appendChild(snap);

  flipOverlay.innerHTML='';
  flipOverlay.appendChild(cover);

  void cover.offsetWidth;
  cover.style.animation = 'singleCurl .32s ease both';

  cover.addEventListener('animationend', ()=>{
    flipOverlay.innerHTML='';
    isFlipping = false;
    $('#btnPrev').disabled = $('#btnNext').disabled = false;
  }, {once:true});
}


  // 覆蓋層快照（靜態）
  function snapshot(page, side){
    const host = document.createElement('div');
    host.className = 'paper ' + side + ' ' + templateClass(page);
    const el = document.createElement('div'); el.className='page';
    const ch = nearestChapter(page.page_no);
    if (ch){ const chip=document.createElement('div'); chip.className='chapter-chip'; chip.textContent=ch; el.appendChild(chip); }
    const no = document.createElement('div'); no.className='page-no'; no.textContent = page.page_no||''; el.appendChild(no);
    if (page.type==='illustration'){
      el.innerHTML += page.image_url ? `<img src="${esc(page.image_url)}" alt="">` : '';
    }else{
      if (Object.prototype.hasOwnProperty.call(page,'chapter')){
        const c = document.createElement('div'); c.className='chapter-block'; c.textContent = page.chapter||''; el.appendChild(c);
      }
      const b = document.createElement('div'); b.className='body-text'; b.textContent = page.content_text||''; el.appendChild(b);
    }
    host.appendChild(el);
    return host;
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

    // 量測（純文字 fit）
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

    // 第一頁保留樣式（DOM 截斷）
    truncateEditableToChars(body, fit);
    const p = book.pages[i];
    p.content_html = sanitizeEditableHTML(body);
    p.content_text = body.textContent || '';

    // 下一可寫文本頁（跳過插圖；不足補頁）—回預設樣式
    let j=i+1;
    while(j<book.pages.length && book.pages[j].type==='illustration') j++;
    if (j>=book.pages.length){ const maxNo=Math.max(...book.pages.map(pp=>pp.page_no)); book.pages.push(newPage(maxNo+1)); j=book.pages.length-1; }
    const remain = fullText.slice(fit).trimStart();
    const before = book.pages[j].content_text || '';
    book.pages[j].content_text = remain + (before?('\n'+before):'');
    book.pages[j].content_html = ''; // 清空樣式 → 用預設
    persist(); render();
  }

  /* ======================
     章節 / 目錄
     ====================== */
  function nearestChapter(pageNo){
    let best = '';
    for(let x=book.pages.findIndex(p=>p.page_no===pageNo); x>=0; x--){
      const p = book.pages[x];
      if (Object.prototype.hasOwnProperty.call(p,'chapter') && (p.chapter||'').trim()){
        best = p.chapter.trim(); break;
      }
    }
    return best;
  }

  function buildTOC(){
    const list = book.pages
      .map(p=>({no:p.page_no, ch:(Object.prototype.hasOwnProperty.call(p,'chapter')?(p.chapter||'').trim():'')}))
      .filter(x=>x.ch);

    const box = $('#tocList');
    if(!list.length){ box.innerHTML='<div style="padding:12px;color:#9aa3b2">尚無章節</div>'; return; }

    box.innerHTML = list.map(x=>`
      <div style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px dashed #2a3555;cursor:pointer">
        <div>P${x.no}</div><div>${esc(x.ch)}</div>
      </div>`).join('');

    Array.from(box.children).forEach((row,i)=>{
      row.onclick = ()=>{
        const targetNo = list[i].no;
        const targetIdx= book.pages.findIndex(p=>p.page_no===targetNo);
        idx = isSingle()? targetIdx : Math.max(0, targetIdx - (targetIdx%2));
        activePageNo = targetNo;
        render(); $('#tocDialog').close();
      };
    });
  }

  /* ======================
     操作（修正：針對「目前頁」）
     ====================== */
  function getCurPage(){
    // 1) 有「你最近點過/正在編輯」→ 用它
    if (activePageNo){
      const p = book.pages.find(pp=>pp.page_no===activePageNo);
      if (p) return p;
    }
    // 2) 否則取畫面右側頁（常用的編輯面），沒有才用左側
    const rightNo = document.querySelector('.paper.right .page-no')?.textContent;
    if (rightNo){
      const p = book.pages.find(pp=>String(pp.page_no)===String(rightNo));
      if (p) return p;
    }
    const leftNo = document.querySelector('.paper.left .page-no')?.textContent;
    if (leftNo){
      const p = book.pages.find(pp=>String(pp.page_no)===String(leftNo));
      if (p) return p;
    }
    // 3) 退而求其次
    return book.pages[idx];
  }

  function insertAfter(){
    const cur = getCurPage();
    const at  = book.pages.findIndex(p=>p.page_no===cur.page_no);
    const maxNo = Math.max(0, ...book.pages.map(p=>p.page_no||0));
    book.pages.splice(at+1, 0, newPage(maxNo+1));
    activePageNo = cur.page_no + 1;  // 游標移到新頁
    // 調整 idx 讓新頁可見（雙頁時至少露到右頁）
    if (isSingle()){
      idx = at+1;
    }else{
      const leftIndex = Math.max(0, (at+1) - ((at+1)%2));
      idx = leftIndex;
    }
    render();
  }

  function deleteBlank(){
    const cur = getCurPage();
    const i   = book.pages.findIndex(p=>p.page_no===cur.page_no);
    if (i<0) return;

    const p = book.pages[i];
    const hasText = (p.content_text||'').trim().length>0;
    const hasCh   = Object.prototype.hasOwnProperty.call(p,'chapter') && (p.chapter||'').trim().length>0;
    const hasImg  = !!p.image_url;
    if (hasText||hasCh||hasImg) return alert('此頁有內容或圖片，無法刪除');

    book.pages.splice(i,1);
    ensureMinPages();
    // 調整 idx 與 active
    activePageNo = book.pages[Math.max(0, i-1)].page_no;
    if (isSingle()){
      idx = Math.max(0, i-1);
    }else{
      const leftIndex = Math.max(0, (i-1) - ((i-1)%2));
      idx = leftIndex;
    }
    render();
  }
function insertChapter(){
  // 1) 鎖定目標頁（插圖頁就自動在前面插一張文字頁）
  const cur = getCurPage();
  let i = book.pages.findIndex(p => p.page_no === cur.page_no);
  if (i < 0) return;

  let target = book.pages[i];
  let showIndex = i;

  if (target.type === 'illustration'){
    const maxNo = Math.max(0, ...book.pages.map(p=>p.page_no||0));
    const np = newPage(maxNo + 1);  // 乾淨文字頁
    book.pages.splice(i, 0, np);    // 插在插圖前
    target = np;
    showIndex = i;
  }

  if (!Object.prototype.hasOwnProperty.call(target,'chapter')) target.chapter = '';

  // 2) 讓目標頁出現在畫面上
  if (isSingle()) idx = showIndex;
  else idx = Math.max(0, showIndex - (showIndex % 2));
  activePageNo = target.page_no;
  persist(); render();

  // 3) 打開彈窗 & 同步輸入到角落章節籤 + 正文大字
  const { dlg, input } = ensureChapterDialog();
  input.value = target.chapter || '';

  // 先做一次同步（讓空頁也立刻看得到大字與角落）
  (function prime(){
    const t = input.value.trim();
    target.chapter = t;
    setCornerChip(target.page_no, t);
    setHeadingInBody(target.page_no, t);
    persist();
  })();

  // 輸入即時同步
  const onInput = () => {
    const t = input.value.trim();
    target.chapter = t;
    setCornerChip(target.page_no, t);
    setHeadingInBody(target.page_no, t);
    persist();
  };
  // 避免重複綁定
  input.removeEventListener('input', input._chapterHandler || (()=>{}));
  input._chapterHandler = onInput;
  input.addEventListener('input', onInput);

  // 關閉就收工（Cancel 不回滾，因為我們是「同步輸入」）
  dlg.onclose = null;
  dlg.addEventListener('close', ()=>{}, {once:true});

  // 開窗並聚焦
  dlg.showModal();
  setTimeout(()=>{ input.focus(); input.select(); }, 0);
}


  function setType(p, type){ p.type=type; persist(); render(); }
  function setFont(nextRem){ const MIN=0.7, MAX=1.8; if(!isFinite(nextRem)||nextRem<=0)nextRem=1.02; book.textStyle.fs=Math.max(MIN,Math.min(MAX,nextRem)); persist(); render(); }
  function autoAppendAndGet(i){ const maxNo=Math.max(0,...book.pages.map(p=>p.page_no||0)); const np=newPage(maxNo+1); book.pages[i]=np; return np }

  /* ======================
     文字縮放（保留選取）
     ====================== */
  function getActiveEditable(){
    const sel = window.getSelection();
    if(!sel || sel.rangeCount===0) return null;
    const range = sel.getRangeAt(0);
    const node = (range.commonAncestorContainer.nodeType===1)
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    return node?.closest?.('.body-text, .chapter-block') || null;
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
      let next   = cur * mult; next = Math.max(0.6, Math.min(3, next));
      span.setAttribute('data-fs', String(parseFloat(next.toFixed(3))));
      span.style.fontSize = next + 'em';
    });

    // 還原選取
    try{
      const r2 = document.createRange();
      r2.setStart(firstText, 0);
      r2.setEnd(lastText, lastText.nodeValue.length);
      sel.removeAllRanges();
      sel.addRange(r2);
    }catch(_){}

    // 保存
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

  /* ======================
     Tab 縮排 / 反縮排
     ====================== */
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

  /* ======================
     貼上純文字 & 即時保存
     ====================== */
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
    activePageNo = pageNo;
    if (target.classList.contains('body-text')){
      p.content_html = sanitizeEditableHTML(target);
      p.content_text = target.textContent || '';
    }else if(target.classList.contains('chapter-block')){
      p.chapter = target.textContent.trim();
    }
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
     找畫面上的正文元素
     ====================== */
  function findBodyForPage(pageNo){
    const leftNo  = document.querySelector('.paper.left  .page-no')?.textContent;
    const rightNo = document.querySelector('.paper.right .page-no')?.textContent;
    if (String(pageNo)===leftNo)  return document.querySelector('.paper.left  .body-text:last-of-type');
    if (String(pageNo)===rightNo) return document.querySelector('.paper.right .body-text:last-of-type');
    return null;
  }

  /* ======================
     極簡 HTML 白名單
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
    return wrap.innerHTML.replace(/\u200B/g,'');
  }
// 建立 / 取得章名彈窗
let chapterUI = { dlg:null, input:null, okBtn:null };
function ensureChapterDialog(){
  if (chapterUI.dlg) return chapterUI;
  const dlg = document.createElement('dialog');
  dlg.id = 'chapterDialog';
  dlg.innerHTML = `
    <form method="dialog" style="min-width:340px;padding:16px 18px">
      <div style="font-weight:600;margin-bottom:8px">章節標題</div>
      <input id="chapterTitleInput" type="text" placeholder="輸入章節名稱…"
             style="width:100%;padding:8px 10px;box-sizing:border-box" />
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button value="cancel" type="submit">取消</button>
        <button id="chapterOK" value="ok" type="submit" style="font-weight:600">套用</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const input = dlg.querySelector('#chapterTitleInput');
  const okBtn = dlg.querySelector('#chapterOK');
  chapterUI = { dlg, input, okBtn };
  return chapterUI;
}

// 同步更新某頁角落的章節籤（沒有就幫你生）
function setCornerChip(pageNo, text){
  const pageRoot = document.querySelector(`.paper[data-page-no="${pageNo}"] .page`);
  if (!pageRoot) return;
  let chip = pageRoot.querySelector('.chapter-chip');
  if (!text){
    if (chip) chip.remove();
    return;
  }
  if (!chip){
    chip = document.createElement('div');
    chip.className = 'chapter-chip';
    pageRoot.insertBefore(chip, pageRoot.firstChild);
  }
  chip.textContent = text;
}

// 把章名以「大字 + 換行」放在正文開頭（同步輸入）
function setHeadingInBody(pageNo, title){
  const body = findBodyForPage(pageNo);
  if (!body) return;

  // 去掉開頭多餘空白文字
  while (body.firstChild && body.firstChild.nodeType===3 && /^\s*$/.test(body.firstChild.nodeValue)){
    body.removeChild(body.firstChild);
  }

  const isHeadingSpan = (n)=>
    n && n.nodeType===1 && n.tagName==='SPAN' && n.hasAttribute('data-fs');

  let first = body.firstChild;

  if (!title){ // 清除標題（若存在）
    if (isHeadingSpan(first)){
      first.remove();
      if (body.firstChild && body.firstChild.nodeType===1 && body.firstChild.tagName==='BR'){
        body.removeChild(body.firstChild);
      }
      persistEditableNow(body);
    }
    return;
  }

  if (isHeadingSpan(first)){
    first.textContent = title;            // 更新既有大字
  }else{
    const span = document.createElement('span'); // 新增大字
    span.setAttribute('data-fs','1.6');
    span.style.fontSize = '1.6em';
    span.textContent = title;
    body.insertBefore(span, body.firstChild);
  }

  // 確保後面有一個 <br>
  const heading = body.firstChild; // 一定是 span
  if (!(heading.nextSibling && heading.nextSibling.nodeType===1 && heading.nextSibling.tagName==='BR')){
    const br = document.createElement('br');
    if (heading.nextSibling) body.insertBefore(br, heading.nextSibling);
    else body.appendChild(br);
  }

  // 寫回資料（會跑 sanitize：SPAN+BR 皆白名單、保留 data-fs/字級）
  persistEditableNow(body);
}

  /* ======================
     其他小工具
     ====================== */
  function fit(){
    const mm   = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mm'));
    const Wmm  = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--paper-w-mm'));
    const Hmm  = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--paper-h-mm'));
    const paperW = (book.binding==='long' ? Hmm*mm : Wmm*mm);
    const stageW = document.querySelector('.stage').clientWidth - 30;
    const needW  = isSingle()? paperW : paperW*2;
    const s = Math.min(1, stageW / needW);
    scaler.style.transform = `scale(${s})`;
  }
  function esc(s){return (s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
  function clamp(n,a,b){ return Math.max(a, Math.min(b, n)) }
  function persist(){ Store.save(book) }
  function getPageByIndex(i){ return book.pages[i] }
})();
