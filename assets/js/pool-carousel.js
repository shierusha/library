// ============ Pool Selector Carousel (外掛模組) ============
(function(){
  const LS_KEY = 'gacha_selected_pool';

  const $  = (s, r=document) => r.querySelector(s);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const save = (k,v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };
  const load = (k,d) => { try{ const v = JSON.parse(localStorage.getItem(k)); return v ?? d; }catch{ return d; } };

  const buildLink = (name) =>
    `https://shierusha.github.io/library/lib/getgacha.html?lim=${(!name || name==='常駐') ? '' : encodeURIComponent(name)}`;

  const api = {
    _state: null,

    async buildFromDB(){
      // 需要頁面已有：G('events')
      const { data } = await G('events')
        .select('event_name,display_name,starts_at,ends_at,image_url,discord_thread_id')
        .order('starts_at',{ascending:true});
      const rows = Array.isArray(data) ? data : [];
      const now  = Date.now();

      const list = [];
      // 常駐（永遠 active）
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

    getCurrent(){ const s=this._state; if(!s||!s.pools.length) return null; return s.pools[Math.round(s.pos)%s.pools.length]; },

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
        pos: 0, // 浮點索引，會四捨五入到中心
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
        card.className = 'pool-card' + (p.active ? '' : ' disabled');
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
        if (!N) return;
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
          const isCenter = Math.abs(dist) < .4;
          card.classList.toggle('center', isCenter);
          card.setAttribute('data-dist', String(Math.round(dist)));
        });

        // 更新顯示區 ＆ 連結 ＆ 狀態（給 webhook）
        const cur = this.getCurrent();
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

        // auto-resize（只作用在有 auto-resize 的區塊）
        if (window.resizeAllTexts) window.resizeAllTexts();

        // onChange + 鎖按鈕
        const idx = Math.round(center);
        if (state._lastIndex !== idx) {
          state._lastIndex = idx;
          save(LS_KEY, cur?.name || '常駐');
          if (typeof state.onChange === 'function') state.onChange(cur);
          const active = window.CURRENT_POOL.active;
          const btnSingle = $('#btn-single');
          const btnTen    = $('#btn-ten');
          if (btnSingle) btnSingle._forceDisabled = !active;
          if (btnTen)    btnTen._forceDisabled    = !active;
          if (typeof window.enforceLandscape === 'function') window.enforceLandscape();
        }
      };

      // 慣性（循環 wrap，不會滑到空白）
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
          // 環形
          if (state.pos < 0) state.pos += N;
          if (state.pos >= N) state.pos -= N;

          update();
          state.v *= 0.92;
          state.raf = requestAnimationFrame(step);
        };
        state.raf = requestAnimationFrame(step);
      };

      // 指標事件：加入 0.3 秒自動放開
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

        clearTimeout(state.pressTimer);
        state.pressTimer = setTimeout(() => {
          if (!state.isDrag) return;
          try { container.releasePointerCapture(state.lastPointerId); }catch{}
          state.isDrag = false;
          container.classList.remove('dragging');
          // 小慣性 or snap
          const dt = Date.now() - state.lastT;
          state.v = dt>0 ? (e.clientX - state.lastX)/dt : 0;
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

        state.v = (e.clientX - state.lastX) / Math.max(1, (Date.now()-state.lastT));
        if (Math.abs(state.v) > 0.01) startMomentum();
        else { state.pos = Math.round(state.pos); update(); }
      };
      container.addEventListener('pointerup', endDrag);
      container.addEventListener('pointercancel', endDrag);
      container.addEventListener('lostpointercapture', ()=>{ clearTimeout(state.pressTimer); });

      // 鍵盤左右切換
      container.tabIndex = 0;
      container.addEventListener('keydown', (e)=>{
        const N = state.pools.length||1;
        if (e.key === 'ArrowLeft')  { state.pos = (Math.round(state.pos)-1 + N)%N; update(); }
        if (e.key === 'ArrowRight') { state.pos = (Math.round(state.pos)+1)%N; update(); }
      });

      // 右下角持有榜 → 另開分頁
      if (state.linkEl) {
        state.linkEl.addEventListener('click', ()=>{
          const href = state.linkEl.dataset.href || buildLink('常駐');
          window.open(href, '_blank');
        });
      }

      // 返回箭頭（#btnBack 或 .back）
      const backEl = document.getElementById('btnBack') || document.querySelector('.back');
      if (backEl){
        backEl.addEventListener('click', ()=>{
          const hasResults = document.querySelectorAll('.gacha-row').length > 0;
          if (hasResults){
            const rc = document.getElementById('gacha-results');
            if (rc){ rc.classList.remove('single'); rc.innerHTML=''; }
            container.style.display = 'block';
          } else {
            location.href = typeof REDIRECT_PLAYER === 'string' ? REDIRECT_PLAYER : '/';
          }
        });
      }

      // 結果出現→隱藏倫波；清空→顯示
      new MutationObserver(()=>{
        const hasResults = document.querySelectorAll('.gacha-row').length > 0;
        container.style.display = hasResults ? 'none' : 'block';
      }).observe(document.getElementById('gacha-results'), { childList:true, subtree:true });

      // 初次渲染
      update();
      window.addEventListener('resize', () => update());

      return api;
    }
  };

  document.addEventListener('DOMContentLoaded', async ()=>{
    const mount  = document.getElementById('gacha-results');
    const nameEl = document.getElementById('poolName');
    const descEl = document.getElementById('poolDesc');
    const linkEl = document.getElementById('poolLink');
    if (!mount) return;

    const pools = await api.buildFromDB();
    api.init({ mount, nameEl, descEl, linkEl, pools, onChange(){} });
  });

  window.PoolCarousel = api;
})();
