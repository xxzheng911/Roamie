/**
 * App 啟動時統一注入 weather / routes serverFn，並在 dev 執行連線測試。
 */
import { logGoogleMapsKeyLoadedOnce } from "@/lib/google-maps-key-resolve";
import { logOpenWeatherKeyLoadedOnce } from "@/lib/openweather-key-resolve";
import { bindRoutesServerFns, testRoutesApiConnection } from "@/services/routesService";
import { bindWeatherServerFns, testWeatherApiConnection } from "@/services/weatherService";

let bootstrapDone = false;
let devTestsScheduled = false;

export function runApiBootstrap(fns: {
  weather: Parameters<typeof bindWeatherServerFns>[0];
  routes: Parameters<typeof bindRoutesServerFns>[0];
}): void {
  bindWeatherServerFns(fns.weather);
  bindRoutesServerFns(fns.routes);

  logOpenWeatherKeyLoadedOnce();
  logGoogleMapsKeyLoadedOnce();

  if (!import.meta.env.DEV || devTestsScheduled) return;
  devTestsScheduled = true;

  if (!bootstrapDone) {
    bootstrapDone = true;
    void testWeatherApiConnection();
    void testRoutesApiConnection();
  }
}
