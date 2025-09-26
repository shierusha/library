// /admin/js/targets.js
window.Targets = (()=>{
  /* ===================== 通用 API ===================== */
  async function api(action, data = {}, method = 'POST') {
    const url = '/admin/api.php?a=' + encodeURIComponent(action);
    try {
      if (method === 'GET') {
        const qs = new URLSearchParams(data).toString();
        const res = await fetch(qs ? (url + '&' + qs) : url, { method: 'GET' });
        return await res.json();
      } else {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        return await res.json();
      }
    } catch (e) {
      return { ok: false, msg: '請求失敗：' + (e?.message || e) };
    }
  }

  /* ===================== 內部快取 / 小工具 ===================== */
  let CAT_TREE = [];
  const CAT_CHILDREN = new Map();
  const CAT_NAME     = new Map();
  const CAT_PARENT   = new Map();
  let TARGETS = [];
  let searchTerm = '';
  const PICKER_STATE = new Map(); // tid => { attr, q, picked:Set }

  const SUBJ_LIST = ()=> (Array.isArray(window.SUBJ_LIST) ? window.SUBJ_LIST : []);
  const SUBJ_MAP  = ()=> (window.SUBJ_MAP instanceof Map ? window.SUBJ_MAP : new Map());

  async function ensureSubj(forceReload = false) {
    if (!forceReload && Array.isArray(window.SUBJ_LIST) && window.SUBJ_LIST.length) return;
    const r = await api('subj.list', {}, 'GET');
    if (r.ok && Array.isArray(r.data) && r.data.length) {
      const list = r.data.map(s => ({ ...s, subject_id: Number(s.subject_id) }));
      window.SUBJ_LIST = list;
      window.SUBJ_MAP = new Map(list.map(s => [s.subject_id, s]));
    } else {
      window.SUBJ_LIST = [];
      window.SUBJ_MAP = new Map();
      alert("科目清單載入失敗！請檢查 subj.list API 狀態");
    }
  }

  const normalizeTitle = s => (s||'').replace(/\s+/g,' ').trim();
  const toInt = v=>{ const n=Number(v); return Number.isFinite(n)?n:0; };
  const toNullInt = v => {
    const s = String(v ?? '').trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const qs = s=>document.querySelector(s);
  const qsa = s=>Array.from(document.querySelectorAll(s));
  const esc = s=>(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function isUnder(nodeId, ancestorId){
    const n = +nodeId||0, anc = +ancestorId||0;
    if(!anc) return true;
    let cur=n;
    while(cur){
      if(cur===anc) return true;
      cur = CAT_PARENT.get(cur) || 0;
    }
    return false;
  }

  /* ===================== 分類樹 ===================== */
  async function ensureCat(){
    if (CAT_TREE.length) return;
    const res = await api('cat.tree', {}, 'GET');
    if(!res.ok){ alert(res.msg||'載入分類失敗'); return; }
    CAT_TREE = res.data || [];
    CAT_CHILDREN.clear(); CAT_NAME.clear(); CAT_PARENT.clear();

    for(const r of CAT_TREE){
      const id=toInt(r.id), pid=toInt(r.parent_id), so=toInt(r.sort_order);
      CAT_NAME.set(id, r.name); CAT_PARENT.set(id, pid);
      const key = pid || 0;
      if(!CAT_CHILDREN.has(key)) CAT_CHILDREN.set(key, []);
      CAT_CHILDREN.get(key).push({id, name:r.name, sort_order:so});
    }
    for(const arr of CAT_CHILDREN.values()){
      arr.sort((a,b)=> (a.sort_order-b.sort_order) || (a.id-b.id));
    }
  }

  function buildCascade(rowId, hiddenId, crumbId, onChange){
    const row = qs('#'+rowId); if(!row) return;
    row.innerHTML=''; const hid = qs('#'+hiddenId); if (hid) hid.value='';
    addSelect(rowId, hiddenId, crumbId, 0, 0, onChange);
    updateCrumb(crumbId, getPath(rowId));
  }
  function addSelect(rowId, hiddenId, crumbId, level, parentId, onChange){
    const list = CAT_CHILDREN.get(+parentId||0) || [];
    if(!list.length) return;
    const sel = document.createElement('select');
    sel.setAttribute('data-level', String(level));
    sel.innerHTML = `<option value="">-- 選擇 --</option>` +
      list.map(x=>`<option value="${x.id}">#${x.id} ${esc(x.name)}</option>`).join('');
    sel.onchange = ()=>{
      qsa(`#${rowId} select`).forEach(s=>{ if(+s.dataset.level>level) s.remove(); });

      const id = toInt(sel.value);
      if(id){
        const kids = CAT_CHILDREN.get(id) || [];
        if(kids.length){ addSelect(rowId, hiddenId, crumbId, level+1, id, onChange); const hid = qs('#'+hiddenId); if (hid) hid.value=''; }
        else{ const hid = qs('#'+hiddenId); if (hid) hid.value = String(id); }
      }else{
        const hid = qs('#'+hiddenId); if (hid) hid.value='';
      }
      updateCrumb(crumbId, getPath(rowId));
      onChange && onChange(toInt(qs('#'+hiddenId)?.value || 0), getPath(rowId));
    };
    qs('#'+rowId).appendChild(sel);
  }
  function getPath(rowId){
    const ids=[]; qsa(`#${rowId} select`).forEach(s=>{ const v=toInt(s.value); if(v) ids.push(v); });
    return ids;
  }
  function updateCrumb(crumbId, ids){
    const el=qs('#'+crumbId); if(!el) return;
    el.textContent = ids.length ? ids.map(id=>CAT_NAME.get(id)||`#${id}`).join(' > ') : '';
  }

  /* ===================== 目標清單 ===================== */
  async function loadList(){
    const res = await api('target.list', {}, 'GET');
    TARGETS = res.ok ? (res.data||[]) : [];
  }

  function twoLevelLabel(catId){
    const id = +catId||0;
    const pid = CAT_PARENT.get(id)||0;
    const pName = pid ? (CAT_NAME.get(pid)||('#'+pid)) : '根';
    const cName = CAT_NAME.get(id) || ('#'+id);
    return `${pName}/${cName}`;
  }

  // 僅檢查「同分類」是否重名（符合 DB 的 UNIQUE(category_id,title)）
  function dupInCat(catId, title, ignoreId=null){
    const t = normalizeTitle(title);
    return TARGETS.find(x => x.category_id===+catId && normalizeTitle(x.title)===t && x.target_id!==ignoreId);
  }

  async function upsert(){
    const category_id = +qs('#leafSelect').value||0;
    const title       = normalizeTitle(qs('#tgtTitle').value);
    const price_1y_list = toNullInt(qs('#tgt1yList').value);
    const price_1y_sale = toNullInt(qs('#tgt1ySale').value);
    const price_6m_list = toNullInt(qs('#tgt6mList').value);
    const price_6m_sale = toNullInt(qs('#tgt6mSale').value);
    const image_url   = qs('#tgtImg').value.trim();

    if(!category_id){ qs('#tgtMsg').textContent='⚠️ 請先一路選到葉分類'; return; }
    if(!title){ qs('#tgtMsg').textContent='⚠️ 名稱不可空白'; return; }
    if(dupInCat(category_id,title)){ qs('#tgtMsg').textContent='⚠️ 此分類已有同名'; return; }

    const res = await api('target.upsert',{
      category_id,title,
      price_1y_list, price_1y_sale,
      price_6m_list, price_6m_sale,
      image_url
    });
    qs('#tgtMsg').textContent = res.ok ? '✅ 已新增/更新' : ('⚠️ '+(res.msg||'失敗'));
    if(res.ok){
      qs('#tgtTitle').value='';
      ['#tgt1yList','#tgt1ySale','#tgt6mList','#tgt6mSale','#tgtImg'].forEach(s=>{ const el=qs(s); if(el) el.value=''; });
      await loadList(); renderTable();
    }
  }

  async function save(id,cat, btn){
    const title          = normalizeTitle(qs(`[data-ttitle="${id}"]`).value);
    const price_1y_list  = toNullInt(qs(`[data-t1yl="${id}"]`).value);
    const price_1y_sale  = toNullInt(qs(`[data-t1ys="${id}"]`).value);
    const price_6m_list  = toNullInt(qs(`[data-t6ml="${id}"]`).value);
    const price_6m_sale  = toNullInt(qs(`[data-t6ms="${id}"]`).value);
    const image_url      = qs(`[data-timg="${id}"]`).value.trim();

    if(!title){ qs('#tgtMsg').textContent='⚠️ 名稱不可空白'; return; }
    if(dupInCat(cat,title,id)){ qs('#tgtMsg').textContent='⚠️ 此分類已有同名'; return; }

    // 防連點 + UI 回饋
    let oldText;
    if (btn) { oldText = btn.textContent; btn.disabled = true; btn.textContent = '儲存中…'; }
    qs('#tgtMsg').textContent = '';

    const res=await api('target.upsert',{
      category_id:cat, title,
      price_1y_list, price_1y_sale,
      price_6m_list, price_6m_sale,
      image_url
    });

    if (btn) { btn.disabled = false; btn.textContent = oldText || '儲存'; }

    qs('#tgtMsg').textContent = res.ok ? '✅ 已儲存' : ('⚠️ '+(res.msg||'失敗'));
    if(res.ok){ await loadList(); renderTable(); }
  }

  async function del_(id){
    if(!confirm('確定刪除此目標職務？')) return;
    const res=await api('target.delete',{target_id:id});
    qs('#tgtMsg').textContent = res.ok ? '已刪除' : ('⚠️ '+(res.msg||'失敗'));
    if(res.ok){ await loadList(); renderTable(); }
  }

  function applySearch(){
    searchTerm = (qs('#tgtSearch')?.value||'').trim();
    renderTable();
  }

  function renderTable(){
    const t = qs('#tgtTable'); if(!t) return;
    const nodeEl = qs('#viewNode');
    const node = nodeEl ? (+nodeEl.value || 0) : 0;
    const term = (searchTerm||'').toLowerCase();

    const rows = TARGETS.filter(x =>
      isUnder(x.category_id, node) &&
      (!term || String(x.title||'').toLowerCase().includes(term))
    );

    t.innerHTML = `<tr>
      <th>#</th><th>分類</th><th>名稱</th>
      <th>一年售</th><th>一年優</th><th>半年售</th><th>半年優</th>
      <th>圖片</th><th>包含科目</th><th>操作</th>
    </tr>` + rows.map(r=>`
      <tr id="tRow-${r.target_id}">
        <td>${r.target_id}</td>
        <td>${esc(twoLevelLabel(r.category_id))}</td>
        <td><input value="${esc(r.title)}" data-ttitle="${r.target_id}"></td>

        <td><input type="number" min="0" step="1" value="${r.price_1y_list ?? ''}" data-t1yl="${r.target_id}" style="width:90px"></td>
        <td><input type="number" min="0" step="1" value="${r.price_1y_sale ?? ''}" data-t1ys="${r.target_id}" style="width:90px"></td>
        <td><input type="number" min="0" step="1" value="${r.price_6m_list ?? ''}" data-t6ml="${r.target_id}" style="width:90px"></td>
        <td><input type="number" min="0" step="1" value="${r.price_6m_sale ?? ''}" data-t6ms="${r.target_id}" style="width:90px"></td>

        <td><input value="${esc(r.image_url||'')}" data-timg="${r.target_id}" style="min-width:160px"></td>
        <td>
          <button type="button" onclick="Targets.toggleTRSAcc(${r.target_id})">展開</button>
          <span class="muted" id="trsBadge-${r.target_id}" style="margin-left:6px"></span>
        </td>
        <td>
          <button type="button" onclick="Targets.save(${r.target_id},${r.category_id}, this)">儲存</button>
          <button class="btn-del" type="button" onclick="Targets.del(${r.target_id})">刪除</button>
        </td>
      </tr>
      <tr id="tAcc-${r.target_id}" style="display:none">
        <td colspan="10" id="tAccBody-${r.target_id}" class="pad muted">（載入中…）</td>
      </tr>
    `).join('');

    rows.forEach(r=>refreshTRSBadge(r.target_id));
  }

  // ========== 展開、設定科目 =============
  async function toggleTRSAcc(tid) {
    const row = qs(`#tAcc-${tid}`);
    const body = qs(`#tAccBody-${tid}`);
    const shown = row.style.display !== 'none';
    if (shown) { row.style.display = 'none'; return; }
    row.style.display = '';
    body.textContent = '（載入中…）';

    await ensureSubj();
    let subjMap = SUBJ_MAP();

    const cur = await api('trs.get', { target_id: tid }, 'GET');
    if (!cur.ok) { body.textContent = '讀取失敗：' + (cur.msg || ''); return; }
    const picked = (cur.data||[]).map(x=>+x.subject_id);

    const hasMiss = picked.find(id=>!subjMap.get(id));
    if (hasMiss) {
      await ensureSubj(true);
      subjMap = SUBJ_MAP();
    }

    if(!PICKER_STATE.has(tid)) PICKER_STATE.set(tid, {attr:'', q:'', picked:new Set(picked)});
    else PICKER_STATE.get(tid).picked = new Set(picked);

    const lis = picked.length ? picked.map(id => {
      const s = subjMap.get(id);
      return `<li>#${id} ${esc(s?.name || '(已刪除)')}（${s?.attr || ''}）</li>`;
    }).join('') : '<li class="muted">尚未設定</li>';

    body.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px">
        <strong>已選科目：</strong>
        <button type="button" onclick="Targets.openSubjectPicker(${tid})">設定科目</button>
        <span class="muted">（可多選/過濾/搜尋）</span>
      </div>
      <ul style="margin:0 0 8px 1.2em">${lis}</ul>
      <div id="trsPick-${tid}" class="pad" style="display:none; border:1px dashed #e6ecf6; border-radius:8px"></div>
    `;
    refreshTRSBadge(tid, picked.length);
  }

  function renderPickerUI(tid, subj, pickedSet){
    const state = PICKER_STATE.get(tid) || {attr:'', q:'', picked:new Set()};
    const attr = state.attr || '';
    const q = (state.q||'').toLowerCase();

    const filtered = subj.filter(s=>{
      const byAttr = !attr || s.attr===attr;
      const byQ = !q || String(s.name||'').toLowerCase().includes(q) || String(s.subject_id||'').includes(q);
      return byAttr && byQ;
    });

    const chips = filtered.length ? filtered.map(s=>`
      <label class="br-btn" style="border-radius:8px;margin:4px 6px 4px 0">
        <input type="checkbox" data-trs-pick="${tid}" value="${s.subject_id}" 
          ${pickedSet.has(s.subject_id)?'checked':''}
          onchange="Targets.onPickTRSItem(${tid}, this.value, this.checked)">
        ${esc(s.name)}（${s.attr}） #${s.subject_id}
      </label>
    `).join('') : `<span class="muted">（沒有符合條件的科目）</span>`;

    return `
      <div class="rowline" style="margin-bottom:6px">
        <select id="pickerAttr-${tid}" onchange="Targets.applyPickerFilter(${tid})">
          <option value="">全部屬性</option>
          <option value="共同科目" ${attr==='共同科目'?'selected':''}>共同科目</option>
          <option value="專業科目" ${attr==='專業科目'?'selected':''}>專業科目</option>
        </select>
        <input id="pickerQ-${tid}" placeholder="輸入關鍵字（名稱或編號）" value="${esc(state.q||'')}" onkeydown="if(event.key==='Enter'){Targets.applyPickerFilter(${tid})}">
        <button type="button" onclick="Targets.applyPickerFilter(${tid})">搜尋</button>
        <button type="button" onclick="Targets.resetPickerFilter(${tid})">清除</button>
      </div>
      <div style="margin:6px 0; max-height:220px; overflow:auto">${chips}</div>
      <div class="rowline" style="margin-top:8px">
        <button class="primary" type="button" onclick="Targets.saveTRS(${tid})">儲存包含科目</button>
        <button type="button" onclick="Targets.cancelTRS(${tid})">取消</button>
        <span class="msg" id="trsMsg-${tid}"></span>
      </div>
    `;
  }

  function onPickTRSItem(tid, id, checked){
    id = +id;
    const state = PICKER_STATE.get(tid) || {attr:'', q:'', picked:new Set()};
    if(!state.picked) state.picked = new Set();
    if(checked) state.picked.add(id); else state.picked.delete(id);
    PICKER_STATE.set(tid, state);
  }

  async function openSubjectPicker(tid){
    await ensureSubj();
    let subj = SUBJ_LIST();

    if (!Array.isArray(subj) || subj.length === 0) {
      await ensureSubj(true);
      subj = SUBJ_LIST();
    }

    const pickedSet = PICKER_STATE.get(tid)?.picked || new Set();

    const box = qs(`#trsPick-${tid}`); if(!box) return;
    box.style.display='';
    box.innerHTML = renderPickerUI(tid, subj, pickedSet);
  }

  function applyPickerFilter(tid){
    const state = PICKER_STATE.get(tid) || {attr:'', q:'', picked:new Set()};
    state.attr = qs(`#pickerAttr-${tid}`)?.value || '';
    state.q    = qs(`#pickerQ-${tid}`)?.value || '';
    PICKER_STATE.set(tid, state);
    reopenPickerPreservingChecks(tid);
  }

  function resetPickerFilter(tid){
    const state = PICKER_STATE.get(tid) || {attr:'', q:'', picked:new Set()};
    state.attr = '';
    state.q = '';
    PICKER_STATE.set(tid, state);
    reopenPickerPreservingChecks(tid);
  }

  function reopenPickerPreservingChecks(tid){
    const state = PICKER_STATE.get(tid) || {attr:'', q:'', picked:new Set()};
    const subj = SUBJ_LIST();
    const box = qs(`#trsPick-${tid}`); if(!box) return;
    box.innerHTML = renderPickerUI(tid, subj, state.picked || new Set());
  }

  async function saveTRS(tid){
    const btn = document.querySelector(`#trsPick-${tid} .rowline button.primary`);
    const msgEl = qs(`#trsMsg-${tid}`); if (msgEl) msgEl.textContent = '';

    // 直接從畫面讀取被勾選科目，避免快取不同步
    const selectedIds = Array.from(document.querySelectorAll(`input[data-trs-pick="${tid}"]:checked`))
      .map(el => Number(el.value))
      .filter(n => Number.isFinite(n));

    if (btn) { btn.disabled = true; btn.textContent = '儲存中…'; }
    const res = await api('trs.set',{target_id:tid, subject_ids: selectedIds}, 'POST');
    if (btn) { btn.disabled = false; btn.textContent = '儲存包含科目'; }

    if(!res.ok){
      if(msgEl) msgEl.textContent = '⚠️ '+(res.msg||'儲存失敗');
      return;
    }

    // 成功：更新徽章與「已選科目」清單（不關閉手風琴）
    refreshTRSBadge(tid, selectedIds.length);

    const cur = await api('trs.get', { target_id: tid }, 'GET');
    const picked = (cur.ok ? cur.data : []).map(x=>+x.subject_id);
    const subjMap = SUBJ_MAP();
    const lis = picked.length ? picked.map(id => {
      const s = subjMap.get(id);
      return `<li>#${id} ${esc(s?.name || '(已刪除)')}（${s?.attr || ''}）</li>`;
    }).join('') : '<li class="muted">尚未設定</li>';

    const body = qs(`#tAccBody-${tid}`);
    if (body) {
      const top = body.querySelector('ul');
      if (top) top.innerHTML = lis;
    }
    if(msgEl) msgEl.textContent = '✅ 已儲存';
  }

  function cancelTRS(tid){
    const box = qs(`#trsPick-${tid}`); if(box){ box.style.display='none'; }
  }

  async function refreshTRSBadge(tid, countOverride){
    let n = countOverride;
    if(n===undefined){
      const cur=await api('trs.get', { target_id: tid }, 'GET');
      n = cur.ok ? cur.data.length : 0;
    }
    const badge = qs(`#trsBadge-${tid}`);
    if(badge) badge.textContent = n ? `共 ${n} 科` : '未設定';
  }

  function showLeafFormIfAny(){
    const el = qs('#tgtForm');
    if(el) el.style.display = +qs('#leafSelect')?.value ? '' : 'none';
  }

  async function init(){
    await ensureCat();
    buildCascade('catSelectRow','leafSelect','catCrumb', ()=>{ showLeafFormIfAny(); });
    buildCascade('catViewRow','viewNode','viewCrumb', ()=>{
      const ids = getPath('catViewRow');
      const v = qs('#viewNode'); if (v) v.value = ids.length ? String(ids[ids.length-1]) : '';
      renderTable();
    });
    const s=qs('#tgtSearch'); if(s){ s.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); applySearch(); } }); }
    await loadList();
    renderTable();
  }

  /* ===================== 對外 API ===================== */
  return {
    init, upsert, save, del: del_,
    applySearch,
    toggleTRSAcc,
    openSubjectPicker, applyPickerFilter, resetPickerFilter,
    saveTRS, cancelTRS,
    onPickTRSItem
  };
})();
