/* paste-flow.js
 * 目標：像 Word 一樣的輸入體驗
 * - Enter：僅插入換行（\n），不會整段被推走；只有真的溢出才把「超出的尾端」往後頁推
 * - Tab / Shift+Tab：行首縮排 / 反縮排（用全形空格 \u3000），不影響選取，保留原生 Undo
 * - 貼上：一律以純文字插入，再依可視高度檢查溢出→把尾端往後推；遇圖片/黑白頁會跳過；不夠自動加頁
 * - 不從後頁「拉回」文字（與你之前的規則一致）
 * 依賴：EditorCore, SheetOps（若沒有 SheetOps 會內建一個極簡 fallback）
 */

(function(){
  /** 綁定所有事件到 .story */
  function bindTo(story){
    if (story.__pfBound) return;
    story.__pfBound = true;

    story.addEventListener('keydown', onKeyDown);
    story.addEventListener('input',   onInput);   // 一般輸入（字母、刪除）
    story.addEventListener('paste',   onPaste);
    story.addEventListener('blur',    syncToDB);
  }

  /* ---------- 事件處理 ---------- */

  function onKeyDown(e){
    const el = e.currentTarget;

    // Tab 縮排（行首用全形空格實作；不創建 span，不破壞 Undo）
    if (e.key === 'Tab'){
      e.preventDefault();
      handleTab(el, e.shiftKey);
      // Tab 不立刻量測，等 input 後（瀏覽器不會派 input 給 Tab，所以主動 flow）
      maybeFlow(el, 'tab');
      return;
    }

    // Enter 僅插入 \n；直到真的 overflow 才把尾端往後推
    if (e.key === 'Enter'){
      e.preventDefault();
      insertTextAtSelection('\n');
      // 立刻衡量是否溢出
      maybeFlow(el, 'enter');
      return;
    }
  }

  function onInput(e){
    const el = e.currentTarget;
    maybeFlow(el, 'input');
  }

  function onPaste(e){
    const el = e.currentTarget;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    if (!text) return;

    // 純文字貼上
    insertTextAtSelection(text.replace(/\r\n?/g, '\n'));

    // 大量貼上：反覆檢查，直到完全塞完
    let guard = 0;
    while (isOverflow(el) && guard++ < 200) {
      flowTailToNextPage(el);
    }
    // 若還有剩下超過很多頁的量，持續建立頁面直到結束
    if (guard >= 200) {
      // 最壞情境 fallback：保證把殘餘文字切出去
      while (getText(el).length > 0) {
        if (!flowTailToNextPage(el)) break;
        if (!isOverflow(el)) break;
      }
    }

    syncToDB();
  }

  /* ---------- Tab 縮排 ---------- */

  function handleTab(story, isShift){
    const { lineStartNode, lineStartOffset } = getLineStartPos(story);
    if (!lineStartNode) return;

    // 取行首兩個字（可能跨 node，先把行首到行首+2 的文字抽出來）
    const preview = extractTextRange(lineStartNode, lineStartOffset, 2);
    const INDENT = '\u3000\u3000'; // 全形空格 ×2，比較貼近中文段首

    if (isShift){
      // 反縮排：如果行首已有縮排，砍掉兩個全形空格
      if (preview === INDENT){
        deleteRange(lineStartNode, lineStartOffset, 2);
      }
    } else {
      // 縮排：在行首插入兩個全形空格
      insertTextAt(lineStartNode, lineStartOffset, INDENT);
    }
  }

  /* ---------- 溢出判定與分頁 ---------- */

  function maybeFlow(story, reason){
    if (!isOverflow(story)) return;
    // 把「超出的尾端」往後頁推（不是整段）
    flowTailToNextPage(story);
    // 可能還超，安全起見再檢一次
    if (isOverflow(story)) flowTailToNextPage(story);
    syncToDB();
  }

  function isOverflow(story){
    // 只用可視高度 vs 內容高度（你 CSS 已 pre-wrap / overflow hidden）
    // 再加上 1px 容差，避免邊界抖動
    return story.scrollHeight - story.clientHeight > 1;
  }

  function flowTailToNextPage(story){
    // 1) 找出本頁「可容納的最大文字 offset」：用二分搜尋
    const total = getText(story).length;
    if (total === 0) return false;
    const fit = findLargestFitOffset(story, 0, total);

    if (fit >= total) return false; // 全部都放得下，不需要流動

    // 2) 將 [fit, end) 的尾段，推到「下一個可編輯頁」
    const tailText = sliceText(story, fit, total);
    // 現頁留下 [0, fit)
    truncateText(story, fit);

    // 3) 取得下一個可編輯頁（跳過圖片/黑白），不足就自動加頁
    const dbIndex = getDbIndex(story);
    const nextDbIndex = ensureNextEditablePage(dbIndex);
    const nextStory = EditorCore.getStoryByDbIndex(nextDbIndex);

    if (!nextStory) return false;

    // 4) 把尾段「前插」到下一頁（把原本的文本往後擠，符合你的規則）
    const nextFull = tailText + getText(nextStory);
    setText(nextStory, nextFull);

    // 5) 下一頁若溢出，讓它自己再流到下下一頁（尾端連鎖）
    while (isOverflow(nextStory)) {
      flowTailToNextPage(nextStory);
      // 防死循環：溢出卻無法往後推，跳出
      const guardBreak = getText(nextStory).length;
      if (guardBreak === 0) break;
    }

    return true;
  }

  // 二分搜尋找出最大可容納 offset（以「可視高度」為界）
  function findLargestFitOffset(story, lo, hi){
    // 建立測量用 Range（不顯示，不會有「黑框」）
    const storyBox = story.getBoundingClientRect();
    const maxHeight = story.clientHeight;

    let best = lo;
    while (lo <= hi){
      const mid = (lo + hi) >> 1;
      const rect = rectOfRange(story, 0, mid);
      const h = rect ? (rect.bottom - storyBox.top) : 0;
      if (h <= maxHeight){ best = mid; lo = mid + 1; }
      else { hi = mid - 1; }
    }
    return best;
  }

  /* ---------- DOM <-> 純文字 操作 ---------- */

  function getDbIndex(story){
    return Number(story.dataset.dbIndex || '0')|0;
  }

  function getText(story){
    // 用 textContent 即可（.story 已設 white-space: pre-wrap）
    return (story.textContent || '').replace(/\u00a0/g, ' ');
  }

  function setText(story, s){
    // 不包 span，不帶樣式；保留原生 Undo（用選取替換方式）
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

  /* 在目前選取點插入純文字（保留原生 Undo/Redo） */
  function insertTextAtSelection(text){
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    // 把 caret 放到剛插入的末端
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* 在指定 DOM 位置插入純文字（行首縮排用） */
  function insertTextAt(node, offset, text){
    const r = document.createRange();
    r.setStart(node, offset);
    r.setEnd(node, offset);
    r.insertNode(document.createTextNode(text));
  }

  /* 刪除 [node,offset) 起算 len 個「文字」（跨 node 的簡易版本） */
  function deleteRange(node, offset, len){
    const sel = window.getSelection();
    const r = document.createRange();
    r.setStart(node, offset);
    const endPos = walkText(node, offset, len);
    if (!endPos) return;
    r.setEnd(endPos.node, endPos.offset);
    r.deleteContents();
    sel.removeAllRanges(); sel.addRange(r); // 維持 caret 在刪除處
  }

  /* 抽出從 [node,offset) 起 len 個字的純文字（跨 node） */
  function extractTextRange(node, offset, len){
    const endPos = walkText(node, offset, len);
    if (!endPos) return '';
    const r = document.createRange();
    r.setStart(node, offset);
    r.setEnd(endPos.node, endPos.offset);
    return r.toString();
  }

  /* 從某個 DOM 位置往後走 len 個文字位移，回傳 {node, offset} */
  function walkText(startNode, startOffset, len){
    let node = startNode, offset = startOffset, remain = len;
    // 建立一個 text-node 迭代器
    const walker = document.createTreeWalker(
      getRoot(startNode),
      NodeFilter.SHOW_TEXT,
      null
    );
    // 定位到 startNode
    walker.currentNode = startNode.nodeType === 3 ? startNode : null;
    if (startNode.nodeType !== 3){
      // 若起點不是 text node，往下找第一個 text
      let first = null;
      while (walker.nextNode()){ first = walker.currentNode; break; }
      if (!first) return null;
      node = first; offset = 0;
    } else {
      node = startNode; offset = startOffset;
    }

    while (node && remain > 0){
      const textLen = node.nodeValue.length;
      const take = Math.min(remain, textLen - offset);
      remain -= take;
      offset += take;
      if (remain === 0) return { node, offset };
      // 移動到下一個 text node
      let nxt = walker.nextNode();
      if (!nxt) break;
      node = nxt; offset = 0;
    }
    return null;
  }

  function getRoot(el){
    // 根據 .story 往上找 .story 自己，避免跨頁
    let n = el;
    while (n && !(n.classList && n.classList.contains('story'))) {
      n = n.parentNode;
    }
    return n || el;
  }

  /* 取得 [0, toOffset) 的 Range 外框矩形 */
  function rectOfRange(story, fromOffset, toOffset){
    const range = document.createRange();
    const start = nodeFromOffset(story, fromOffset);
    const end   = nodeFromOffset(story, toOffset);
    if (!start || !end) return null;
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const rect = range.getBoundingClientRect();
    return rect;
  }

  /* 預估 offset 對應的 DOM 位置（以 textContent 計）*/
  function nodeFromOffset(story, target){
    if (target <= 0){
      // story 最開頭
      const firstText = nextText(story, true);
      if (!firstText) return null;
      return { node: firstText, offset: 0 };
    }
    let walked = 0;
    const iter = document.createTreeWalker(story, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = iter.nextNode())){
      const len = n.nodeValue.length;
      if (walked + len >= target){
        return { node: n, offset: target - walked };
      }
      walked += len;
    }
    // 超過最後，就回到最後一個 text 的末端
    const lastText = prevText(story, false);
    if (!lastText) return null;
    return { node: lastText, offset: lastText.nodeValue.length };
  }

  function nextText(root, includeSelf){
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    if (!includeSelf) w.nextNode();
    return w.nextNode();
  }
  function prevText(root){
    // 走到最後一個 text
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let last = null; let n;
    while ((n = w.nextNode())) last = n;
    return last;
  }

  /* 取得目前行的起點位置（行首 node/offset；供 Tab 縮排） */
  function getLineStartPos(story){
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return {};
    const r = sel.getRangeAt(0);
    // 從 caret 向回找上一個 \n；以 textContent 計
    const text = getText(story);
    const caretIdx = caretOffsetIn(story);
    let i = caretIdx - 1;
    while (i >= 0 && text[i] !== '\n') i--;
    const lineStartOffset = Math.max(0, i + 1);
    const pos = nodeFromOffset(story, lineStartOffset);
    return { lineStartNode: pos?.node || null, lineStartOffset: pos?.offset || 0 };
  }

  /* caret 在 story 的 textContent 中的 offset（粗略） */
  function caretOffsetIn(story){
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const r = sel.getRangeAt(0).cloneRange();
    r.setStart(story, 0);
    return r.toString().length;
  }

  /* ---------- 取得下一個可編輯頁，或自動新增 ---------- */

  function ensureNextEditablePage(curDbIndex){
    // 1) 找下一個可編輯頁
    for (let i = curDbIndex + 1; i <= PAGES_DB.length; i++){
      const p = PAGES_DB[i - 1];
      if (EditorCore.isEditablePage(p)) return i;
    }
    // 2) 沒有的話：在尾端自動加「一張紙（兩頁 novel）」直到足夠
    if (window.SheetOps && typeof SheetOps.ensureTailSheets === 'function'){
      SheetOps.ensureTailSheets(1); // 加一張紙（正反兩頁）
    } else {
      // Fallback：本地直接補兩頁
      const base = PAGES_DB.length;
      const mk = (idx)=>({
        id: `local_${cryptoRandom(8)}`,
        page_index: idx,
        type: 'novel',
        image_url: null,
        content_json: { text_plain: '', text_html: '' }
      });
      PAGES_DB.push(mk(base+1), mk(base+2));
      // 重排 page_index
      for (let i=0;i<PAGES_DB.length;i++){ PAGES_DB[i].page_index = i+1; }
      persistDraft?.();
      rebuildTo?.(curDbIndex); // 只重掛 DOM，不改目前頁
    }
    return curDbIndex + 1; // 回傳新的一頁（理論上是可編輯）
  }

  function cryptoRandom(n){
    const set = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s=''; for (let i=0;i<n;i++) s += set[Math.floor(Math.random()*set.length)];
    return s;
  }

  /* ---------- 同步到 DB / LOCAL ---------- */

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

  // 導出
  window.PasteFlow = { bindTo };
})();
