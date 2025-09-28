/* paste-flow.js
 * 目標：貼上純文字 → 以 <br> 斷行（不產生 <div>/<p>）
 *       Enter 也寫入 <br>（與 editor-core 的行為一致）
 *       視覺溢出推到下一頁時，同樣用 <br> 插入剩餘文字
 * 備註：保留你原有的自動分頁邏輯與選取復位流程
 */
(function(){
  /* ===== 小工具：純文字 → 安全 HTML（以 <br> 斷行） ===== */
  function escHtml(s){
    return String(s||'')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }
  function plainToBrHtml(t){
    // 先統一換行，再轉 <br>
    return escHtml(String(t||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n')).replace(/\n/g,'<br>');
  }

  function isVerticalFlow(storyEl){
    const page = storyEl.closest('.page, .single-page') || storyEl;
    const wm = (page && getComputedStyle(page).writingMode) || '';
    return wm.indexOf('vertical') === 0;
  }
  function isOverflow(storyEl){
    if (!storyEl) return false;
    const v = isVerticalFlow(storyEl);
    if (v) { return (storyEl.scrollWidth  - storyEl.clientWidth ) > 0.5; }
    else   { return (storyEl.scrollHeight - storyEl.clientHeight) > 0.5; }
  }

  // 保留格式的子樹截斷（原樣）
  function truncateHTMLPreserve(firstHTML, nChars){
    if (nChars <= 0) return '';
    const tmp = document.createElement('div'); tmp.innerHTML = firstHTML;
    let remain = nChars, stop = false;
    function cloneNodeLimited(node){
      if (stop) return null;
      if (node.nodeType === 3){
        const s = node.nodeValue || '';
        if (s.length <= remain){ remain -= s.length; return document.createTextNode(s); }
        const part = s.slice(0, remain); remain = 0; stop = true; return document.createTextNode(part);
      } else if (node.nodeType === 1){
        const clone = document.createElement(node.nodeName);
        if (node.hasAttribute('class')) clone.setAttribute('class', node.getAttribute('class'));
        if (node.hasAttribute('style')) clone.setAttribute('style', node.getAttribute('style'));
        for (let i=0;i<node.childNodes.length;i++){
          const cc = cloneNodeLimited(node.childNodes[i]); if (cc) clone.appendChild(cc);
          if (stop) break;
        }
        return clone;
      }
      return null;
    }
    const out = document.createElement('div');
    for (let i=0;i<tmp.childNodes.length;i++){
      const c = cloneNodeLimited(tmp.childNodes[i]); if (c) out.appendChild(c);
      if (stop) break;
    }
    return out.innerHTML;
  }

  function fitKeepWithFormat(storyEl){
    const fullHTML  = storyEl.innerHTML;
    const fullPlain = storyEl.textContent || '';
    let lo=0, hi=fullPlain.length, fit=0;

    while (lo <= hi){
      const mid = (lo + hi) >> 1;
      storyEl.innerHTML = truncateHTMLPreserve(fullHTML, mid);
      if (!isOverflow(storyEl)){ fit = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    storyEl.innerHTML = truncateHTMLPreserve(fullHTML, fit);
    if (isOverflow(storyEl)){
      const before  = storyEl.textContent || '';
      const lastNL  = before.lastIndexOf('\n');
      const target  = (lastNL >= 0) ? lastNL : Math.max(0, before.length - 1);
      storyEl.innerHTML = truncateHTMLPreserve(fullHTML, target);
      fit = target;
    }
    const restPlain = fullPlain.slice(fit);
    return { keepChars: fit, restPlain };
  }

  function setStoryPlain(storyEl, plain){
    storyEl.textContent = plain || '';
    if (!storyEl.style.minHeight) storyEl.style.minHeight = '1.2em';
  }

  function findNextNovel(fromDb){
    for (let i=fromDb+1; i<=PAGES_DB.length; i++){
      const p = PAGES_DB[i-1];
      const t = String(p?.type||'').toLowerCase().replace(/-/g,'_');
      if (t === 'novel') return i;
    }
    return 0;
  }

  function flowOverflowFrom(dbIndex){
    const startDb = dbIndex | 0;
    const storyBefore = EditorCore.getStoryByDbIndex(startDb);
    const savedSel = storyBefore ? EditorCore.getOffsets(storyBefore) : null;

    let curIdx = dbIndex, guard=0, MAX=2500;
    while (curIdx > 0 && curIdx <= PAGES_DB.length){
      if (++guard > MAX) break;

      const pageEl = EditorCore.getDomPagesList()[EditorCore.dbIndexToDomIndex(curIdx)-1];
      const story  = EditorCore.ensureStoryOnPageEl(pageEl, curIdx);
      if (!story){ curIdx++; continue; }

      const { restPlain } = fitKeepWithFormat(story);
      EditorCore.updatePageJsonFromStory(curIdx, story);

      if (!restPlain || restPlain.length === 0) break;

      let nextIdx = findNextNovel(curIdx);
      if (!nextIdx){
        nextIdx = SheetOps.insertBlankSheetAfterCurrentSheet();
        if (typeof window.lockToDbIndex === 'function') lockToDbIndex(startDb);
        if (String(PAGES_DB[nextIdx-1]?.type||'').toLowerCase().replace(/-/g,'_') !== 'novel'){
          for (let k=curIdx+1;k<=PAGES_DB.length;k++){
            if (String(PAGES_DB[k-1]?.type||'').toLowerCase().replace(/-/g,'_') === 'novel') { nextIdx = k; break; }
          }
        }
      }

      const nextEl = EditorCore.getDomPagesList()[EditorCore.dbIndexToDomIndex(nextIdx)-1];
      const nextStory = EditorCore.ensureStoryOnPageEl(nextEl, nextIdx);

      // ★ 改成以 <br> 插入剩餘文字（避免產生 <div>/<p>）
      const restHtml = plainToBrHtml(restPlain);
      if (typeof nextStory.insertAdjacentHTML === 'function') {
        nextStory.insertAdjacentHTML('afterbegin', restHtml);
      } else {
        // 後備：仍盡量保留 <br>
        const tmp = document.createElement('div');
        tmp.innerHTML = restHtml;
        nextStory.insertBefore(tmp, nextStory.firstChild);
      }

      curIdx = nextIdx;
    }

    if (typeof window.lockToDbIndex === 'function') lockToDbIndex(startDb);
    if (savedSel){
      setTimeout(()=>{
        const s = EditorCore.getStoryByDbIndex(startDb);
        if (s){ try { EditorCore.setOffsets(s, savedSel.start, savedSel.end); s.focus?.(); } catch(_){ } }
      }, 0);
    }
  }

  function bindTo(storyEl){
    const dbIndex = Number(storyEl.dataset.dbIndex||'0')|0;
    if (!dbIndex) return;

    // ★ 貼上：取純文字 → 轉 <br> → insertHTML
    storyEl.addEventListener('paste', (e)=>{
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
      const html = plainToBrHtml(t);
      document.execCommand('insertHTML', false, html);
      setTimeout(()=>{ flowOverflowFrom(dbIndex); }, 0);
    });

    // ★ Enter：若沒被 editor-core 攔到，這裡也插入 <br>
    storyEl.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter'){
        if (e.defaultPrevented) return; // editor-core 已處理
        e.preventDefault();
        document.execCommand('insertHTML', false, '<br>');
        setTimeout(()=>{ flowOverflowFrom(dbIndex); }, 0);
      }
    });

    storyEl.addEventListener('input', ()=>{
      EditorCore.updatePageJsonFromStory(dbIndex, storyEl);
      setTimeout(()=>{
        if (isOverflow(storyEl)) flowOverflowFrom(dbIndex);
        else { try{ renderMetaForAllPages(); EditorCore.lockMeta(); }catch(e){} }
      }, 0);
    });
  }

  window.PasteFlow = { bindTo, flowOverflowFrom };
})();

/* paste-flow.js 附加：提供 forceReflow(story)（保留你的原邏輯） */
(function(){
  window.PasteFlow = window.PasteFlow || {};
  if (typeof window.PasteFlow.forceReflow !== 'function') {
    window.PasteFlow.forceReflow = function(story){
      if (!story) return;
      requestAnimationFrame(()=>{
        story.dispatchEvent(new Event('input', { bubbles:true }));
      });
    };
  }
})();
