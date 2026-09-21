import type { WeatherSummary } from "@/lib/weather-types";
import type { Locale } from "@/lib/i18n/types";
import { translate } from "@/lib/i18n/translate";

export type WeatherCondition = "Clear" | "FewClouds" | "PartlyCloudy" | "Overcast" | "Rain" | "Snow" | "Thunderstorm" | "Fog" | "Unknown";

/** Project provider codes already persisted in iconType; never reuse cached prose. */
export function homeWeatherCondition(weather: WeatherSummary): WeatherCondition {
  if (!weather.available) return "Unknown";
  const providerCode = weather.iconType?.trim() ?? "";
  const code = providerCode ? Number(providerCode) : Number.NaN;
  if (weather.source === "open-meteo-fallback" && providerCode) {
    if (code === 0) return "Clear";
    if (code === 1) return "FewClouds";
    if (code === 2) return "PartlyCloudy";
    if (code === 3) return "Overcast";
    if ([45, 48].includes(code)) return "Fog";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
    if ([95, 96, 99].includes(code)) return "Thunderstorm";
  }
  if (weather.source === "openweather") {
    if (code >= 200 && code < 300) return "Thunderstorm";
    if (code >= 300 && code < 600) return "Rain";
    if (code >= 600 && code < 700) return "Snow";
    if (code >= 700 && code < 800) return "Fog";
    if (code === 800) return "Clear";
    if (code === 801) return "FewClouds";
    if (code === 802) return "PartlyCloudy";
    if (code === 803 || code === 804) return "Overcast";
    const icon = providerCode.match(/^(01|02|03|04|09|10|11|13|50)[dn]$/)?.[1];
    const icons: Record<string, WeatherCondition> = { "01": "Clear", "02": "FewClouds", "03": "PartlyCloudy", "04": "Overcast", "09": "Rain", "10": "Rain", "11": "Thunderstorm", "13": "Snow", "50": "Fog" };
    if (icon) return icons[icon];
  }
  return "Unknown";
}

export function homeWeatherMetadata(weather: WeatherSummary, locale: Locale) {
  // Legacy location sentinel, not a place name or user-authored city.
  const currentLocation = !weather.city.trim() || weather.city === translate("zh-TW", "uiCoverage.weatherCurrentLocation");
  return {
    city: currentLocation ? translate(locale, "uiCoverage.weatherCurrentLocation") : weather.city,
    condition: translate(locale, `uiCoverage.weather${homeWeatherCondition(weather)}`),
  };
}
