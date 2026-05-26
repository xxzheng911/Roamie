/** 依座標推斷 Google Places region / 語言（探索地圖用，不寫死台灣） */

export function isTaiwanCoordinates(lat: number, lng: number): boolean {
  return lat >= 21.5 && lat <= 26.5 && lng >= 118.5 && lng <= 122.5;
}

/** 北美本島（含常見 iOS Simulator 預設區域） */
export function isContinentalUsCoordinates(lat: number, lng: number): boolean {
  return inBox(lat, lng, 24, 49, -125, -66);
}

function inBox(
  lat: number,
  lng: number,
  latMin: number,
  latMax: number,
  lngMin: number,
  lngMax: number,
): boolean {
  return lat >= latMin && lat <= latMax && lng >= lngMin && lng <= lngMax;
}

/** CLDR region code；未知時回傳 undefined（API 僅靠 locationBias） */
export function placesRegionCodeFromCoordinates(lat: number, lng: number): string | undefined {
  if (isTaiwanCoordinates(lat, lng)) return "TW";
  if (inBox(lat, lng, 30, 46, 129, 146)) return "JP";
  if (inBox(lat, lng, 33, 39, 124, 132)) return "KR";
  if (inBox(lat, lng, 1, 23, 100, 120)) return "TH";
  if (inBox(lat, lng, 8, 24, 102, 110)) return "VN";
  if (inBox(lat, lng, 22, 49, 113, 114)) return "HK";
  if (inBox(lat, lng, 1, 2, 103, 104)) return "SG";
  if (inBox(lat, lng, -44, -10, 112, 154)) return "AU";
  if (isContinentalUsCoordinates(lat, lng)) return "US";
  if (inBox(lat, lng, 35, 71, -10, 40)) return "EU";
  return undefined;
}

export function placesLanguageFromCoordinates(lat: number, lng: number): string {
  const region = placesRegionCodeFromCoordinates(lat, lng);
  if (region === "JP") return "ja";
  if (region === "KR") return "ko";
  if (region === "TH") return "th";
  if (region === "AU" || region === "US" || region === "EU") return "en";
  if (region === "TW" || region === "HK") return "zh-TW";
  return "en";
}

/** IANA 時區（推薦理由／時段判斷用） */
export function approximateTimezoneFromCoordinates(lat: number, lng: number): string {
  if (isTaiwanCoordinates(lat, lng)) return "Asia/Taipei";
  if (inBox(lat, lng, 30, 46, 129, 146)) return "Asia/Tokyo";
  if (inBox(lat, lng, 33, 39, 124, 132)) return "Asia/Seoul";
  if (inBox(lat, lng, 1, 23, 100, 120)) return "Asia/Bangkok";
  if (inBox(lat, lng, -44, -10, 112, 154)) {
    if (lng < 129) return "Australia/Perth";
    if (lng < 141) return "Australia/Adelaide";
    if (lng < 150) return "Australia/Sydney";
    return "Australia/Brisbane";
  }
  if (isContinentalUsCoordinates(lat, lng)) {
    if (lng < -115) return "America/Los_Angeles";
    if (lng < -90) return "America/Denver";
    if (lng < -75) return "America/New_York";
    return "America/Chicago";
  }
  const offsetHours = Math.round(lng / 15);
  const sign = offsetHours >= 0 ? "+" : "-";
  const abs = Math.abs(offsetHours);
  return `Etc/GMT${sign === "+" ? "-" : "+"}${abs}`;
}

export function geocodeRegionFromCoordinates(lat: number, lng: number): string | undefined {
  const code = placesRegionCodeFromCoordinates(lat, lng);
  return code?.toLowerCase();
}
