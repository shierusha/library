
/* 所有功能.js
   - EditorCore（.story 掛鉤：輸入、貼上、Enter=br、選取記憶）
   - TextControls（A+/A-/B/I/U 對選取作用，保留反白）
   - PageStyle（切換 novel/divider-light/divider-dark/illustration）
   - SheetOps（刪除白紙、插入紙張）
   - PasteFlow（大量文本跨頁流動、跳過非文本頁、不夠自動插紙）
   - TOC（章節資料、目錄 UI、章節角標渲染、跳頁）
   - PageRender（把資料轉成 page HTML、封面渲染、頁碼/角標渲染）
*/

(function(){
  /* ========== 小工具 ========== */
  function el(q, root=document){ return root.querySelector(q); }
  function els(q, root=document){ return Array.from(root.querySelectorAll(q)); }
  function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
  function escapeHTML(s){ return String(s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

  /* ========== PageRender ========== */
  const PageRender = {
    // 單頁 HTML（含角標容器與 .story 容器）
    pageHTML(page, pageIndex){
      const type = page?.type || 'novel';
      const isDividerLight = (type === 'divider-light');
      const isDividerDark  = (type === 'divider-dark');
      const isImage        = (type === 'illustration');

      const chapterNow = PageRender.chapterLabelFor(pageIndex);
      const pageBadge  = `<div class="page-meta meta-br meta-page">${pageIndex}</div>`;
      const chapBadge  = chapterNow ? `<div class="page-meta meta-tl meta-chapter">${escapeHTML(chapterNow)}</div>` : '';

      if (isImage){
        const bg = page.image_url ? ` style="background-image:url('${escapeHTML(page.image_url)}')"` : '';
        return `<div class="page page--illustration" data-db-index="${pageIndex}"${bg}>${pageBadge}</div>`;
      }
      if (isDividerLight){
        return `<div class="page page--divider_light" data-db-index="${pageIndex}">${chapBadge}${pageBadge}<div>　</div></div>`;
      }
      if (isDividerDark){
        return `<div class="page page--divider_dark" data-db-index="${pageIndex}">${chapBadge}${pageBadge}<div>　</div></div>`;
      }
      // novel
      return `<div class="page" data-db-index="${pageIndex}">
        ${chapBadge}${pageBadge}
        <div class="story" contenteditable="true" spellcheck="false"></div>
      </div>`;
    },

    // 根據 CHAPTERS_DB 計算某頁應顯示的章節名
    chapterLabelFor(pageIndex){
      const arr = (window.CHAPTERS_DB||[]).slice().sort((a,b)=>a.page_index-b.page_index);
      let label = '';
      for (const ch of arr){
        if (pageIndex >= (ch.page_index||0)) label = ch.title||'';
        else break;
      }
      return label || '';
    },

    // 封面渲染（被 app.js 呼叫）
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

    // 重繪所有頁的角標（章節與頁碼），不重建整本
    renderMetaForAllPages(){
      const chapters = (window.CHAPTERS_DB||[]).slice().sort((a,b)=>a.page_index-b.page_index);
      els('.page[data-db-index]').forEach(pg=>{
        const idx = Number(pg.getAttribute('data-db-index'))||1;
        // page badge
        let metaPage = pg.querySelector('.meta-page');
        if (!metaPage){
          metaPage = document.createElement('div');
          metaPage.className = 'page-meta meta-br meta-page';
          pg.appendChild(metaPage);
        }
        metaPage.textContent = String(idx);
        // chapter badge
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

  /* ========== EditorCore（.story 掛鉤） ========== */
  const EditorCore = (function(){
    let lastSelection = null;

    function getDomPagesList(){
      // 單頁或雙頁都抓實際可見的頁元素
      const single = els('.single-page');
      if (single.length) return single;
      return els('.paper .page');
    }

    function getFocusedDbIndex(){
      const sel = document.getSelection();
      if (!sel || sel.rangeCount === 0) return 1;
      const node = sel.anchorNode;
      const page = (node && (node.nodeType===1 ? node : node.parentElement))?.closest('.page[data-db-index],.single-page[data-db-index]');
      if (!page) return clamp(Number(document.querySelector('.meta-page')?.textContent)||1,1, (window.PAGES_DB?.length||1));
      return Number(page.getAttribute('data-db-index'))||1;
    }

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

    function handleEnterAsBr(e){
      if (e.key === 'Enter'){
        e.preventDefault();
        document.execCommand('insertLineBreak');
      }
    }

    function handlePastePlain(e){
      if (!e.clipboardData) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain') || '';
      if (!text) return;
      PasteFlow.flow(text); // 交給跨頁分流
    }

    function hookStoryOne(story){
      // 初次把 DB 的 html 套回
      const idx = Number(story.closest('[data-db-index]')?.getAttribute('data-db-index'))||1;
      story.innerHTML = (window.PAGES_DB?.[idx-1]?.html) || '';

      story.addEventListener('keydown', handleEnterAsBr);
      story.addEventListener('paste', handlePastePlain);
      story.addEventListener('input', ()=>{
        const i = Number(story.closest('[data-db-index]')?.getAttribute('data-db-index'))||1;
        const page = window.PAGES_DB[i-1];
        if (page && page.type==='novel'){
          page.html = story.innerHTML;
          window.persistDraft();
        }
        // 每次輸入都更新角標（避免角標偶發消失）
        PageRender.renderMetaForAllPages(); try{ window.__updateChapterBtnLabel?.(); }catch(_){}
      });
      story.addEventListener('mouseup', keepSelection);
      story.addEventListener('keyup', keepSelection);
      story.addEventListener('focus', keepSelection);
    }

    function hookAllStories(){
      els('.story').forEach(hookStoryOne);
    }

    document.addEventListener('selectionchange', keepSelection);
    return { hookAllStories, getDomPagesList, getFocusedDbIndex, keepSelection, restoreSelection };
  })();
  window.EditorCore = EditorCore;

  /* ========== TextControls（A+/A-/B/I/U） ========== */
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
      // 記住選取
      EditorCore?.keepSelection?.();
      return span;
    }
    function applyBold(){ document.execCommand('bold'); }
    function applyItalic(){ document.execCommand('italic'); }
    function applyUnderline(){ document.execCommand('underline'); }

    // 使用 styleWithCSS 避免 <font> 標籤
    try{ document.execCommand('styleWithCSS', false, true); }catch(_){}

    function changeFontSize(delta){
      wrapSelectionWithSpan((span)=>{
        // 連乘法縮放（限制 0.5~3 倍）
        function currentK(el){
          const m = /calc\(1em \* ([0-9.]+)\)/.exec(el.style.fontSize||'');
          return m ? parseFloat(m[1]) : 1;
        }
        const k0 = currentK(span);
        const k = Math.max(0.5, Math.min(3, k0 + (delta>0?0.1:-0.1)));
        span.style.fontSize = `calc(1em * ${k.toFixed(2)})`;
      });
    }
      const k0 = currentK(span);
      const k = clamp(k0 + (delta>0?0.1:-0.1), 0.5, 3);
      span.style.fontSize = `calc(1em * ${k.toFixed(2)})`;
    }

    function bindButtons(){
      const absorb = (btn)=>{
        if (!btn) return;
        ['pointerdown','mousedown','touchstart'].forEach(ev=>{
          btn.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); EditorCore.restoreSelection(); });
        });
      };

      const byId = id=>document.getElementById(id);
      const btnUp = byId('btnFontUp'), btnDown=byId('btnFontDown');
      const btnB  = byId('btnBold'),   btnI   = byId('btnItalic'), btnU = byId('btnUnderline');
      [btnUp,btnDown,btnB,btnI,btnU].forEach(absorb);
      // 保留選取：按鈕 mousedown 阻止焦點轉移
      [btnUp,btnDown,btnB,btnI,btnU].forEach(b=>{
        if (!b) return;
        b.addEventListener('mousedown', e=>{ e.preventDefault(); EditorCore.restoreSelection(); });
      });
      btnUp && btnUp.addEventListener('click', ()=>{ EditorCore.restoreSelection(); changeFontSize(+1); EditorCore.keepSelection(); });
      btnDown&& btnDown.addEventListener('click', ()=>{ EditorCore.restoreSelection(); changeFontSize(-1); EditorCore.keepSelection(); });
      btnB && btnB.addEventListener('click', ()=>{ EditorCore.restoreSelection(); document.execCommand('styleWithCSS', false, true); applyBold(); EditorCore.keepSelection(); });
      btnI && btnI.addEventListener('click', ()=>{ EditorCore.restoreSelection(); document.execCommand('styleWithCSS', false, true); applyItalic(); EditorCore.keepSelection(); });
      btnU && btnU.addEventListener('click', ()=>{ EditorCore.restoreSelection(); document.execCommand('styleWithCSS', false, true); applyUnderline(); EditorCore.keepSelection(); });
    }
    return { bindButtons };
  })();
  window.TextControls = TextControls;

  /* ========== SheetOps（插紙、刪白紙） ========== */
  const SheetOps = (function(){
    function isBlankNovel(index){ // index: 1-based
      const p = window.PAGES_DB?.[index-1];
      return p && p.type==='novel' && (!p.html || !p.html.replace(/<br\s*\/?>/gi,'').trim());
    }
    function deleteBlankSheetAround(index){
      // 刪除「正反兩面都是空白 novel」的紙（以 index 所在那張紙為準）
      const zero = index-1;
      const pairStart = zero % 2 === 0 ? zero : zero-1;
      const a = pairStart+1, b = pairStart+2;
      if (isBlankNovel(a) && isBlankNovel(b)){
        window.PAGES_DB.splice(pairStart, 2);
        window.persistDraft();
        // 重新 mount
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
      window.persistDraft();
      if (window.book){ window._cursorPageIndex = zero; }
      mountAgain();
    }

    function mountAgain(){
      // 透過 app.js 的 mount/mounted 流程
      if (typeof window.getPages !== 'function') return;
      if (window.book && typeof window.book._mountCurrent === 'function'){
        const pairs = (function(){
          const res=[]; const p=window.PAGES_DB;
          for(let i=0;i<p.length;i+=2){
            const f=p[i]||{type:'novel',html:''}, b=p[i+1]||{type:'novel',html:''};
            res.push({ frontHTML: PageRender.pageHTML(f,i+1), backHTML: PageRender.pageHTML(b,i+2) });
          }
          return res;
        })();
        // 直接改內部資料重掛
        window.book.opts.data = { pairs };
        window.book._mountCurrent();
        setTimeout(()=>{
          if (window.EditorCore?.hookAllStories) window.EditorCore.hookAllStories();
          PageRender.renderMetaForAllPages(); try{ window.__updateChapterBtnLabel?.(); }catch(_){}
          PageRender.applyCoverFromBook();
          document.getElementById('lblCount')?.textContent = String(window.PAGES_DB.length);
        },0);
      }else{
        // 初次
        if (typeof window.dispatchEvent === 'function'){
          window.dispatchEvent(new Event('DOMContentLoaded'));
        }
      }
    }

    function bindButtons(){
      const absorb = (btn)=>{
        if (!btn) return;
        ['pointerdown','mousedown','touchstart'].forEach(ev=>{
          btn.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); EditorCore.restoreSelection(); });
        });
      };

      const del = document.getElementById('btnDeleteBlank');
      del && del.addEventListener('click', ()=>{
        const idx = EditorCore.getFocusedDbIndex();
        const ok = deleteBlankSheetAround(idx);
        if (!ok) alert('只能刪除：該張「紙」的正反兩面皆為空白的一般文本頁');
      });
      // 插白紙按鈕目前隱藏（你要求先不用），保留事件以備未來用
      const ins = document.getElementById('btnInsertPage');
      ins && ins.addEventListener('click', ()=>{
        const idx = EditorCore.getFocusedDbIndex();
        insertBlankPagesAt(idx, 1);
      });
    }
    return { bindButtons, insertBlankPagesAt, deleteBlankSheetAround, mountAgain };
  })();
  window.SheetOps = SheetOps;

  /* ========== PageStyle（頁型切換） ========== */
  const PageStyle = (function(){
    function setTypeAt(index, type){
      const p = window.PAGES_DB?.[index-1];
      if (!p) return;
      if (type==='illustration'){
        // 僅在無文本時可改
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
      }else if (type==='divider-light' || type==='divider-dark'){
        p.type = type; p.image_url = null; // 文本仍保留？按你的規則 divider 不需要文本，清空避免干擾
        p.html = '';
      }else{
        p.type = 'novel';
      }
      window.persistDraft();
      SheetOps.mountAgain();
    }

    function bindButtons(){
      const absorb = (btn)=>{
        if (!btn) return;
        ['pointerdown','mousedown','touchstart'].forEach(ev=>{
          btn.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); EditorCore.restoreSelection(); });
        });
      };

      els('.dock .btn[data-style]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const style = btn.getAttribute('data-style');
          const idx = EditorCore.getFocusedDbIndex();
          setTypeAt(idx, style);
        });
      });
    }
    return { bindButtons, setTypeAt };
  })();
  window.PageStyle = PageStyle;

  /* ========== PasteFlow（跨頁分流貼上） ========== */
  const PasteFlow = (function(){
    function storyFor(index){
      // 找到當前 DOM 中該 index 的 .story
      const sel = `.page[data-db-index="${index}"] .story, .single-page[data-db-index="${index}"] .story`;
      return document.querySelector(sel);
    }
    function fits(story){
      return story.scrollHeight <= story.clientHeight + 1; // 容錯 1px
    }
    function appendLine(story, line){
      // 將一行文字（可含空白）附加為 <br>（Enter=br 的一致性）
      if (!line){ // 空行
        story.innerHTML += '<br>';
        return;
      }
      // 用 textNode 再加 <br>
      const tn = document.createTextNode(line);
      story.appendChild(tn);
      story.appendChild(document.createElement('br'));
    }

    function flow(text){
      const lines = String(text).replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
      let idx = EditorCore.getFocusedDbIndex();
      // 先把目前頁（若不是 novel）尋找下一個可寫入頁
      function nextWritable(start){
        let i = start;
        while (i <= window.PAGES_DB.length){
          const p = window.PAGES_DB[i-1];
          if (p && p.type==='novel') return i;
          i++;
        }
        // 不夠→自動插入紙張直到有 novel
        SheetOps.insertBlankPagesAt(window.PAGES_DB.length+1, 1);
        return window.PAGES_DB.length; // 新增的最後一頁
      }
      idx = nextWritable(idx);

      for (const rawLine of lines){
        let line = rawLine;
        let story = storyFor(idx);
        if (!story){ // 若 mount 還沒完成，強制重掛
          SheetOps.mountAgain();
          story = storyFor(idx);
          if (!story){ console.warn('no story at index', idx); break; }
        }
        // 暫存原內容以便檢查 overflow
        const snapshot = story.innerHTML;
        appendLine(story, line);
        // 檢查溢出
        if (!fits(story)) {
          // 回滾一行 → 另起新頁
          story.innerHTML = snapshot;
          // 移動到下一個可寫頁
          idx = nextWritable(idx+1);
          // 重新取得該頁的 story
          SheetOps.mountAgain();
          story = storyFor(idx);
          if (!story) { console.warn('no story at index (2)', idx); break; }
          appendLine(story, line);
          if (!fits(story)){
            // 還是不夠，代表一行極長；採用粗略截斷：切成兩半再流到下一頁
            const mid = Math.floor(line.length/2)||1;
            // 回滾
            story.innerHTML = snapshot;
            const a = line.slice(0, mid);
            const b = line.slice(mid);
            appendLine(story, a);
            if (!fits(story)){
              // 再次分半直到塞得下（簡化保守）
              let chunk = a;
              let low=0, high=a.length;
              while (!fits(story) && high-low>1){
                const cut = Math.floor((low+high)/2);
                story.innerHTML = snapshot;
                appendLine(story, a.slice(0, cut));
                if (!fits(story)) high = cut;
                else low = cut;
              }
              story.innerHTML = snapshot;
              appendLine(story, a.slice(0, low));
              const rest = a.slice(low) + b;
              idx = nextWritable(idx+1);
              SheetOps.mountAgain();
              const s2 = storyFor(idx);
              if (s2){ appendLine(s2, rest); }
            }else{
              // a 成功，b 走下一頁
              idx = nextWritable(idx+1);
              SheetOps.mountAgain();
              const s2 = storyFor(idx);
              if (s2){ appendLine(s2, b); }
            }
          }
        }
        // 寫回 DB
        const dbi = Number(story.closest('[data-db-index]')?.getAttribute('data-db-index'))||1;
        const p = window.PAGES_DB[dbi-1];
        if (p) { p.html = story.innerHTML; }
      }
      window.persistDraft();
      PageRender.renderMetaForAllPages(); try{ window.__updateChapterBtnLabel?.(); }catch(_){}
    }
    return { flow };
  })();
  window.PasteFlow = PasteFlow;

  /* ========== TOC（目錄、章節角標） ========== */
  const TOC = (function(){
    const modal = document.getElementById('tocModal');
    const body  = document.getElementById('tocBody');
    const btn   = document.getElementById('btnTOC');

    function build(){
      if (!body) return;
      const title = (window.ACTIVE_BOOK?.title || '未命名書籍');
      const ch = (window.CHAPTERS_DB||[]).slice().sort((a,b)=>a.page_index-b.page_index);
      body.innerHTML = '';
      // 封面 & 書名
      const head = document.createElement('div');
      head.innerHTML = `<div style="font-weight:700;letter-spacing:.08em;margin-bottom:6px">${escapeHTML(title)}</div>`;
      body.appendChild(head);
      // 章節列
      if (!ch.length){
        const p = document.createElement('p'); p.style.opacity='.8'; p.textContent='（尚未建立章節）';
        body.appendChild(p);
      }else{
        ch.forEach(c=>{
          const row = document.createElement('div');
          row.className='toc-row';
          row.innerHTML = `<div class="toc-title">${escapeHTML(c.title||'（未命名章節）')}</div><div class="toc-page">${c.page_index}</div>`;
          row.addEventListener('click', ()=>{
            window.gotoDomPage?.(c.page_index);
            close();
          });
          body.appendChild(row);
        });
      }
      // 功能列：回到封面
      const back = document.createElement('div');
      back.style.marginTop='8px';
      const btnCover = document.createElement('button');
      btnCover.className='btn';
      btnCover.textContent='回到封面';
      btnCover.addEventListener('click', ()=>{ window.gotoDomPage?.(1); close(); });
      back.appendChild(btnCover);
      body.appendChild(back);
    }

    function open(){ build(); modal?.classList.add('show'); modal?.setAttribute('aria-hidden','false'); }
    function close(){ modal?.classList.remove('show'); modal?.setAttribute('aria-hidden','true'); }

    btn && btn.addEventListener('click', open);
    modal && modal.addEventListener('click', (e)=>{ if (e.target===modal) close(); });

    return { build, open, close };
  })();
  window.TOC_API = TOC;

  /* ========== 章節插入/編輯（按鈕事件） ========== */
  (function bindInsertChapter(){
    const btn = document.getElementById('btnInsertChapter');
    if (!btn) return;
    btn.addEventListener('click', ()=>{
      // 以正在編輯的頁作為 page_index
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
      window.persistDraft();
      PageRender.renderMetaForAllPages(); try{ window.__updateChapterBtnLabel?.(); }catch(_){}
      TOC.build();
    });
  })();

  /* ========== 封面初始渲染 & 工具綁定 ========== */
  (function bootFeatures(){
    // 首次掛載完成後，app.js 也會再呼叫一次 renderMeta/cover
    PageRender.applyCoverFromBook();
    TextControls.bindButtons();
    PageStyle.bindButtons();
    SheetOps.bindButtons();
  })();

  /* ===== 兼容舊函式名稱（避免 lightRedraw / rebuildTo 缺失） ===== */
  function _preserveAndRemount(targetIndex){
    // 盡量保留目前頁
    try{
      if (typeof targetIndex !== 'number' || !targetIndex){
        targetIndex = (window.EditorCore?.getFocusedDbIndex?.() || window._cursorPageIndex || 1);
      }
      window._cursorPageIndex = Math.max(0, Number(targetIndex-1)||0);
    }catch(_){}
    window.SheetOps?.mountAgain?.();
    setTimeout(()=>{
      // 重新聚焦該頁 story
      const s = document.querySelector(`.page[data-db-index="${targetIndex}"] .story, .single-page[data-db-index="${targetIndex}"] .story`);
      if (s){ s.focus(); }
      window.PageRender?.renderMetaForAllPages?.();
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
    // 舊程式呼叫 switchTo('novel'|'divider-light'|'divider-dark'|'illustration')
    const idx = window.EditorCore?.getFocusedDbIndex?.() || 1;
    window.PageStyle?.setTypeAt?.(idx, styleKey);
    _preserveAndRemount(idx);
  };

  /* ===== 章節按鈕文字同步（在每次焦點/翻頁時更新） ===== */
  function updateChapterBtnLabel(){
    const btn = document.getElementById('btnInsertChapter');
    if (!btn) return;
    const idx = window.EditorCore?.getFocusedDbIndex?.() || 1;
    const exist = (window.CHAPTERS_DB||[]).some(c=>c.page_index===idx);
    btn.textContent = exist ? '編輯章節' : '插入章節';
  }
  window.__updateChapterBtnLabel = updateChapterBtnLabel;
  document.addEventListener('selectionchange', ()=>{ try{ updateChapterBtnLabel(); }catch(_){}});
  document.addEventListener('click', (e)=>{
    // 點到任一頁時更新
    if (e.target.closest('.page,.single-page')){
      setTimeout(()=>{ try{ updateChapterBtnLabel(); }catch(_){} },0);
    }
  });

})();
