/** iOS WKWebView：暫時解除 scroll lock，讓原生相簿 / 相機可以彈出 */
export function unlockDocumentScrollForNativePicker(): () => void {
  const html = document.documentElement;
  const body = document.body;
  const prevHtml = html.style.overflow;
  const prevBody = body.style.overflow;

  html.style.overflow = "";
  body.style.overflow = "";

  return () => {
    if (prevHtml) html.style.overflow = prevHtml;
    else html.style.removeProperty("overflow");

    if (prevBody) body.style.overflow = prevBody;
    else body.style.removeProperty("overflow");
  };
}
