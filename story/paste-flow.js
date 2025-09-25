/* paste-flow.js v2 */
(function(){
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
          const cc = cloneNodeLimited(node.childNodes[i]); if (cc) out.appendChild(cc);
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
        if (String(PAGES_DB[nextIdx-1]?.type||'').toLowerCase().replace(/-/g,'_') !== 'novel'){
          for (let k=curIdx+1;k<=PAGES_DB.length;k++){
            if (String(PAGES_DB[k-1]?.type||'').toLowerCase().replace(/-/g,'_') === 'novel') { nextIdx = k; break; }
          }
        }
      }

      const nextEl = EditorCore.getDomPagesList()[EditorCore.dbIndexToDomIndex(nextIdx)-1];
      const nextStory = EditorCore.ensureStoryOnPageEl(nextEl, nextIdx);
      if (!nextStory){ curIdx = nextIdx; continue; }
      const oldPlain = nextStory.textContent || '';
      setStoryPlain(nextStory, restPlain + oldPlain);
      EditorCore.updatePageJsonFromStory(nextIdx, nextStory);

      curIdx = nextIdx;
    }
    setTimeout(()=>{ try{ renderMetaForAllPages(); EditorCore.lockMeta(); }catch(e){} }, 0);
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
      if (e.key === 'Enter'){
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

  window.PasteFlow = { bindTo, flowOverflowFrom, isOverflow };
})();
