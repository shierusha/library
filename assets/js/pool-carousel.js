// ============ Pool Selector Carousel (外掛模組，非循環 + 單步版) ============
(function(){
  const LS_KEY = 'gacha_selected_pool';
  const $  = (s, r=document) => r.querySelector(s);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const save = (k,v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };
  const load = (k,d) => { try{ const v = JSON.parse(localStorage.getItem(k)); return v ?? d; }catch{ return d; } };

  const buildLink = (name) =>
    `https://shierusha.github.io/library/lib/getgacha.html?lim=${(!name || name==='常駐') ? '' : encodeURIComponent(name)}`;

  function sizeBackArrow(){
    const el = document.getElementById('btnBack') || document.querySelector('.back');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = Math.floor(Math.max(16, Math.min(rect.width, rect.height) * 0.8));
    el.style.setProperty('--arrow-size', s + 'px');
  }

  const api = {
    _state: null,

    async buildFromDB(){
      const { data } = await G('events')
        .select('event_name,display_name,starts_at,ends_at,image_url,discord_thread_id')
        .order('starts_at',{ascending:true});
      const rows = Array.isArray(data) ? data : [];
      const now  = Date.now();

      const list = [];
      const base = rows.find(r=>r.event_name==='常駐') || null;
      list.push({
        name: '常駐',
        desc: base?.display_name || '一般池（含隱藏機率）',
        banner: base?.image_url || '',
        threadId: base?.discord_thread_id || null,
        active: true
      });
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

    getCurrent(){
      const s=this._state; if(!s||!s.pools.length) return null;
      return s.pools[Math.round(s.pos)];
    },

    hide(){ this._state?.root && (this._state.root.style.display = 'none'); },
    show(){ this._state?.root && (this._state.root.style.display = 'block'); },

    init(opts){
      const { mount, nameEl, descEl, linkEl, pools = null, onChange = null } = (opts||{});
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
        isDrag:false, startX:0, startPos:0
      };

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
  img.draggable = false; // ✅ 禁止原生拖曳
  card.appendChild(img);
}


     //   const t = document.createElement('div');
     //   t.className = 'title auto-resize';
     //   t.textContent = p.name;
     //   card.appendChild(t);

    //    const d = document.createElement('div');
    //    d.className = 'desc auto-resize';
     //   d.textContent = p.desc || '';
    //    card.appendChild(d);

        state.track.appendChild(card);
        state.cards.push(card);
      });

      // 更新位置
      const update = (center = state.pos) => {
        const N = state.pools.length;
        center = clamp(center, 0, N-1);
        state.pos = center;

        const W = container.clientWidth;
        const baseX = Math.max(90, Math.min(180, W/4));

        state.cards.forEach((card, i) => {
          const dist = i - center;
          const abs = Math.abs(dist);
          const tx = dist * baseX;
          const scale = abs < .4 ? 1.06 : 0.88;
          let op = 1 - .25 * abs;
          if (abs > 2.5) op = 0;

          card.style.transform = `translate(-50%,-50%) translateX(${tx}px) scale(${scale})`;
          card.style.opacity = String(clamp(op, 0, 1));
          card.classList.toggle('center', abs < .4);
          card.setAttribute('data-dist', String(Math.round(dist)));
          card.style.pointerEvents = abs < .4 ? 'auto' : 'none';
        });

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

        if (window.resizeAllTexts) window.resizeAllTexts();

        const idx = Math.round(center);
        if (state._lastIndex !== idx) {
          state._lastIndex = idx;
          save(LS_KEY, cur?.name || '常駐');
          if (typeof state.onChange === 'function') state.onChange(cur);
          const active = window.CURRENT_POOL.active;
          
          
          const btnSingle = $('#btn-single');
          const btnTen    = $('#btn-ten');
                
                if (btnSingle) {
                  btnSingle._forceDisabled = !active;
                  btnSingle.classList.toggle('inactive', !active);
                }
                if (btnTen) {
                  btnTen._forceDisabled = !active;
                  btnTen.classList.toggle('inactive', !active);
                }
          
              if (typeof window.enforceLandscape === 'function') window.enforceLandscape();
        }
      };

      // 拖曳事件：不慣性，只算距離超過一半就跳到下一張
      container.addEventListener('pointerdown', (e) => {
        state.isDrag = true;
        container.setPointerCapture(e.pointerId);
        state.startX = e.clientX;
        state.startPos = state.pos;
        container.classList.add('dragging');
      });

     container.addEventListener('pointermove', (e) => {
  if (!state.isDrag) return;
  const dx = e.clientX - state.startX;
  // 拖曳過程不 clamp
  state.pos = state.startPos - dx / 160;
  update(state.pos);
});

     const endDrag = (e) => {
  if (!state.isDrag) return;
  state.isDrag = false;
  container.classList.remove('dragging');
  try { container.releasePointerCapture(e.pointerId); } catch {}

  // 放開時才 clamp
  const nearest = Math.round(state.pos);
  state.pos = clamp(nearest, 0, state.pools.length - 1);
  update(state.pos);
};

      container.addEventListener('pointerup', endDrag);
      container.addEventListener('pointercancel', endDrag);

      // 鍵盤左右切換：一次一張
      container.tabIndex = 0;
      container.addEventListener('keydown', (e)=>{
        const N = state.pools.length||1;
        if (e.key === 'ArrowLeft')  { state.pos = clamp(Math.round(state.pos)-1, 0, N-1); update(state.pos); }
        if (e.key === 'ArrowRight') { state.pos = clamp(Math.round(state.pos)+1, 0, N-1); update(state.pos); }
      });

      if (state.linkEl) {
        state.linkEl.addEventListener('click', ()=>{
          const href = state.linkEl.dataset.href || buildLink('常駐');
          window.open(href, '_blank');
        });
      }

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

      new MutationObserver(()=>{
        const hasResults = document.querySelectorAll('.gacha-row').length > 0;
        container.style.display = hasResults ? 'none' : 'block';
      }).observe(document.getElementById('gacha-results'), { childList:true, subtree:true });

      update();
      sizeBackArrow();
      window.addEventListener('resize', ()=>{ sizeBackArrow(); update(); });
      try {
        const ro = new ResizeObserver(()=>{ sizeBackArrow(); update(); });
        ro.observe(document.querySelector('.container-16-9') || document.body);
      } catch {}

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
