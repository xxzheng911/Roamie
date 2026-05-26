import type { AnyRouter } from "@tanstack/react-router";
import { buildCapacitorEarlyErrorLogScript } from "@/lib/log-error";

/**
 * TanStack Router HeadContent uses `manifest?.routes[match.routeId]`.
 * Optional chaining only guards `manifest`; if `routes` is missing, access throws.
 */
export const EMPTY_SSR_MANIFEST = { routes: {} } as const;

export function normalizeRouterSsrManifest(router: AnyRouter): void {
  const ssr = router.ssr;
  if (!ssr) return;

  const manifest = ssr.manifest;
  if (!manifest) {
    router.ssr = { ...ssr, manifest: { ...EMPTY_SSR_MANIFEST } };
    return;
  }

  if (manifest.routes == null || typeof manifest.routes !== "object") {
    router.ssr = {
      ...ssr,
      manifest: { ...manifest, routes: {} },
    };
  }
}

/** Inline script for Capacitor bundled index.html (no SSR shell). Keep in sync with capacitor-prepare.mjs */
export function buildCapacitorTsrBootstrapScript(): string {
  return `${buildCapacitorEarlyErrorLogScript()}
<script>
(function(){
  var p=location.pathname.replace(/\\/+$/, "") || "/";
  var q=location.search||"";
  var h=location.hash||"";
  var legacy={"/loading":1,"/intro":1,"/splash":1,"/onboarding":1};
  if(p===""||p==="/"||p==="/index.html"||p.endsWith("/index.html")||legacy[p]){
    history.replaceState(history.state,"","/"+q+h);
  }
})();
</script>
<script>
self.$_TSR={
  h(){this.hydrated=!0;this.c()},
  e(){this.streamEnded=!0;this.c()},
  c(){
    if(this.hydrated&&this.streamEnded){
      try{delete self.$_TSR}catch(_){}
      try{self.$R&&delete self.$R.tsr}catch(_){}
    }
  },
  p(fn){this.initialized?fn():this.buffer.push(fn)},
  buffer:[],
  router:{manifest:{routes:{}},matches:[],dehydratedData:void 0,lastMatchId:""}
};
self.$_TSR.e();
self.$_TSR.h();
</script>`;
}
