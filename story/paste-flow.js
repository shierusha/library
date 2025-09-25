/* paste-flow.js — Word-like typing + robust auto pagination
 * 重點：
 * 1) Enter 插入 \n、Tab/Shift+Tab 以全形空格做（反）縮排，保留原生 Undo
 * 2) 貼上：純文字，分頁時只把「尾端超出」往後推；遇圖片頁跳過
 * 3) 分頁採「離線量測」：用隱形 clone 依故事區尺寸二分找最大可容納 offset
 * 4) 推擠直接改 PAGES_DB（即使下一頁 DOM 還沒掛上也能運作）
 * 5) 需要新增頁時只標記並「延遲重建一次」，避免在打字中破壞輸入手感
 */

(function(){
  /* ===== 對外 ===== */
  function bindTo(story){
    if (story.__pfBound) return;
    story.__pfBound = true;

    story.addEventListener('keydown', onKeyDown);
    story.addEventListener('input',   onInput);
    story.addEventListener('paste',   onPaste);
    story.addEventListener('blur',    syncFocusedToDB);
  }

  /* ===== 事件 ===== */
  function onKeyDown(e){
    const story = e.currentTarget;

    if (e.key === 'Tab'){
      e.preventDefault();
      handleTab(story, e.shiftKey);
      // Tab 不會觸發 input，主動檢查一次
      maybeFlow(story, 'tab');
      return;
    }

    if (e.key === 'Enter'){
      e.preventDefault();
      insertTextAtSelection('\n');
      maybeFlow(story, 'enter');
      return;
    }
  }

  function onInput(e){
    maybeFlow(e.currentTarget, 'input');
  }

  function onPaste(e){
    const story = e.currentTarget;
    e.preventDefault();
    const txt = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    if (!txt) return;

    insertTextAtSelection(txt.replace(/\r\n?/g, '\n'));

    // 大量貼上：持續把尾端分走直到不溢出
    let guard = 0;
    while (isOverflow(story) && guard++ < 200){
      flowTailChain(story);
    }
    // 超防護：極端長文
    if (guard >= 200){
      flowTailChain(story);
    }

    syncFocusedToDB();
  }

  /* ===== Tab 縮排 ===== */
  function handleTab(story, isShift){
    const INDENT = '\u3000\u3000'; // 全形空格×2
    const { node, offset } = lineStartPos(story);
    if (!node) return;

    const two = peekText(node, offset, 2);
    if (isShift){
      if (two === INDENT) deleteRange(node, offset, 2);
    }else{
      insertTextAt(node, offset, INDENT);
    }
  }

  /* ===== 溢出與分頁 ===== */
  function maybeFlow(story){
    if (!isOverflow(story)) return;
    flowTailChain(story);
    syncFocusedToDB();
  }

  // 只以「可視高度 vs 內容高度」判定（你的 CSS 已 pre-wrap & overflow:hidden）
  function isOverflow(story){
    return story.scrollHeight - story.clientHeight > 1;
  }

  // 連鎖把本頁尾端 → 下一可編輯頁 → 再檢查下一頁是否溢出……
  function flowTailChain(story){
    const curIdx = dbIndexOf(story);
    if (curIdx <= 0) return;

    // 以離線量測找出當前頁可容納的最大 offset
    const s = getText(story);
    const fit = largestFitOffsetOffline(story, s);
    if (fit >= s.length) return;

    const head = s.slice(0, fit);
    const tail = s.slice(fit);

    // 寫回本頁（DOM + DB）
    setText(story, head);
    writePageText(curIdx, head);

    // 把 tail 推到下一個可編輯頁（跳過圖片）
    let push = tail;
    let nextIdx = nextEditableIndex(curIdx);
    while (push && nextIdx > 0){
      const nextText = readPageText(nextIdx);
      const merged = push + nextText; // 前插，符合「往後擠」規則
      writePageText(nextIdx, merged);

      // 若下一頁有 DOM，就同步 DOM；沒有也沒關係，等翻到那頁時 EditorCore 會帶出
      const nextStory = getStory(nextIdx);
      if (nextStory) setText(nextStory, merged);

      // 量測下一頁是否仍溢出（離線）
      const dimsRef = nextStory || story; // 用相同尺寸做量測
      const nextFit = largestFitOffsetOffline(dimsRef, merged);

      if (nextFit >= merged.length){
        push = ''; // 已吃得下，結束
      }else{
        // 再切一段到下一個可編輯頁
        const keep = merged.slice(0, nextFit);
        push = merged.slice(nextFit);
        writePageText(nextIdx, keep);
        if (nextStory) setText(nextStory, keep);

        // 取得下一個可編輯頁，必要時自動新增頁
        nextIdx = nextEditableIndex(nextIdx, /*allowCreate*/true);
      }
    }
  }

  /* ===== 離線量測：用隱形 clone 求最大可容納 offset ===== */
  function largestFitOffsetOffline(dimRefStory, fullText){
    if (!fullText) return 0;
    const { w, h, styleToken } = measureDims(dimRefStory);
    const probe = getProbe(styleToken, w, h);
    let lo = 0, hi = fullText.length, best = 0;

    while (lo <= hi){
      const mid = (lo + hi) >> 1;
      probe.textContent = fullText.slice(0, mid);
      if (probe.scrollHeight <= probe.clientHeight){
        best = mid; lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  function measureDims(story){
    const cs = getComputedStyle(story);
    const w = story.clientWidth;
    const h = story.clientHeight;
    // 以 writing-mode / font / line-height 等當作樣式 token（不同 token 共用不同量測節點）
    const styleToken = [
      cs.writingMode, cs.fontFamily, cs.fontSize, cs.lineHeight,
      cs.whiteSpace, cs.wordBreak, cs.letterSpacing
    ].join('|');
    return { w, h, styleToken };
  }

  const PROBES = new Map(); // key: token|w|h
  function getProbe(styleToken, w, h){
    const key = styleToken + '|' + w + '|' + h;
    if (PROBES.has(key)) return PROBES.get(key);
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed; left:-99999px; top:0; visibility:hidden;
      white-space:pre-wrap; word-break:break-word; overflow:hidden;
      width:${w}px; height:${h}px; padding:0; border:0; margin:0;
    `;
    document.body.appendChild(el);
    PROBES.set(key, el);
    return el;
  }

  /* ===== Page 級讀寫（DB 為主，DOM 可選同步） ===== */
  function dbIndexOf(story){ return Number(story.dataset.dbIndex||'0')|0; }

  function readPageText(dbIndex){
    const p = PAGES_DB[dbIndex - 1];
    return (p?.content_json?.text_plain) || '';
    // （text_html 會在 persist 或其它流程同步產生）
  }

  function writePageText(dbIndex, text){
    const p = PAGES_DB[dbIndex - 1]; if (!p) return;
    p.content_json = p.content_json || {};
    p.content_json.text_plain = text;
    // 最小轉換：html 僅將 \n → <br>，不包多餘元素
    p.content_json.text_html  = escapeHTML(text).replace(/\n/g,'<br>');
    persistDraft?.();
  }

  function getStory(dbIndex){
    try { return EditorCore.getStoryByDbIndex(dbIndex); } catch(_) { return null; }
  }

  /* ===== 取得下一個可編輯頁（跳過圖片）；必要時在尾端新增 ===== */
  function nextEditableIndex(cur, allowCreate){
    for (let i = cur + 1; i <= PAGES_DB.length; i++){
      const p = PAGES_DB[i - 1];
      if (!isIllustration(p)) return i; // novel / divider_* 都算可編輯
    }
    if (!allowCreate) return -1;

    // 需要更多頁：加一張紙（兩頁 novel）
    appendTwoNovelPages();
    // 延遲重建一次（避免打字中卡頓或重置游標）
    scheduleLazyRebuild(cur);
    return cur + 1;
  }

  function isIllustration(p){
    const t = String(p?.type||'').toLowerCase().replace(/-/g,'_');
    return t === 'illustration' || t === 'image';
  }

  function appendTwoNovelPages(){
    const base = PAGES_DB.length;
    const mk = (idx)=>({
      id: `local_${Math.random().toString(36).slice(2,10)}`,
      page_index: idx,
      type: 'novel',
      image_url: null,
      content_json: { text_plain:'', text_html:'' }
    });
    PAGES_DB.push(mk(base+1), mk(base+2));
    for (let i=0;i<PAGES_DB.length;i++) PAGES_DB[i].page_index = i+1;
    persistDraft?.();
  }

  let __rebuildTimer = null;
  function scheduleLazyRebuild(keepDbIndex){
    if (__rebuildTimer) return;
    __rebuildTimer = setTimeout(()=>{
      __rebuildTimer = null;
      try { rebuildTo?.(keepDbIndex); } catch(_){}
    }, 60); // 稍等一下，避免在輸入節流內頻繁重建
  }

  /* ===== DOM 純文字操作（不创建 span，不破壞 Undo） ===== */
  function getText(story){
    return (story.textContent || '').replace(/\u00a0/g,' ');
  }
  function setText(story, s){
    // 直接改 textContent；caret 會在瀏覽器內部續接於末端，符合一般編輯習慣
    story.textContent = s;
  }

  function insertTextAtSelection(text){
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    r.deleteContents();
    r.insertNode(document.createTextNode(text));
    r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  }

  function insertTextAt(node, offset, text){
    const r = document.createRange();
    r.setStart(node, offset); r.setEnd(node, offset);
    r.insertNode(document.createTextNode(text));
  }

  function deleteRange(node, offset, len){
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(node, offset);
    const endPos = walkText(node, offset, len);
    if (!endPos) return;
    r.setEnd(endPos.node, endPos.offset);
    r.deleteContents();
    sel.removeAllRanges(); sel.addRange(r);
  }

  function peekText(node, offset, len){
    const endPos = walkText(node, offset, len);
    if (!endPos) return '';
    const r = document.createRange();
    r.setStart(node, offset); r.setEnd(endPos.node, endPos.offset);
    return r.toString();
  }

  function walkText(startNode, startOffset, len){
    const root = storyRoot(startNode);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    // 導到起點
    let node = startNode, offset = startOffset;
    if (node.nodeType !== 3){
      node = nextText(root, true); offset = 0;
    } else {
      // 將 walker 定位在當前 text
      w.currentNode = node;
    }
    let remain = len;
    while (node && remain > 0){
      const can = node.nodeValue.length - offset;
      const take = Math.min(can, remain);
      remain -= take;
      offset += take;
      if (remain === 0) return { node, offset };
      node = w.nextNode(); offset = 0;
    }
    return null;
  }

  function storyRoot(el){
    let n = el;
    while (n && !(n.classList && n.classList.contains('story'))) n = n.parentNode;
    return n || el;
  }

  function nextText(root, includeSelf){
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    if (!includeSelf) w.nextNode();
    return w.nextNode();
  }

  function caretOffsetIn(story){
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const r = sel.getRangeAt(0).cloneRange();
    r.setStart(story, 0);
    return r.toString().length;
  }

  function nodeFromOffset(story, idx){
    if (idx <= 0){
      const t = nextText(story, true);
      return t ? { node:t, offset:0 } : null;
    }
    let walked = 0; let n;
    const it = document.createTreeWalker(story, NodeFilter.SHOW_TEXT, null);
    while ((n = it.nextNode())){
      const L = n.nodeValue.length;
      if (walked + L >= idx) return { node:n, offset: idx - walked };
      walked += L;
    }
    const last = (()=>{ let t=null, x; const w=document.createTreeWalker(story,NodeFilter.SHOW_TEXT,null); while((x=w.nextNode())) t=x; return t; })();
    return last ? { node:last, offset:last.nodeValue.length } : null;
  }

  function lineStartPos(story){
    const text = getText(story);
    const caret = caretOffsetIn(story);
    let i = caret - 1; while (i >= 0 && text[i] !== '\n') i--;
    const start = Math.max(0, i + 1);
    const pos = nodeFromOffset(story, start) || {};
    return { node: pos.node || null, offset: pos.offset || 0 };
  }

  /* ===== DB 同步 ===== */
  function syncFocusedToDB(){
    try{
      if (!window.EditorCore) return;
      const idx = EditorCore.getFocusedDbIndex?.() || 1;
      const st = EditorCore.getStoryByDbIndex(idx);
      if (!st) return;
      writePageText(idx, getText(st));
    }catch(_){}
  }

  /* export */
  window.PasteFlow = { bindTo };
})();
