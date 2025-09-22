/* editing-mode.js — 內頁輸入與自動分頁（穩定版）
 * 依賴 app.js 提供：
 *   - PAGES_DB, state, elBook, persistDraft()
 *   - applyLayout(), applyPageTypesNow(), renderMetaForAllPages(), updateCount(), afterLayoutRedraw()
 *   - buildPairsFromPages(), book (BookFlip)
 *
 * 功能：
 * - 只有 type==='novel' 可輸入；貼上純文字；Enter=換行；Ctrl+Z 用瀏覽器原生。
 * - 超出頁面自動向後分頁，遇圖片/不可輸入頁會跳過；頁數不夠自動插「紙」（兩頁）。
 * - 分頁為「往後推擠」：溢出的剩餘文字以「純文字」插到下一頁最前面。
 * - 翻頁/輸入後自動召回章節與頁碼角標。
 * - 左側工具：A+/A-（單層 zoom、連點直接調整 font-size）、B/I/U（僅本頁視覺；被推擠出去會轉純文字）。
 */

/* ========== 小工具 ========== */
function isWritablePage(p){ return p && p.type === 'novel'; }

function getDomPagesList(){
  const list = [];
  if (state.mode === 'spread') {
    elBook.querySelectorAll('.paper').forEach(paper=>{
      const f = paper.querySelector('.page.front');
      const b = paper.querySelector('.page.back');
      if (f) list.push(f);
      if (b) list.push(b);
    });
  } else {
    elBook.querySelectorAll('.single-page').forEach(n => list.push(n));
  }
  return list;
}
function domIndexToDbIndex(domIndex){ if (domIndex <= 2) return 0; return domIndex - 2; }
function dbIndexToDomIndex(dbIndex){ return dbIndex + 2; }

function getPageElByDbIndex(dbIndex){
  const domList = getDomPagesList();
  const domIdx0 = dbIndexToDomIndex(dbIndex) - 1;
  return domList[domIdx0] || null;
}

/* ---- editor-area 取得/建立（只在這層編輯，不動 .page 與角標） ---- */
function ensureEditorArea(pageEl){
  if (!pageEl) return null;
  let area = pageEl.querySelector(':scope > .editor-area');
  if (area) return area;

  area = document.createElement('div');
  area.className = 'editor-area';
  Object.assign(area.style, {
    boxSizing: 'border-box',
    width: '100%',
    height: '100%',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflow: 'hidden',
    display: 'block'
  });
  pageEl.insertBefore(area, pageEl.firstChild); // 放最前面，不會蓋到角標（角標 position:absolute）
  return area;
}

/* ---- 純文字 get/set 僅作用在 editor-area ---- */
function getPlainTextFromArea(area){ return (area && area.textContent) ? area.textContent : ''; }
function setPlainTextToArea(area, plain){
  if (!area) return;
  area.textContent = plain || '';
  area.style.whiteSpace = 'pre-wrap';
  area.style.wordBreak  = 'break-word';
  area.style.overflow   = 'hidden';
  area.style.display    = 'block';
}

/* ---- 存回每頁 content_json（DB 將以 text_plain / text_html 一頁一頁存） ---- */
function ensurePagePlainToJson(pageObj, plain){
  const html = (plain || '').split('\n')
    .map(line => line ? line.replace(/&/g,'&amp;').replace(/</g,'&lt;') : '')
    .join('<br>');
  pageObj.content_json = pageObj.content_json || {};
  pageObj.content_json.text_plain = plain || '';
  pageObj.content_json.text_html  = html || '';
}

/* ========== 角標召回（翻頁與輸入之後） ========== */
const recallMeta = debounce(()=>{ try{ renderMetaForAllPages(); }catch(e){} }, 0);
function debounce(fn, wait){ let t=null; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; }

function patchBookMountOnce(){
  if (!window.book || window.book.__metaPatched) return;
  const orig = window.book._mountCurrent && window.book._mountCurrent.bind(window.book);
  if (!orig) return;
  window.book._mountCurrent = function(){
    const r = orig();
    setTimeout(()=>{ try{ renderMetaForAllPages(); }catch(e){} }, 0);
    return r;
  };
  window.book.__metaPatched = true;
}

/* ========== 溢出量測（臨界一行修正） ========== */
function isOverflowBox(el){
  if (!el) return false;
  const over = el.scrollHeight > el.clientHeight;
  if (over) return true;

  const cs = getComputedStyle(el);
  let lh = parseFloat(cs.lineHeight);
  if (!isFinite(lh)) lh = parseFloat(cs.fontSize || '16') * 1.2; // 'normal' 估值
  const free = el.clientHeight - el.scrollHeight; // >= 0
  return free < lh * 0.35; // 剩餘 < 0.35 行視為溢出
}

/* 建一個隱形量測盒（和 editor-area 一樣大小樣式） */
let __measureBox = null;
function getMeasureBoxLike(area){
  if (!__measureBox){
    __measureBox = document.createElement('div');
    Object.assign(__measureBox.style, {
      position: 'absolute',
      left: '-99999px',
      top: '-99999px',
      visibility: 'hidden',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflow: 'hidden',
      display: 'block'
    });
    document.body.appendChild(__measureBox);
  }
  const cs = getComputedStyle(area);
  __measureBox.style.width     = area.clientWidth + 'px';
  __measureBox.style.height    = area.clientHeight + 'px';
  __measureBox.style.font      = cs.font;
  __measureBox.style.lineHeight= cs.lineHeight;
  __measureBox.style.padding   = cs.padding;
  __measureBox.style.writingMode = cs.writingMode;
  __measureBox.style.letterSpacing = cs.letterSpacing;
  __measureBox.style.textOrientation = cs.textOrientation;
  return __measureBox;
}

/* 依 plain 長度切割 area 的「保留 HTML」與「剩餘純文本」 */
function clipAreaByPlainLength(area, keepLen){
  const clone = area.cloneNode(true);          // 不動原本 DOM
  let remain = keepLen;
  const outFrag = document.createDocumentFragment();

  function walk(node, outParent){
    if (remain <= 0) return;
    if (node.nodeType === Node.TEXT_NODE){
      const t = node.nodeValue || '';
      if (t.length <= remain){
        outParent.appendChild(document.createTextNode(t));
        remain -= t.length;
      }else{
        outParent.appendChild(document.createTextNode(t.slice(0, remain));
        remain = 0;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE){
      const shell = node.cloneNode(false); // 不帶子孫
      outParent.appendChild(shell);
      const children = node.childNodes;
      for (let i=0; i<children.length && remain>0; i++){
        walk(children[i], shell);
      }
      if (!shell.textContent) outParent.removeChild(shell);
    }
  }

  for (const child of clone.childNodes){
    if (remain <= 0) break;
    walk(child, outFrag);
  }

  area.innerHTML = '';
  area.appendChild(outFrag);

  const fullPlain = clone.textContent || '';
  const keptPlain = fullPlain.slice(0, keepLen);
  const restPlain = fullPlain.slice(keepLen);
  return { keptPlain, restPlain };
}

/* 對有標記的 editor-area 做「能塞多少字」→ 回傳（保留到本頁、剩餘） */
function fitMarkupArea(area){
  const fullPlain = getPlainTextFromArea(area).replace(/\n+$/,'');
  const measure = getMeasureBoxLike(area);

  // 二分出最多可塞的純文字數
  let lo = 0, hi = fullPlain.length, fit = 0;
  while (lo <= hi){
    const mid = (lo + hi) >> 1;
    measure.textContent = fullPlain.slice(0, mid);
    if (!isOverflowBox(measure)) { fit = mid; lo = mid + 1; }
    else { hi = mid - 1; }
  }

  // 按純文字數切回「保留 HTML」與「剩餘純文字」
  let { keptPlain, restPlain } = clipAreaByPlainLength(area, fit);

  // 末行回退（臨界）：若還是擠線，退掉最後一行
  measure.textContent = keptPlain;
  if (isOverflowBox(measure)){
    const lastNL = keptPlain.lastIndexOf('\n');
    keptPlain = (lastNL > -1) ? keptPlain.slice(0, lastNL) : keptPlain.slice(0, Math.max(0, keptPlain.length-1));
    keptPlain = keptPlain.replace(/\n+$/,'');
    const again = clipAreaByPlainLength(area, keptPlain.length);
    keptPlain = again.keptPlain;
    restPlain = again.restPlain + restPlain; // 退掉的那一行一起算到剩餘
  }
  return { keep: keptPlain, rest: restPlain };
}

/* ========== 找下一個可輸入頁 ========== */
function findNextWritableDbIndex(fromDbIndex){
  for (let i = fromDbIndex + 1; i <= PAGES_DB.length; i++){
    if (isWritablePage(PAGES_DB[i-1])) return i;
  }
  return 0;
}

/* ========== 插入紙張（兩頁 novel 空白） ========== */
function genLocalId(){ return 'local_' + Math.random().toString(36).slice(2, 9); }

function insertBlankSheetAfterDbIndex(dbIndex){
  const insertAt = dbIndex + 1; // 從下一頁開始插
  const newFront = { id: genLocalId(), page_index: insertAt,   type: 'novel', image_url: null, content_json: { text_plain: '', text_html: '' } };
  const newBack  = { id: genLocalId(), page_index: insertAt+1, type: 'novel', image_url: null, content_json: { text_plain: '', text_html: '' } };

  for (const p of PAGES_DB){ if (p.page_index >= insertAt) p.page_index += 2; }
  PAGES_DB.push(newFront, newBack);
  PAGES_DB.sort((a,b)=>a.page_index - b.page_index);

  safeRebuildAndRedraw();
  return insertAt;
}

/* ========== 重建 + 重繪 ========== */
function safeRebuildAndRedraw(){
  try{
    if (typeof buildPairsFromPages === 'function' && window.BookFlip && window.book) {
      const curDomIdx = (window.book._cursorPage || 0) + 1;
      const curDbIdx = Math.max(0, domIndexToDbIndex(curDomIdx));
      const pairs = buildPairsFromPages();
      const opts = {
        mode: state.mode,
        direction: state.direction,
        speed: 450,
        singleSpeed: 300,
        perspective: 2000,
        data: { pairs },
        startPageIndex: Math.max(0, dbIndexToDomIndex(curDbIdx) - 1),
        coverPapers: 1
      };
      window.book = new BookFlip('#bookCanvas', opts);
      patchBookMountOnce();
    }
    applyLayout();
    applyPageTypesNow();
    renderMetaForAllPages();
    updateCount();
  }catch(e){
    console.warn('safeRebuildAndRedraw failed:', e);
  }
}

/* ========== 編輯殼（用 editor-area；不動 .page 直接子元素） ========== */
function ensureEditableShell(dbIndex){
  const pageEl = getPageElByDbIndex(dbIndex);
  if (!pageEl) return null;

  const p = PAGES_DB[dbIndex - 1];
  if (!isWritablePage(p)) return null;

  const area = ensureEditorArea(pageEl);
  if (!area) return null;

  pageEl.setAttribute('data-editor', '1');
  area.setAttribute('contenteditable', 'true');

  bindInputEvents(area, dbIndex);

  // 初始化：以 text_plain 或 text_html → 純文字呈現（不帶樣式）
  const pj = p.content_json || {};
  const basePlain = pj.text_plain || (()=>{ const tmp=document.createElement('div'); tmp.innerHTML = pj.text_html || ''; return tmp.textContent || ''; })();
  setPlainTextToArea(area, basePlain);
  return area;
}

/* ========== 內容向後分流（不回捲；往後推擠；推擠為純文字） ========== */
function flowOverflowFrom(dbIndex){
  let curIdx = dbIndex;

  while (curIdx > 0 && curIdx <= PAGES_DB.length){
    const curPage = PAGES_DB[curIdx - 1];

    // 不可寫：跳到下一個可寫頁或插紙
    if (!isWritablePage(curPage)) {
      let nextWritable = findNextWritableDbIndex(curIdx - 1);
      if (!nextWritable) nextWritable = insertBlankSheetAfterDbIndex(PAGES_DB.length);
      curIdx = nextWritable;
      continue;
    }

    const area = ensureEditableShell(curIdx);
    if (!area) { curIdx++; continue; }

    // 讓本頁在「保留樣式」的前提下，切出剩餘純文字
    const { keep, rest } = fitMarkupArea(area);
    ensurePagePlainToJson(curPage, keep);

    if (!rest || rest.length === 0){
      recallMeta();
      break;
    }

    // 還有剩：下一個可寫頁，若沒有就插紙
    let nextIdx = findNextWritableDbIndex(curIdx);
    if (!nextIdx){
      const anchor = (curIdx % 2 === 0) ? curIdx : curIdx + 1;
      nextIdx = insertBlankSheetAfterDbIndex(anchor);
    }

    const nextArea = ensureEditableShell(nextIdx);
    const oldPlain = getPlainTextFromArea(nextArea);

    // ★ 往後推擠：剩餘內容以「純文字」放在下一頁最前面
    const merged = rest + oldPlain;
    setPlainTextToArea(nextArea, merged);
    ensurePagePlainToJson(PAGES_DB[nextIdx-1], merged);

    curIdx = nextIdx; // 繼續檢查下一頁是否溢出
  }

  persistDraft();
  recallMeta();
}

/* ========== 事件處理：paste / input / Enter ========== */
function bindInputEvents(areaEl, dbIndex){

  // 只允許純文字貼上（保留 \n）
  areaEl.addEventListener('paste', (e)=>{
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
    if (!t) return;
    document.execCommand('insertText', false, t);  // 保留瀏覽器 undo stack
    setTimeout(()=>{ flowOverflowFrom(dbIndex); }, 0);
  });

  // Enter -> 插入 \n（不產生 <div>/<p>）
  areaEl.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter'){
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
      setTimeout(()=>{ flowOverflowFrom(dbIndex); }, 0);
    }
    // Ctrl+Z：交給瀏覽器原生
  });

  // 任意輸入：更新本頁；若溢出才向後分流；不回捲
  areaEl.addEventListener('input', ()=>{
    const curPage = PAGES_DB[dbIndex - 1];
    ensurePagePlainToJson(curPage, getPlainTextFromArea(areaEl));
    persistDraft();
    setTimeout(()=>{
      const measure = getMeasureBoxLike(areaEl);
      measure.textContent = getPlainTextFromArea(areaEl);
      if (isOverflowBox(measure)) flowOverflowFrom(dbIndex);
      else recallMeta();
    }, 0);
  });
}

/* ========== 插入/刪除紙張（配合 dock 按鈕） ========== */
const btnInsert = document.getElementById('btnInsertPage');
const btnDelete = document.getElementById('btnDeleteBlank');

function getFocusedDbIndex(){
  const activeEl = document.activeElement;
  if (activeEl && activeEl.classList && activeEl.classList.contains('editor-area')){
    const domList = getDomPagesList();
    const pageEl = activeEl.parentElement;
    const idx0 = domList.indexOf(pageEl);
    const domIndex = idx0 >= 0 ? idx0 + 1 : 0;
    return domIndexToDbIndex(domIndex);
  }
  return 0;
}

btnInsert?.addEventListener('click', ()=>{
  let dbIndex = getFocusedDbIndex();
  if (!dbIndex) dbIndex = 1;
  const thisSheetStart = (dbIndex % 2 === 0) ? dbIndex - 1 : dbIndex;
  const afterThisSheet = thisSheetStart + 1;
  insertBlankSheetAfterDbIndex(afterThisSheet);
  persistDraft();
  setTimeout(()=>{ afterLayoutRedraw(); mountEditors(); }, 0);
});

btnDelete?.addEventListener('click', ()=>{
  const dbIndex = getFocusedDbIndex();
  if (!dbIndex){ alert('請先點到要刪除的紙張其中一頁（封面不行）。'); return; }

  const sheetStart = (dbIndex % 2 === 0) ? dbIndex - 1 : dbIndex;
  const a = PAGES_DB[sheetStart - 1];
  const b = PAGES_DB[sheetStart];

  function isBlankNovel(p){
    if (!p || p.type !== 'novel') return false;
    const t = (p.content_json && p.content_json.text_plain) || '';
    return t.length === 0;
  }
  if (!isBlankNovel(a) || !isBlankNovel(b)){
    alert('僅能刪除「正反兩面皆空白」的紙張。');
    return;
  }

  PAGES_DB = PAGES_DB.filter(x => x !== a && x !== b);
  for (const p of PAGES_DB){ if (p.page_index > sheetStart+1) p.page_index -= 2; }
  PAGES_DB.sort((x,y)=>x.page_index - y.page_index);

  safeRebuildAndRedraw();
  persistDraft();
  setTimeout(()=>{ afterLayoutRedraw(); mountEditors(); }, 0);
});

/* ========== 左側工具：A+/A-（單層 zoom）、B/I/U ========== */
const btnFontUp    = document.getElementById('btnFontUp');
const btnFontDown  = document.getElementById('btnFontDown');
const btnBold      = document.getElementById('btnBold');
const btnItalic    = document.getElementById('btnItalic');
const btnUnderline = document.getElementById('btnUnderline');

function selectionInEditor(){
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const anc = range.commonAncestorContainer.nodeType === 1
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!anc) return null;
  return anc.closest && anc.closest('.editor-area') ? sel : null;
}

const MIN_ZOOM = 0.65;
const MAX_ZOOM = 1.6;
const STEP_UP   = 1.15;
const STEP_DOWN = 0.87;

function getZoomWrapperForSelection(sel){
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const sc = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  const ec = range.endContainer.nodeType   === 1 ? range.endContainer   : range.endContainer.parentElement;
  if (!sc || !ec) return null;
  const a = sc.closest && sc.closest('.editor-area [data-fx-zoom]');
  const b = ec.closest && ec.closest('.editor-area [data-fx-zoom]');
  return (a && a === b) ? a : null;
}

function adjustZoomOn(el, factor){
  let cur = parseFloat(el.dataset.fxZoom || '1');
  if (!isFinite(cur) || cur <= 0) cur = 1;
  cur *= factor;
  if (cur < MIN_ZOOM) cur = MIN_ZOOM;
  if (cur > MAX_ZOOM) cur = MAX_ZOOM;
  el.dataset.fxZoom = String(cur);
  el.style.fontSize = cur + 'em';
}

function wrapSelectionWithZoom(sel){
  const range = sel.getRangeAt(0);
  const frag = range.extractContents();             // 保留粗/斜/底線等原有子節點
  const span = document.createElement('span');
  span.setAttribute('data-fx-zoom','1');
  span.style.fontSize = '1em';
  span.appendChild(frag);
  range.insertNode(span);
  sel.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(span);
  sel.addRange(r);
  return span;
}

function applySizeAdjustNoStack(delta){
  const sel = selectionInEditor(); if (!sel) return;
  if (sel.isCollapsed) return; // 要有選取
  const factor = delta > 0 ? STEP_UP : STEP_DOWN;

  let target = getZoomWrapperForSelection(sel);
  if (!target) target = wrapSelectionWithZoom(sel);
  adjustZoomOn(target, factor);

  // 調整字級可能造成溢出 → 讓自動分頁繼續生效
  setTimeout(()=>{
    const dbIndex = getFocusedDbIndex && getFocusedDbIndex();
    if (dbIndex) flowOverflowFrom(dbIndex);
  }, 0);
}

function applyExec(cmd){
  const sel = selectionInEditor(); if (!sel) return;
  document.execCommand('styleWithCSS', false, true);
  document.execCommand(cmd, false, null);
}

btnFontUp   ?.addEventListener('click', ()=> applySizeAdjustNoStack(+1));
btnFontDown ?.addEventListener('click', ()=> applySizeAdjustNoStack(-1));
btnBold     ?.addEventListener('click', ()=> applyExec('bold'));
btnItalic   ?.addEventListener('click', ()=> applyExec('italic'));
btnUnderline?.addEventListener('click', ()=> applyExec('underline'));

/* ========== 啟動 ========== */
function mountEditors(){
  for (let i=1; i<=PAGES_DB.length; i++){
    if (!isWritablePage(PAGES_DB[i-1])) continue;
    ensureEditableShell(i);
  }
  recallMeta();
}
(function start(){
  document.addEventListener('DOMContentLoaded', ()=>{
    setTimeout(()=>{
      patchBookMountOnce();
      mountEditors();
    }, 0);
  });
  window.__mountEditors = mountEditors; // 外部重繪後可再掛
})();
