class BookFlip {
  constructor(selector, options = {}) {
    this.book = document.querySelector(selector);
    this.options = Object.assign({
      direction: 'ltr',     // ltr=左開, rtl=右開
      mode: 'spread',       // spread=雙頁, single=單頁
      speed: 500,           // 翻頁速度 (ms)
      perspective: 3000     // 透視 (px)
    }, options);

    this.papers = this.book.querySelectorAll('.paper');
    this.current = 0;
    this.locked = false;

    this.injectCSS();
    this.applyPerspective();

    if (this.options.mode === 'single') {
      this.initSwipe();
      this.showPage(0);
    }
  }

  injectCSS() {
    if (document.getElementById('bookflip-style')) return;
    const style = document.createElement('style');
    style.id = 'bookflip-style';
    style.textContent = `
      .paper { 
        width: 100%; height: 100%; position: absolute; top:0; left:0;
        transform-style: preserve-3d;
      }
      .page {
        width: 100%; height: 100%;
        position: absolute; top:0; left:0;
        display:flex; align-items:center; justify-content:center;
        font-size:2rem; font-weight:bold;
        border:1px solid #ccc;
        backface-visibility:hidden; -webkit-backface-visibility:hidden;
      }
      .back { transform: rotateY(180deg); }
      .paper.flipped-ltr { transform-origin:left center; }
      .paper.flipped-rtl { transform-origin:right center; }
      .page.enter { transition: transform 0.4s ease; }
      .page.exit { transition: transform 0.4s ease; }
    `;
    document.head.appendChild(style);
  }

  applyPerspective() {
    this.book.style.perspective = this.options.perspective + 'px';
  }

  nextPage() {
    if (this.locked) return;
    if (this.options.mode === 'spread') {
      if (this.current < this.papers.length) {
        this.locked = true;
        this.current++;
        this.updateBook();
        setTimeout(() => this.locked = false, this.options.speed);
      }
    } else {
      this.showPage(this.current + 1);
    }
  }

  prevPage() {
    if (this.locked) return;
    if (this.options.mode === 'spread') {
      if (this.current > 0) {
        this.locked = true;
        this.current--;
        this.updateBook();
        setTimeout(() => this.locked = false, this.options.speed);
      }
    } else {
      this.showPage(this.current - 1);
    }
  }

  updateBook() {
    this.papers.forEach((paper, idx) => {
      const cls = this.options.direction === 'ltr' ? 'flipped-ltr' : 'flipped-rtl';
      if (idx < this.current) {
        paper.classList.add(cls);
        paper.style.transition = `transform ${this.options.speed}ms ease-in-out`;
        paper.style.transform = (this.options.direction === 'ltr') ?
          'rotateY(-180deg)' : 'rotateY(180deg)';
        paper.style.zIndex = idx;
      } else {
        paper.classList.remove('flipped-ltr', 'flipped-rtl');
        paper.style.transition = `transform ${this.options.speed}ms ease-in-out`;
        paper.style.transform = 'rotateY(0deg)';
        paper.style.zIndex = this.papers.length - idx;
      }
    });
  }

  // 單頁模式
  showPage(idx) {
    const pages = this.book.querySelectorAll('.page');
    if (idx < 0 || idx >= pages.length) return;
    pages.forEach((p, i) => {
      p.style.display = (i === idx) ? 'flex' : 'none';
    });
    this.current = idx;
  }

  initSwipe() {
    let startX = 0;
    this.book.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
    });
    this.book.addEventListener('touchend', e => {
      const endX = e.changedTouches[0].clientX;
      if (endX - startX > 50) this.prevPage();
      else if (startX - endX > 50) this.nextPage();
    });
  }
}
