/** 同步寫入 #root（不依賴 React），Capacitor 冷啟動在 main bundle 解析前即有 UI */
export function mountImmediateBootShell(): void {
  if (typeof document === "undefined") return;
  const root = document.getElementById("root");
  if (!root || root.childElementCount > 0) return;

  root.setAttribute("data-roamie-boot-shell", "1");
  root.innerHTML = `<div class="roamie-splash" role="status" aria-live="polite" aria-busy="true">
  <div class="roamie-splash__gradient" aria-hidden="true"></div>
  <div class="roamie-splash__viewport">
    <div class="roamie-splash__content roamie-splash__content--fade-in">
      <h1 class="roamie-splash__brand">Roamie</h1>
      <p class="roamie-splash__tagline">Less planning, more wandering.</p>
      <div class="roamie-splash__loader" aria-label="載入中">
        <span class="roamie-splash__loader-dot"></span>
        <span class="roamie-splash__loader-dot"></span>
        <span class="roamie-splash__loader-dot"></span>
      </div>
    </div>
  </div>
</div>`;

  const boot = window.__ROAMIE_BOOT__ ?? { phase: "dom-shell", t0: Date.now() };
  boot.phase = "dom-shell";
  window.__ROAMIE_BOOT__ = boot;
}

declare global {
  interface Window {
    __ROAMIE_BOOT__?: { phase?: string; t0?: number; import?: string; error?: string };
  }
}
