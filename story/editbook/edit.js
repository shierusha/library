/* 所有功能.js — Monolithic implementation
   - PageRender: page HTML, cover, meta (page/chapter badges)
   - EditorCore: .story hookup (Enter=br, paste=plain, selection keep)
   - TextControls: A+/A-/B/I/U on selection (preserve highlight)
   - PageStyle: switch types novel/divider-light/divider-dark/illustration
   - SheetOps: insert/delete blank sheets, remount
   - PasteFlow: multi-line paste across pages, auto-insert, skip non-novel
   - TOC: modal build/jump
   - Chapters: insert/edit button behavior
   - Compat shims: lightRedraw / rebuildTo / rebuildAndRedrawPreserveCursor / insertBlankSheetAfterCurrentSheet / switchTo
*/

(function(){
  /* ===== Utils ===== */
  function el(q, root=document){ return root.querySelector(q); }
  function els(q, root=document){ return Array.from(root.querySelectorAll(q)); }
  function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
  function escapeHTML(s){ return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

  /* ===== PageRender ===== */
  const PageRender = {
    pageHTML(page, pageIndex){
      const type = page?.type || 'novel';
      const isDividerLight = (type === 'divider-light' || type === 'divider_white');
      const isDividerDark  = (type === 'divider-dark'  || type === 'divider_black');
      const isImage        = (type === 'illustration' || type === 'image');

      const chapterNow = PageRender.chapterLabelFor(pageIndex);
      const pageBadge  = `<div class="page-meta meta-br meta-page">${pageIndex}</div>`;
      const chapBadge  = chapterNow ? `<div class="page-meta meta-tl meta-chapter">${escapeHTML(chapterNow)}</div>` : '';

      if (isImage){
        const bg = page.image_url ? ` style="background-image:url('${escapeHTML(page.image_url)}')"` : '';
        return `<div class="page page--illustration" data-db-index="${pageIndex}"${bg}></div>`;
      }
      if (isDividerLight){
        return `<div class="page page--divider_light" data-db-index="${pageIndex}">${chapBadge}${pageBadge}<div>　</div></div>`;
      }
      if (isDividerDark){
        return `<div class="page page--divider_dark" data-db-index="${pageIndex}">${chapBadge}${pageBadge}<div>　</div></div>`;
      }
      return `<div class="page" data-db-index="${pageIndex}">
        ${chapBadge}${pageBadge}
        <div class="story" contenteditable="true" spellcheck="false"></div>
      </div>`;
    },
    chapterLabelFor(pageIndex){
      const arr = (window.CHAPTERS_DB||[]).slice().sort((a,b)=>a.page_index-b.page_index);
      let label = '';
      for (const ch of arr){
        if (pageIndex >= (ch.page_index||0)) label = ch.title||'';
        else break;
      }
      return label || '';
    },
    applyCoverFromBook(){
      const book = window.getBook ? window.getBook() : { title:'未命名書籍', cover_url:null };
      const cover = document.querySelector('#bookCanvas .paper .front');
      if (!cover) return;
      if (book.cover_url){
        cover.classList.add('page--illustration');
        cover.style.backgroundImage = `url("${book.cover_url}")`;
        cover.innerHTML = '';
      }else{
        cover.classList.remove('page--illustration');
        cover.style.backgroundImage = '';
        cover.style.display='flex';
        cover.style.alignItems='center';
        cover.style.justifyContent='center';
        cover.innerHTML = `<div style="font-size:2.2em;font-weight:700;letter-spacing:.08em">${escapeHTML(book.title||'未命名書籍')}</div>`;
      }
    },
    renderMetaForAllPages(){
      els('.page[data-db-index], .single-page[data-db-index]').forEach(pg=>{
        const idx = Number(pg.getAttribute('data-db-index'))||1;
        // page #
        let metaPage = pg.querySelector('.meta-page');
        if (!metaPage){
          metaPage = document.createElement('div');
          metaPage.className = 'page-meta meta-br meta-page';
          pg.appendChild(metaPage);
        }
        metaPage.textContent = String(idx);
        // chapter label
        const label = PageRender.chapterLabelFor(idx);
        let metaCh = pg.querySelector('.meta-chapter');
        if (label){
          if (!metaCh){
            metaCh = document.createElement('div');
            metaCh.className = 'page-meta meta-tl meta-chapter';
            pg.appendChild(metaCh);
          }
          metaCh.textContent = label;
        }else if (metaCh){
          metaCh.remove();
        }
      });
    }
  };
  window.PageRender = Object.assign(window.PageRender||{}, PageRender);

  /* ===== EditorCore ===== */
  const EditorCore = (function(){
    let lastSelection = null;

    function isNovel(page){ return page && (page.type==='novel' || !page.type); }
    function isDivider(page){
      return page && (page.type==='divider-light' || page.type==='divider_white' || page.type==='divider-dark' || page.type==='divider_black');
    }
    function isImage(page){ return page && (page.type==='illustration' || page.type==='image'); }

    function keepSelection(){
      const s = document.getSelection();
      if (s && s.rangeCount>0){
        lastSelection = s.getRangeAt(0).cloneRange();
      }
    }
    function restoreSelection(){
      if (!lastSelection) return;
      const s = document.getSelection();
      s.removeAllRanges();
      s.addRange(lastSelection);
    }
    document.addEventListener('selectionchange', keepSelection);

    function getFocusedDbIndex(){
      const s = document.getSelection();
      if (!s || s.rangeCount===0) return 1;
      let node = s.anchorNode;
      if (node?.nodeType===3) node = node.parentElement;
      const page = node?.closest?.('.page[data-db-index], .single-page[data-db-index]');
      if (!page) return 1;
      return Number(page.getAttribute('data-db-index'))||1;
    }

    function handleEnterAsBr(e){
      if (e.key === 'Enter'){ e.preventDefault(); document.execCommand('insertLineBreak'); }
    }
    function handlePastePlain(e){
      if (!e.clipboardData) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain') || '';
      if (!text) return;
      PasteFlow.flow(text);
    }

    function hookStoryOne(story){
      const idx = Number(story.closest('[data-db-index]')?.getAttribute('data-db-index'))||1;
      // 覆寫 user-select: none（CSS）
      story.contentEditable = 'true';
      story.style.userSelect = 'text';
      story.style.webkitUserSelect = 'text';
      story.style.MozUserSelect = 'text';
      story.style.msUserSelect = 'text';
      story.style.pointerEvents = 'auto';
      story.style.caretColor = 'auto';
      story.setAttribute('tabindex','0');

      // 回填 DB 內容
      story.innerHTML = (window.PAGES_DB?.[idx-1]?.html) || '';

      story.addEventListener('keydown', handleEnterAsBr);
      story.addEventListener('paste', handlePastePlain);
      story.addEventListener('input', ()=>{
        const i = Number(story.closest('[data-db-index]')?.getAttribute('data-db-index'))||1;
        const p = window.PAGES_DB[i-1];
        if (p && isNovel(p)){
          p.html = story.innerHTML;
          window.persistDraft?.();
        }
        PageRender.renderMetaForAllPages();
      });
      story.addEventListener('mouseup', keepSelection);
      story.addEventListener('keyup', keepSelection);
      story.addEventListener('focus', keepSelection);
    }

    function hookAllStories(){
      els('.story').forEach(hookStoryOne);
    }

    return { hookAllStories, keepSelection, restoreSelection, getFocusedDbIndex };
  })();
  window.EditorCore = EditorCore;
  /* ===== TextControls ===== */
  const TextControls = (function(){
    function getRange(){
      const sel = document.getSelection();
      if (!sel || sel.rangeCount===0) return null;
      return sel.getRangeAt(0);
    }
    function wrapSelectionWithSpan(mutator){
      const r = getRange(); if (!r || r.collapsed) return;
      const frag = r.cloneContents();
      const span = document.createElement('span');
      span.appendChild(frag);
      if (mutator) mutator(span);
      r.deleteContents();
      r.insertNode(span);
      // 重新選取該 span 以維持反白
      const s = document.getSelection();
      s.removeAllRanges();
      const nr = document.createRange();
      nr.selectNodeContents(span);
      s.addRange(nr);
      EditorCore.keepSelection();
      return span;
    }
    try{ document.execCommand('styleWithCSS', false, true); }catch(_){}

    function changeFontSize(delta){
      wrapSelectionWithSpan((span)=>{
        function currentK(el){
          const m = /calc\(1em \* ([0-9.]+)\)/.exec(el.style.fontSize||'');
          return m ? parseFloat(m[1]) : 1;
        }
        const k0 = currentK(span);
        const k = Math.max(0.5, Math.min(3, k0 + (delta>0?0.1:-0.1)));
        span.style.fontSize = `calc(1em * ${k.toFixed(2)})`;
      });
    }
    function applyBold(){ document.execCommand('bold'); }
    function applyItalic(){ document.execCommand('italic'); }
    function applyUnderline(){ document.execCommand('underline'); }

    function bindButtons(){
      const byId=id=>document.getElementById(id);
      const btnUp = byId('btnFontUp'), btnDown=byId('btnFontDown');
      const btnB  = byId('btnBold'),   btnI   = byId('btnItalic'), btnU = byId('btnUnderline');
      const absorb=(btn)=> btn && ['pointerdown','mousedown','touchstart'].forEach(ev=>{
        btn.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); EditorCore.restoreSelection(); });
      });
      [btnUp,btnDown,btnB,btnI,btnU].forEach(absorb);

      btnUp && btnUp.addEventListener('click', ()=>{ EditorCore.restoreSelection(); changeFontSize(+1); EditorCore.keepSelection(); });
      btnDown&& btnDown.addEventListener('click', ()=>{ EditorCore.restoreSelection(); changeFontSize(-1); EditorCore.keepSelection(); });
      btnB && btnB.addEventListener('click', ()=>{ EditorCore.restoreSelection(); document.execCommand('styleWithCSS', false, true); applyBold(); EditorCore.keepSelection(); });
      btnI && btnI.addEventListener('click', ()=>{ EditorCore.restoreSelection(); document.execCommand('styleWithCSS', false, true); applyItalic(); EditorCore.keepSelection(); });
      btnU && btnU.addEventListener('click', ()=>{ EditorCore.restoreSelection(); document.execCommand('styleWithCSS', false, true); applyUnderline(); EditorCore.keepSelection(); });
    }
    return { bindButtons, changeFontSize };
  })();
  window.TextControls = TextControls;

  /* ===== SheetOps ===== */
  const SheetOps = (function(){
    function isBlankNovel(index){
      const p = window.PAGES_DB?.[index-1];
      return p && (p.type==='novel' || !p.type) && (!p.html || !p.html.replace(/<br\s*\/?>/gi,'').trim());
    }
    function deleteBlankSheetAround(index){
      const zero = index-1;
      const pairStart = zero % 2 === 0 ? zero : zero-1;
      const a = pairStart+1, b = pairStart+2;
      if (isBlankNovel(a) && isBlankNovel(b)){
        window.PAGES_DB.splice(pairStart, 2);
        window.persistDraft?.();
        if (window.book){ window._cursorPageIndex = Math.max(0, pairStart-1); }
        mountAgain();
        return true;
      }
      return false;
    }
    function insertBlankPagesAt(index, count=1){
      const arr = [];
      for (let i=0;i<count*2;i++) arr.push({ type:'novel', html:'', image_url:null });
      const zero = clamp(index-1, 0, window.PAGES_DB.length);
      window.PAGES_DB.splice(zero, 0, ...arr);
      window.persistDraft?.();
      if (window.book){ window._cursorPageIndex = zero; }
      mountAgain();
    }
    function mountAgain(){
      if (!window.book || !window.book._mountCurrent){
        // 將由 app.js 次次掛載
        return;
      }
      // 重建 pairs
      const res=[]; const p=window.PAGES_DB;
      for(let i=0;i<p.length;i+=2){
        const f=p[i]||{type:'novel',html:''}, b=p[i+1]||{type:'novel',html:''};
        res.push({ frontHTML: PageRender.pageHTML(f,i+1), backHTML: PageRender.pageHTML(b,i+2) });
      }
      window.book.opts.data = { pairs: res };
      window.book._mountCurrent();
      setTimeout(()=>{
        window.EditorCore?.hookAllStories?.();
        PageRender.renderMetaForAllPages();
        PageRender.applyCoverFromBook();
        document.getElementById('lblCount')?.textContent = String(window.PAGES_DB.length);
        try{ window.__updateChapterBtnLabel?.(); }catch(_){}
      },0);
    }
    function bindButtons(){
      const del = document.getElementById('btnDeleteBlank');
      del && del.addEventListener('click', ()=>{
        const idx = EditorCore.getFocusedDbIndex();
        const ok = deleteBlankSheetAround(idx);
        if (!ok) alert('只能刪除：該張「紙」的正反兩面皆為空白的一般文本頁');
      });
      const ins = document.getElementById('btnInsertPage');
      ins && ins.addEventListener('click', ()=>{
        const idx = EditorCore.getFocusedDbIndex();
        insertBlankPagesAt(idx, 1);
      });
    }
    return { bindButtons, insertBlankPagesAt, deleteBlankSheetAround, mountAgain };
  })();
  window.SheetOps = SheetOps;
  /* ===== PageStyle ===== */
  const PageStyle = (function(){
    function setTypeAt(index, type){
      const p = window.PAGES_DB?.[index-1];
      if (!p) return;
      if (type==='illustration' || type==='image'){
        const pureEmpty = (!p.html || !p.html.replace(/<br\s*\/?>/gi,'').trim());
        if (!pureEmpty){ alert('圖片頁需先清空本頁文本'); return; }
        const url = prompt('輸入圖片網址（留空=取消圖片頁）', p.image_url || '');
        if (url===null) return;
        const v = String(url).trim();
        if (!v){
          p.type='novel'; p.image_url=null;
        }else{
          p.type='illustration'; p.image_url=v; p.html='';
        }
      }else if (type==='divider-light' || type==='divider_white' || type==='divider-dark' || type==='divider_black'){
        p.type = (type==='divider_white')?'divider-light':(type==='divider_black')?'divider-dark':type;
        p.image_url = null; p.html='';
      }else{
        p.type = 'novel';
      }
      window.persistDraft?.();
      SheetOps.mountAgain();
    }
    function bindButtons(){
      els('.dock .btn[data-style]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const style = btn.getAttribute('data-style');
          const idx = EditorCore.getFocusedDbIndex();
          if (style==='divider-light') setTypeAt(idx, 'divider-light');
          else if (style==='divider-dark') setTypeAt(idx, 'divider-dark');
          else if (style==='illustration') setTypeAt(idx, 'illustration');
          else setTypeAt(idx, 'novel');
        });
      });
    }
    // 供外部呼叫（例如載入後根據資料重繪）
    function bindImageEditors(){
      // 圖片頁雙擊可改網址
      els('.page.page--illustration,[class*="single-page"].page--illustration').forEach(pg=>{
        pg.addEventListener('dblclick', ()=>{
          const idx = Number(pg.getAttribute('data-db-index'))||1;
          const p = window.PAGES_DB[idx-1];
          if (!p) return;
          const url = prompt('輸入圖片網址（留空=取消圖片頁）', p.image_url || '');
          if (url===null) return;
          const v = String(url).trim();
          if (!v){ p.type='novel'; p.image_url=null; }
          else { p.type='illustration'; p.image_url=v; p.html=''; }
          window.persistDraft?.();
          SheetOps.mountAgain();
        });
      });
    }
    return { bindButtons, setTypeAt, bindImageEditors };
  })();
  window.PageStyle = PageStyle;

  /* ===== PasteFlow ===== */
  const PasteFlow = (function(){
    function storyFor(index){
      return document.querySelector(`.page[data-db-index="${index}"] .story, .single-page[data-db-index="${index}"] .story`);
    }
    function fits(story){
      return story.scrollHeight <= story.clientHeight + 1;
    }
    function appendLine(story, line){
      if (!line){ story.innerHTML += '<br>'; return; }
      const tn = document.createTextNode(line);
      story.appendChild(tn);
      story.appendChild(document.createElement('br'));
    }
    function nextWritable(start){
      let i = start;
      while (i <= (window.PAGES_DB?.length||0)){
        const p = window.PAGES_DB[i-1];
        if (p && (p.type==='novel' || !p.type)) return i;
        i++;
      }
      SheetOps.insertBlankPagesAt((window.PAGES_DB?.length||0)+1, 1);
      return window.PAGES_DB.length;
    }
    function flow(text){
      const lines = String(text).replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
      let idx = EditorCore.getFocusedDbIndex();
      idx = nextWritable(idx);
      for (const rawLine of lines){
        let story = storyFor(idx);
        if (!story){
          SheetOps.mountAgain();
          story = storyFor(idx);
          if (!story) break;
        }
        const snapshot = story.innerHTML;
        appendLine(story, rawLine);
        if (!fits(story)){
          story.innerHTML = snapshot;
          idx = nextWritable(idx+1);
          SheetOps.mountAgain();
          story = storyFor(idx);
          if (!story) break;
          appendLine(story, rawLine);
          if (!fits(story)){
            // 粗略切半策略
            const line = rawLine;
            const mid = Math.floor(line.length/2)||1;
            const a = line.slice(0, mid);
            const b = line.slice(mid);
            story.innerHTML = snapshot;
            appendLine(story, a);
            if (!fits(story)){
              // 二分逼近
              let low=1, high=a.length;
              while (low<high){
                const cut = Math.floor((low+high)/2);
                story.innerHTML = snapshot;
                appendLine(story, a.slice(0, cut));
                if (!fits(story)) high=cut-1; else low=cut+1;
              }
              story.innerHTML = snapshot;
              appendLine(story, a.slice(0, Math.max(1,high)));
              const rest = a.slice(Math.max(1,high)) + b;
              idx = nextWritable(idx+1);
              SheetOps.mountAgain();
              const s2 = storyFor(idx);
              if (s2) appendLine(s2, rest);
            }else{
              idx = nextWritable(idx+1);
              SheetOps.mountAgain();
              const s2 = storyFor(idx);
              if (s2) appendLine(s2, b);
            }
          }
        }
        // 寫回 DB
        const dbi = Number(story.closest('[data-db-index]')?.getAttribute('data-db-index'))||1;
        const p = window.PAGES_DB[dbi-1];
        if (p) p.html = story.innerHTML;
      }
      window.persistDraft?.();
      PageRender.renderMetaForAllPages();
    }
    return { flow };
  })();
  window.PasteFlow = PasteFlow;
  /* ===== TOC ===== */
  (function(){
    const tocModal = document.getElementById('tocModal');
    const tocBody  = document.getElementById('tocBody');
    const btnTOC   = document.getElementById('btnTOC');

    function build(){
      if (!tocBody) return;
      const title = (window.ACTIVE_BOOK?.title || '未命名書籍');
      const ch = (window.CHAPTERS_DB||[]).slice().sort((a,b)=>a.page_index-b.page_index);
      tocBody.innerHTML = '';

      const head = document.createElement('div');
      head.innerHTML = `<div style="font-weight:700;letter-spacing:.08em;margin-bottom:6px">${escapeHTML(title)}</div>`;
      tocBody.appendChild(head);

      if (!ch.length){
        const p = document.createElement('p'); p.style.opacity='.8'; p.textContent='（尚未建立章節）';
        tocBody.appendChild(p);
      }else{
        ch.forEach(c=>{
          const row = document.createElement('div');
          row.className='toc-row';
          row.innerHTML = `<div class="toc-title">${escapeHTML(c.title||'（未命名章節）')}</div><div class="toc-page">${c.page_index}</div>`;
          row.addEventListener('click', ()=>{
            window.gotoDomPage?.(c.page_index);
            close();
          });
          tocBody.appendChild(row);
        });
      }

      const ctrl = document.createElement('div');
      ctrl.style.marginTop='8px';
      ctrl.innerHTML = `<button class="btn" id="tocGotoCover">回到封面</button>`;
      tocBody.appendChild(ctrl);

      document.getElementById('tocGotoCover')?.addEventListener('click', ()=>{
        window.gotoDomPage?.(1);
        close();
      });
    }

    function open(){ build(); tocModal?.classList.add('show'); tocModal?.setAttribute('aria-hidden','false'); }
    function close(){ tocModal?.classList.remove('show'); tocModal?.setAttribute('aria-hidden','true'); }

    tocModal?.addEventListener('click', (e)=>{ if (e.target === tocModal) close(); });
    btnTOC  ?.addEventListener('click', open);

    window.TOC_API = { open, close, build };
  })();

  /* ===== Chapters: 插入/編輯 ===== */
  (function(){
    const btn = document.getElementById('btnInsertChapter');
    function updateChapterBtnLabel(){
      if (!btn) return;
      const idx = EditorCore.getFocusedDbIndex();
      const exist = (window.CHAPTERS_DB||[]).some(c=>c.page_index===idx);
      btn.textContent = exist ? '編輯章節' : '插入章節';
    }
    window.__updateChapterBtnLabel = updateChapterBtnLabel;

    if (btn){
      btn.addEventListener('click', ()=>{
        const idx = EditorCore.getFocusedDbIndex();
        const exist = (window.CHAPTERS_DB||[]).find(c=>c.page_index===idx);
        const tip = exist ? '編輯章節（留空=刪除）' : '新增章節名稱';
        const input = prompt(tip, exist?.title||'');
        if (input===null) return;
        const name = String(input).trim();
        if (!name){
          if (exist){ window.CHAPTERS_DB = (window.CHAPTERS_DB||[]).filter(c=>c!==exist); }
        }else{
          if (exist) exist.title = name;
          else (window.CHAPTERS_DB = window.CHAPTERS_DB||[]).push({ title:name, page_index: idx });
          window.CHAPTERS_DB.sort((a,b)=>a.page_index-b.page_index);
        }
        window.persistDraft?.();
        PageRender.renderMetaForAllPages();
        window.TOC_API?.build?.();
        updateChapterBtnLabel();
      });
      document.addEventListener('selectionchange', ()=>{ try{ updateChapterBtnLabel(); }catch(_){}});
      document.getElementById('btnleft')?.addEventListener('click', ()=> setTimeout(updateChapterBtnLabel, 30));
      document.getElementById('btnright')?.addEventListener('click', ()=> setTimeout(updateChapterBtnLabel, 30));
    }
  })();

  /* ===== Compat Shims ===== */
  (function(){
    function _preserveAndRemount(targetIndex){
      try{
        if (typeof targetIndex !== 'number' || !targetIndex){
          targetIndex = (window.EditorCore?.getFocusedDbIndex?.() || window._cursorPageIndex || 1);
        }
        window._cursorPageIndex = Math.max(0, Number(targetIndex-1)||0);
      }catch(_){}
      SheetOps.mountAgain();
      setTimeout(()=>{
        const s = document.querySelector(`.page[data-db-index="${targetIndex}"] .story, .single-page[data-db-index="${targetIndex}"] .story`);
        if (s){ s.focus(); }
        PageRender.renderMetaForAllPages();
      },0);
    }
    window.lightRedraw = function(){ _preserveAndRemount(window.EditorCore?.getFocusedDbIndex?.()||1); };
    window.rebuildTo = function(index){ _preserveAndRemount(index||1); };
    window.rebuildAndRedrawPreserveCursor = function(){ _preserveAndRemount(window.EditorCore?.getFocusedDbIndex?.()||1); };
    window.insertBlankSheetAfterCurrentSheet = function(){
      const idx = (window.EditorCore?.getFocusedDbIndex?.()||1) + 1;
      window.SheetOps?.insertBlankPagesAt?.(idx, 1);
    };
    window.switchTo = function(styleKey){
      const idx = window.EditorCore?.getFocusedDbIndex?.() || 1;
      window.PageStyle?.setTypeAt?.(idx, styleKey);
      _preserveAndRemount(idx);
    };
  })();

  /* ===== Convenience: 點頁就聚焦 .story ===== */
  (function(){
    document.addEventListener('click', (e)=>{
      const page = e.target.closest('.page[data-db-index], .single-page[data-db-index]');
      if (!page) return;
      const story = page.querySelector('.story');
      if (story){ story.focus(); }
    });
  })();

  /* ===== Boot submodules ===== */
  (function boot(){
    try{
      PageRender.applyCoverFromBook();
      PageRender.renderMetaForAllPages();
      TextControls.bindButtons();
      PageStyle.bindButtons();
      SheetOps.bindButtons();
    }catch(e){ console.warn('[所有功能] boot fail', e); }
  })();

})();
