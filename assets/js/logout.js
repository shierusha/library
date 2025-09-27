// ==== A 專案登出守門；封裝避免全域衝突 ====
(function () {
  const A_URL  = 'https://wfhwhvodgikpducrhgda.supabase.co';
  const A_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmaHdodm9kZ2lrcGR1Y3JoZ2RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgwMTAwNjEsImV4cCI6MjA2MzU4NjA2MX0.P6P-x4SxjiR4VdWH6VFgY_ktgMac_OzuI4Bl7HWskz8';
  const HOME_URL = 'https://shierusha.github.io/create-student/player';

  // 這個 client 只拿 A 專案 session，不影響你的其他 client
  const aClient = window.supabase.createClient(A_URL, A_ANON);

  // 避免多次重導
  let exited = false;

  function cleanupAndGoHome(showAlert = true) {
    if (exited) return;
    exited = true;

    // 清掉各 B-app 用到的本機憑證（扭蛋 + 圖書館）
    [
      'gacha_b_jwt','gacha_b_jwt_exp','gacha_b_user','gacha_player_name','gacha_app_role',
      'xer_b_jwt','xer_b_jwt_exp','xer_b_user','xer_app_role'
    ].forEach(k => localStorage.removeItem(k));

    try { if (showAlert) alert('您已在主站登出，將返回玩家中心。'); } catch (_) {}
    location.replace(HOME_URL); // 用 replace 避免上一頁回來
  }

  async function checkASessionOnce() {
    try {
      const { data: { session } } = await aClient.auth.getSession();
      if (!session) cleanupAndGoHome(false);
    } catch (_) {
      // 取不到就保守處理
      cleanupAndGoHome(false);
    }
  }

  // 1) 頁面載入先檢一次
  checkASessionOnce();

  // 2) 監聽 A 專案的 auth 事件（同頁登出）
  aClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') cleanupAndGoHome(true);
  });

  // 3) 回到可視狀態再檢一次
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkASessionOnce();
  });

  // 4) 多分頁同步：其他分頁動到 auth/localStorage 也會觸發
  window.addEventListener('storage', () => { checkASessionOnce(); });

  // 5) 低頻保險
  setInterval(checkASessionOnce, 60 * 1000);
})();
