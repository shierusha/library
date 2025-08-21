(()=>{
  // ========= 1) Supabase 連線（換成你的專案） =========
  const SUPABASE_URL      = 'https://YOUR_PROJECT.ref.supabase.co';
  const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
  const supabase = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  // ========= 2) DOM/小工具 =========
  const $  = (s,r=document)=>r.querySelector(s);
  const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
  const uid=()=>Math.random().toString(36).slice(2,10);
  const escapeHtml=s=>(s||'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate=ts=> new Date(ts).toLocaleDateString();
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const isValidHex=s=>/^#?[0-9a-fA-F]{6}$/.test(s);

  // 色相濾鏡（替封面圖上色）
  function hexToHsl(hex){
    let s=hex.replace('#',''); if(s.length===3) s=s.split('').map(c=>c+c).join('');
    const r=parseInt(s.slice(0,2),16)/255, g=parseInt(s.slice(2,4),16)/255, b=parseInt(s.slice(4,6),16)/255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b); let h=0, l=(max+min)/2, d=max-min, S=0;
    if(d!==0){ S=l>0.5? d/(2-max-min) : d/(max+min); switch(max){ case r:h=(g-b)/d+(g<b?6:0);break; case g:h=(b-r)/d+2;break; case b:h=(r-g)/d+4;break;} h*=60; }
    return {h, s:S, l};
  }
  const buildFilterFromHex=(hex)=>{ const {h,l}=hexToHsl(hex); return `sepia(0.1) saturate(600%) hue-rotate(${Math.round(h)}deg) brightness(${Math.round(60+(l*40))}%)`; };

  // 書名顯示規則（最多20字，10字自動換行）
  const formatTitle=(t)=>{
    t = (t||'未命名').slice(0,20);
    if(t.length>10) t = t.slice(0,10) + '\n' + t.slice(10);
    return t;
  };

  // ========= 3) LocalStorage 後備實作（無 token 時使用） =========
  const LIB_KEY='xer_book_library_v1', BOOK_PREFIX='xer_book_';
  const LocalStore = {
    async list(){ try{ return JSON.parse(localStorage.getItem(LIB_KEY))||[] }catch{ return [] } },
    saveList(list){ localStorage.setItem(LIB_KEY, JSON.stringify(list)) },
    async get(id){ try{ return JSON.parse(localStorage.getItem(BOOK_PREFIX+id))||null }catch{ return null } },
    async create(meta){
      const book={ id:uid(), title:meta.title||'未命名書籍', binding:meta.binding||'short', direction:meta.direction||'ltr',
                   viewMode:meta.view||'single', cover_color:'#7c8cfb', cover_image:'https://shierusha.github.io/school-battle/images/book.png',
                   page_count:0, updated_at:new Date().toISOString(), created_at:new Date().toISOString() };
      localStorage.setItem(BOOK_PREFIX+book.id, JSON.stringify(book));
      const list=await this.list(); list.unshift({
        id:book.id, title:book.title, updatedAt:Date.now(), direction:book.direction, viewMode:book.viewMode,
        coverColor:book.cover_color, coverImage:book.cover_image
      }); this.saveList(list);
      return book;
    },
    async update(id, patch){
      const b=await this.get(id); if(!b) return null;
      Object.assign(b, patch, { updated_at:new Date().toISOString() });
      localStorage.setItem(BOOK_PREFIX+id, JSON.stringify(b));
      const list=await this.list(); const i=list.findIndex(x=>x.id===id);
      if(i>-1){ list[i].title=b.title; list[i].updatedAt=Date.now(); list[i].coverColor=b.cover_color; list[i].coverImage=b.cover_image; this.saveList(list); }
      return b;
    },
    async delete(id){ localStorage.removeItem(BOOK_PREFIX+id); this.saveList((await this.list()).filter(x=>x.id!==id)); },
    async duplicate(id){ const src=await this.get(id); if(!src) return null; const c=structuredClone(src); c.id=uid(); c.title=(src.title||'未命名')+'（副本）'; await this.update(c.id,c); localStorage.setItem(BOOK_PREFIX+c.id, JSON.stringify(c)); const list=await this.list(); list.unshift({id:c.id,title:c.title,updatedAt:Date.now(),coverColor:c.cover_color,coverImage:c.cover_image}); this.saveList(list); },
    async move(id,newIndex){
      const list=await this.list(); const i=list.findIndex(x=>x.id===id); if(i<0) return;
      const [item]=list.splice(i,1); const j=clamp(newIndex,0,list.length); list.splice(j,0,item); this.saveList(list);
    }
  };

  // ========= 4) Supabase 實作（有 session/owner 時使用） =========
  const SupaStore = {
    _ownerId: null,
    setOwnerId(id){ this._ownerId=id },
    async _user(){
      const { data:{ user } } = await supabase.auth.getUser();
      return user;
    },
    async list(){
      // 交給 RLS：owner_id = auth.uid()
      const { data, error } = await supabase.from('books')
        .select('id,title,updated_at,cover_color,cover_image,sort_order,page_count')
        .order('sort_order',{ascending:true})
        .order('updated_at',{ascending:false});
      if(error){ console.error(error); return []; }
      // 映射成 UI 用欄位名稱
      return (data||[]).map(r=>({
        id:r.id,
        title:r.title,
        updatedAt:new Date(r.updated_at).getTime(),
        coverColor:r.cover_color || '#7c8cfb',
        coverImage:r.cover_image || 'https://shierusha.github.io/school-battle/images/book.png',
        page_count:r.page_count ?? 0,
        sort_order:r.sort_order ?? 1
      }));
    },
    async get(id){ const { data, error } = await supabase.from('books').select('*').eq('id',id).single(); if(error) return null; return data; },
    async create(meta){
      const user = await this._user(); // 正常情況要有 user
      const owner_id = user?.id || window.SUPABASE_OWNER_ID;
      if(!owner_id){ alert('無法建立書籍：沒有 owner_id（需先帶入 token 或設定 window.SUPABASE_OWNER_ID）'); return null; }
      const payload = {
        owner_id,
        title: meta.title || '未命名書籍',
        binding: meta.binding || 'short',
        direction: meta.direction || 'ltr',
        cover_color: '#7c8cfb',
        cover_image: 'https://shierusha.github.io/school-battle/images/book.png',
        page_count: 0,
        sort_order: 1
      };
      const { data, error } = await supabase.from('books').insert(payload).select('*').single();
      if(error){ alert('建立失敗：'+error.message); return null; }
      return data;
    },
    async update(id, patch){
      // 允許 patch: title, cover_color, cover_image, sort_order, page_count
      const { data, error } = await supabase.from('books').update(patch).eq('id', id).select('*').single();
      if(error){ alert('更新失敗：'+error.message); return null; }
      return data;
    },
    async delete(id){
      await supabase.from('chapters').delete().eq('book_id', id);
      await supabase.from('pages').delete().eq('book_id', id);
      const { error } = await supabase.from('books').delete().eq('id', id);
      if(error){ alert('刪除失敗：'+error.message); }
    },
    async duplicate(id){
      const { data:src, error:e1 } = await supabase.from('books').select('*').eq('id', id).single();
      if(e1){ alert('讀取原書失敗：'+e1.message); return; }
      const user = await this._user();
      const payload = {
        owner_id: user?.id || window.SUPABASE_OWNER_ID,
        title: (src.title||'未命名')+'（副本）',
        binding: src.binding, direction: src.direction,
        cover_color: src.cover_color, cover_image: src.cover_image,
        sort_order: 1, page_count: 0
      };
      const { error:e2 } = await supabase.from('books').insert(payload);
      if(e2){ alert('建立副本失敗：'+e2.message); }
    },
    async move(id, newIndex){
      // 取目前清單，重排 sort_order 1..N
      const list = await this.list();
      const i=list.findIndex(x=>x.id===id); if(i<0) return;
      const [item]=list.splice(i,1);
      const j=clamp(newIndex,0,list.length);
      list.splice(j,0,item);
      // 批次更新 sort_order
      await Promise.all(list.map((b,idx)=> supabase.from('books').update({ sort_order: idx+1 }).eq('id', b.id)));
    }
  };

  // ========= 5) Session 啟動邏輯（無登入頁也能帶 token） =========
  async function trySetSessionFromHash(){
    if(!supabase) return;
    const qp=new URLSearchParams(location.hash.startsWith('#')?location.hash.slice(1):location.hash);
    const at=qp.get('access_token'), rt=qp.get('refresh_token');
    if(at && rt){ await supabase.auth.setSession({ access_token:at, refresh_token:rt }); }
  }
  // 提供外部呼叫
  window.setSupabaseSession = async (access_token, refresh_token)=>{
    if(!supabase){ console.warn('supabase-js 未載入'); return; }
    await supabase.auth.setSession({ access_token, refresh_token });
    await boot(); // 重新以 Supabase 模式渲染
  };

  // 選擇使用哪個 Store
  let Store = LocalStore;
  async function pickStore(){
    if(!supabase) { Store = LocalStore; return; }
    await trySetSessionFromHash();
    const { data:{ user } } = await supabase.auth.getUser();
    if(user || window.SUPABASE_OWNER_ID){ SupaStore.setOwnerId(user?.id || window.SUPABASE_OWNER_ID); Store=SupaStore; }
    else { Store=LocalStore; } // 沒 token 就降級
  }

  // ========= 6) UI：書庫渲染 & 事件 =========
  const libGrid   = $('#libGrid');
  const dlgNew    = $('#dlgNew');
  const dlgRename = $('#dlgRename');
  const renameInp = $('#rename_title');
  let renameTargetId = null;

  function renderCardList(list){
    if(!list.length){
      libGrid.innerHTML = `
        <div class="card">
          <h3>${formatTitle('還沒有書籍')}</h3>
          <div class="muted">點右上角「＋ 新增書籍」開始吧。</div>
        </div>`;
      return;
    }
    libGrid.innerHTML = list.map((m,idx)=>`
      <div class="card" data-id="${m.id}">
        <button class="sort-btn prev" title="往前排">←</button>
        <button class="sort-btn next" title="往後排">→</button>

        <div class="corner-tools">
          <img alt="cover" src="${escapeHtml(m.coverImage || 'https://shierusha.github.io/school-battle/images/book.png')}"
               style="filter:${buildFilterFromHex(m.coverColor||'#7c8cfb')}">
          <div class="row">
            <input type="color" value="${escapeHtml(m.coverColor||'#7c8cfb')}" data-role="color">
            <input class="hex" value="${escapeHtml(m.coverColor||'#7c8cfb')}" maxlength="7" data-role="hex">
          </div>
        </div>

        <h3 class="title-wrap">${escapeHtml(formatTitle(m.title))}<button class="title-edit" type="button" title="編輯書名">✎</button></h3>
        <div class="muted">頁數：${m.page_count ?? 0}｜最後更新：${fmtDate(m.updatedAt)}</div>

        <div class="actions">
          <button class="btn primary" data-act="open">開啟</button>
          <button class="btn" data-act="dup">製作副本</button>
          <button class="btn danger" data-act="del">刪除</button>
        </div>
      </div>
    `).join('');

    // 綁定每張卡片
    $$('#libGrid .card').forEach((card, cardIndex)=>{
      const id = card.dataset.id;
      const img = card.querySelector('.corner-tools img');
      const colorInput = card.querySelector('[data-role="color"]');
      const hexInput   = card.querySelector('[data-role="hex"]');
      const titleWrap  = card.querySelector('.title-wrap');
      const editBtn    = card.querySelector('.title-edit');

      // 顏色同步
      const applyColor = async (hex)=>{
        if(!hex.startsWith('#')) hex = '#'+hex;
        if(!isValidHex(hex)){ alert('請輸入正確的 HEX 顏色（例如 #7c8cfb）'); return; }
        img.style.filter = buildFilterFromHex(hex);
        colorInput.value = hex; hexInput.value = hex;
        await Store.update(id, { cover_color: hex, updated_at: new Date().toISOString() });
      };
      colorInput.addEventListener('input', ()=> applyColor(colorInput.value));
      hexInput.addEventListener('change', ()=> applyColor(hexInput.value.trim()));

      // 開啟／副本／刪除
      card.querySelector('[data-act="open"]').onclick = ()=> openBook(id);
      card.querySelector('[data-act="dup"]').onclick  = async ()=>{ await Store.duplicate(id); await renderLibrary(); };
      card.querySelector('[data-act="del"]').onclick  = async ()=>{
        if(confirm('確定刪除此書？')){ await Store.delete(id); await renderLibrary(); }
      };

      // 排序（固定角落按鈕）
      card.querySelector('.sort-btn.prev').onclick = async ()=>{ await Store.move(id, cardIndex-1); await renderLibrary(); };
      card.querySelector('.sort-btn.next').onclick = async ()=>{ await Store.move(id, cardIndex+1); await renderLibrary(); };

      // 邊界感應：靠近左右邊界顯示箭頭
      card.addEventListener('mousemove', (e)=>{
        const r=card.getBoundingClientRect(); const x=e.clientX-r.left; const edge=Math.max(24,r.width*0.12);
        card.classList.toggle('near-left',  x<edge);
        card.classList.toggle('near-right', (r.width-x)<edge);
      });
      card.addEventListener('mouseleave', ()=> card.classList.remove('near-left','near-right'));
      card.addEventListener('click',(e)=>{
        const tag=(e.target.tagName||'').toLowerCase();
        if(['button','input','select'].includes(tag)) return;
        const r=card.getBoundingClientRect(); const x=e.clientX-r.left;
        card.classList.toggle('near-left', x<r.width/2);
        card.classList.toggle('near-right', x>=r.width/2);
        setTimeout(()=> card.classList.remove('near-left','near-right'), 2500);
      });

      // 書名改名彈窗
      editBtn.addEventListener('click', async (ev)=>{
        ev.stopPropagation();
        renameTargetId = id;
        const b = await Store.get(id);
        renameInp.value = b?.title || '';
        $('#dlgRename').showModal();
      });
    });
  }

  async function renderLibrary(){
    const list = await Store.list();
    renderCardList(list);
  }

  // 「開啟」交給第二支 editor.js
  function openBook(id){
    if(window.Editor?.open) window.Editor.open(id);
    else alert(`（editor.js 尚未載入）將開啟 ID: ${id}`);
  }

  // ========= 7) 新增 & 改名 =========
  $('#btnNew').addEventListener('click',()=>{ $('#formNew').reset(); $('#dlgNew').showModal(); });
  $('#btnCreate').addEventListener('click', async ()=>{
    const meta = {
      title:    $('#f_title').value.trim() || '未命名書籍',
      binding:  $('#f_binding').value,
      direction:$('#f_direction').value,
      view:     $('#f_view').value
    };
    const book = await Store.create(meta);
    if(book){ $('#dlgNew').close(); await renderLibrary(); if(window.Editor?.open) window.Editor.open(book.id); }
  });

  $('#btnRenameSave').addEventListener('click', async ()=>{
    let t = (renameInp.value||'').replace(/\n/g,'').trim(); if(!t) t='未命名'; if(t.length>20) t=t.slice(0,20);
    if(renameTargetId){ await Store.update(renameTargetId, { title:t, updated_at:new Date().toISOString() }); }
    $('#dlgRename').close();
    renameTargetId=null; await renderLibrary();
  });
// ========= X) 一次性提示 & 通用關閉綁定（★ NEW） =========
function showTipOnce() {
  const KEY = 'xer_book_tip_v1';
  if (sessionStorage.getItem(KEY)) return;
  sessionStorage.setItem(KEY, '1');
  alert(
    [
      '小提示：',
      '• 點「書名右上角」的 ✎ 可更改書名',
      '• 點書卡「左上 ← / 右下 →」可調整排序'
    ].join('\n')
  );
}

// 統一綁定所有 <dialog> 的關閉按鈕（具 data-close 屬性）（★ NEW）
function bindDialogCloseButtons() {
  document.querySelectorAll('dialog').forEach(dlg => {
    dlg.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest('[data-close]')) {
        dlg.close();                 // 關閉 dialog
        const form = dlg.querySelector('form');
        if (form) form.reset?.();    // 有表單就順手 reset
      }
    });
  });
}

// 特別保險：如果你有「新增書籍」取消按鈕但沒 data-close，這裡也幫你綁上（★ NEW）
function bindLegacyCancelIds() {
  const dlgNew = document.getElementById('dlgNew');
  const btns = [
    '#btnNewCancel',
    '#btnCreateCancel',
    '#btnCancel',       // 常見命名
  ];
  btns.forEach(sel => {
    const el = document.querySelector(sel);
    if (el && dlgNew) el.addEventListener('click', () => dlgNew.close());
  });

  // 也順便處理改名視窗的取消（如果存在）
  const dlgRename = document.getElementById('dlgRename');
  const renameCancel = document.getElementById('btnRenameCancel');
  if (dlgRename && renameCancel) {
    renameCancel.addEventListener('click', () => dlgRename.close());
  }
}
// ========= 8) 啟動：依 session 選 Store 然後渲染 =========
async function boot(){
  await pickStore();
  await renderLibrary();
  bindDialogCloseButtons(); // ★ NEW
  bindLegacyCancelIds();    // ★ NEW
  showTipOnce();            // ★ NEW
}
boot();
})();
