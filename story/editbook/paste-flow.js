/* paste-flow.js
 * 貼上純文字 / Enter / 輸入 → 視覺溢出自動分頁到下一個 novel 頁
 * - 溢出判斷依 writing-mode 決定：直排看寬、橫排看高
 * - 沒有可寫頁就插入一張白紙（兩頁），並繼續流向新 front
 */
(function(){
  function isVerticalFlow(storyEl){
    const page = storyEl.closest('.page, .single-page') || storyEl;
    const wm = (page && getComputedStyle(page).writingMode) || '';
    return wm.indexOf('vertical') === 0; // vertical-rl / vertical-lr
  }
  function isOverflow(storyEl){
    if (!storyEl) return false;
    const v = isVerticalFlow(storyEl);
    if (v) { return (storyEl.scrollWidth  - storyEl.clientWidth ) > 0.5; }
    else   { return (storyEl.scrollHeight - storyEl.clientHeight) > 0.5; }
  }

  // 保留格式的子樹截斷（用視覺溢出判斷二分）
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
  // ① 記住一開始的頁，順便保存選取（貼上時通常焦點在這頁）
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

    // 沒有溢出就收工
    if (!restPlain || restPlain.length === 0) break;

    // 尋找下一個可放文字的 novel；沒有就插一張白紙
    let nextIdx = findNextNovel(curIdx);
    if (!nextIdx){
      // ② 插頁後「立刻」鎖回原始頁，避免畫面被帶走
      nextIdx = SheetOps.insertBlankSheetAfterCurrentSheet();
      if (typeof window.lockToDbIndex === 'function') lockToDbIndex(startDb);

      // 保險：確保指到 novel
      if (String(PAGES_DB[nextIdx-1]?.type||'').toLowerCase().replace(/-/g,'_') !== 'novel'){
        for (let k=curIdx+1;k<=PAGES_DB.length;k++){
          if (String(PAGES_DB[k-1]?.type||'').toLowerCase().replace(/-/g,'_') === 'novel') { nextIdx = k; break; }
        }
      }
    }

    // 把剩餘文字搬到 nextIdx 的開頭（或依你原本的策略放置）
    const nextEl = EditorCore.getDomPagesList()[EditorCore.dbIndexToDomIndex(nextIdx)-1];
    const nextStory = EditorCore.ensureStoryOnPageEl(nextEl, nextIdx);
    nextStory.textContent = (restPlain + (nextStory.textContent || ''));

    // 繼續檢查下一頁是否還會再溢出
    curIdx = nextIdx;
  }

  // ③ 收尾：鎖回原始頁並還原游標
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

    storyEl.addEventListener('paste', (e)=>{
      e.preventDefault();
      const t = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
      document.execCommand('insertText', false, t);
      setTimeout(()=>{ flowOverflowFrom(dbIndex); }, 0);
    });

    storyEl.addEventListener('keydown', (e)=>{
     // if (e.key === 'Enter'){
    //   e.preventDefault();
     //   document.execCommand('insertText', false, '\n');
    //    setTimeout(()=>{ flowOverflowFrom(dbIndex); }, 0);
   //   }

if (e.key === 'Enter'){
    // editor-core 會先處理並呼叫 stopImmediatePropagation()
    // 但保險起見這裡也尊重 defaultPrevented，避免雙重插入
    if (e.defaultPrevented) return;
    e.preventDefault();
    document.execCommand('insertText', false, '\n');
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

  // 讓 B/I/U/字級改完也能觸發分頁（text-controls.js 會呼叫這支）
  window.PasteFlow = { bindTo, flowOverflowFrom };
})();
/* paste-flow.js 附加：提供 forceReflow(story)
 * 不影響你原本的 PasteFlow.bindTo(...) 分頁/推擠邏輯
 */
(function(){
  // 保留原物件
  window.PasteFlow = window.PasteFlow || {};

  // 若尚未實作，補一個簡單的 reflow 觸發器
  if (typeof window.PasteFlow.forceReflow !== 'function') {
    window.PasteFlow.forceReflow = function(story){
      if (!story) return;
      // 交給現有的 input 監聽去做「面積算 → 自動換頁 / 推擠」
      // 用 raf 確保 DOM 更新順序
      requestAnimationFrame(()=>{
        story.dispatchEvent(new Event('input', { bubbles:true }));
      });
    };
  }
})();

