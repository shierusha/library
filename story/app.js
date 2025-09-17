(() => {
  /* ======================
     儲存：LocalStorage
     ====================== */
  var Store = {
    KEY: 'ebook_integrated_v1',
    load: function(){ try{ return JSON.parse(localStorage.getItem(this.KEY)); }catch(e){ return null; } },
    save: function(data){ localStorage.setItem(this.KEY, JSON.stringify(data)); }
  };

  /* ======================
     資料模型（含封面）
     ====================== */
  function newPage(){
    return {
      id: 'local_'+Math.random().toString(36).slice(2,9),
      page_no: 0,                 // 內容頁在 render 會重編 1..N；封面固定 0
      type: 'novel',              // 'novel' | 'illustration' | 'divider-light' | 'divider-dark' | 'cover-front'
      content_text: '',
      content_html: '',
      image_url: null
    };
  }
  function newCover(){ // 封面
    return { id:'cover_front', page_no:0, type:'cover-front', content_text:'', content_html:'', image_url:null };
  }

  var book = Store.load() || {
    title: '未命名書籍',
    direction: 'ltr',       // 'ltr' 橫排；'rtl' 直排
    binding: 'short',       // 'short' 直放；'long' 橫放
    viewMode: 'double',     // 'single' | 'double'
    textStyle: { fs: 1.02, lh: 1.8 },
    pages: [ newCover(), newPage(), newPage() ]
  };

  function ensureCover(){
    if (!book.pages.length || book.pages[0].type!=='cover-front'){
      book.pages.unshift(newCover());
    }
  }
  function ensureMinPages(){
    // 至少兩張內容頁（不含封面）
    var contents = book.pages.filter(function(p){ return p.type!=='cover-front'; });
    while (contents.length < 2){
      book.pages.push(newPage());
      contents.push(1);
    }
  }

  /* ======================
     DOM & 小工具
     ====================== */
  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
  function closest(el, sel){
    while(el && el.nodeType===1){ if (el.matches(sel)) return el; el = el.parentElement; }
    return null;
  }
  function esc(s){ return String(s||'').replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
  function persist(){ Store.save(book); }
  function getPageByIndex(i){ return book.pages[i]; }
  function isCover(p){ return p && p.type==='cover-front'; }

  var scaler      = $('#scaler');
  var papersWrap  = $('#papers');
  var leftPaper   = $('#leftPaper');
  var rightPaper  = $('#rightPaper');
  var flipOverlay = $('#flipOverlay');

  var idx = 0;                 // 左頁索引（單頁=當前索引）
  var isFlipping = false;
  var activePageId = null;     // ★ 用 id 追蹤目前頁（不再用 page_no）

  /* ======================
     導覽列 & 按鈕
     ====================== */
  var titleEl = $('#bookTitle');
  if (titleEl){
    titleEl.textContent = book.title;
    titleEl.addEventListener('input', function(){
      book.title = (titleEl.textContent||'').trim() || '未命名書籍';
      persist(); render();
    });
    // 雙擊書名 → 跳封面
    titleEl.addEventListener('dblclick', function(){ idx = 0; render(); });
  }

  var btnPrev = $('#btnPrev'), btnNext = $('#btnNext');
  if (btnPrev) btnPrev.onclick = function(){ step(-1); };
  if (btnNext) btnNext.onclick = function(){ step( 1); };

  var btnInsertPage = $('#btnInsertPage');
  if (btnInsertPage) btnInsertPage.onclick = insertAfter;

  var btnDeleteBlank = $('#btnDeleteBlank');
  if (btnDeleteBlank) btnDeleteBlank.onclick = deleteBlank;

  var btnSave = $('#btnSave');
  if (btnSave) btnSave.onclick = function(){ alert('示範：已存到 LocalStorage（尚未連 DB）'); };

  var btnBack = $('#btnBack');
  if (btnBack) btnBack.onclick = function(){ alert('示範：自行導回書單 URL'); };

  var btnToggleView = $('#btnToggleView');
  if (btnToggleView) btnToggleView.onclick = function(){ book.viewMode = (book.viewMode==='single'?'double':'single'); render(); };

  var btnToggleDir = $('#btnToggleDir');
  if (btnToggleDir) btnToggleDir.onclick  = function(){ book.direction = (book.direction==='rtl'?'ltr':'rtl'); render(); };

  var btnToggleBind = $('#btnToggleBind');
  if (btnToggleBind) btnToggleBind.onclick = function(){ book.binding   = (book.binding==='long'?'short':'long'); render(); };

  function keepSel(btn){ if(!btn) return; btn.addEventListener('mousedown', function(e){ e.preventDefault(); }); }
  var btnBold=$('#btnBold'), btnItalic=$('#btnItalic'), btnUnderline=$('#btnUnderline'), btnFontUp=$('#btnFontUp'), btnFontDown=$('#btnFontDown');
  [btnBold,btnItalic,btnUnderline,btnFontUp,btnFontDown].forEach(keepSel);
  if (btnBold)      btnBold.onclick      = function(){ document.execCommand('bold',false,null); };
  if (btnItalic)    btnItalic.onclick    = function(){ document.execCommand('italic',false,null); };
  if (btnUnderline) btnUnderline.onclick = function(){ document.execCommand('underline',false,null); };
  if (btnFontUp)    btnFontUp.onclick    = function(){ scaleSelection(1.15); };
  if (btnFontDown)  btnFontDown.onclick  = function(){ scaleSelection(0.87); };

  // Dock 切模板
  $all('[data-style]').forEach(function(b){
    b.addEventListener('click', function(){ setType(getCurPage(), b.getAttribute('data-style')); });
  });

  // 插入章節（沿用前版，這裡主題是頁碼）
  var btnInsertChapter = $('#btnInsertChapter');
  if (btnInsertChapter) btnInsertChapter.onclick = insertChapter;

  // 目錄
  var btnTOC = $('#btnTOC');
  if (btnTOC) btnTOC.onclick = openTOC;

  // 鍵盤翻頁
  window.addEventListener('resize', fit);
  document.addEventListener('keydown', function(e){
    if (e.key==='ArrowLeft')  { if(btnPrev) btnPrev.click(); }
    if (e.key==='ArrowRight') { if(btnNext) btnNext.click(); }
  });

  // Tab 縮排 / 反縮排（僅正文/章節）
  document.addEventListener('keydown', function(e){
    var target = closest(e.target, '.body-text, .chapter-block');
    if(!target) return;
    if(e.key === 'Tab'){
      e.preventDefault();
      if (e.shiftKey) outdentAtSelection(target);
      else indentAtSelection(target);
    }
  });

  // 貼上 → 純文字
  document.addEventListener('paste', function(e){
    var target = closest(e.target, '.body-text, .chapter-block');
    if(!target) return;
    e.preventDefault();
    var text = (e.clipboardData && e.clipboardData.getData('text/plain')) || (window.clipboardData && window.clipboardData.getData('Text')) || '';
    insertPlainTextAtCursor(text);
    persistEditableNow(target);
  });

  /* ======================
     章節 / TOC
     ====================== */
  function nearestChapter(pageNo){
    var start = -1;
    for (var i=0;i<book.pages.length;i++){ if (book.pages[i].page_no===pageNo){ start=i; break; } }
    var best = '';
    for (var x=start; x>=0; x--){
      var p = book.pages[x];
      if (Object.prototype.hasOwnProperty.call(p,'chapter') && (p.chapter||'').trim()){
        best = (p.chapter||'').trim(); break;
      }
    }
    return best;
  }
  function buildTOC(){
    var box = $('#tocList'); if(!box) return;
    var rows = [];
    rows.push('<div class="toc-row toc-cover" style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px dashed #2a3555;cursor:pointer"><div>封面</div><div>'+esc(book.title||'未命名書籍')+'</div></div>');
    for (var i=0;i<book.pages.length;i++){
      var p = book.pages[i];
      if (p.page_no>0 && Object.prototype.hasOwnProperty.call(p,'chapter')){
        var ch = (p.chapter||'').trim();
        if (ch){
          rows.push('<div class="toc-row" data-no="'+p.page_no+'" style="display:flex;justify-content:space-between;padding:10px 12px;border-bottom:1px dashed #2a3555;cursor:pointer"><div>P'+p.page_no+'</div><div>'+esc(ch)+'</div></div>');
        }
      }
    }
    if (!rows.length){
      box.innerHTML='<div style="padding:12px;color:#9aa3b2">尚無章節</div>';
      return;
    }
    box.innerHTML = rows.join('');

    var coverRow = $('.toc-cover', box);
    if (coverRow) coverRow.onclick = function(){ idx = 0; render(); closeTOC(); };

    $all('.toc-row[data-no]', box).forEach(function(row){
      row.onclick = function(){
        var targetNo = parseInt(row.getAttribute('data-no'),10);
        var targetIdx=-1;
        for (var i=0;i<book.pages.length;i++){ if (book.pages[i].page_no===targetNo){ targetIdx=i; break; } }
        if (targetIdx<0) return;
        var effSingle = effectiveSingleAt(targetIdx);
        idx = effSingle ? targetIdx : Math.max(0, targetIdx - (targetIdx%2));
        activePageId = book.pages[targetIdx].id;
        render(); closeTOC();
      };
    });
  }
  function openTOC(){ buildTOC(); var dlg=$('#tocDialog'); if(!dlg) return; try{ dlg.showModal(); }catch(_){ dlg.setAttribute('open',''); } }
  function closeTOC(){ var dlg=$('#tocDialog'); if(!dlg) return; try{ dlg.close(); }catch(_){ dlg.removeAttribute('open'); } }

  /* ======================
     渲染（★重編頁碼）
     ====================== */
  function userWantsSingle(){ return book.viewMode==='single'; }
  function effectiveSingleAt(i){
    var L = book.pages[i], R = book.pages[i+1];
    return isCover(L) || isCover(R) ? true : userWantsSingle();
  }
  function renumberPages(){
    // 封面固定 0；其餘依目前順序 1..N
    var n=1;
    for (var i=0;i<book.pages.length;i++){
      if (isCover(book.pages[i])) { book.pages[i].page_no = 0; }
      else { book.pages[i].page_no = n++; }
    }
  }
  function templateClass(p){
    if(!p) return '';
    if(p.type==='divider-light')return 'tpl-divider-light';
    if(p.type==='divider-dark') return 'tpl-divider-dark';
    if(p.type==='illustration') return 'tpl-illustration';
    if(p.type==='cover-front')  return 'tpl-cover-front';
    return '';
  }

  function render(){
    ensureCover(); ensureMinPages();
    renumberPages(); // ★ 每次渲染都重編 1..N

    var effSingle = effectiveSingleAt(idx);
    document.body.classList.toggle('single', effSingle);
    if (papersWrap) papersWrap.classList.toggle('landscape', book.binding==='long');
    if (scaler) scaler.classList.toggle('vertical', book.direction==='rtl');

    // 只算內容頁數
    var count=0; for (var i=0;i<book.pages.length;i++){ if (!isCover(book.pages[i])) count++; }
    var lblCount = $('#lblCount'); if (lblCount) lblCount.textContent = String(count);

    document.documentElement.style.setProperty('--fs', book.textStyle.fs+'rem');
    document.documentElement.style.setProperty('--lh', book.textStyle.lh);

    var maxIndex = Math.max(0, book.pages.length - (effSingle?1:2));
    idx = clamp(idx, 0, maxIndex);

    if (!leftPaper || !rightPaper) return;
    leftPaper.innerHTML=''; rightPaper.innerHTML='';

    if (effSingle){
      renderOne(rightPaper, book.pages[idx], 'right');
    }else{
      var rtl = (book.direction==='rtl');
      var pL = book.pages[idx];
      var pR = book.pages[idx+1] || autoAppendAndGet(idx+1);
      if (!rtl){ renderOne(leftPaper , pL,'left'); renderOne(rightPaper,pR,'right'); }
      else     { renderOne(leftPaper , pR,'left'); renderOne(rightPaper,pL,'right'); }
    }
    buildTOC();
    fit();
    persist();
  }

  function renderOne(host, page, side){
    if(!host || !page) return;
    host.className = 'paper ' + side + ' ' + templateClass(page);
    host.setAttribute('data-page-no', String(page.page_no||0));

    var el = document.createElement('div'); el.className='page';

    if (isCover(page)){
      el.innerHTML = '<div style="display:grid;place-items:center;height:100%;text-align:center;padding:24px">'+
                     '<div style="font-size:1.6em;font-weight:700;line-height:1.2">'+esc(book.title||'未命名書籍')+'</div>'+
                     '<div style="margin-top:10px;opacity:.65">～ 封面 ～</div></div>';
      host.innerHTML=''; host.appendChild(el);
      host.addEventListener('mousedown', function(){ activePageId = page.id; });
      return;
    }

    // 角標：最近章名
    var chRun = nearestChapter(page.page_no);
    if (chRun){
      var chip = document.createElement('div');
      chip.className='chapter-chip'; chip.textContent=chRun;
      el.appendChild(chip);
    }

    // 頁碼
    var no = document.createElement('div');
    no.className='page-no'; no.textContent = page.page_no || '';
    el.appendChild(no);

    host.addEventListener('mousedown', function(){ activePageId = page.id; });

    if (page.type==='illustration'){
      el.innerHTML += page.image_url
        ? '<img src="'+esc(page.image_url)+'" alt="">'
        : '<div class="ph" style="color:#6b7280;display:grid;place-items:center;height:100%">（雙擊貼上圖片網址）</div>';
      host.ondblclick = function(){
        var url = prompt('圖片網址：', page.image_url||'') || '';
        url = url.trim();
        page.image_url = url || null; persist(); render();
      };
    }else{
      // 章節標題（只有插過才有）
      if (Object.prototype.hasOwnProperty.call(page,'chapter')){
        var chbox = document.createElement('div');
        chbox.className='chapter-block';
        chbox.setAttribute('contenteditable','true');
        chbox.setAttribute('data-ph','章節名稱…');
        chbox.textContent = page.chapter || '';
        chbox.addEventListener('focus', function(){ activePageId = page.id; });
        chbox.addEventListener('input', function(){ page.chapter = (chbox.textContent||'').trim(); persist(); });
        el.appendChild(chbox);
      }

      // 正文
      var body = document.createElement('div');
      body.className='body-text'; body.setAttribute('contenteditable','true');
      body.setAttribute('data-ph', (page.type==='novel' ? '正文…' : '置中文字…'));
      if (page.content_html){ body.innerHTML = page.content_html; }
      else { body.textContent = page.content_text || ''; }

      var tmr=null;
      body.addEventListener('focus', function(){ activePageId = page.id; });
      body.addEventListener('input', function(){
        page.content_html = sanitizeEditableHTML(body);
        page.content_text = body.textContent || '';
        persist();
        if (tmr) clearTimeout(tmr);
        tmr = setTimeout(function(){ autoPaginateFrom(page.page_no, body); }, 40);
      });

      el.appendChild(body);
      host.ondblclick = null;
    }

    host.innerHTML=''; host.appendChild(el);
  }

  /* ======================
     翻頁（可翻到封面）
     ====================== */
  function userSingleNow(){ return effectiveSingleAt(idx); }
  function step(sign){
    if (isFlipping) return;
    var effSingle = userSingleNow();
    var delta    = effSingle ? sign*1 : sign*2;
    var maxIndex = Math.max(0, book.pages.length - (effSingle?1:2));
    var target   = clamp(idx + delta, 0, maxIndex);
    if (target === idx) return;
    var dir = (sign>0)? 'next' : 'prev';
    if (effSingle) flipSingle(dir, target);
    else           flipDouble(dir, target);
  }
  function getOffsetInOverlay(hostPaper){
    var pr = hostPaper.getBoundingClientRect();
    var or = flipOverlay.getBoundingClientRect();
    return { left: pr.left - or.left, top: pr.top - or.top, width: pr.width, height: pr.height };
  }
  function flipDouble(dir, targetIdx){
    if (isFlipping) return;
    var rtl = (book.direction==='rtl');
    var L = idx, R = idx+1;
    var frontPage, backPage, placeLeft, hostPaper;
    if (!rtl){
      if (dir==='next'){ frontPage=getPageByIndex(R); backPage=getPageByIndex(R+1)||autoAppendAndGet(R+1); placeLeft=false; hostPaper=rightPaper; }
      else             { frontPage=getPageByIndex(L); backPage=getPageByIndex(L-1);                         placeLeft=true;  hostPaper=leftPaper;  }
    }else{
      if (dir==='next'){ frontPage=getPageByIndex(L); backPage=getPageByIndex(L+1)||autoAppendAndGet(L+1); placeLeft=true;  hostPaper=leftPaper;  }
      else             { frontPage=getPageByIndex(R); backPage=getPageByIndex(R-1);                         placeLeft=false; hostPaper=rightPaper; }
    }
    if (!backPage || !hostPaper) return;

    var pos = getOffsetInOverlay(hostPaper);
    var turn = document.createElement('div');
    turn.className='turn';
    turn.style.width  = pos.width+'px';
    turn.style.height = pos.height+'px';
    turn.style.left   = pos.left+'px';
    turn.style.top    = pos.top+'px';
    turn.style.transformOrigin = placeLeft? 'right center' : 'left center';

    var f = document.createElement('div'); f.className='face front';
    var b = document.createElement('div'); b.className='face back';
    f.appendChild(snapshot(frontPage, placeLeft? 'left':'right'));
    b.appendChild(snapshot(backPage , placeLeft? 'right':'left'));

    var shade = document.createElement('div'); shade.className='foldShade';
    shade.style.background = placeLeft
      ? 'linear-gradient(270deg, rgba(0,0,0,.22), rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, rgba(0,0,0,.12))'
      : 'linear-gradient(90deg,  rgba(0,0,0,.22), rgba(0,0,0,0) 40%, rgba(0,0,0,0) 60%, rgba(0,0,0,.12))';
    turn.appendChild(f); turn.appendChild(b); turn.appendChild(shade);

    isFlipping = true; if (btnPrev) btnPrev.disabled = true; if (btnNext) btnNext.disabled = true;
    idx = targetIdx; render();
    flipOverlay.innerHTML=''; flipOverlay.appendChild(turn);
    void turn.offsetWidth;
    turn.style.animation = placeLeft ? 'flipLeftPrev .42s ease both' : 'flipRightNext .42s ease both';
    turn.addEventListener('animationend', function(){
      flipOverlay.innerHTML=''; isFlipping = false;
      if (btnPrev) btnPrev.disabled = false; if (btnNext) btnNext.disabled = false;
    }, {once:true});
  }
  function flipSingle(dir, targetIdx){
    if (isFlipping) return;
    var pos = getOffsetInOverlay(rightPaper);
    var snap = snapshot(getPageByIndex(idx), 'right');
    isFlipping = true; if (btnPrev) btnPrev.disabled = true; if (btnNext) btnNext.disabled = true;
    idx = targetIdx; render();
    var cover = document.createElement('div');
    cover.className='singleTurn';
    cover.style.width  = pos.width+'px';
    cover.style.height = pos.height+'px';
    cover.style.left   = pos.left+'px';
    cover.style.top    = pos.top+'px';
    cover.style.transformOrigin = 'left center';
    cover.appendChild(snap);
    flipOverlay.innerHTML=''; flipOverlay.appendChild(cover);
    void cover.offsetWidth;
    cover.style.animation = 'singleCurl .32s ease both';
    cover.addEventListener('animationend', function(){
      flipOverlay.innerHTML=''; isFlipping = false;
      if (btnPrev) btnPrev.disabled = false; if (btnNext) btnNext.disabled = false;
    }, {once:true});
  }
  function snapshot(page, side){
    var host = document.createElement('div');
    host.className = 'paper ' + side + ' ' + templateClass(page);
    var el = document.createElement('div'); el.className='page';
    if (isCover(page)){
      el.innerHTML = '<div style="display:grid;place-items:center;height:100%;text-align:center;padding:24px">'+
                     '<div style="font-size:1.6em;font-weight:700;line-height:1.2">'+esc(book.title||'未命名書籍')+'</div>'+
                     '<div style="margin-top:10px;opacity:.65">～ 封面 ～</div></div>';
      host.appendChild(el); return host;
    }
    var ch = nearestChapter(page.page_no);
    if (ch){ var chip=document.createElement('div'); chip.className='chapter-chip'; chip.textContent=ch; el.appendChild(chip); }
    var no = document.createElement('div'); no.className='page-no'; no.textContent = page.page_no||''; el.appendChild(no);
    if (page.type==='illustration'){
      el.innerHTML += page.image_url ? '<img src="'+esc(page.image_url)+'" alt="">' : '';
    }else{
      if (Object.prototype.hasOwnProperty.call(page,'chapter')){
        var c = document.createElement('div'); c.className='chapter-block'; c.textContent = page.chapter||''; el.appendChild(c);
      }
      var b = document.createElement('div'); b.className='body-text'; b.textContent = page.content_text||''; el.appendChild(b);
    }
    host.appendChild(el);
    return host;
  }

  /* ======================
     自動換頁 / 插入 / 刪除
     ====================== */
  function autoPaginateFrom(pageNo, bodyEl){
    var i=-1; for (var k=0;k<book.pages.length;k++){ if (book.pages[k].page_no===pageNo){ i=k; break; } }
    if (i<0) return;
    var body = bodyEl || findBodyForPage(pageNo);
    if (!body) return;
    if (body.scrollHeight <= body.clientHeight) return;

    var originalHTML = body.innerHTML;
    var fullText = body.textContent || '';
    var lo=0, hi=fullText.length, fit=fullText.length;
    while(lo<=hi){
      var mid=(lo+hi>>1);
      body.textContent = fullText.slice(0,mid);
      if (body.scrollHeight <= body.clientHeight){ fit=mid; lo=mid+1; } else hi=mid-1;
    }
    body.innerHTML = originalHTML;
    if (fit >= fullText.length) return;

    truncateEditableToChars(body, fit);
    var p = book.pages[i];
    p.content_html = sanitizeEditableHTML(body);
    p.content_text = body.textContent || '';

    var j=i+1;
    while(j<book.pages.length && (book.pages[j].type==='illustration' || isCover(book.pages[j]))) j++;
    if (j>=book.pages.length){ book.pages.push(newPage()); j=book.pages.length-1; }
    var remain = fullText.slice(fit).replace(/^\s+/,'');
    var before = book.pages[j].content_text || '';
    book.pages[j].content_text = remain + (before?('\n'+before):'');
    book.pages[j].content_html = '';
    persist(); render();
  }

  function getCurPage(){
    // 1) 以 id 追蹤（不受重編號影響）
    if (activePageId){
      for (var i=0;i<book.pages.length;i++){ if (book.pages[i].id===activePageId) return book.pages[i]; }
    }
    // 2) 讀畫面右/左頁的頁碼以回推
    var rightNoEl = $('.paper.right .page-no');
    if (rightNoEl){
      var n = parseInt(rightNoEl.textContent||'0',10);
      for (var j=0;j<book.pages.length;j++){ if (book.pages[j].page_no===n) return book.pages[j]; }
    }
    var leftNoEl = $('.paper.left .page-no');
    if (leftNoEl){
      var n2 = parseInt(leftNoEl.textContent||'0',10);
      for (var k=0;k<book.pages.length;k++){ if (book.pages[k].page_no===n2) return book.pages[k]; }
    }
    return book.pages[idx];
  }

  function insertAfter(){
    var cur = getCurPage();
    var atIdx = -1;
    for (var i=0;i<book.pages.length;i++){ if (book.pages[i]===cur){ atIdx=i; break; } }
    if (atIdx<0) atIdx=0;

    var np = newPage();
    if (cur.type==='cover-front'){
      book.pages.splice(1, 0, np);
      activePageId = np.id;
      idx = 0;
    }else{
      book.pages.splice(atIdx+1, 0, np);
      activePageId = np.id;
      var effSingle = effectiveSingleAt(atIdx+1);
      idx = effSingle ? (atIdx+1) : Math.max(0, (atIdx+1) - ((atIdx+1)%2));
    }
    render(); // 這裡會重編 1..N，所以頁碼不會亂跳
  }

  function deleteBlank(){
    var cur = getCurPage();
    if (cur.type==='cover-front'){ alert('封面不可刪除'); return; }
    var i=-1; for (var k=0;k<book.pages.length;k++){ if (book.pages[k]===cur){ i=k; break; } }
    if (i<0) return;

    var p = book.pages[i];
    var hasText = ((p.content_text||'').trim().length>0);
    var hasCh   = (Object.prototype.hasOwnProperty.call(p,'chapter') && (p.chapter||'').trim().length>0);
    var hasImg  = !!p.image_url;
    if (hasText||hasCh||hasImg){ alert('此頁有內容或圖片，無法刪除'); return; }

    // 設定刪除後的焦點 id
    var nextFocus = book.pages[Math.max(0, i-1)];
    activePageId = nextFocus ? nextFocus.id : null;

    book.pages.splice(i,1);
    ensureMinPages();

    var prevIdx = Math.max(0, i-1);
    var effSingle = effectiveSingleAt(prevIdx);
    idx = effSingle ? prevIdx : Math.max(0, prevIdx - (prevIdx%2));
    render(); // 重編 1..N
  }

  function insertChapter(){
    var p = getCurPage();
    if (p.type==='cover-front'){
      if (book.pages[1] && book.pages[1].type!=='illustration'){ p = book.pages[1]; }
      else { var np=newPage(); book.pages.splice(1,0,np); p=np; }
      idx = 0; render();
    }
    if (!Object.prototype.hasOwnProperty.call(p,'chapter')) p.chapter = '';
    var title = prompt('章節名稱：', p.chapter||'') || '';
    title = title.trim();
    p.chapter = title;

    var body = findBodyForPage(p.page_no);
    if (body){
      while (body.firstChild && body.firstChild.nodeType===3 && /^\s*$/.test(body.firstChild.nodeValue)){ body.removeChild(body.firstChild); }
      var first = body.firstChild;
      var isHead = first && first.nodeType===1 && first.tagName==='SPAN' && first.getAttribute('data-fs');
      if (title){
        if (!isHead){
          var span = document.createElement('span'); span.setAttribute('data-fs','1.6'); span.style.fontSize='1.6em'; span.textContent=title;
          body.insertBefore(span, body.firstChild);
          var br = document.createElement('br'); if (span.nextSibling) body.insertBefore(br, span.nextSibling); else body.appendChild(br);
        }else{
          first.textContent = title;
          if (!(first.nextSibling && first.nextSibling.nodeType===1 && first.nextSibling.tagName==='BR')){
            var br2 = document.createElement('br'); if (first.nextSibling) body.insertBefore(br2, first.nextSibling); else body.appendChild(br2);
          }
        }
      }else if (isHead){
        first.parentNode.removeChild(first);
        if (body.firstChild && body.firstChild.nodeType===1 && body.firstChild.tagName==='BR'){ body.removeChild(body.firstChild); }
      }
      persistEditableNow(body);
    }
    activePageId = p.id;
    render();
  }

  function setType(p, type){ if(!p) return; p.type=type; persist(); render(); }
  function setFont(nextRem){
    var MIN=0.7, MAX=1.8;
    if(!isFinite(nextRem)||nextRem<=0)nextRem=1.02;
    book.textStyle.fs=Math.max(MIN,Math.min(MAX,nextRem));
    persist(); render();
  }
  function autoAppendAndGet(i){
    var np = newPage();
    book.pages[i]=np; return np;
  }

  /* ======================
     文字縮放 / 貼上 / 保存
     ====================== */
  function getActiveEditable(){
    var sel = window.getSelection();
    if(!sel || sel.rangeCount===0) return null;
    var range = sel.getRangeAt(0);
    var node = (range.commonAncestorContainer.nodeType===1)
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    return closest(node, '.body-text, .chapter-block');
  }
  function scaleSelection(mult){
    var sel = window.getSelection();
    if(!sel || sel.rangeCount===0){ setFont(book.textStyle.fs * mult); return; }
    var range = sel.getRangeAt(0);
    var editable = getActiveEditable();
    if (!editable || !editable.contains(range.commonAncestorContainer)) return;

    splitTextBoundaries(range);

    var walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, null, false);
    var texts=[];
    while(walker.nextNode()){
      var n = walker.currentNode;
      if(!n.nodeValue || !n.nodeValue.trim()) continue;
      var r = document.createRange(); r.selectNodeContents(n);
      if (range.compareBoundaryPoints(Range.END_TO_START, r)>=0)  continue;
      if (range.compareBoundaryPoints(Range.START_TO_END, r)<=0)  continue;
      texts.push(n);
    }
    if (!texts.length) return;

    var firstText = texts[0];
    var lastText  = texts[texts.length-1];

    for (var i=0;i<texts.length;i++){
      var text = texts[i];
      var span = text.parentElement;
      if(!(span && span.tagName==='SPAN' && span.getAttribute('data-fs')!=null)){
        span = document.createElement('span');
        text.parentNode.insertBefore(span, text);
        span.appendChild(text);
        span.setAttribute('data-fs','1');
        span.style.fontSize='1em';
      }
      var cur  = parseFloat(span.getAttribute('data-fs')) || 1;
      var next = cur * mult; next = Math.max(0.6, Math.min(3, next));
      span.setAttribute('data-fs', String(parseFloat(next.toFixed(3))));
      span.style.fontSize = next + 'em';
    }

    try{
      var r2 = document.createRange();
      r2.setStart(firstText, 0);
      r2.setEnd(lastText, lastText.nodeValue.length);
      sel.removeAllRanges();
      sel.addRange(r2);
    }catch(_){}
    persistEditableNow(editable);
  }
  function splitTextBoundaries(range){
    if(range.startContainer && range.startContainer.nodeType===3){
      var t=range.startContainer;
      if(range.startOffset>0 && range.startOffset<t.nodeValue.length){
        var after = t.splitText(range.startOffset);
        range.setStart(after, 0);
      }
    }
    if(range.endContainer && range.endContainer.nodeType===3){
      var t2=range.endContainer;
      if(range.endOffset>0 && range.endOffset<t2.nodeValue.length){
        t2.splitText(range.endOffset);
      }
    }
  }
  function insertPlainTextAtCursor(text){
    var sel = window.getSelection(); if(!sel || sel.rangeCount===0) return;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node); range.setEndAfter(node);
    sel.removeAllRanges(); sel.addRange(range);
  }
  function persistEditableNow(target){
    var paper = closest(target, '.paper');
    var noEl  = paper ? $('.page-no', paper) : null;
    var pageNo = noEl ? Number(noEl.textContent||'0') : 0;
    var p=null;
    for (var i=0;i<book.pages.length;i++){ if (book.pages[i].page_no===pageNo){ p=book.pages[i]; break; } }
    if(!p) return;
    activePageId = p.id;
    if (target.classList.contains('body-text')){
      p.content_html = sanitizeEditableHTML(target);
      p.content_text = target.textContent || '';
    }else if(target.classList.contains('chapter-block')){
      p.chapter = (target.textContent||'').trim();
    }
    persist();
  }

  /* ======================
     DOM 截斷 / 查找 / 白名單
     ====================== */
  function truncateEditableToChars(root, keep){
    var remain = keep;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var nodes=[]; while(walker.nextNode()) nodes.push(walker.currentNode);
    var toRemove = [];
    for (var k=0;k<nodes.length;k++){
      var t = nodes[k];
      var len = t.nodeValue.length;
      if (remain>=len){ remain -= len; continue; }
      t.nodeValue = t.nodeValue.slice(0, remain);
      remain = 0; collectSiblingsToRemove(t); break;
    }
    function collectSiblingsToRemove(node){
      var n = node;
      while(n){ if (n.nextSibling){ markAll(n.nextSibling); } n = n.parentNode; if (n===root) break; }
    }
    function markAll(n){ toRemove.push(n); var c=n.firstChild; while(c){ markAll(c); c=c.nextSibling; } }
    toRemove.forEach(function(n){ if (n.parentNode) n.parentNode.removeChild(n); });
  }
  function findBodyForPage(pageNo){
    var leftNoEl  = $('.paper.left  .page-no');
    var rightNoEl = $('.paper.right .page-no');
    if (leftNoEl  && String(pageNo)===String(leftNoEl.textContent||''))  return $('.paper.left  .body-text:last-of-type');
    if (rightNoEl && String(pageNo)===String(rightNoEl.textContent||'')) return $('.paper.right .body-text:last-of-type');
    return null;
  }
  function sanitizeEditableHTML(rootEl){
    var allowed = {B:1,I:1,U:1,SPAN:1,BR:1};
    var wrap = document.createElement('div');
    wrap.appendChild(rootEl.cloneNode(true));
    $all('[contenteditable]', wrap).forEach(function(n){ n.removeAttribute('contenteditable'); });
    $all('[data-ph]', wrap).forEach(function(n){ n.removeAttribute('data-ph'); });
    $all('*', wrap).forEach(function(node){
      if (!allowed[node.tagName]){
        var parent=node.parentNode;
        while(node.firstChild) parent.insertBefore(node.firstChild, node);
        if (parent && node.parentNode===parent) parent.removeChild(node);
        return;
      }
      if (node.tagName==='SPAN'){
        var ds = parseFloat(node.getAttribute('data-fs'));
        var fs = node.style.fontSize || (isFinite(ds)? (ds+'em') : '');
        Array.prototype.slice.call(node.attributes).forEach(function(a){
          if(a.name!=='data-fs' && a.name!=='style') node.removeAttribute(a.name);
        });
        if (isFinite(ds)) node.setAttribute('data-fs', String(ds));
        else node.removeAttribute('data-fs');
        node.style.cssText = fs ? ('font-size:'+fs) : '';
        if (!node.getAttribute('data-fs') && !node.getAttribute('style')){
          var p=node.parentNode; if (p){ while(node.firstChild) p.insertBefore(node.firstChild,node); p.removeChild(node); }
        }
      }else{
        Array.prototype.slice.call(node.attributes).forEach(function(a){ node.removeAttribute(a.name); });
      }
    });
    return wrap.innerHTML.replace(/\u200B/g,'');
  }

  /* ======================
     RWD 縮放
     ====================== */
  function fit(){
    var root = getComputedStyle(document.documentElement);
    var mm  = parseFloat(root.getPropertyValue('--mm')) || 3.7795;
    var Wmm = parseFloat(root.getPropertyValue('--paper-w-mm')) || 148;
    var Hmm = parseFloat(root.getPropertyValue('--paper-h-mm')) || 210;

    var paperW = (book.binding==='long' ? Hmm*mm : Wmm*mm);
    var paperH = (book.binding==='long' ? Wmm*mm : Hmm*mm);

    var needW  = effectiveSingleAt(idx)? paperW : paperW*2;
    var needH  = paperH;

    var stage = $('.stage'); if(!stage || !scaler) return;
    var cs = getComputedStyle(stage);
    var stageW = stage.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var stageH = stage.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);

    var s = Math.min(1, stageW / needW, stageH / needH);
    scaler.style.transform = 'scale('+s+')';
  }

  /* ======================
     啟動
     ====================== */
  ensureCover();
  render();
  fit();
})();
