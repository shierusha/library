// ==== B 跟著 A 的登入狀態走（共用守門檔） ====
const A_URL  = 'https://wfhwhvodgikpducrhgda.supabase.co';
const A_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmaHdodm9kZ2lrcGR1Y3JoZ2RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgwMTAwNjEsImV4cCI6MjA2MzU4NjA2MX0.P6P-x4SxjiR4VdWH6VFgY_ktgMac_OzuI4Bl7HWskz8';
const HOME_URL = 'https://shierusha.github.io/create-student/player';

const aClient = window.supabase.createClient(A_URL, A_ANON);

// 避免重複觸發（多個定時器/事件齊叫）
let _guardExited = false;

function cleanupBAndGoHome(showAlert = true) {
  if (_guardExited) return;
  _guardExited = true;

  // 清 B 端本機狀態
  localStorage.removeItem('gacha_b_jwt');
  localStorage.removeItem('gacha_b_jwt_exp');
  localStorage.removeItem('gacha_b_user');
  localStorage.removeItem('gacha_player_name');
  localStorage.removeItem('gacha_app_role');

  try { if (showAlert) alert('您已在主站登出，將返回玩家中心。'); } catch (_) {}
  // 用 replace 避免使用者「上一頁」又回到受保頁
  location.replace(HOME_URL);
}

async function checkASessionOnce() {
  try {
    const { data: { session } } = await aClient.auth.getSession();
    if (!session) cleanupBAndGoHome(false);
  } catch (_) {
    // 若取 session 出錯，保守做法也當作未登入處理
    cleanupBAndGoHome(false);
  }
}

// 1) 頁面剛開：立刻檢一次
checkASessionOnce();

// 2) 監聽 A 的 Auth 事件
aClient.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') cleanupBAndGoHome(true);
});

// 3) 回到可視狀態時再檢一次
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkASessionOnce();
});

// 4) 多分頁同步：其他分頁登出時，這頁也會收到 storage 事件
window.addEventListener('storage', () => { checkASessionOnce(); });

// 5) 低頻保險：每 60 秒補檢一次
setInterval(checkASessionOnce, 60 * 1000);
