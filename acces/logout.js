// === 讓 B 跟著 A 的登入狀態走（不用改環境變數） ===
const A_URL  = 'https://wfhwhvodgikpducrhgda.supabase.co';
const A_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmaHdodm9kZ2lrcGR1Y3JoZ2RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgwMTAwNjEsImV4cCI6MjA2MzU4NjA2MX0.P6P-x4SxjiR4VdWH6VFgY_ktgMac_OzuI4Bl7HWskz8';
const aClient = window.supabase.createClient(A_URL, A_ANON);

function cleanupBAndGoHome() {
  localStorage.removeItem('gacha_b_jwt');
  localStorage.removeItem('gacha_b_jwt_exp');
  localStorage.removeItem('gacha_b_user');
  localStorage.removeItem('gacha_player_name');
  localStorage.removeItem('gacha_app_role');
  alert('您已在主站登出，將返回玩家中心。');
  location.href = 'https://shierusha.github.io/create-student/player';
}

// 1) 立刻檢查一次（頁面剛打開）
aClient.auth.getSession().then(({ data: { session } }) => { if (!session) cleanupBAndGoHome(); });

// 2) 監聽 A 的登出事件（即時）
aClient.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') cleanupBAndGoHome(); });

// 3) 再加保險：頁面回到可見時、或每 60 秒補檢一次
document.addEventListener('visibilitychange', () => { if (!document.hidden) aClient.auth.getSession().then(({ data: { session } }) => { if (!session) cleanupBAndGoHome(); }); });
setInterval(async () => {
  const { data: { session } } = await aClient.auth.getSession();
  if (!session) cleanupBAndGoHome();
}, 60 * 1000);
