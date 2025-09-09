(function(){
  const mount      = document.getElementById('gacha-results');
  const poolNameEl = document.getElementById('poolName');
  const poolDescEl = document.getElementById('poolDesc');
  const poolLinkEl = document.getElementById('poolLink');
  const backEl     = document.getElementById('btnBack');

  if (!mount) return;

  // 建立倫波容器
  const car   = document.createElement('div');
  car.className = 'pool-carousel';
  const track = document.createElement('div');
  track.className = 'pool-track';
  car.appendChild(track);
  mount.appendChild(car);

  const resultsContainer = document.getElementById('gacha-results');
  const btnSingle = document.getElementById('btn-single');
  const btnTen    = document.getElementById('btn-ten');

  const S = { cards:[], pools:[], pos:0, dragging:false, sx:0, sp:0, lastX:0, lastT:0, v:0, raf:0 };

  // 初始化當前池
  window.CURRENT_POOL = { key:'常駐', name:'常駐', desc:'', banner:'', threadId:null, active:true };

  // 讀活動
  (async function loadPools(){
    const ev = await G('events').select('event_name,display_name,starts_at,ends_at,image_url,discord_thread_id').order('starts_at', {ascending:true});
    const rows = Array.isArray(ev.data) ? ev.data : [];
    const now  = Date.now();

    // 常駐
    const base = rows.find(r=>r.event_name==='常駐') || null;
    S.pools.push({
      key:'常駐', name:'常駐',
      desc: base?.display_name || '一般池（含隱藏機率）',
      banner: base?.image_url || '',
      threadId: base?.discord_thread_id || null,
      active: true
    });

    // 其他活動
    rows.filter(r=>r.event_name!=='常駐').forEach(r=>{
      const st = new Date(r.starts_at).getTime();
      const ed = new Date(r.ends_at).getTime();
      S.pools.push({
        key: r.event_name,
        name: r.event_name,
        desc: r.display_name || '',
        banner: r.image_url || '',
        threadId: r.discord_thread_id || null,
        active: (now>=st && now<=ed)
      });
    });

    build();
    update();
  })();

  function build(){
    // 卡片
    S.pools.forEach((p,i)=>{
      const card = document.createElement('div');
      card.className = 'pool-card' + (p.active ? '' : ' disabled');

      const img = document.createElement('img');
      img.src = p.banner || '';
      img.alt = p.name;
      card.appendChild(img);

      const mask = document.createElement('div');
      mask.className = 'disabled-mask';
      card.appendChild(mask);

      track.appendChild(card);
      S.cards.push(card);
    });

    // 滑鼠拖曳（照你書本倫波：mouse + window 監聽 + 慣性）
    car.addEventListener('mousedown', e=>{
      S.dragging = true; S.sx = e.clientX; S.sp = S.pos;
      S.lastX = e.clientX; S.lastT = Date.now(); S.v = 0;
      car.classList.add('dragging');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp, { once:true });
    });
    function onMove(e){
      if (!S.dragging) return;
      const dx = e.clientX - S.sx;
      S.pos = S.sp - dx / 160;
      wrap(); update();
      const now = Date.now();
      S.v = (e.clientX - S.lastX)/(now - S.lastT);
      S.lastX = e.clientX; S.lastT = now;
    }
    function onUp(){
      S.dragging = false; car.classList.remove('dragging'); momentum();
      window.removeEventListener('mousemove', onMove);
    }
    car.addEventListener('mouseleave', ()=>{ if (S.dragging) { S.dragging=false; car.classList.remove('dragging'); momentum(); }});
    window.addEventListener('blur', ()=>{ if (S.dragging) { S.dragging=false; car.classList.remove('dragging'); momentum(); }});

    // 觸控
    car.addEventListener('touchstart', e=>{
      if (e.touches.length>1) return;
      const t = e.touches[0];
      S.dragging=true; S.sx=t.clientX; S.sp=S.pos;
      S.lastX=t.clientX; S.lastT=Date.now(); S.v=0;
      car.classList.add('dragging');
    }, {passive:true});
    car.addEventListener('touchmove', e=>{
      if (!S.dragging) return;
      const t = e.touches[0];
      const dx = t.clientX - S.sx;
      S.pos = S.sp - dx / 160;
      wrap(); update();
      const now = Date.now();
      S.v = (t.clientX - S.lastX)/(now - S.lastT);
      S.lastX = t.clientX; S.lastT = now;
    }, {passive:true});
    car.addEventListener('touchend', ()=>{
      if (!S.dragging) return;
      S.dragging=false; car.classList.remove('dragging'); momentum();
    }, {passive:true});

    // 持有榜
    poolLinkEl?.addEventListener('click', ()=>{
      const k = window.CURRENT_POOL?.key || '常駐';
      const href = `https://shierusha.github.io/library/lib/getgacha.html?lim=${k==='常駐' ? '' : encodeURIComponent(k)}`;
      document.getElementById('info-modal').style.display = 'flex';
      const infoTitle  = document.getElementById('info-modal-title');
      const infoBody   = document.getElementById('info-modal-body');
      if (infoTitle) infoTitle.textContent = '持有榜';
      if (infoBody)  infoBody.innerHTML = `<div style="width:100%;height:100%;"><iframe src="${href}" style="width:100%;height:100%;border:0;"></iframe></div>`;
    });

    // 返回鍵
    backEl?.addEventListener('click', ()=>{
      const hasResults = document.querySelectorAll('.gacha-row').length > 0;
      if (hasResults){
        const rc = document.getElementById('gacha-results');
        if (rc){ rc.classList.remove('single'); rc.innerHTML=''; }
        showCarousel();
      } else {
        location.href = typeof REDIRECT_PLAYER === 'string' ? REDIRECT_PLAYER : '/';
      }
    });

    // 抽卡結果出現時 → 隱藏倫波；清空時 → 顯示倫波
    new MutationObserver(()=>{
      const hasResults = document.querySelectorAll('.gacha-row').length > 0;
      car.style.display = hasResults ? 'none' : 'block';
    }).observe(resultsContainer, { childList:true, subtree:true });

    window.addEventListener('resize', update);
  }

  function wrap(){
    const N = S.pools.length;
    if (S.pos<0) S.pos += N;
    if (S.pos>=N) S.pos -= N;
  }

  function update(center=S.pos){
    const N = S.pools.length;
    const W = car.clientWidth;
    const baseX = Math.max(W*0.09, Math.min(W*0.18, W/4));

    S.cards.forEach((card,i)=>{
      let d = i - center;
      if (d > N/2) d -= N;
      if (d < -N/2) d += N;
      const tx = d * baseX;
      const scale = Math.abs(d)<.4 ? 1.06 : 0.88;
      const op = Math.max(.3, 1 - .25*Math.abs(d));
      card.style.transform = `translate(-50%,-50%) translateX(${tx}px) scale(${scale})`;
      card.style.opacity = String(op);
      card.classList.toggle('center', Math.abs(d)<.4);
    });

    // 當前池
    const idx = ((Math.round(center) % N) + N) % N;
    const cur = S.pools[idx];
    window.CURRENT_POOL = cur;

    if (poolNameEl) poolNameEl.textContent = cur?.name || '';
    if (poolDescEl) poolDescEl.textContent = cur?.desc || '';

    // 非活動期間 → 禁抽（不改你的 canDraw 流程，只用 disabled）
    const active = cur?.active !== false || cur?.key === '常駐';
    btnSingle && (btnSingle._forceDisabled = !active);
    btnTen    && (btnTen._forceDisabled    = !active);
    if (typeof enforceLandscape === 'function') enforceLandscape();
  }

  function momentum(){
    cancelAnimationFrame(S.raf);
    const step = ()=>{
      if (Math.abs(S.v) < 0.02){
        S.v = 0; S.pos = Math.round(S.pos); update(); return;
      }
      S.pos -= S.v; wrap(); update(); S.v *= 0.92;
      S.raf = requestAnimationFrame(step);
    };
    S.raf = requestAnimationFrame(step);
  }

  function showCarousel(){ car.style.display = 'block'; }
})();
