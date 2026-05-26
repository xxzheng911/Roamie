/** 無 React 時的 Roamie 品牌錯誤頁（SSR / 伺服器 middleware 用） */
export function renderRoamieErrorHtml(detail?: string): string {
  const safeDetail = detail
    ? detail
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
    : "";

  const detailBlock = safeDetail
    ? `<pre class="detail">${safeDetail}</pre>`
    : "";

  return `<!doctype html>
<html lang="zh-Hant" class="roamie-app">
  <head>
    <meta charset="utf-8" />
    <title>Roamie 暫時無法啟動</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#f7f4ef" />
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        background: linear-gradient(180deg, #fdf8f2 0%, #f7f4ef 45%, #f0ebe4 100%); color: #2a2520; }
      .wrap { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 2rem 1.5rem; text-align: center; }
      h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.5rem; }
      p { color: #6b635c; margin: 0 0 1.5rem; line-height: 1.55; max-width: 22rem; font-size: 0.9rem; }
      .detail { margin: 0 auto 1.25rem; max-width: 20rem; max-height: 6rem; overflow: auto; text-align: left;
        font-size: 0.65rem; line-height: 1.4; background: rgba(255,255,255,0.65); border-radius: 12px;
        padding: 0.65rem 0.75rem; color: #6b635c; white-space: pre-wrap; word-break: break-word; }
      .actions { display: flex; flex-direction: column; gap: 0.5rem; width: 100%; max-width: 16rem; }
      button, a { padding: 0.75rem 1.25rem; border-radius: 999px; font: inherit; font-size: 0.9rem; cursor: pointer;
        text-decoration: none; border: 1px solid transparent; display: block; text-align: center; }
      .primary { background: #2a2520; color: #fdf8f2; border: none; }
      .secondary { background: #fff; color: #2a2520; border-color: #e5dfd6; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>Roamie 暫時無法啟動</h1>
      <p>可能是連線或設定問題。請重試，或從頭載入 App。</p>
      ${detailBlock}
      <div class="actions">
        <button type="button" class="primary" onclick="location.reload()">重新整理</button>
        <a class="secondary" href="/login">重新啟動</a>
      </div>
    </div>
    <script>
      function roamieLog(tag, reason, source) {
        var msg = reason && reason.message ? String(reason.message) : String(reason);
        var stack = reason && reason.stack ? String(reason.stack) : "";
        console.error(tag + " " + msg + (stack ? " stack=" + stack : "") + (source ? " source=" + source : ""));
      }
      window.addEventListener("error", function(e) {
        roamieLog("APP_INIT_ERROR", e.error || e.message, e.filename);
      }, true);
      window.addEventListener("unhandledrejection", function(e) {
        roamieLog("APP_UNHANDLED_REJECTION", e.reason, "promise");
      });
    </script>
  </body>
</html>`;
}
