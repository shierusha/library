/* page-style.js
 * 切換頁型（一般/白置中/黑置中/圖片）— 只影響目前頁
 * - 按鈕 data-style: novel | divider-light | divider-dark | illustration
 * - 內部正規化：novel / divider_light / divider_dark / illustration
 * - 切換後：更新 PAGES_DB[].type、同步 DOM 類名、重新套用置中 sizing
 * - 圖片頁：只在本文為空時允許；雙擊可改網址；空值則還原 novel
 */
(function () {
  if (!window.EditorCore) return;

  const CLASS_ALL = ['page--novel', 'page--divider_light', 'page--divider_dark', 'page--illustration'];

  function normalize(key) {
    const k = String(key || '').trim().toLowerCase();
    if (k === 'divider-dark' || k === 'divider_dark' || k === 'dividerblack' || k === 'divider_black') return 'divider_dark';
    if (k === 'divider-light' || k === 'divider_light' || k === 'dividerwhite' || k === 'divider_white') return 'divider_light';
    if (k === 'illustration' || k === 'image') return 'illustration';
    return 'novel';
  }

  function getPageElByDbIndex(dbIndex) {
    const list = EditorCore.getDomPagesList();
    const domIdx = EditorCore.dbIndexToDomIndex(dbIndex) - 1;
    return list[domIdx] || null;
  }

  function hasTextContent(story) {
    if (!story) return false;
    // 把 <br> / 空白都視為空
    const txt = (story.textContent || '').replace(/\u00a0/g, ' ').trim();
    return txt.length > 0;
  }

  function applyDomClassForType(pageEl, type, pageObj) {
    if (!pageEl) return;

    // 清掉舊類名與背景
    CLASS_ALL.forEach(c => pageEl.classList.remove(c));
    pageEl.style.backgroundImage = '';

    if (type === 'divider_light') {
      pageEl.classList.add('page--divider_light');
    } else if (type === 'divider_dark') {
      pageEl.classList.add('page--divider_dark');
    } else if (type === 'illustration') {
      pageEl.classList.add('page--illustration');
      const url = (pageObj?.image_url || '').trim();
      if (url) pageEl.style.backgroundImage = `url("${url}")`;
    } else {
      pageEl.classList.add('page--novel');
    }
  }

  function toImagePage(dbIndex, pageEl, pageObj) {
    // 只有本文為空才允許
    const story = pageEl.querySelector('.story');
    if (hasTextContent(story)) {
      alert('此頁仍有文本，請先清空再切換為圖片頁。');
      return false;
    }
    // 詢問網址
    const url = prompt('請輸入圖片網址（留空則取消）：', pageObj.image_url || '');
    if (!url) {
      // 使用者取消或空值，還原 novel
      pageObj.type = 'novel';
      applyDomClassForType(pageEl, 'novel', pageObj);
      EditorCore.applyStorySizingFor(dbIndex);
      return true;
    }
    pageObj.type = 'illustration';
    pageObj.image_url = url.trim();
    applyDomClassForType(pageEl, 'illustration', pageObj);
    // 圖片頁不編輯：移除殘留 story（若有）
    const s = pageEl.querySelector('.story');
    if (s) s.remove();
    return true;
  }

  function toCenteredPage(dbIndex, pageEl, pageObj, which) {
    // which: 'divider_light' | 'divider_dark'
    pageObj.type = which;

    // 確保有 story 可以編輯（不清空內容）
    let story = pageEl.querySelector('.story');
    if (!story) story = EditorCore.ensureStoryOnPageEl(pageEl, dbIndex);

    applyDomClassForType(pageEl, which, pageObj);
    EditorCore.applyStorySizingFor(dbIndex);
    return true;
  }

  function toNovelPage(dbIndex, pageEl, pageObj) {
    pageObj.type = 'novel';
    let story = pageEl.querySelector('.story');
    if (!story) story = EditorCore.ensureStoryOnPageEl(pageEl, dbIndex);
    applyDomClassForType(pageEl, 'novel', pageObj);
    EditorCore.applyStorySizingFor(dbIndex);
    return true;
  }

  function applyTypeToCurrentPage(key) {
    const type = normalize(key);
    const dbIndex = EditorCore.getFocusedDbIndex();
    if (!dbIndex) return;

    const pageObj = PAGES_DB[dbIndex - 1];
    const pageEl = getPageElByDbIndex(dbIndex);
    if (!pageObj || !pageEl) return;

    if (type === 'illustration') {
      if (!toImagePage(dbIndex, pageEl, pageObj)) return;
    } else if (type === 'divider_light' || type === 'divider_dark') {
      toCenteredPage(dbIndex, pageEl, pageObj, type);
    } else {
      toNovelPage(dbIndex, pageEl, pageObj);
    }

    // 角標不可編輯 & 尺寸重算
    EditorCore.lockMeta();
    EditorCore.applyStorySizingFor(dbIndex);

    // 若有本地草稿持久化，寫一次
    try { window.persistDraft && window.persistDraft(); } catch(_) {}
  }

  /* ---- 綁定下方按鈕 ---- */
  function bindButtons() {
    document.querySelectorAll('.dock [data-style]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-style');
        applyTypeToCurrentPage(key);
      });
    });
  }

  /* ---- 圖片頁：雙擊可改網址（空值退回一般頁） ---- */
  function bindImageEditors() {
    const list = EditorCore.getDomPagesList();
    list.forEach((node, i) => {
      // 封面（DOM 1、2）跳過
      const domIndex = i + 1;
      if (domIndex <= 2) return;
      node.removeEventListener('dblclick', _onDbl, true);
      node.addEventListener('dblclick', _onDbl, true);
    });
  }
  function _onDbl(e){
    const pageEl = e.currentTarget;
    if (!pageEl.classList.contains('page--illustration')) return;

    // 找 dbIndex
    const list = EditorCore.getDomPagesList();
    const domIndex = list.indexOf(pageEl) + 1;
    const dbIndex = EditorCore.domIndexToDbIndex(domIndex);
    const pageObj = PAGES_DB[dbIndex - 1];
    if (!pageObj) return;

    const now = prompt('更換圖片網址（留空退回一般頁）：', pageObj.image_url || '');
    if (!now) {
      // 還原 novel
      toNovelPage(dbIndex, pageEl, pageObj);
      return;
    }
    pageObj.type = 'illustration';
    pageObj.image_url = now.trim();
    applyDomClassForType(pageEl, 'illustration', pageObj);
    try { window.persistDraft && window.persistDraft(); } catch(_) {}
  }

  /* ---- 初始化 ---- */
  document.addEventListener('DOMContentLoaded', () => {
    bindButtons();
    // 提供給外部在重繪後再次綁定
    window.PageStyle = window.PageStyle || {};
    window.PageStyle.bindImageEditors = bindImageEditors;
    // 首次也綁一次
    setTimeout(bindImageEditors, 0);
  });

})();
