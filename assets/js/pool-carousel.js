(function(){
  const mount      = document.getElementById('gacha-results');
  const poolNameEl = document.getElementById('poolName');
  const poolDescEl = document.getElementById('poolDesc');
  const poolLinkEl = document.getElementById('poolLink');
  const backEl     = document.getElementById('btnBack');

  if (!mount) return;

  // 建立倫波容器（百分比定位已在 CSS）
  const car   = document.createElement('div');
  car.className = 'pool-carousel';
  const track = document.createElement('div');
  track.className = 'pool-track';
  car.appendChild(track);
  mount.appendChild(car);

  const resultsContainer = document.getElementById('gacha-results');
  const btnSingle = document.getElementById('btn-single');
  const btnTen    = document.getElementById('btn-ten');

  // 狀態：只顯示 center；切換時暫時顯示第二張做進出場
  const S = {
    pools: [], cards: [],
    idx: 0,        // 目前中心卡
    dragging: false,
    startX: 0, deltaX: 0, lastDX: 0,
    width: () => car.clientWidth
  };

  // 對外提供：目前卡池（供 webhook 使用）
  window.CURRENT_POOL = { key:'常駐', name:'常駐', desc:'', banner:'', threadId:null, active:true };

  // 讀活動清單
  (async function loadPools(){
    const ev = await G('events').select('event_name,display_name,starts_at,ends_at,image_url,discord_thread_id').order('starts_at', {ascending:true});
    const rows = Array.isArray(ev.data) ? ev.data : [];
    const now  = Date.now();

    // 常駐（永遠可抽）
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
    setCenter(0);
    updateTexts();
    applyActiveLock();
  })();

  function build(){
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

    // 滑鼠/觸控：一次只決定「上一或下一張」
    car.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    car.addEventListener('mouseleave', onLeave);

    car.addEventListener('touchstart', e=>{
      if (e.touches.length>1) return;
      onDown(e.touches[0]);
    }, {passive:true});
    car.addEventListener('touchmove', e=>{
      if (!S.dragging) return;
      onMove(e.touches[0]);
    }, {passive:true});
    car.addEventListener('touchend', ()=> onUp());

    // 持有榜：另開新分頁（常駐 lim=空字串）
    poolLinkEl?.addEventListener('click', ()=>{
      const k = window.CURRENT_POOL?.key || '常駐';
      const href = `https://shierusha.github.io/library/lib/getgacha.html?lim=${k==='常駐' ? '' : encodeURIComponent(k)}`;
      window.open(href, '_blank');
    });

    // 返回鍵：有抽卡結果→清掉顯示倫波；否則回玩家中心
    backEl?.addEventListener('click', ()=>{
      const hasResults = document.querySelectorAll('.gacha-row').length > 0;
      if (hasResults){
        const rc = document.getElementById('gacha-results');
        if (rc){ rc.classList.remove('single'); rc.innerHTML=''; }
        car.style.display = 'block';
      } else {
        location.href = typeof REDIRECT_PLAYER === 'string' ? REDIRECT_PLAYER : '/';
      }
    });

    // 有抽卡結果→隱藏倫波；沒有→顯示
    new MutationObserver(()=>{
      const hasResults = document.querySelectorAll('.gacha-row').length > 0;
      car.style.display = hasResults ? 'none' : 'block';
    }).observe(resultsContainer, { childList:true, subtree:true });

    window.addEventListener('resize', ()=>{ snapToCenter(); });
  }

  function onDown(e){
    S.dragging = true;
    S.startX = e.clientX;
    S.deltaX = 0;
    S.lastDX = 0;
    car.classList.add('dragging');
  }
  function onMove(e){
    if (!S.dragging) return;
    S.deltaX = e.clientX - S.startX;
    S.lastDX = S.deltaX;

    // 只讓「中心卡片」跟手 － 少量位移（回彈）
    const cur = S.cards[S.idx];
    if (cur){
      const limit = S.width() * 0.06; // 最大 6% 寬度的跟隨
      const tx = Math.max(-limit, Math.min(limit, S.deltaX));
      cur.style.transform = `translate(-50%,-50%) translateX(${tx}px)`;
    }
  }
  function onUp(){
    if (!S.dragging) return;
    S.dragging = false;
    car.classList.remove('dragging');

    const th = Math.max(40, S.width()*0.08); // 觸發門檻
    const dx = S.lastDX;

    if (dx <= -th) {
      // 往左滑 → 下一張
      slideTo( +1 );
    } else if (dx >= th) {
      // 往右滑 → 上一張
      slideTo( -1 );
    } else {
      // 回彈
      snapToCenter();
    }
  }
  function onLeave(){
    if (!S.dragging) return;
    onUp();
  }

  function snapToCenter(){
    const cur = S.cards[S.idx];
    if (cur){
      cur.classList.add('center');
      cur.classList.remove('transitioning');
      cur.style.visibility = 'visible';
      cur.style.opacity = '1';
      cur.style.transform = `translate(-50%,-50%)`;
    }
    // 其它全部隱形
    S.cards.forEach((c,i)=>{
      if (i!==S.idx){
        c.classList.remove('center','transitioning');
        c.style.visibility = 'hidden';
        c.style.opacity = '0';
        c.style.transform = `translate(-50%,-50%)`;
      }
    });
    updateTexts();
    applyActiveLock();
  }

  function setCenter(newIdx){
    S.idx = ((newIdx % S.pools.length) + S.pools.length) % S.pools.length;
    snapToCenter();
  }

  // dir: +1 下一張；-1 上一張
  function slideTo(dir){
    const N = S.pools.length;
    if (N<=1){ snapToCenter(); return; }
    const curIdx = S.idx;
    const nxtIdx = ((curIdx + dir) % N + N) % N;

    const cur = S.cards[curIdx];
    const nxt = S.cards[nxtIdx];

    // 進場/退場初始狀態
    const offset = dir > 0 ? +1 : -1; // 下一張從右(+1)或左(-1)進場
    nxt.style.visibility = 'visible';
    nxt.style.opacity = '1';
    nxt.style.transform = `translate(-50%,-50%) translateX(${offset* (car.clientWidth*0.4)}px)`;
    nxt.classList.add('transitioning');

    // 觸發動畫
    requestAnimationFrame(()=>{
      // 退場
      if (cur){
        cur.classList.remove('center');
        cur.classList.add('transitioning');
        cur.style.transform = `translate(-50%,-50%) translateX(${ -offset* (car.clientWidth*0.4)}px)`;
      }
      // 進場
      nxt.style.transform = `translate(-50%,-50%)`;
    });

    // 動畫結束後收尾
    setTimeout(()=>{
      if (cur){
        cur.classList.remove('transitioning');
        cur.style.visibility = 'hidden';
        cur.style.opacity = '0';
        cur.style.transform = `translate(-50%,-50%)`;
      }
      nxt.classList.remove('transitioning');
      nxt.classList.add('center');
      setCenter(nxtIdx);
    }, 420); // 對齊 CSS .40s
  }

  function updateTexts(){
    const cur = S.pools[S.idx] || {};
    window.CURRENT_POOL = cur;
    if (poolNameEl) poolNameEl.textContent = cur.name || '';
    if (poolDescEl) poolDescEl.textContent = cur.desc || '';
  }

  function applyActiveLock(){
    const cur = S.pools[S.idx] || {};
    const active = cur?.active !== false || cur?.key === '常駐';
    // 不改你 canDraw 節流，只用 disabled 鎖住按鈕
    if (btnSingle) btnSingle._forceDisabled = !active;
    if (btnTen)    btnTen._forceDisabled    = !active;
    if (typeof enforceLandscape === 'function') enforceLandscape();
  }
})();
