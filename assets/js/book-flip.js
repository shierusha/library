/*!
 * BookFlip v1.0.0
 * 支援：左右開（ltr/rtl）、單頁/雙頁模式切換、滑動翻頁（單頁）
 * 必要 CSS 由本檔自動注入；外觀可改樣式欄位見底部「自訂樣式表」
 * by you + assistant
 */
(function (global) {
  const STYLE_ID = 'bookflip-core-style-v1';

  // 一次性注入必要且不應移除/覆蓋的 CSS
  function injectCoreCSS() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
/* ===== 不可移除的核心樣式（由 JS 注入）===== */

/* 防止選字影響手感 */
.book, .book * { user-select: none; -webkit-user-select: none; }

/* 雙頁（spread）必要骨架 */
.paper {
  width:100%; height:100%;
  position:absolute; top:0; left:0;
  transform-style: preserve-3d;
}
.page {
  width:100%; height:100%;
  position:absolute; top:0; left:0;
  display:flex; align-items:center; justify-content:center;
  backface-visibility:hidden; -webkit-backface-visibility:hidden;
  border: 1px solid #ddd; /* ← 可覆蓋，見自訂樣式表 .page 邊框 */
}
.back { transform: rotateY(180deg); }

/* 左開/右開的旋轉軸（具名方向 class） */
.paper.dir-ltr { transform-origin: left center; }
.paper.dir-rtl { transform-origin: right center; }

/* 單頁（single）必要骨架 */
.single-stage {
  width:100%; height:100%;
  position:relative; overflow:hidden;
}
.single-page {
  width:100%; height:100%;
  position:absolute; top:0; left:0;
  display:flex; align-items:center; justify-content:center;
  border: 1px solid #ddd; /* ← 可覆蓋，見自訂樣式表 .single-page 邊框 */
  will-change: transform;
}
`;
    document.head.appendChild(style);
  }

  // ---------------- 工具 ----------------
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  // ============ 雙頁控制器：旋轉翻頁（沿用你的穩定邏輯） ============
  class BookFlipSpread {
    constructor(el, { direction='ltr', speed=500, perspective=2000, startPageIndex=0 } = {}) {
      this.el = el;
      this.papers = Array.from(el.querySelectorAll('.paper'));
      this.current = clamp(Math.floor(startPageIndex/2), 0, this.papers.length); // 以「紙」為單位
      this.isAnimating = false;
      this.direction = direction;
      this.speed = speed;
      this.perspective = perspective;

      this.applyDirection();
      this.applyPerspective();
      this.update();
    }
    applyDirection(){
      this.papers.forEach(p => {
        p.classList.remove('dir-ltr','dir-rtl');
        p.classList.add(this.direction==='rtl' ? 'dir-rtl' : 'dir-ltr');
      });
    }
    applyPerspective(){
      this.el.style.perspective = this.perspective + 'px';
    }
    flipTransform(isFlipped){
      if (!isFlipped) return 'rotateY(0deg)';
      return (this.direction==='rtl') ? 'rotateY(180deg)' : 'rotateY(-180deg)';
    }
    update(){
      this.papers.forEach((paper, idx) => {
        paper.style.transition = `transform ${this.speed}ms ease-in-out`;
        const flipped = idx < this.current;
        paper.style.transform = this.flipTransform(flipped);
        // 疊層：已翻的往下堆；未翻的在上
        paper.style.zIndex = flipped ? idx : (this.papers.length - idx);
      });
    }
    next(){
      if (this.isAnimating || this.current >= this.papers.length) return;
      this.isAnimating = true;
      const paper = this.papers[this.current];
      paper.style.zIndex = this.papers.length + 1; // 動畫中浮到最上
      paper.style.transition = `transform ${this.speed}ms ease-in-out`;
      paper.style.transform = this.flipTransform(true);
      paper.addEventListener('transitionend', () => {
        this.current++;
        this.update();
        this.isAnimating = false;
      }, { once:true });
    }
    prev(){
      if (this.isAnimating || this.current <= 0) return;
      this.isAnimating = true;
      this.current--;
      const paper = this.papers[this.current];
      paper.style.zIndex = this.papers.length + 1; // 動畫中浮到最上
      paper.style.transition = `transform ${this.speed}ms ease-in-out`;
      paper.style.transform = this.flipTransform(false);
      paper.addEventListener('transitionend', () => {
        this.update();
        this.isAnimating = false;
      }, { once:true });
    }
    destroy(){ /* 無需特別清理 */ }
  }

  // ============ 單頁控制器：滑動翻頁 ============
  class SinglePager {
    constructor(el, { speed=300, perspective=0, startPageIndex=0 } = {}){
      this.el = el;
      this.stage = el.querySelector('.single-stage');
      this.pages = Array.from(el.querySelectorAll('.single-page'));
      this.current = clamp(startPageIndex, 0, this.pages.length-1);
      this.isAnimating = false;
      this.speed = speed;
      this.perspective = perspective;
      if (this.perspective) this.el.style.perspective = this.perspective + 'px';
      this.setup();
      this.bindSwipe();
    }
    setup(){
      this.pages.forEach((pg, i) => {
        pg.style.transition = `transform ${this.speed}ms ease`;
        pg.style.transform =
          (i < this.current) ? 'translateX(-100%)' :
          (i === this.current) ? 'translateX(0)' : 'translateX(100%)';
      });
    }
    to(idx){
      if (this.isAnimating) return;
      if (idx < 0 || idx >= this.pages.length || idx === this.current) return;
      this.isAnimating = true;

      const cur = this.pages[this.current];
      const next = this.pages[idx];
      const dir = (idx > this.current) ? -1 : 1; // -1 往左，+1 往右
      // 預置 next 在進場邊
      next.style.transform = `translateX(${dir*-100}%)`;
      requestAnimationFrame(() => {
        cur.style.transform  = `translateX(${dir*100}%)`; // 出場
        next.style.transform = `translateX(0)`;           // 進場
      });
      const done = () => {
        cur.removeEventListener('transitionend', done);
        this.current = idx;
        this.isAnimating = false;
      };
      cur.addEventListener('transitionend', done, { once:true });
    }
    next(){ this.to(this.current + 1); }
    prev(){ this.to(this.current - 1); }
    bindSwipe(){
      let startX = 0;
      this.el.addEventListener('touchstart', e => {
        if (!e.touches[0]) return;
        startX = e.touches[0].clientX;
      }, { passive:true });
      this.el.addEventListener('touchend', e => {
        const endX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0;
        const d = endX - startX;
        if (d > 50) this.prev();
        if (d < -50) this.next();
      }, { passive:true });
    }
    destroy(){ /* 無需特別清理 */ }
  }

  // ============ 主插件：BookFlip ============
  class BookFlip {
    /**
     * @param {string|Element} elSelector 容器（.book）
     * @param {Object} options
     *   - mode: 'spread' | 'single'  預設 'spread'
     *   - direction: 'ltr' | 'rtl'   只影響 spread
     *   - speed: number               spread 速度 (ms)
     *   - singleSpeed: number         single 速度 (ms)
     *   - perspective: number         透視 (px)
     *   - data: { pairs?: Array<{frontHTML, backHTML}>, pages?: string[] }
     *           若不提供 data，則沿用現有 DOM 結構
     *   - startPageIndex: number      以「頁」為單位的起始索引（單/雙會自動對齊）
     */
    constructor(elSelector, options = {}) {
      injectCoreCSS();

      this.el = (typeof elSelector === 'string') ? document.querySelector(elSelector) : elSelector;
      this.opts = Object.assign({
        mode: 'spread',
        direction: 'ltr',
        speed: 500,
        singleSpeed: 300,
        perspective: 2000,
        data: null,
        startPageIndex: 0
      }, options);

      // 內部狀態
      this._controller = null;       // 當前模式的控制器
      this._cursorPage = this.opts.startPageIndex; // 用「頁」作為全域游標
      this._pairs = [];              // [{frontHTML, backHTML}, ...]
      this._flatPages = [];          // [html, html, ...]
      this._buildFromDataOrDom();
      this._mountCurrent();
    }

    // 允許外部後續換資料（例如 Supabase 重抓）
    loadData({ pairs = null, pages = null } = {}) {
      if (pairs) this._pairs = pairs.slice();
      if (pages) this._flatPages = pages.slice();
      if (!this._flatPages.length && this._pairs.length) {
        this._flatPages = this._pairs.flatMap(p => [p.frontHTML ?? '', p.backHTML ?? '']);
      }
      this._mountCurrent();
    }

    setMode(mode) {
      if (mode !== 'spread' && mode !== 'single') return;
      // 換模式前，把「頁」游標對齊
      if (this.opts.mode === 'spread' && mode === 'single') {
        // 紙 -> 頁
        // 若 controller 有 current（紙索引），對齊到對應左頁
        if (this._controller && typeof this._controller.current === 'number') {
          this._cursorPage = clamp(this._controller.current * 2, 0, this._flatPages.length - 1);
        }
      } else if (this.opts.mode === 'single' && mode === 'spread') {
        // 頁 -> 紙（向下取偶數頁）
        if (this._controller && typeof this._controller.current === 'number') {
          this._cursorPage = Math.floor(this._controller.current / 2) * 2;
        }
      }
      this.opts.mode = mode;
      this._mountCurrent();
    }

    setDirection(dir) {
      if (dir !== 'ltr' && dir !== 'rtl') return;
      this.opts.direction = dir;
      if (this.opts.mode === 'spread') {
        // 重新掛載 spread 以套用方向 class 與 transform
        this._mountCurrent();
      }
    }

    next() {
      if (!this._controller) return;
      this._controller.next();
      // 嘗試同步頁游標（非必要但方便）
      if (this.opts.mode === 'spread') {
        const paperNext = clamp((this._controller.current + 1) * 2, 0, this._flatPages.length - 1);
        this._cursorPage = paperNext;
      } else {
        this._cursorPage = clamp(this._controller.current + 1, 0, this._flatPages.length - 1);
      }
    }

    prev() {
      if (!this._controller) return;
      this._controller.prev();
      if (this.opts.mode === 'spread') {
        const paperPrev = clamp((this._controller.current - 1) * 2, 0, this._flatPages.length - 1);
        this._cursorPage = paperPrev;
      } else {
        this._cursorPage = clamp(this._controller.current - 1, 0, this._flatPages.length - 1);
      }
    }

    destroy() {
      if (this._controller && this._controller.destroy) this._controller.destroy();
      this._controller = null;
      // 不移除 core CSS，避免多本書共用
    }

    // ----------------- 私有：建 DOM -----------------
    _buildFromDataOrDom() {
      if (this.opts.data && (this.opts.data.pairs || this.opts.data.pages)) {
        // 直接用 data 建
        if (this.opts.data.pairs) {
          this._pairs = this.opts.data.pairs.slice();
          this._flatPages = this._pairs.flatMap(p => [p.frontHTML ?? '', p.backHTML ?? '']);
        } else {
          this._flatPages = this.opts.data.pages.slice();
          // 把扁平頁組回 pairs（單純兩兩成對）
          this._pairs = [];
          for (let i = 0; i < this._flatPages.length; i += 2) {
            this._pairs.push({
              frontHTML: this._flatPages[i] ?? '',
              backHTML: this._flatPages[i+1] ?? ''
            });
          }
        }
      } else {
        // 用現有 DOM 推導
        const papers = Array.from(this.el.querySelectorAll('.paper'));
        if (papers.length) {
          this._pairs = papers.map(p => ({
            frontHTML: (p.querySelector('.front') || {}).innerHTML || '',
            backHTML:  (p.querySelector('.back')  || {}).innerHTML || ''
          }));
          this._flatPages = this._pairs.flatMap(p => [p.frontHTML, p.backHTML]);
        } else {
          // 沒內容就空本
          this._pairs = [];
          this._flatPages = [];
        }
      }
    }

    _mountCurrent() {
      // 清空容器
      this.el.innerHTML = '';
      // 根據模式渲染
      if (this.opts.mode === 'spread') {
        // 以 pairs 渲染
        const html = this._pairs.map(p => `
          <div class="paper">
            <div class="page front">${p.frontHTML ?? ''}</div>
            <div class="page back">${p.backHTML ?? ''}</div>
          </div>
        `).join('');
        this.el.innerHTML = html;
        // 起始定位：以 cursorPage 對齊到對應 paper
        const startPaper = clamp(Math.floor(this._cursorPage / 2), 0, this._pairs.length);
        this._controller = new BookFlipSpread(this.el, {
          direction: this.opts.direction,
          speed: this.opts.speed,
          perspective: this.opts.perspective,
          startPageIndex: startPaper * 2
        });
      } else {
        // 以 flatPages 渲染
        const html = `
          <div class="single-stage">
            ${this._flatPages.map(pg => `<div class="single-page">${pg ?? ''}</div>`).join('')}
          </div>
        `;
        this.el.innerHTML = html;
        this._controller = new SinglePager(this.el, {
          speed: this.opts.singleSpeed,
          perspective: 0,
          startPageIndex: clamp(this._cursorPage, 0, this._flatPages.length - 1)
        });
      }
    }
  }

  // 導出 UMD風格
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = BookFlip;
  } else {
    global.BookFlip = BookFlip;
  }
})(typeof window !== 'undefined' ? window : this);
