<script>
// ===== 共用守門：A 同步登出 + B 自動續簽 =====
const A_URL  = 'https://wfhwhvodgikpducrhgda.supabase.co';
const A_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmaHdodm9kZ2lrcGR1Y3JoZ2RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgwMTAwNjEsImV4cCI6MjA2MzU4NjA2MX0.P6P-x4SxjiR4VdWH6VFgY_ktgMac_OzuI4Bl7HWskz8';

const B_URL  = 'https://ogzpfrkwnqqaitytncla.supabase.co';
const B_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nenBmcmt3bnFxYWl0eXRuY2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUxODQzNzEsImV4cCI6MjA3MDc2MDM3MX0.Ls83xOXcKIW7FUcavr8_sOs37I18VGFWYNW3sNFRS24';
const EXCHANGE_URL = B_URL + '/functions/v1/exchange-token';

const HOME_URL = 'https://shierusha.github.io/create-student/player';

const aClient = window.supabase.createClient(A_URL, A_ANON);

let _guardExited = false;
let _bClient = null;
let _refreshing = null;

function cleanupBAndGoHome(showAlert = true) {
  if (_guardExited) return;
  _guardExited = true;

  localStorage.removeItem('gacha_b_jwt');
  localStorage.removeItem('gacha_b_jwt_exp');
  localStorage.removeItem('gacha_b_user');
  localStorage.removeItem('gacha_player_name');
  localStorage.removeItem('gacha_app_role');

  try { if (showAlert) alert('您已在主站登出，將返回玩家中心。'); } catch {}
  location.replace(HOME_URL);
}

async function checkASessionOnce() {
  try {
    const { data: { session } } = await aClient.auth.getSession();
    if (!session) cleanupBAndGoHome(false);
    return session;
  } catch {
    cleanupBAndGoHome(false);
    return null;
  }
}

// —— A 狀態守門 ——
// 頁面剛開檢一次
checkASessionOnce();
// 監聽 A 的登出事件
aClient.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') cleanupBAndGoHome(true);
});
// 回到可視時再檢一次
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkASessionOnce(); });
// 多分頁同步
window.addEventListener('storage', () => { checkASessionOnce(); });
// 每 60 秒保險檢查
setInterval(checkASessionOnce, 60 * 1000);

// —— B 自動續簽 ——
// 讀/寫本機 B token
function readB() {
  return {
    token: localStorage.getItem('gacha_b_jwt') || '',
    exp: Number(localStorage.getItem('gacha_b_jwt_exp') || 0),
  };
}
function saveB(j) {
  localStorage.setItem('gacha_b_jwt', j.token);
  localStorage.setItem('gacha_b_jwt_exp', String(j.exp || 0));
  if (j.sub)  localStorage.setItem('gacha_b_user', j.sub);
  if (j.role) localStorage.setItem('gacha_app_role', j.role);
}
const nowSec = () => Math.floor(Date.now() / 1000);

// 確保有一顆夠新的 B token；minTtlSec 內即視為「快到期」需續
async function ensureBToken({ minTtlSec = 15 * 60 } = {}) {
  if (_refreshing) return _refreshing; // 正在續簽

  const { token, exp } = readB();
  const ttl = exp - nowSec();

  // 有 token 且壽命>門檻，直接用
  if (token && ttl > minTtlSec) {
    if (!_bClient) {
      _bClient = window.supabase.createClient(B_URL, B_ANON, {
        global: { headers: { Authorization: `Bearer ${token}` } }
      });
      _bClient.realtime.setAuth(token);
    }
    return token;
  }

  // 沒有或快過期：用 A 的 access_token 去換
  _refreshing = (async () => {
    const { data: { session } } = await aClient.auth.getSession();
    if (!session) { cleanupBAndGoHome(false); throw new Error('No A session'); }

    const resp = await fetch(EXCHANGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: session.access_token })
    });
    const j = await resp.json();
    if (!resp.ok || !j?.token) throw new Error(j?.detail || 'exchange failed');

    saveB(j);
    _bClient = window.supabase.createClient(B_URL, B_ANON, {
      global: { headers: { Authorization: `Bearer ${j.token}` } }
    });
    _bClient.realtime.setAuth(j.token);
    _refreshing = null;
    return j.token;
  })().catch(e => { _refreshing = null; throw e; });

  return _refreshing;
}

// 取得可用的 B client（會自動續簽）
async function getBClient() {
  await ensureBToken({ minTtlSec: 15 * 60 }); // 低於 15 分鐘就提前換新
  return _bClient;
}
window.getBClient = getBClient;

// 週期性地「溫和續簽」：每 30 分鐘檢一次，若 < 1 小時則換新
setInterval(() => {
  ensureBToken({ minTtlSec: 60 * 60 }).catch(() => {});
}, 30 * 60 * 1000);
</script>
