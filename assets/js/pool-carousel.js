// ============ Pool Selector Carousel (外掛模組) ============
(function(){
  const LS_KEY = 'gacha_selected_pool';

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const save = (k,v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };
  const load = (k,d) => { try{ const v = JSON.parse(localStorage.getItem(k)); return v ?? d; }catch{ return d; } };

  const buildLink = (name) =>
    `https://shierusha.github.io/library/lib/getgacha.html?lim=${(!name || name==='常駐') ? '' : encodeURIComponent(name)}`;

  const api = {
    _state: null,

    // 從 DB events 直接建立卡池
    async buildFromDB(){
      // 需要你頁面中已建立的 G / DEFAULT_EVENT
      const { data } = await G('events').select('event_name,display_name,starts_at,ends_at,image_url,discord_thread_id').order('starts_at',{ascending:true});
      const rows = Array.isArray(data) ? data : [];
      const now  = Date.now();

      const list = [];
      // 常駐（永遠可抽）
      const base = rows.find(r=>r.event_name==='常駐') || null;
      list.push({
        name: '常駐',
        desc: base?.display_name || '一般池（含隱藏機率）',
        banner: base?.image_url || '',
        threadId: base?.discord_thread_id || null,
        active: true
      });
      // 其他活動
      rows.filter(r=>r.event_name!=='常駐').forEach(r=>{
        const st = new Date(r.starts_at).getTime();
        const ed = new Date(r.ends_at).getTime();
        list.push({
          name: r.event_name,
          desc: r.display_name || '',
          banner: r.image_url || '',
          threadId: r.discord_thread_id || null,
          active: (now>=st && now<=ed)
        });
      });
      return list;
    },

    getCurrent(){ const s=this._state; if(!s) return null; return s.pools?.[Math.round(s.pos)%s.pools.length]; },
    getCurrentName(){ return this.getCurrent()?.name || '常駐'; },

    hide(){ this._state?.root && (this._state.root.style.display = 'none'); },
    show(){ this._state?.root && (this._state.root.style.display = 'block'); },

    init(opts){
      const {
        mount, nameEl, descEl, linkEl,
        pools = null,
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
        pools: (pools && pools.length) ? pools : [{name:'常駐', desc:'一般池', banner:''}],
        cards: [],
        pos: 0,
        isDrag:false, startX:0, startPos:0, lastX:0, lastT:0, v:0, raf:0,
        pressTimer: 0, lastPointerId: null
      };

      // 復原上次選擇
      const saved = load(LS_KEY, null);
      if (saved) {
        const i = state.pools.findIndex(p => p.name === saved);
        if (i >= 0) state.pos = i;
      }

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
        t.textContent = p.name;
        card.appendChild(t);

        const d = document.createElement('div');
        d.className = 'desc auto-resize';
        d.textContent = p.desc || '';
        card.appendChild(d);

        state.track.appendChild(card);
        state.cards.push(card);
      });

      const update = (center = state.pos) => {
        const N = state.pools.length;
        const W = container.clientWidth;
        const baseX = Math.max(90, Math.min(180, W/4)); // 自適應間距
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

        // 更新卡池顯示區 & 連結
        const cur = api.getCurrent();
        window.CURRENT_POOL = {
          key: cur?.name || '常駐',
          name: cur?.name || '常駐',
          desc: cur?.desc || '',
          banner: cur?.banner || '',
          threadId: cur?.threadId || null,
          active: cur?.active !== false || (cur?.name === '常駐')
        };
        if (state.nameEl) state.nameEl.textContent = cur?.name || '';
        if (state.descEl) state.descEl.textContent = cur?.desc || '';
        if (state.linkEl) {
          const href = buildLink(cur?.name || '常駐');
          state.linkEl.dataset.href = href;
          state.linkEl.title = `前往持有榜`;
        }

        // 自動縮字（只套在 auto-resize 標記）
        if (window.resizeAllTexts) window.resizeAllTexts();

        // onChange hook
        if (state._lastIndex !== Math.round(center)) {
          state._lastIndex = Math.round(center);
          save(LS_KEY, cur?.name || '常駐');
          if (typeof state.onChange === 'function') state.onChange(cur);
          // 活動期間鎖按鈕（不改你的 canDraw 流程）
          const active = window.CURRENT_POOL.active;
          const btnSingle = $('#btn-single');
          const btnTen    = $('#btn-ten');
          if (btnSingle) btnSingle._forceDisabled = !active;
          if (btnTen)    btnTen._forceDisabled    = !active;
          if (typeof window.enforceLandscape === 'function') window.enforceLandscape();
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

      // ===== pointer 事件：加入「0.3 秒自動放開」=====
      container.addEventListener('pointerdown', (e) => {
        state.isDrag = true;
        state.lastPointerId = e.pointerId;
        container.setPointerCapture(e.pointerId);
        state.startX = e.clientX;
        state.startPos = state.pos;
        state.lastX = e.clientX;
        state.lastT = Date.now();
        state.v = 0;
        endMomentum();
        container.classList.add('dragging');

        // 0.3 秒自動放開
        clearTimeout(state.pressTimer);
        state.pressTimer = setTimeout(() => {
          if (!state.isDrag) return;
          // 模擬放開：以目前速度做一次收尾
          try { container.releasePointerCapture(state.lastPointerId); }catch{}
          state.isDrag = false;
          container.classList.remove('dragging');
          // 用目前瞬時速度（很小就 snap、稍大就小慣性）
          state.v = (Date.now() - state.lastT) > 0 ? (e.clientX - state.lastX) / (Date.now()-state.lastT) : 0;
          if (Math.abs(state.v) > 0.01) startMomentum();
          else { state.pos = Math.round(state.pos); update(); }
        }, 300);
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
        state.v = (e.clientX - state.lastX) / Math.max(1, (now - state.lastT));
        state.lastX = e.clientX; state.lastT = now;
      });

      const endDrag = (e) => {
        if (!state.isDrag) return;
        state.isDrag = false;
        try { container.releasePointerCapture(e.pointerId); }catch{}
        container.classList.remove('dragging');
        clearTimeout(state.pressTimer);

        // 慣性 or snap
        state.v = (e.clientX - state.lastX) / Math.max(1, (Date.now()-state.lastT));
        if (Math.abs(state.v) > 0.01) startMomentum();
        else { state.pos = Math.round(state.pos); update(); }
      };

      container.addEventListener('pointerup', endDrag);
      container.addEventListener('pointercancel', (e)=>{ endDrag(e); });
      container.addEventListener('lostpointercapture', ()=>{ clearTimeout(state.pressTimer); });

      // 鍵盤
      container.tabIndex = 0;
      container.addEventListener('keydown', (e)=>{
        if (e.key === 'ArrowLeft')  { state.pos = Math.round(state.pos) - 1; if (state.pos < 0) state.pos += state.pools.length; update(); }
        if (e.key === 'ArrowRight') { state.pos = Math.round(state.pos) + 1; if (state.pos >= state.pools.length) state.pos -= state.pools.length; update(); }
      });

      // 點擊右下角「持有榜」→ 另開分頁
      if (state.linkEl) {
        state.linkEl.addEventListener('click', ()=>{
          const href = state.linkEl.dataset.href || buildLink('常駐');
          window.open(href, '_blank');
        });
      }

      // 初次渲染 + 視窗縮放
      update();
      window.addEventListener('resize', () => update());

      // 對外
      api.update = update;
      api.selectByName = (name) => {
        const i = state.pools.findIndex(p => p.name === name);
        if (i >= 0) { state.pos = i; update(); }
      };

      return api;
    }
  };

  // 自動啟用（依你頁面現有節點）
  document.addEventListener('DOMContentLoaded', async ()=>{
    const mount  = document.getElementById('gacha-results');
    const nameEl = document.getElementById('poolName');
    const descEl = document.getElementById('poolDesc');
    const linkEl = document.getElementById('poolLink');
    if (!mount) return;

    const pools = await api.buildFromDB();
    api.init({
      mount, nameEl, descEl, linkEl,
      pools,
      onChange(){ /* 已在內部處理 CURRENT_POOL / 鎖按鈕 */ }
    });
  });

  window.PoolCarousel = api;
})();
