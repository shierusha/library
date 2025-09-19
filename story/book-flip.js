/*! BookFlip v1.0.0 (standalone) */
(function (global) {
  'use strict';

  const STYLE_ID = 'bookflip-core-style-v1';
  function injectCoreCSS() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.book, .book * { user-select: none; -webkit-user-select: none; }
.paper { width:100%; height:100%; position:absolute; top:0; left:0; transform-style: preserve-3d; }
.page  { width:100%; height:100%; position:absolute; top:0; left:0; display:flex; align-items:center; justify-content:center; backface-visibility:hidden; -webkit-backface-visibility:hidden; border:1px solid #ddd; }
.back  { transform: rotateY(180deg); }
.paper.dir-ltr { transform-origin: left center; }
.paper.dir-rtl { transform-origin: right center; }
.single-stage { width:100%; height:100%; position:relative; overflow:hidden; }
.single-page  { width:100%; height:100%; position:absolute; top:0; left:0; display:flex; align-items:center; justify-content:center; border:1px solid #ddd; will-change: transform; }
    `;
    document.head.appendChild(style);
  }

  function clamp(n, min, max) {
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  class BookFlipSpread {
    constructor(el, { direction = 'ltr', speed = 500, perspective = 2000, startPageIndex = 0 } = {}) {
      this.el = el;
      this.papers = Array.from(el.querySelectorAll('.paper'));
      this.current = clamp(Math.floor(startPageIndex / 2), 0, this.papers.length);
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
      this.updateSideClasses();
    }
    applyPerspective() {
      if (this.el) this.el.style.perspective = this.perspective + 'px';
    }
     updateSideClasses() {
      const isRTL = this.direction === 'rtl';
      this.papers.forEach((paper, idx) => {
        const flipped = idx < this.current;
        const shouldBeLeft = isRTL ? !flipped : flipped;
        paper.classList.remove('left', 'right');
        paper.classList.add(shouldBeLeft ? 'left' : 'right');
      });
    }
    flipTransform(isFlipped) {
      if (this.direction === 'rtl') return isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)';
      return isFlipped ? 'rotateY(-180deg)' : 'rotateY(0deg)';
    }
    update() {
      this.papers.forEach((paper, idx) => {
        paper.style.transition = `transform ${this.speed}ms ease-in-out`;
        const flipped = idx < this.current;
        paper.style.transform = this.flipTransform(flipped);
        paper.style.zIndex = flipped ? idx : (this.papers.length - idx);
      });
    }
          this.updateSideClasses();

    goToPage(pageIndex = 0) {
      this.current = clamp(Math.floor(pageIndex / 2), 0, this.papers.length);
      this.isAnimating = false;
      this.update();
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

  class SinglePager {
    constructor(el, { speed = 300, perspective = 0, startPageIndex = 0 } = {}) {
      this.el = el;
      this.stage = el.querySelector('.single-stage');
      this.pages = Array.from(el.querySelectorAll('.single-page'));
      this.current = clamp(startPageIndex, 0, this.pages.length - 1);
      this.isAnimating = false;
      this.speed = speed;
      this.perspective = perspective;
      if (this.perspective && this.el) this.el.style.perspective = this.perspective + 'px';
      this.setup();
      this.bindSwipe();
    }
    setup() {
      this.pages.forEach((pg, i) => {
        pg.style.transition = `transform ${this.speed}ms ease`;
        pg.style.transform = (i < this.current)
          ? 'translateX(-100%)'
          : (i === this.current)
            ? 'translateX(0)'
            : 'translateX(100%)';
      });
    }
    to(idx) {
      if (this.isAnimating) return;
      if (idx < 0 || idx >= this.pages.length || idx === this.current) return;
      this.isAnimating = true;
      const cur = this.pages[this.current];
      const next = this.pages[idx];
      const dir = (idx > this.current) ? -1 : 1;
      next.style.transform = `translateX(${dir * -100}%)`;
      requestAnimationFrame(() => {
        cur.style.transform = `translateX(${dir * 100}%)`;
        next.style.transform = 'translateX(0)';
      });
      const done = () => {
        cur.removeEventListener('transitionend', done);
        this.current = idx;
        this.isAnimating = false;
      };
      cur.addEventListener('transitionend', done, { once: true });
    }
    goToPage(pageIndex = 0) {
      if (!this.pages.length) return;
      const target = clamp(pageIndex, 0, this.pages.length - 1);
      this.current = target;
      this.isAnimating = false;
      this.pages.forEach(pg => { pg.style.transition = 'none'; });
      this.setup();
      if (this.el) void this.el.offsetHeight;
      this.pages.forEach(pg => { pg.style.transition = `transform ${this.speed}ms ease`; });
    }
    next() { this.to(this.current + 1); }
    prev() { this.to(this.current - 1); }
    bindSwipe() {
      let startX = 0;
      this.el.addEventListener('touchstart', e => {
        if (!e.touches || !e.touches[0]) return;
        startX = e.touches[0].clientX;
      }, { passive: true });
      this.el.addEventListener('touchend', e => {
        const touch = e.changedTouches && e.changedTouches[0];
        if (!touch) return;
        const diff = touch.clientX - startX;
        if (diff > 50) this.prev();
        if (diff < -50) this.next();
      }, { passive: true });
    }
    destroy() {}
  }

  class BookFlip {
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
      this._controller = null;
      this._cursorPage = this.opts.startPageIndex;
      this._pairs = [];
      this._flatPages = [];
      this._buildFromDataOrDom();
      this._mountCurrent();
    }
    loadData({ pairs = null, pages = null } = {}) {
      if (Array.isArray(pairs)) this._pairs = pairs.slice();
      if (Array.isArray(pages)) this._flatPages = pages.slice();
      if (!this._flatPages.length && this._pairs.length) {
        this._flatPages = this._pairs.flatMap(p => [p.frontHTML ?? '', p.backHTML ?? '']);
      }
      this._cursorPage = clamp(this._cursorPage, 0, Math.max(0, this._flatPages.length - 1));
      this._mountCurrent();
    }
    setMode(mode) {
      if (mode !== 'spread' && mode !== 'single') return;
      if (this.opts.mode === 'spread' && mode === 'single') {
        if (this._controller && typeof this._controller.current === 'number') {
          this._cursorPage = clamp(this._controller.current * 2, 0, Math.max(0, this._flatPages.length - 1));
        }
      } else if (this.opts.mode === 'single' && mode === 'spread') {
        if (this._controller && typeof this._controller.current === 'number') {
          this._cursorPage = clamp(this._controller.current, 0, Math.max(0, this._flatPages.length - 1));
          this._cursorPage = this._cursorPage - (this._cursorPage % 2);
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
    next() {
      if (!this._controller) return;
      this._controller.next();
      if (this.opts.mode === 'spread') {
        const nextPage = clamp((this._controller.current + 1) * 2, 0, Math.max(0, this._flatPages.length - 1));
        this._cursorPage = nextPage - (nextPage % 2);
      } else {
        this._cursorPage = clamp(this._controller.current + 1, 0, Math.max(0, this._flatPages.length - 1));
      }
    }
    prev() {
      if (!this._controller) return;
      this._controller.prev();
      if (this.opts.mode === 'spread') {
        const prevPage = clamp((this._controller.current - 1) * 2, 0, Math.max(0, this._flatPages.length - 1));
        this._cursorPage = prevPage - (prevPage % 2);
      } else {
        this._cursorPage = clamp(this._controller.current - 1, 0, Math.max(0, this._flatPages.length - 1));
      }
    }
    goTo(pageIndex = 0) {
      if (!this._controller) return;
      if (!this._flatPages.length) { this._cursorPage = 0; return; }
      const maxIndex = Math.max(0, this._flatPages.length - 1);
      const target = clamp(pageIndex, 0, maxIndex);
      if (this.opts.mode === 'spread') {
        if (typeof this._controller.goToPage === 'function') this._controller.goToPage(target);
        this._cursorPage = target - (target % 2);
      } else {
        if (typeof this._controller.goToPage === 'function') this._controller.goToPage(target);
        this._cursorPage = target;
      }
    }
    getCurrentPage() {
      return clamp(this._cursorPage, 0, Math.max(0, this._flatPages.length - 1));
    }
    destroy() {
      if (this._controller && typeof this._controller.destroy === 'function') this._controller.destroy();
      this._controller = null;
    }
    _buildFromDataOrDom() {
      if (this.opts.data && (Array.isArray(this.opts.data.pairs) || Array.isArray(this.opts.data.pages))) {
        if (Array.isArray(this.opts.data.pairs)) {
          this._pairs = this.opts.data.pairs.slice();
          this._flatPages = this._pairs.flatMap(p => [p.frontHTML ?? '', p.backHTML ?? '']);
        } else {
          this._flatPages = this.opts.data.pages.slice();
          this._pairs = [];
          for (let i = 0; i < this._flatPages.length; i += 2) {
            this._pairs.push({ frontHTML: this._flatPages[i] ?? '', backHTML: this._flatPages[i + 1] ?? '' });
          }
        }
      } else if (this.el) {
        const papers = Array.from(this.el.querySelectorAll('.paper'));
        if (papers.length) {
          this._pairs = papers.map(p => ({
            frontHTML: (p.querySelector('.front') || {}).innerHTML || '',
            backHTML: (p.querySelector('.back') || {}).innerHTML || ''
          }));
          this._flatPages = this._pairs.flatMap(p => [p.frontHTML, p.backHTML]);
        } else {
          this._pairs = [];
          this._flatPages = [];
        }
      }
    }
    _mountCurrent() {
      if (!this.el) return;
      const maxIndex = Math.max(0, this._flatPages.length - 1);
      this._cursorPage = clamp(this._cursorPage, 0, maxIndex);
      this.el.innerHTML = '';
      if (this.opts.mode === 'spread') {
        const html = this._pairs.map(p => `
          <div class="paper ${this.opts.direction === 'rtl' ? 'dir-rtl' : 'dir-ltr'}">
            <div class="page front">${p.frontHTML ?? ''}</div>
            <div class="page back">${p.backHTML ?? ''}</div>
          </div>`).join('');
        this.el.innerHTML = html;
        const startPaper = Math.max(0, Math.min(Math.floor(this._cursorPage / 2), this._pairs.length));
        this._controller = new BookFlipSpread(this.el, {
          direction: this.opts.direction,
          speed: this.opts.speed,
          perspective: this.opts.perspective,
          startPageIndex: startPaper * 2
        });
      } else {
        const html = `
          <div class="single-stage">
            ${this._flatPages.map(pg => `<div class="single-page">${pg ?? ''}</div>`).join('')}
          </div>`;
        this.el.innerHTML = html;
        this._controller = new SinglePager(this.el, {
          speed: this.opts.singleSpeed,
          perspective: 0,
          startPageIndex: Math.max(0, Math.min(this._cursorPage, this._flatPages.length - 1))
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
