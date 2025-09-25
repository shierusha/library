/* paste-flow.js
 * Word-like 輸入 + 面積分頁（含提前觸發安全邊界）
 * - Enter：插入 \n；只有溢出才把「尾端」往後頁推
 * - Tab/Shift+Tab：段首縮排/反縮排（全形空格×2），不包 span、不破壞 Undo
 * - 貼上：純文字；大量貼上會持續分頁、遇黑白/圖片頁跳過；頁數不夠自動補頁
 * - 溢出：橫排用高度、直排用寬度；加入 GUARD_EM（預留 0.4em）提早切
 */

(function(){
  // 提早分頁用的「安全邊界」，單位 em（可依感覺調 0.3~0.6）
  const GUARD_EM = 0.4;

  function bindTo(story){
    if (story.__pfBound) return;
    story.__pfBound = true;

    story.addEventListener('keydown', onKeyDown);
    story.addEventListener('input',   onInput);
    story.addEventListener('paste',   onPaste);
    story.addEventListener('blur',    syncToDB);
  }

  /* ---------------- 事件 ---------------- */

  function onKeyDown(e){
    const el = e.currentTarget;

    if (e.key === 'Tab'){
      e.preventDefault();
      handleTab(el, e.shiftKey);
      maybeFlow(el, 'tab');
      return;
    }
    if (e.key === 'Enter'){
      e.preventDefault();
      insertTextAtSelection('\n');
      maybeFlow(el, 'enter');
      return;
    }
  }

  function onInput(e){
    maybeFlow(e.currentTarget, 'input');
  }

  function onPaste(e){
    const el = e.currentTarget;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    if (!text) return;

    insertTextAtSelection(text.replace(/\r\n?/g, '\n'));

    // 持續分頁直到放得下（用「無硬上限＋進度檢查」避免卡死）
    let lastLen = getText(el).length;
    while (isOverflow(el)) {
      if (!flowTailToNextPage(el)) break;
      const nowLen = getText(el).length;
      if (nowLen >= lastLen) break; // 沒進度就跳出
      lastLen = nowLen;
    }
    syncToDB();
  }

  /* -------------- Tab 段首縮排 -------------- */

  function handleTab(story, isShift){
    const { lineStartNode, lineStartOffset } = getLineStartPos(story);
    if (!lineStartNode) return;

    const INDENT = '\u3000\u3000'; // 全形空格×2
    const preview = extractTextRange(lineStartNode, lineStartOffset, 2);

    if (isShift){
      if (preview === INDENT){
        deleteRange(lineStartNode, lineStartOffset, 2);
      }
    } else {
      insertTextAt(lineStartNode, lineStartOffset, INDENT);
    }
  }

  /* -------------- 溢出與分頁 -------------- */

  function maybeFlow(story){
    if (!isOverflow(story)) return;
    // 把超出的「尾端」往後頁推；不拉回
    flowTailToNextPage(story);
    // 再安全檢一次，避免邊界
    if (isOverflow(story)) flowTailToNextPage(story);
    syncToDB();
  }

  function isVertical(story){
    const wm = getComputedStyle(story).writingMode || '';
    return /vertical-rl|vertical-lr/i.test(wm);
  }

  function guardPx(story){
    const fs = parseFloat(getComputedStyle(story).fontSize) || 16;
    return GUARD_EM * fs;
  }

  function isOverflow(story){
    // 橫排看高度；直排看寬度；加入「安全邊界」讓分頁提早觸發
    const g = guardPx(story);
    if (isVertical(story)){
      return story.scrollWidth > (story.clientWidth - g);
    }
    return story.scrollHeight > (story.clientHeight - g);
  }

  function flowTailToNextPage(story){
    const total = getText(story).length;
    if (total === 0) return false;

    // 找到本頁可容納的最大 offset（用測量盒 + 邊界）
    const fit = findLargestFitOffsetByMeasureBox(story, 0, total);
    if (fit >= total) return false;

    const tailText = sliceText(story, fit, total);
    truncateText(story, fit);

    // 找下一個可編輯頁（跳過圖片/黑白），不足自動加
    const curDb = getDbIndex(story);
    const nextDb = ensureNextEditablePage(curDb);

    let nextStory = EditorCore.getStoryByDbIndex(nextDb);
    if (!nextStory){
      try { EditorCore.hookAllStories(); } catch(_){}
      nextStory = EditorCore.getStoryByDbIndex(nextDb);
      if (!nextStory) return false;
    }

    // 前插尾段，往後推擠
    setText(nextStory, tailText + getText(nextStory));

    // 若下一頁仍溢出，連鎖往後推（無硬上限＋進度檢查）
    let prev = getText(nextStory).length;
    while (isOverflow(nextStory)) {
      if (!flowTailToNextPage(nextStory)) break;
      const cur = getText(nextStory).length;
      if (cur >= prev) break;
      prev = cur;
    }
    return true;
  }

  /* ------------ 測量盒：橫/直排皆可用的二分量測 ------------ */

  function findLargestFitOffsetByMeasureBox(story, lo, hi){
    const box = getMeasureBox(story);
    const text = getText(story);
    const g = guardPx(story);

    // 以「可視尺寸 - 邊界」作為實際可用尺寸
    const availW = Math.max(0, story.clientWidth  - g);
    const availH = Math.max(0, story.clientHeight - g);

    let best = lo;
    while (lo <= hi){
      const mid = (lo + hi) >> 1;
      box.textContent = text.slice(0, mid);

      const usedW = box.scrollWidth;
      const usedH = box.scrollHeight;

      const overflow = isVertical(story)
        ? (usedW > availW)
        : (usedH > availH);

      if (!overflow){ best = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    return best;
  }

  function getMeasureBox(story){
    let box = story.__measureBox;
    const cs = getComputedStyle(story);

    if (!box){
      box = document.createElement('div');
      box.style.position = 'absolute';
      box.style.left = '-99999px';
      box.style.top  = '0';
      box.style.visibility = 'hidden';
      box.style.overflow = 'auto';
      box.style.whiteSpace = 'pre-wrap';
      box.style.wordBreak  = 'break-word';
      box.style.boxSizing  = 'border-box';
      document.body.appendChild(box);
      story.__measureBox = box;
    }

    // 同步尺寸與排版屬性
    box.style.width  = story.clientWidth  + 'px';
    box.style.height = story.clientHeight + 'px';

    // 字體相關
    box.style.font = cs.font; // 包含 style/weight/size/line-height/family
    box.style.letterSpacing   = cs.letterSpacing;
    box.style.textOrientation = cs.textOrientation;
    box.style.writingMode     = cs.writingMode;

    // 其他排版屬性
    box.style.padding = cs.padding;   // 若 .story 設了 padding，也一併反映
    box.style.border  = '0';
    box.style.margin  = '0';

    return box;
  }

  /* ----------- DOM <-> 文本 ----------- */

  function getDbIndex(story){
    return Number(story.dataset.dbIndex || '0')|0;
  }
  function getText(story){
    return (story.textContent || '').replace(/\u00a0/g, ' ');
  }
  function setText(story, s){
    story.textContent = s;
  }
  function sliceText(story, from, to){
    const s = getText(story);
    return s.slice(from, to);
  }
  function truncateText(story, len){
    const s = getText(story);
    setText(story, s.slice(0, len));
  }

  function insertTextAtSelection(text){
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* ------- 行首/選區輔助（給 Tab 用） ------- */

  function getLineStartPos(story){
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return {};
    const text = getText(story);
    const caretIdx = caretOffsetIn(story);
    let i = caretIdx - 1;
    while (i >= 0 && text[i] !== '\n') i--;
    const offset = Math.max(0, i + 1);
    const pos = nodeFromOffset(story, offset);
    return { lineStartNode: pos?.node || null, lineStartOffset: pos?.offset || 0 };
  }

  function caretOffsetIn(story){
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const r = sel.getRangeAt(0).cloneRange();
    r.setStart(story, 0);
    return r.toString().length;
  }

  function nodeFromOffset(story, target){
    if (target <= 0){
      const first = nextText(story, true);
      return first ? { node:first, offset:0 } : null;
    }
    let walked = 0;
    const it = document.createTreeWalker(story, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = it.nextNode())){
      const len = n.nodeValue.length;
      if (walked + len >= target){
        return { node:n, offset: target - walked };
      }
      walked += len;
    }
    const last = lastText(story);
    return last ? { node:last, offset:last.nodeValue.length } : null;
  }

  function nextText(root, includeSelf){
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    if (!includeSelf) w.nextNode();
    return w.nextNode();
  }
  function lastText(root){
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let last=null,n; while((n=w.nextNode())) last=n; return last;
  }

  function extractTextRange(node, offset, len){
    const end = walkText(node, offset, len);
    if (!end) return '';
    const r = document.createRange();
    r.setStart(node, offset);
    r.setEnd(end.node, end.offset);
    return r.toString();
  }
  function deleteRange(node, offset, len){
    const end = walkText(node, offset, len);
    if (!end) return;
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(node, offset);
    r.setEnd(end.node, end.offset);
    r.deleteContents();
    sel.removeAllRanges(); sel.addRange(r);
  }
  function walkText(startNode, startOffset, len){
    let node = startNode, offset = startOffset, remain = len;
    const walker = document.createTreeWalker(getRoot(startNode), NodeFilter.SHOW_TEXT, null);
    if (startNode.nodeType !== 3){
      let first=null; while(walker.nextNode()){ first=walker.currentNode; break; }
      if (!first) return null; node=first; offset=0;
    } else {
      walker.currentNode = startNode;
    }
    while (node && remain > 0){
      const L = node.nodeValue.length;
      const take = Math.min(remain, L - offset);
      remain -= take; offset += take;
      if (remain === 0) return { node, offset };
      let nxt = walker.nextNode(); if (!nxt) break; node = nxt; offset = 0;
    }
    return null;
  }
  function getRoot(el){
    let n = el;
    while (n && !(n.classList && n.classList.contains('story'))) n = n.parentNode;
    return n || el;
  }

  /* --------- 後頁/新增頁 --------- */

  function ensureNextEditablePage(curDbIndex){
    for (let i = curDbIndex + 1; i <= PAGES_DB.length; i++){
      const p = PAGES_DB[i - 1];
      if (EditorCore.isEditablePage(p)) return i;
    }
    // 不足自動加一張紙（兩頁 novel）
    if (window.SheetOps && typeof SheetOps.ensureTailSheets === 'function'){
      SheetOps.ensureTailSheets(1);
    } else {
      const base = PAGES_DB.length;
      const mk = (idx)=>({
        id: `local_${(Math.random().toString(36).slice(2,10))}`,
        page_index: idx,
        type: 'novel',
        image_url: null,
        content_json: { text_plain:'', text_html:'' }
      });
      PAGES_DB.push(mk(base+1), mk(base+2));
      for (let i=0;i<PAGES_DB.length;i++) PAGES_DB[i].page_index = i+1;
      try { persistDraft(); } catch(_){}
      try { rebuildTo(curDbIndex); } catch(_){}
      try { EditorCore.hookAllStories(); } catch(_){}
    }
    return curDbIndex + 1;
  }

  /* --------- 同步 --------- */

  function syncToDB(){
    try{
      if (!window.EditorCore) return;
      const dbIndex = EditorCore.getFocusedDbIndex?.() || 1;
      const story = EditorCore.getStoryByDbIndex(dbIndex);
      if (!story) return;
      EditorCore.updatePageJsonFromStory(dbIndex, story);
      persistDraft?.();
    }catch(_){}
  }

  window.PasteFlow = { bindTo };
})();
