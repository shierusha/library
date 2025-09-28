/* text-controls.js — Word-like B/I/U 切換 + 「只動反白」的 A+/A-
 * 需求達成：
 * - B/I/U：真的 toggle，不會越按越多標籤；清掉巢狀、合併相鄰、移除空標籤（保留 <br>）
 * - A+/A-：只動選取文字；若包含多種字級，會統一成「起點實際字級 + delta」的單層 data-fs
 * - 變動後：保留選取、更新 JSON、觸發 reflow
 *
 * 相依：
 *   EditorCore.getFocusedDbIndex()
 *   EditorCore.getStoryByDbIndex(dbIndex)
 *   EditorCore.keepSelectionAround(story, fn)
 *   EditorCore.updatePageJsonFromStory(dbIndex, story)
 *   （可選）PasteFlow.forceReflow(story)
 */
(function () {
  if (!window.EditorCore) return;

  /* ================== 小工具 ================== */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fmtEm = (v) => parseFloat(v.toFixed(2)); // 1.200000… → 1.2

  function getStoryAndRange(allowCollapsed = true) {
    const dbIndex = EditorCore.getFocusedDbIndex && EditorCore.getFocusedDbIndex();
    if (!dbIndex) return null;
    const story = EditorCore.getStoryByDbIndex && EditorCore.getStoryByDbIndex(dbIndex);
    if (!story) return null;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const rng = sel.getRangeAt(0);
    if (!story.contains(rng.startContainer)) return null;
    if (!allowCollapsed && rng.collapsed) return null;
    return { story, range: rng, dbIndex };
  }

  function afterChange(story) {
    const db = Number(story.dataset.dbIndex || '0') | 0;
    if (EditorCore.updatePageJsonFromStory) {
      EditorCore.updatePageJsonFromStory(db, story);
    }
    if (window.PasteFlow && typeof window.PasteFlow.forceReflow === 'function') {
      window.PasteFlow.forceReflow(story);
    } else {
      // fallback：讓既有 input 監聽可以吃到
      story.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /* ========== 內聯清理（B/I/U 後必跑） ========== */
  function unwrap(el) {
    const p = el.parentNode;
    if (!p) return;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
  }

  function replaceTag(el, newTag) {
    if (el.tagName === newTag.toUpperCase()) return el;
    const n = document.createElement(newTag);
    while (el.firstChild) n.appendChild(el.firstChild);
    el.parentNode.replaceChild(n, el);
    return n;
  }

  function sanitizeInlineBUI(root) {
    if (!root) return;

    // 1) 統一標籤 strong→b / em→i
    root.querySelectorAll('strong').forEach((n) => replaceTag(n, 'b'));
    root.querySelectorAll('em').forEach((n) => replaceTag(n, 'i'));

    // 2) 移除空的 b/i/u（只有空白或完全無字；保留裡面的 <br> 等結構）
    ['b', 'i', 'u'].forEach((tag) => {
      Array.from(root.querySelectorAll(tag)).forEach((el) => {
        let hasText = false;
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (tw.nextNode()) {
          if ((tw.currentNode.nodeValue || '').replace(/\u00a0/g, ' ').trim()) {
            hasText = true; break;
          }
        }
        if (!hasText) unwrap(el);
      });
    });

    // 3) 去巢狀：父子同標籤展平
    ['b', 'i', 'u'].forEach((tag) => {
      let changed = true;
      while (changed) {
        changed = false;
        root.querySelectorAll(tag).forEach((el) => {
          const p = el.parentElement;
          if (p && p.tagName.toLowerCase() === tag) {
            unwrap(el); changed = true;
          }
        });
      }
    });

    // 4) 合併相鄰同標籤（忽略純空白文字節點）
    ['b', 'i', 'u'].forEach((tag) => {
      Array.from(root.querySelectorAll(tag)).forEach((el) => {
        let next = el.nextSibling;
        while (next && next.nodeType === 3 && !(next.nodeValue || '').trim()) {
          next = next.nextSibling;
        }
        if (next && next.nodeType === 1 && next.tagName.toLowerCase() === tag) {
          while (next.firstChild) el.appendChild(next.firstChild);
          next.remove();
        }
      });
    });
  }

  /* ================== B / I / U（真正 toggle） ================== */
  function toggleCommand(cmd) {
    const ctx = getStoryAndRange(true);
    if (!ctx) return false;
    const { story } = ctx;

    return EditorCore.keepSelectionAround(story, () => {
      document.execCommand(cmd, false); // 反白/游標狀態皆可
      sanitizeInlineBUI(story);
      afterChange(story);
      return true;
    });
  }
  function onBold() { return toggleCommand('bold'); }
  function onItalic() { return toggleCommand('italic'); }
  function onUnderline() { return toggleCommand('underline'); }

  /* ================== A+ / A-（只動反白） ================== */

  // 取得某節點「相對於 story」的實際 em 字級
  function getEmAt(node, story) {
    const el = (node && node.nodeType === 1) ? node : (node ? node.parentElement : story);
    const csNode = window.getComputedStyle(el || story);
    const csStory = window.getComputedStyle(story);
    const pxNode = parseFloat(csNode.fontSize || '16') || 16;
    const pxStory = parseFloat(csStory.fontSize || '16') || 16;
    return pxNode / pxStory;
  }

  // 移除片段內所有 data-fs / style.fontSize，但保留 B/I/U 等結構
  function stripFontSizeInFragment(node) {
    if (!node) return;
    if (node.nodeType !== 1) { Array.from(node.childNodes).forEach(stripFontSizeInFragment); return; }
    const el = node;
    if (el.tagName === 'SPAN') {
      if (el.dataset && el.dataset.fs) delete el.dataset.fs;
      if (el.style && el.style.fontSize) el.style.fontSize = '';
    }
    Array.from(el.childNodes).forEach(stripFontSizeInFragment);
  }

  // 合併相鄰相同 data-fs 的 span
  function mergeAdjacentFs(span) {
    if (!span || !span.parentNode || span.tagName !== 'SPAN') return;
    const key = span.dataset.fs || (span.style.fontSize || '').replace('em', '');

    // 左
    let prev = span.previousSibling;
    while (prev && prev.nodeType === 3 && !(prev.nodeValue || '').trim()) prev = prev.previousSibling;
    if (prev && prev.nodeType === 1 && prev.tagName === 'SPAN') {
      const prevKey = prev.dataset.fs || (prev.style.fontSize || '').replace('em', '');
      if (prevKey === key) {
        while (span.firstChild) prev.appendChild(span.firstChild);
        span.replaceWith(prev);
        span = prev;
      }
    }
    // 右
    let next = span.nextSibling;
    while (next && next.nodeType === 3 && !(next.nodeValue || '').trim()) next = next.nextSibling;
    if (next && next.nodeType === 1 && next.tagName === 'SPAN') {
      const nextKey = next.dataset.fs || (next.style.fontSize || '').replace('em', '');
      if (nextKey === key) {
        while (next.firstChild) span.appendChild(next.firstChild);
        next.remove();
      }
    }
  }

  // 刪掉 story 裡「空的 data-fs span」（只剩空白或完全沒內容）；保留 <br>
  function removeEmptyDataFs(story) {
    Array.from(story.querySelectorAll('span[data-fs]')).forEach(el => {
      let hasText = false;
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (tw.nextNode()) {
        if ((tw.currentNode.nodeValue || '').replace(/\u00a0/g, ' ').trim()) { hasText = true; break; }
      }
      if (!hasText) unwrap(el);
    });
  }

  // 調整選取區字級：deltaEm 可正可負
  function adjustFont(deltaEm) {
    // 僅在「有選取」時生效；沒選取（游標）就不處理，避免誤動
    const ctx = getStoryAndRange(false);
    if (!ctx) return false;
    const { story, range } = ctx;

    return EditorCore.keepSelectionAround(story, () => {
      // 1) 以「起點實際 em」為基準
      const base = getEmAt(range.startContainer, story);
      const target = fmtEm(clamp(base + deltaEm, 0.2, 5));

      // 2) 擷取選取片段 → 清掉片段中的 data-fs / fontSize
      const frag = range.extractContents();
      stripFontSizeInFragment(frag);

      // 3) 重新包一層「單一目標字級」
      const span = document.createElement('span');
      span.dataset.fs = String(target);
      span.style.fontSize = target + 'em';
      span.appendChild(frag);
      range.insertNode(span);

      // 4) 合併左右同字級的 data-fs
      mergeAdjacentFs(span);

      // 5) 清掉 story 內空的 data-fs殼
      removeEmptyDataFs(story);

      afterChange(story);
      return true;
    });
  }

  /* ================== 綁定 ================== */
  function bindButtons() {
    const btnB  = document.getElementById('btnBold');
    const btnI  = document.getElementById('btnItalic');
    const btnU  = document.getElementById('btnUnderline');
    const btnUp = document.getElementById('btnFontUp');
    const btnDn = document.getElementById('btnFontDown');

    btnB && btnB.addEventListener('click', onBold);
    btnI && btnI.addEventListener('click', onItalic);
    btnU && btnU.addEventListener('click', onUnderline);

    // 字級步進（預設 0.1em；可依需求改）
    btnUp && btnUp.addEventListener('click', () => adjustFont(+0.1));
    btnDn && btnDn.addEventListener('click', () => adjustFont(-0.1));
  }

  function bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); onBold(); }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); onItalic(); }
      if (e.key === 'u' || e.key === 'U') { e.preventDefault(); onUnderline(); }
      if (e.key === '=' || e.key === '+') { e.preventDefault(); adjustFont(+0.1); }
      if (e.key === '-')               { e.preventDefault(); adjustFont(-0.1); }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindButtons();
    bindShortcuts();
  });
})();
