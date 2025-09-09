/* ============ Pool Selector Carousel 外掛模組 ============

使用方式（本頁已完成初始化）：

PoolCarousel.init({
  mount: document.getElementById('gacha-results'),
  nameEl: document.getElementById('poolNameSlot'),
  descEl: document.getElementById('poolDescSlot'),
  linkEl: document.getElementById('poolLinkSlot'),
  pools: [
    // 由 gacha.html 依 DB 建立（name=event_name、desc=display_name）
  ],
  onChange: (pool) => { window.CURRENT_POOL = pool; }
});

*/
(function(){
  const LS_KEY = 'gacha_selected_pool_v2';

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  // 常駐時 lim= 空值；其他 lim= event_name
  const buildLink = (key) =>
    `https://shierusha.github.io/library/lib/getgacha.html?lim=${(!key || key === '常駐') ? '' : encodeURIComponent(key)}`;

  const api = {
    _state: null,

    getCurrent(){ return this._state?.pools?.[Math.round(this._state.pos)%this._state.pools.length]; },
    getCurrentKey(){ return this.getCurrent()?.key || '常駐'; },

    hide(){ this._state?.root && (this._state.root.style.display = 'none'); },
    show(){ this._state?.root && (this._state.root.style.display = 'block'); },

    init(opts){
      const {
        mount, nameEl, descEl, linkEl,
        pools = [],
        onChange = null
      } = (opts||{});

      if (!mount) throw new Error('[PoolCarousel] mount 容器必填');
      const container = document.createElement('div');
      container.className = 'pool-carousel';
      const track = document.createElement('div');
      track.className = 'pool-track';
      container.appendChild(track);
      mount.appendChild(container);

      const state = this._state = {
        root: container, track, nameEl, descEl, linkEl, onChange,
        pools: pools.length ? pools : [{key:'常駐', name:'常駐', desc:'一般池（含隱藏機率）', banner:'', active:true, threadId:null}],
        cards: [],
        pos: 0, isDrag:false, startX:0, startPos:0, lastX:0, lastT:0, v:0, raf:0, _lastIndex: -1
      };

      // 復原上次選擇（key=event_name）
      try {
        const saved = JSON.parse(localStorage.getItem(LS_KEY));
        if (saved) {
          const i = state.pools.findIndex(p => p.key === saved);
          if (i >= 0) state.pos = i;
        }
      } catch {}

      // 建卡
      state.pools.forEach((p, i) => {
        const card = document.createElement('div');
        card.className = 'pool-card';
        card.setAttribute('data-index', i);

        if (p.banner) {
          const img = document.createElement('img');
          img.className = 'banner';
          img.src = p.banner;
          img.alt = p.name;
          img.loading = 'lazy';
          img.decoding = 'async';
          card.appendChild(img);
        }

        const t = document.createElement('div');
        t.className = 'title auto-resize';
        t.textContent = p.name; // event_name 顯示於標題
        card.appendChild(t);

        const d = document.createElement('div');
        d.className = 'desc auto-resize';
        d.textContent = p.desc || ''; // display_name 當簡介（不顯示時間）
        card.appendChild(d);

        // 未開放角標
        const tag = document.createElement('div');
        tag.className = 'disabled-tag auto-resize';
        tag.textContent = '未開放';
        tag.style.display = p.active ? 'none' : 'flex';
        card.appendChild(tag);

        if (!p.active && p.key !== '常駐') {
          card.classList.add('disabled');
        }

        state.track.appendChild(card);
        state.cards.push(card);
      });

      const update = (center = state.pos) => {
        const N = state.pools.length;
        const W = container.clientWidth;
        const baseX = Math.max(W * 0.09, Math.min(W * 0.18, W/4)); // 自適應橫向間距
        state.cards.forEach((card, i) => {
          let dist = i - center;
          if (dist > N/2) dist -= N;
          if (dist < -N/2) dist += N;

          const tx = dist * baseX;
          const scale = Math.abs(dist) < .4 ? 1.06 : 0.88;
          const op = 1 - .25 * Math.abs(dist);

          card.style.transform = `translate(-50%,-50%) translateX(${tx}px) scale(${scale})`;
          card.style.opacity = String(clamp(op, .3, 1));
          card.classList.toggle('center', Math.abs(dist) < .4);
          card.setAttribute('data-dist', String(Math.round(dist)));
        });

        // 更新 slots & 持有榜連結
        const cur = api.getCurrent();
        if (state.nameEl) state.nameEl.textContent = cur?.name || '';
        if (state.descEl) state.descEl.textContent = cur?.desc || '';
        if (state.linkEl) {
          const href = buildLink(cur?.key || '常駐');
          state.linkEl.dataset.href = href;
          state.linkEl.title = `前往持有榜`;
        }

        // 自動縮字
        if (window.resizeAllTexts) window.resizeAllTexts();

        // onChange
        if (state._lastIndex !== Math.round(center)) {
          state._lastIndex = Math.round(center);
          try { localStorage.setItem(LS_KEY, JSON.stringify(cur?.key || '常駐')); } catch {}
          if (typeof state.onChange === 'function') state.onChange(cur);
        }
      };

      const endMomentum = () => {
        if (!state.raf) return;
        cancelAnimationFrame(state.raf);
        state.raf = 0;
      };
      const startMomentum = () => {
        endMomentum();
        const step = () => {
          if (Math.abs(state.v) < 0.02) {
            state.v = 0;
            state.pos = Math.round(state.pos);
            update();
            return;
          }
          state.pos -= state.v;
          const N = state.pools.length;
          if (state.pos < 0) state.pos += N;
          if (state.pos >= N) state.pos -= N;
          update();
          state.v *= 0.92;
          state.raf = requestAnimationFrame(step);
        };
        state.raf = requestAnimationFrame(step);
      };

      // 指標事件（滑鼠/觸控）
      container.addEventListener('pointerdown', (e) => {
        state.isDrag = true;
        container.setPointerCapture(e.pointerId);
        state.startX = e.clientX;
        state.startPos = state.pos;
        state.lastX = e.clientX;
        state.lastT = Date.now();
        state.v = 0;
        endMomentum();
        container.classList.add('dragging');
      });
      container.addEventListener('pointermove', (e) => {
        if (!state.isDrag) return;
        const dx = e.clientX - state.startX;
        state.pos = state.startPos - dx / 160;
        const N = state.pools.length;
        if (state.pos < 0) state.pos += N;
        if (state.pos >= N) state.pos -= N;
        update();

        const now = Date.now();
        state.v = (e.clientX - state.lastX) / (now - state.lastT);
        state.lastX = e.clientX; state.lastT = now;
      });
      container.addEventListener('pointerup', (e) => {
        if (!state.isDrag) return;
        state.isDrag = false;
        container.releasePointerCapture(e.pointerId);
        container.classList.remove('dragging');
        state.v = (e.clientX - state.lastX) / Math.max(1, (Date.now()-state.lastT));
        if (Math.abs(state.v) > 0.01) startMomentum();
        else { state.pos = Math.round(state.pos); update(); }
      });

      // 鍵盤
      container.tabIndex = 0;
      container.addEventListener('keydown', (e)=>{
        if (e.key === 'ArrowLeft')  { state.pos = Math.round(state.pos) - 1; if (state.pos < 0) state.pos += state.pools.length; update(); }
        if (e.key === 'ArrowRight') { state.pos = Math.round(state.pos) + 1; if (state.pos >= state.pools.length) state.pos -= state.pools.length; update(); }
      });

      // 持有榜按鈕
      if (state.linkEl) {
        state.linkEl.addEventListener('click', ()=>{
          const href = state.linkEl.dataset.href || buildLink('常駐');
          window.open(href, '_blank');
        });
      }

      update();
      window.addEventListener('resize', () => update());

      api.update = update;
      api.selectByKey = (key) => {
        const i = state.pools.findIndex(p => p.key === key);
        if (i >= 0) { state.pos = i; update(); }
      };

      return api;
    }
  };

  window.PoolCarousel = api;
})();
