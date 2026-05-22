import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { geocodeReverseUrl, requireGoogleMapsServerKey } from "@/lib/google-maps.server";

export type WeatherSummary = {
  city: string;
  tempC: number | null;
  feelsLikeC: number | null;
  condition: string;
  iconType: string;
  isDaytime: boolean;
  precipProbability: number | null;
  recommendation: "outdoor" | "indoor" | "cool_indoor" | "evening";
  recommendationText: string;
};

/** 多日預報（穿搭建議用） */
export type DailyForecast = {
  date: string;
  tempHighC: number | null;
  tempLowC: number | null;
  precipProbability: number | null;
  condition: string;
  iconType: string;
};

const Input = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const WMO_ZH: Record<number, string> = {
  0: "晴朗",
  1: "大致晴朗",
  2: "多雲",
  3: "陰天",
  45: "有霧",
  48: "霧凇",
  51: "毛毛雨",
  53: "毛毛雨",
  55: "毛毛雨",
  61: "小雨",
  63: "中雨",
  65: "大雨",
  71: "小雪",
  73: "中雪",
  75: "大雪",
  80: "陣雨",
  81: "陣雨",
  82: "強陣雨",
  95: "雷雨",
};

function recommend(tempC: number | null, precip: number | null, condition: string): {
  rec: WeatherSummary["recommendation"];
  text: string;
} {
  const cond = (condition || "").toLowerCase();
  const rainy =
    (precip ?? 0) >= 40 || cond.includes("雨") || cond.includes("rain") || cond.includes("shower");
  if (rainy) return { rec: "indoor", text: "今天可能下雨，找一間能待整個下午的店吧。" };
  if (tempC !== null && tempC >= 32) return { rec: "cool_indoor", text: "今天很熱，建議下午躲冷氣，傍晚再出門。" };
  if (tempC !== null && tempC <= 12) return { rec: "indoor", text: "外面有點冷，適合書店、咖啡館慢慢待。" };
  return { rec: "outdoor", text: "天氣不錯，適合在巷弄裡慢慢走走。" };
}

async function reverseGeocodeBigDataCloud(lat: number, lng: number): Promise<string> {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn("[Roamie Weather] BigDataCloud geocode failed", res.status);
    return "";
  }
  const json = (await res.json()) as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
  };
  return json.city || json.locality || json.principalSubdivision || "";
}

async function reverseGeocodeGoogle(lat: number, lng: number, apiKey: string): Promise<string> {
  const res = await fetch(geocodeReverseUrl(lat, lng, apiKey));
  if (!res.ok) {
    const text = await res.text();
    console.warn("[Roamie Weather] Google geocode failed", res.status, text.slice(0, 120));
    return "";
  }
  const json = (await res.json()) as {
    status?: string;
    results?: Array<{ address_components?: Array<{ long_name: string; types: string[] }> }>;
  };
  if (json.status && json.status !== "OK") {
    console.warn("[Roamie Weather] Google geocode status", json.status);
    return "";
  }
  const comps = json.results?.[0]?.address_components ?? [];
  const pick = (t: string) => comps.find((c) => c.types.includes(t))?.long_name;
  return pick("locality") || pick("administrative_area_level_2") || pick("administrative_area_level_1") || "";
}

async function reverseGeocodeCity(lat: number, lng: number): Promise<string> {
  try {
    const googleKey = requireGoogleMapsServerKey();
    const city = await reverseGeocodeGoogle(lat, lng, googleKey);
    if (city) return city;
  } catch (e) {
    console.warn("[Roamie Weather] Google geocode skipped", e);
  }
  return reverseGeocodeBigDataCloud(lat, lng);
}

async function fetchOpenMeteoWeather(lat: number, lng: number): Promise<{
  tempC: number | null;
  feelsLikeC: number | null;
  condition: string;
  iconType: string;
  isDaytime: boolean;
  precip: number | null;
}> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,precipitation_probability,weather_code,is_day&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    console.error("[Roamie Weather] Open-Meteo error", res.status, text.slice(0, 200));
    throw new Error(`Open-Meteo ${res.status}`);
  }
  const json = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      precipitation_probability?: number;
      weather_code?: number;
      is_day?: number;
    };
  };
  const c = json.current;
  const code = c?.weather_code ?? 0;
  return {
    tempC: c?.temperature_2m ?? null,
    feelsLikeC: c?.apparent_temperature ?? null,
    condition: WMO_ZH[code] ?? "多雲",
    iconType: String(code),
    isDaytime: (c?.is_day ?? 1) === 1,
    precip: c?.precipitation_probability ?? null,
  };
}

export async function fetchOpenMeteoDailyForecast(
  lat: number,
  lng: number,
  days: number,
): Promise<DailyForecast[]> {
  const d = Math.min(Math.max(days, 1), 14);
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=${d}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    console.error("[Roamie Weather] daily forecast error", res.status, text.slice(0, 200));
    throw new Error(`Open-Meteo daily ${res.status}`);
  }
  const json = (await res.json()) as {
    daily?: {
      time?: string[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
      weather_code?: number[];
    };
  };
  const daily = json.daily;
  const times = daily?.time ?? [];
  return times.map((date, i) => {
    const code = daily?.weather_code?.[i] ?? 0;
    return {
      date,
      tempHighC: daily?.temperature_2m_max?.[i] ?? null,
      tempLowC: daily?.temperature_2m_min?.[i] ?? null,
      precipProbability: daily?.precipitation_probability_max?.[i] ?? null,
      condition: WMO_ZH[code] ?? "多雲",
      iconType: String(code),
    };
  });
}

const ForecastInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  days: z.number().int().min(1).max(14).default(7),
});

export const getWeatherForecast = createServerFn({ method: "POST" })
  .inputValidator((input) => ForecastInput.parse(input))
  .handler(
    async ({ data }): Promise<{ forecast: DailyForecast[]; city: string; error: string | null }> => {
      try {
        const forecast = await fetchOpenMeteoDailyForecast(data.lat, data.lng, data.days);
        const city = await reverseGeocodeCity(data.lat, data.lng);
        return { forecast, city: city || "目前位置", error: null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "forecast failed";
        console.error("[Roamie Weather] forecast failed:", msg);
        return { forecast: [], city: "", error: msg };
      }
    },
  );

export const getWeather = createServerFn({ method: "POST" })
  .inputValidator((input) => Input.parse(input))
  .handler(async ({ data }): Promise<{ weather: WeatherSummary | null; error: string | null }> => {
    try {
      const wx = await fetchOpenMeteoWeather(data.lat, data.lng);
      const city = await reverseGeocodeCity(data.lat, data.lng);
      const { rec, text } = recommend(wx.tempC, wx.precip, wx.condition);

      console.info("[Roamie Weather] ok", { city: city || "目前位置", lat: data.lat, lng: data.lng });

      return {
        weather: {
          city: city || "目前位置",
          tempC: wx.tempC,
          feelsLikeC: wx.feelsLikeC,
          condition: wx.condition,
          iconType: wx.iconType,
          isDaytime: wx.isDaytime,
          precipProbability: wx.precip,
          recommendation: rec,
          recommendationText: text,
        },
        error: null,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "request failed";
      console.error("[Roamie Weather] failed:", msg);
      return { weather: null, error: msg };
    }
  });
