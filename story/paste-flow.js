/* paste-flow.js
 * 貼上純文字 / Enter / 鍵入 → 自動分頁到「一般文本」頁
 * 遇到圖片/黑白頁會先把本頁截滿，剩餘往下一個 novel；若沒有 novel 就插入白紙（用新的回傳 insertAt）
 */

(function(){
  function isOverflow(el){
    if (!el) return false;
    if (el.clientHeight <= 0) return false;
    return (el.scrollHeight - el.clientHeight) > 1;
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
    const fullHTML = storyEl.innerHTML;
    const fullPlain = storyEl.textContent || '';
    let lo=0, hi=fullPlain.length, fit=0;
    while (lo <= hi){
      const mid = (lo + hi) >> 1;
      storyEl.innerHTML = truncateHTMLPreserve(fullHTML, mid);
      if (!isOverflow(storyEl)){ fit = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    storyEl.innerHTML = truncateHTMLPreserve(fullHTML, fit);
    if (isOverflow(storyEl)){
      const before = storyEl.textContent || '';
      const lastNL = before.lastIndexOf('\n');
      const target = (lastNL >= 0) ? lastNL : Math.max(0, before.length - 1);
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
      if (EditorCore.isNovelPage(PAGES_DB[i-1])) return i;
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

      // 找下一個 novel；沒有就插紙（這裡會回傳新 front index）
      let nextIdx = findNextNovel(curIdx);
      if (!nextIdx){
        nextIdx = SheetOps.insertBlankSheetAfterCurrentSheet();
        // 插入後 DB 已重建，確保從當前之後找第一個 novel（理論上 nextIdx 就是新插入的）
        if (!EditorCore.isNovelPage(PAGES_DB[nextIdx-1])){
          for (let k=curIdx+1;k<=PAGES_DB.length;k++){
            if (EditorCore.isNovelPage(PAGES_DB[k-1])) { nextIdx = k; break; }
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

  window.PasteFlow = { bindTo, flowOverflowFrom };
})();
