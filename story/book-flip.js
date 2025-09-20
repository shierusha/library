/*!
 * BookFlip v1.0.2 (no CSS injection)
 * 支援：左右開（ltr/rtl）、單頁/雙頁（single/spread）、手勢滑動（單頁）
 * 新增：coverPapers（保留最前 N 張 .paper，不覆蓋你的封面）
 * 注意：本檔不再注入任何 CSS，請在 HTML 提供必要 CSS。
 */
(function (global) {
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  /* ================= 雙頁控制器（旋轉翻頁） ================= */
  class BookFlipSpread {
    constructor(el, { direction = 'ltr', speed = 500, perspective = 2000, startPageIndex = 0 } = {}) {
      this.el = el;
      this.papers = Array.from(el.querySelectorAll('.paper'));
      this.current = clamp(Math.floor(startPageIndex / 2), 0, this.papers.length); // 以「紙」為單位
      this.isAnimating = false;
      this.direction = direction;
      this.speed = speed;
      this.perspective = perspective;

      this.applyDirection();
      this.applyPerspective();
      this.update();
    }

    applyDirection() {
      this.papers.forEach(p => {
        p.classList.remove('dir-ltr', 'dir-rtl');
        p.classList.add(this.direction === 'rtl' ? 'dir-rtl' : 'dir-ltr');
      });
    }

    applyPerspective() { this.el.style.perspective = this.perspective + 'px'; }

    flipTransform(isFlipped) {
      if (!isFlipped) return 'rotateY(0deg)';
      return (this.direction === 'rtl') ? 'rotateY(180deg)' : 'rotateY(-180deg)';
    }

    update() {
      this.papers.forEach((paper, idx) => {
        paper.style.transition = `transform ${this.speed}ms ease-in-out`;
        const flipped = idx < this.current;
        paper.style.transform = this.flipTransform(flipped);
        paper.style.zIndex = flipped ? idx : (this.papers.length - idx);
      });
    }

    next() {
      if (this.isAnimating || this.current >= this.papers.length) return;
      this.isAnimating = true;
      const paper = this.papers[this.current];
      paper.style.zIndex = this.papers.length + 1;
      paper.style.transition = `transform ${this.speed}ms ease-in-out`;
      paper.style.transform = this.flipTransform(true);
      paper.addEventListener('transitionend', () => {
        this.current++;
        this.update();
        this.isAnimating = false;
      }, { once: true });
    }

    prev() {
      if (this.isAnimating || this.current <= 0) return;
      this.isAnimating = true;
      this.current--;
      const paper = this.papers[this.current];
      paper.style.zIndex = this.papers.length + 1;
      paper.style.transition = `transform ${this.speed}ms ease-in-out`;
      paper.style.transform = this.flipTransform(false);
      paper.addEventListener('transitionend', () => {
        this.update();
        this.isAnimating = false;
      }, { once: true });
    }

    destroy() {}
  }

  /* ================= 單頁控制器（滑動翻頁） ================= */
  class SinglePager {
    constructor(el, { speed = 300, perspective = 0, startPageIndex = 0 } = {}) {
      this.el = el;
      this.stage = el.querySelector('.single-stage');
      this.pages = Array.from(el.querySelectorAll('.single-page'));
      this.current = clamp(startPageIndex, 0, this.pages.length - 1);
      this.isAnimating = false;
      this.speed = speed;
      this.perspective = perspective;

      if (this.perspective) this.el.style.perspective = this.perspective + 'px';
      this.setup();
      this.bindSwipe();
    }

    setup() {
      this.pages.forEach((pg, i) => {
        pg.style.transition = `transform ${this.speed}ms ease`;
        pg.style.transform =
          (i < this.current) ? 'translateX(-100%)' :
          (i === this.current) ? 'translateX(0)' :
          'translateX(100%)';
      });
    }

    to(idx) {
      if (this.isAnimating) return;
      if (idx < 0 || idx >= this.pages.length || idx === this.current) return;
      this.isAnimating = true;

      const cur = this.pages[this.current];
      const nxt = this.pages[idx];
      const dir = (idx > this.current) ? -1 : 1; // -1 往左，+1 往右

      nxt.style.transform = `translateX(${dir * -100}%)`;
      requestAnimationFrame(() => {
        cur.style.transform = `translateX(${dir * 100}%)`;
        nxt.style.transform = 'translateX(0)';
      });

      const done = () => {
        cur.removeEventListener('transitionend', done);
        this.current = idx;
        this.isAnimating = false;
      };
      cur.addEventListener('transitionend', done, { once: true });
    }

    next() { this.to(this.current + 1); }
    prev() { this.to(this.current - 1); }

    bindSwipe() {
      let startX = 0;
      this.el.addEventListener('touchstart', e => {
        if (!e.touches[0]) return; startX = e.touches[0].clientX;
      }, { passive: true });
      this.el.addEventListener('touchend', e => {
        const t = e.changedTouches && e.changedTouches[0]; if (!t) return;
        const d = t.clientX - startX;
        if (d > 50) this.prev();
        if (d < -50) this.next();
      }, { passive: true });
    }

    destroy() {}
  }

  /* ================= 主插件 ================= */
  class BookFlip {
    /**
     * @param {string|Element} elSelector  容器（.book）
     * @param {Object} options
     *   - mode: 'spread' | 'single'
     *   - direction: 'ltr' | 'rtl'
     *   - speed, singleSpeed, perspective
     *   - data: { pairs?: [{frontHTML, backHTML}], pages?: string[] }
     *   - startPageIndex: number（以「頁」為單位）
     *   - coverPapers: number（最前保留幾張 .paper）
     */
    constructor(elSelector, options = {}) {
      this.el = (typeof elSelector === 'string')
        ? document.querySelector(elSelector)
        : elSelector;

      this.opts = Object.assign({
        mode: 'spread',
        direction: 'ltr',
        speed: 500,
        singleSpeed: 300,
        perspective: 2000,
        data: null,
        startPageIndex: 0,
        coverPapers: 0
      }, options);

      this._controller = null;
      this._cursorPage = this.opts.startPageIndex;
      this._pairs = [];
      this._flatPages = [];

      // 保留封面 .paper
      const existingPapers = Array.from(this.el.querySelectorAll('.paper'));
      this._keepCount = Math.max(0, Math.min(this.opts.coverPapers, existingPapers.length));
      this._keptPapersHTML = existingPapers.slice(0, this._keepCount).map(p => p.outerHTML).join('');
      this._keptFlatPages = [];
      if (this._keepCount > 0) {
        for (let i = 0; i < this._keepCount; i++) {
          const p = existingPapers[i];
          const frontHTML = (p.querySelector('.front') || {}).innerHTML || '';
          const backHTML  = (p.querySelector('.back')  || {}).innerHTML || '';
          this._keptFlatPages.push(frontHTML, backHTML);
        }
      }

      this._buildFromDataOrDom();
      this._mountCurrent();
    }

    next() { this._controller && this._controller.next(); }
    prev() { this._controller && this._controller.prev(); }

    setMode(mode) {
      if (mode !== 'spread' && mode !== 'single') return;
      if (this.opts.mode === 'spread' && mode === 'single') {
        if (this._controller && typeof this._controller.current === 'number') {
          this._cursorPage = clamp(this._controller.current * 2, 0, this.totalPages() - 1);
        }
      } else if (this.opts.mode === 'single' && mode === 'spread') {
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
      if (this.opts.mode === 'spread') this._mountCurrent();
    }

    loadData({ pairs = null, pages = null } = {}) {
      if (pairs) this._pairs = pairs.slice();
      if (pages) this._flatPages = pages.slice();
      if (!this._flatPages.length && this._pairs.length) {
        this._flatPages = this._pairs.flatMap(p => [p.frontHTML ?? '', p.backHTML ?? '']);
      }
      this._mountCurrent();
    }

    destroy() { if (this._controller?.destroy) this._controller.destroy(); this._controller = null; }
    totalPages() { return this._keptFlatPages.length + this._pairs.length * 2; }

    _buildFromDataOrDom() {
      if (this.opts.data && (this.opts.data.pairs || this.opts.data.pages)) {
        if (this.opts.data.pairs) {
          this._pairs = this.opts.data.pairs.slice();
          this._flatPages = this._pairs.flatMap(p => [p.frontHTML ?? '', p.backHTML ?? '']);
        } else {
          this._flatPages = this.opts.data.pages.slice();
          this._pairs = [];
          for (let i = 0; i < this._flatPages.length; i += 2) {
            this._pairs.push({
              frontHTML: this._flatPages[i] ?? '',
              backHTML:  this._flatPages[i + 1] ?? ''
            });
          }
        }
      } else {
        const allPapers = Array.from(this.el.querySelectorAll('.paper'));
        const rest = allPapers.slice(this._keepCount);
        if (rest.length) {
          const pairs = rest.map(p => ({
            frontHTML: (p.querySelector('.front') || {}).innerHTML || '',
            backHTML:  (p.querySelector('.back')  || {}).innerHTML || ''
          }));
          this._pairs = pairs;
          this._flatPages = pairs.flatMap(p => [p.frontHTML, p.backHTML]);
        } else {
          this._pairs = [];
          this._flatPages = [];
        }
      }
    }

    _mountCurrent() {
      const totalPages = this.totalPages();
      this._cursorPage = clamp(this._cursorPage, 0, Math.max(0, totalPages - 1));

      if (this.opts.mode === 'spread') {
        const htmlBody = this._pairs.map(p => `
          <div class="paper">
            <div class="page front">${p.frontHTML ?? ''}</div>
            <div class="page back">${p.backHTML ?? ''}</div>
          </div>
        `).join('');
        this.el.innerHTML = (this._keepCount > 0) ? (this._keptPapersHTML + htmlBody) : htmlBody;

        this._controller = new BookFlipSpread(this.el, {
          direction: this.opts.direction,
          speed: this.opts.speed,
          perspective: this.opts.perspective,
          startPageIndex: this._cursorPage
        });

      } else {
        const flat = [
          ...this._keptFlatPages,
          ...this._pairs.flatMap(p => [p.frontHTML ?? '', p.backHTML ?? ''])
        ];
        const html = `
          <div class="single-stage">
            ${flat.map(pg => `<div class="single-page">${pg ?? ''}</div>`).join('')}
          </div>
        `;
        this.el.innerHTML = html;

        this._controller = new SinglePager(this.el, {
          speed: this.opts.singleSpeed,
          perspective: 0,
          startPageIndex: this._cursorPage
        });
      }
    }
  }

  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = BookFlip;
  } else {
    global.BookFlip = BookFlip;
  }
})(typeof window !== 'undefined' ? window : this);
