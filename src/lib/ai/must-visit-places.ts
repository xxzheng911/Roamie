import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { Locale } from "@/lib/i18n/types";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import { applyEnglishPlaceArticles } from "@/lib/i18n/en-place-articles";
import { displayDestinationForCopy } from "@/lib/ai/destination-locale-aliases";
import { isAffirmativeReply } from "@/lib/ai/chat-conversation-state";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeRecommendationItem } from "@/lib/ai/types";
import {
  isCountryCityInquiryText,
  isFutureTripPlanningStatement,
  normalizeDestinationLabel,
  parseDestinationFromText,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";
import {
  isGenericPlaceLabel,
  INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
} from "@/lib/ai/generic-place-label";
import { parseItineraryPlanModeIntent } from "@/lib/ai/itinerary-planning";
import { isCreateItineraryRequest } from "@/lib/ai/itinerary-entity-extraction";
import { classifyDestinationForPlaceSearch } from "@/lib/ai/landmark-place-strategy";
import {
  planningStageAfterMustVisitIntent,
  planningStageAfterRecommendations,
} from "@/lib/ai/chat-planning-stage";
import {
  isSuggestionInDestinationScope,
} from "@/lib/ai/destination-combination-suggestions";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import {
  evaluateDestinationScopeGate,
  logDestinationScopeBlocked,
} from "@/lib/ai/destination-scope";

export type PlanningFollowUpIntent = "must_visit_places" | "daily_rhythm" | "full_itinerary";

export type MustVisitPlace = {
  name: string;
  reason: string;
};

type DestinationMustVisitGuide = {
  places: MustVisitPlace[];
  rhythmTip?: string;
};

const MUST_VISIT_RE =
  /(必去點|必去景點|必去|推薦景點|哪些景點|列景點|列出景點|景點有哪些|景點推薦|幫我列|先列|有哪些地方值得去|值得去|幫我安排地點|直接推薦|幫我列出景點)/;

const PLACE_RECOMMENDATION_RE =
  /(推薦.{0,6}(?:景點|地點|地方)|哪些.{0,6}(?:景點|地點|地方)|列出.{0,6}(?:景點|地點)|有什麼.{0,4}(?:景點|地方)|去哪裡玩|去哪玩|必去)/;

const DAILY_RHYTHM_RE =
  /(總天數節奏|天數節奏|排節奏|先定節奏|前後段節奏|行程節奏|每天怎麼排|怎麼排天)/;

const DESTINATION_MUST_VISIT: Record<string, DestinationMustVisitGuide> = {
  阿里山: {
    places: [
      { name: "奮起湖老街", reason: "下山順路排便當、森林鐵路與老街小吃" },
      { name: "檜意森活村", reason: "嘉義市區文創聚落，適合慢逛拍照" },
      { name: "文化路夜市", reason: "嘉義在地小吃集中，晚餐好排" },
      { name: "太平雲梯", reason: "高空步道與茶園景觀，可當半日搭配" },
      { name: "北門驛", reason: "阿里山森林鐵路起點，復古車站很好拍" },
    ],
    rhythmTip: "若只有 1～2 天，建議第一天下午上山、隔日清晨看日出，再排奮起湖或嘉義市區。",
  },
  台北101: {
    places: [
      { name: "象山", reason: "經典夜景與台北 101 同框取景點" },
      { name: "松山文創園區", reason: "文創市集與展覽，適合半日慢逛" },
      { name: "國父紀念館", reason: "信義區綠地與換衛儀式，可串連商圈" },
      { name: "饒河夜市", reason: "在地小吃與河岸散步" },
      { name: "信義商圈", reason: "購物、美食與夜間氛圍" },
    ],
    rhythmTip: "101 周邊建議傍晚起排，象山夜景與夜市可接在一起。",
  },
  嘉義: {
    places: [
      { name: "檜意森活村", reason: "舊林業宿舍改建的文創聚落，適合慢逛拍照" },
      { name: "嘉義公園", reason: "市區綠地，可串連射日塔與市立博物館" },
      { name: "文化路夜市", reason: "在地小吃集中，晚餐與宵夜都好排" },
      { name: "蘭潭風景區", reason: "環湖散步、看夕陽的市區綠洲" },
      { name: "北門驛", reason: "阿里山森林鐵路起點，復古車站很好拍" },
      { name: "阿里山森林鐵路車庫園區", reason: "蒸汽火車與車庫展示，鐵道迷別錯過" },
    ],
    rhythmTip: "市區景點與森林鐵路可排半天，若要上阿里山建議另留 1～2 天。",
  },
  日月潭: {
    places: [
      { name: "玄光寺碼頭", reason: "環湖經典起點，可搭船串連各碼頭" },
      { name: "伊達邵部落", reason: "原民文化、茶葉蛋與纜車站" },
      { name: "向山觀景台", reason: "俯瞰日月潭全景，拍照效果好" },
      { name: "文武廟", reason: "湖畔地標，順路了解在地信仰文化" },
      { name: "九族文化村", reason: "親子或想加主題體驗時可排半日" },
    ],
    rhythmTip: "建議至少留 1 晚，清晨環湖或騎行體驗最佳。",
  },
  京都: {
    places: [
      { name: "伏見稻荷大社", reason: "千本鳥居經典，建議一早前往避開人潮" },
      { name: "清水寺", reason: "世界遺產，可連通二年坂、三年坂散步" },
      { name: "嵐山竹林小徑", reason: "竹林與渡月橋，適合半日慢遊" },
      { name: "金閣寺", reason: "標誌性金色建築，上午光線較好" },
      { name: "錦市場", reason: "在地小吃與伴手禮，適合晚餐前後" },
    ],
    rhythmTip: "東山、嵐山分兩天排會比較不趕。",
  },
  大阪: {
    places: [
      { name: "大阪城公園", reason: "城市地標，春天櫻花季特別熱門" },
      { name: "道頓堀", reason: "美食與夜景核心，適合晚上" },
      { name: "通天閣＋新世界", reason: "復古街區與炸串，拍照感強" },
      { name: "環球影城", reason: "若喜歡主題樂園可留一整日" },
      { name: "黑門市場", reason: "海鮮與小吃，適合午餐" },
    ],
    rhythmTip: "市區景點與美食可混搭，環球影城建議獨立一天。",
  },
  富士山: {
    places: [
      { name: "河口湖", reason: "經典富士山倒影取景點" },
      { name: "新倉山浅間公園", reason: "忠靈塔＋富士山同框" },
      { name: "忍野八海", reason: "湧泉聚落，適合短停" },
      { name: "箱根", reason: "溫泉與芦ノ湖，可排二日一夜" },
      { name: "大石公園", reason: "河口湖北岸視野開闊的富士展望點" },
    ],
    rhythmTip: "天氣好時河口湖與新倉山必排；陰天可改箱根溫泉。",
  },
  東京: {
    places: [
      { name: "淺草寺＋晴空塔", reason: "傳統與現代地標一次看完" },
      { name: "明治神宮＋原宿表參道", reason: "神社綠意接時尚商圈" },
      { name: "上野公園＋博物館", reason: "文化與櫻花季熱點" },
      { name: "澀谷＋新宿", reason: "購物、美食與夜景" },
      { name: "鎌倉一日遊", reason: "大佛、江之電與海景，適合近郊" },
    ],
    rhythmTip: "市區經典與近郊分開排，節奏會比較舒服。",
  },
  首爾: {
    places: [
      { name: "景福宮＋北村韓屋村", reason: "韓式傳統建築與巷弄散步" },
      { name: "弘大／梨大商圈", reason: "年輕文化、咖啡與逛街" },
      { name: "明洞", reason: "購物與韓式小吃集中" },
      { name: "南山首爾塔", reason: "夜景與城市全景" },
      { name: "廣藏市場", reason: "道地小吃，適合午餐" },
    ],
    rhythmTip: "前幾天排經典，後段留商圈與咖啡廳慢逛。",
  },
  曼谷: {
    places: [
      { name: "大皇宮＋玉佛寺", reason: "曼谷最經典寺廟組合" },
      { name: "鄭王廟", reason: "河對岸地標，適合傍晚" },
      { name: "恰圖恰市集", reason: "週末市集，可挖寶與小吃" },
      { name: "ICONSIAM", reason: "河畔商場，可搭船順遊" },
      { name: "喬德夜市", reason: "美食與夜生活" },
    ],
    rhythmTip: "寺廟、市集、夜市分天排，不會太趕。",
  },
  清邁: {
    places: [
      { name: "清邁古城寺廟", reason: "步行即可串連多座寺廟" },
      { name: "帕辛寺", reason: "古城內重要蘭納寺廟" },
      { name: "雙龍寺", reason: "素貼山俯瞰清邁" },
      { name: "週六／週日夜市", reason: "在地小吃與手作" },
      { name: "尼曼路", reason: "咖啡與文青小店" },
    ],
    rhythmTip: "古城散步、市集、近郊可各排一天。",
  },
  芭達雅: {
    places: [
      { name: "真理寺", reason: "木造建築藝術，海邊很壯觀" },
      { name: "芭達雅海灘", reason: "市區海灘散步與水上活動" },
      { name: "四方水上市場", reason: "特色市集，適合半日" },
      { name: "珊瑚島", reason: "跳島浮潛與沙灘" },
      { name: "中天海灘", reason: "較安靜，適合看日落" },
    ],
    rhythmTip: "海灘放鬆與跳島分開排較佳。",
  },
  普吉島: {
    places: [
      { name: "芭東海灘", reason: "最熱鬧的海灘與夜生活" },
      { name: "普吉老城", reason: "中葡建築與咖啡小店" },
      { name: "查龍寺", reason: "普吉最大佛寺" },
      { name: "神仙半島", reason: "南端日落展望" },
      { name: "皮皮島", reason: "經典跳島一日遊" },
    ],
    rhythmTip: "前段跳島、後段海灘放空較平衡。",
  },
};

type ForeignLocale = Exclude<Locale, "zh-TW">;
type ForeignMustVisitGuide = { places: Array<[name: string, reason: string]>; tip: string };

/** Display-only en / ja / ko copy for DESTINATION_MUST_VISIT (same order); internal names stay zh. */
const DESTINATION_MUST_VISIT_I18N: Record<string, Record<ForeignLocale, ForeignMustVisitGuide>> = {
  阿里山: {
    en: {
      places: [
        ["Fenqihu Old Street", "Bento lunch, the forest railway and old-street snacks on the way down"],
        ["Hinoki Village", "Creative hub in Chiayi city, great for a slow stroll and photos"],
        ["Wenhua Road Night Market", "Local Chiayi street food in one place, easy for dinner"],
        ["Taiping Suspension Bridge", "Sky walkway with tea-garden views, a good half-day add-on"],
        ["Beimen Station", "Starting point of the Alishan Forest Railway; the retro station is very photogenic"],
      ],
      tip: "With only 1–2 days, head up the mountain on the first afternoon, catch the sunrise the next morning, then add Fenqihu or Chiayi city.",
    },
    ja: {
      places: [
        ["奮起湖老街", "下山途中に駅弁、森林鉄道、老街グルメを楽しめる"],
        ["檜意森活村", "嘉義市内のクリエイティブエリア。のんびり散策や写真に"],
        ["文化路夜市", "嘉義のローカルグルメが集まり、夕食に便利"],
        ["太平雲梯", "茶畑を望む空中つり橋。半日の組み合わせに"],
        ["北門駅", "阿里山森林鉄道の起点。レトロな駅舎が絵になる"],
      ],
      tip: "1〜2日なら、初日の午後に山へ上がり、翌朝に日の出を見てから奮起湖か嘉義市内を回るのがおすすめです。",
    },
    ko: {
      places: [
        ["펀치후 옛거리", "하산길에 도시락, 산림철도, 옛거리 간식을 즐기기 좋아요"],
        ["히노키 빌리지", "Chiayi 시내 문화 공간, 천천히 걷고 사진 찍기 좋아요"],
        ["원화루 야시장", "Chiayi 현지 먹거리가 모여 있어 저녁 식사로 좋아요"],
        ["타이핑 구름다리", "차밭 풍경의 하늘길, 반나절 코스로 좋아요"],
        ["베이먼역", "아리산 산림철도의 출발역, 레트로한 역사가 사진 찍기 좋아요"],
      ],
      tip: "1–2일이라면 첫날 오후에 산에 올라 다음 날 새벽 일출을 보고, 펀치후나 Chiayi 시내를 넣는 걸 추천해요.",
    },
  },
  台北101: {
    en: {
      places: [
        ["Elephant Mountain", "Classic night view framing Taipei 101"],
        ["Songshan Cultural and Creative Park", "Creative markets and exhibitions, great for a slow half day"],
        ["Sun Yat-sen Memorial Hall", "Green space in Xinyi with a guard ceremony, easy to link with the shopping district"],
        ["Raohe Night Market", "Local street food and a riverside walk"],
        ["Xinyi Shopping District", "Shopping, food and nighttime atmosphere"],
      ],
      tip: "Around 101, start in the late afternoon; Elephant Mountain's night view and a night market pair well.",
    },
    ja: {
      places: [
        ["象山", "台北101と一緒に撮れる定番の夜景スポット"],
        ["松山文創園区", "クリエイティブマーケットや展示があり、半日のんびり散策に"],
        ["国父紀念館", "信義区の緑地と衛兵交代式。商業エリアとつなげやすい"],
        ["饒河夜市", "ローカルグルメと川沿いの散歩"],
        ["信義エリア", "ショッピング、グルメ、夜の雰囲気"],
      ],
      tip: "101周辺は夕方からがおすすめ。象山の夜景と夜市を続けて回れます。",
    },
    ko: {
      places: [
        ["샹산(코끼리산)", "타이베이 101과 함께 담는 대표 야경 명소"],
        ["쑹산 문화창의공원", "문화 마켓과 전시가 있어 반나절 천천히 둘러보기 좋아요"],
        ["국부기념관", "신이구의 녹지와 근위병 교대식, 쇼핑가와 연결하기 좋아요"],
        ["라오허 야시장", "현지 먹거리와 강변 산책"],
        ["신이 상권", "쇼핑, 맛집, 밤 분위기"],
      ],
      tip: "101 주변은 해 질 무렵부터 일정을 잡고, 샹산 야경과 야시장을 이어서 가면 좋아요.",
    },
  },
  嘉義: {
    en: {
      places: [
        ["Hinoki Village", "Former forestry dorms turned creative hub, great for a slow stroll and photos"],
        ["Chiayi Park", "Green space in town, linking the Sun Shooting Tower and the city museum"],
        ["Wenhua Road Night Market", "Local street food in one place, good for dinner or a late-night snack"],
        ["Lantan Lake Scenic Area", "An in-town oasis for a lakeside walk and sunset"],
        ["Beimen Station", "Starting point of the Alishan Forest Railway; the retro station is very photogenic"],
      ],
      tip: "City sights and the forest railway fit in half a day; if you plan to go up Alishan, set aside another 1–2 days.",
    },
    ja: {
      places: [
        ["檜意森活村", "旧林業宿舎を改装したクリエイティブエリア。のんびり散策や写真に"],
        ["嘉義公園", "市内の緑地。射日塔や市立博物館とあわせて回れる"],
        ["文化路夜市", "ローカルグルメが集まり、夕食にも夜食にも便利"],
        ["蘭潭風景区", "湖畔散歩や夕日を楽しめる市内のオアシス"],
        ["北門駅", "阿里山森林鉄道の起点。レトロな駅舎が絵になる"],
      ],
      tip: "市内観光と森林鉄道は半日で回れます。阿里山に上るなら、さらに1〜2日確保するのがおすすめです。",
    },
    ko: {
      places: [
        ["히노키 빌리지", "옛 임업 숙소를 개조한 문화 공간, 천천히 걷고 사진 찍기 좋아요"],
        ["Chiayi 공원", "시내 녹지, 사일탑과 시립박물관을 함께 둘러볼 수 있어요"],
        ["원화루 야시장", "현지 먹거리가 모여 있어 저녁과 야식 모두 좋아요"],
        ["란탄 풍경구", "호숫가 산책과 노을을 즐기는 시내 속 쉼터"],
        ["베이먼역", "아리산 산림철도의 출발역, 레트로한 역사가 사진 찍기 좋아요"],
      ],
      tip: "시내 명소와 산림철도는 반나절이면 충분하고, 아리산에 오르려면 1–2일을 따로 잡는 걸 추천해요.",
    },
  },
  日月潭: {
    en: {
      places: [
        ["Xuanguang Temple Pier", "Classic starting point around the lake; take the boat to link the piers"],
        ["Ita Thao Village", "Indigenous culture, tea eggs and the ropeway station"],
        ["Xiangshan Viewing Deck", "Panoramic view over Sun Moon Lake, great for photos"],
        ["Wenwu Temple", "Lakeside landmark; learn about local faith along the way"],
        ["Formosan Aboriginal Culture Village", "A half day for families or a themed experience"],
      ],
      tip: "Stay at least one night; an early-morning loop around the lake or a bike ride is best.",
    },
    ja: {
      places: [
        ["玄光寺埠頭", "湖めぐりの定番の起点。船で各埠頭をつなげる"],
        ["伊達邵", "先住民文化、茶葉蛋、ロープウェイ乗り場"],
        ["向山展望台", "日月潭を一望でき、写真映えする"],
        ["文武廟", "湖畔のランドマーク。地元の信仰文化にも触れられる"],
        ["九族文化村", "家族連れやテーマ体験を加えたいときに半日で"],
      ],
      tip: "少なくとも1泊がおすすめ。早朝の湖めぐりやサイクリングが最高です。",
    },
    ko: {
      places: [
        ["쉬안광쓰 선착장", "호수 일주의 대표 출발점, 배로 각 선착장을 이어 갈 수 있어요"],
        ["이다샤오 마을", "원주민 문화, 차예단, 케이블카 정류장"],
        ["샹산 전망대", "르웨탄 전경을 내려다볼 수 있어 사진이 잘 나와요"],
        ["원우묘", "호숫가 랜드마크, 현지 신앙 문화도 함께 볼 수 있어요"],
        ["구족문화촌", "가족 여행이나 테마 체험을 더하고 싶을 때 반나절 코스로"],
      ],
      tip: "최소 1박을 추천해요. 이른 아침 호수 일주나 자전거가 가장 좋아요.",
    },
  },
  京都: {
    en: {
      places: [
        ["Fushimi Inari Taisha", "Famous thousand torii gates; go early to beat the crowds"],
        ["Kiyomizu-dera", "World Heritage site, linked to a stroll along Ninenzaka and Sannenzaka"],
        ["Arashiyama Bamboo Grove", "Bamboo grove and Togetsukyo Bridge, good for a slow half day"],
        ["Kinkaku-ji", "Iconic golden pavilion; the light is better in the morning"],
        ["Nishiki Market", "Local snacks and souvenirs, good before or after dinner"],
      ],
      tip: "Splitting Higashiyama and Arashiyama over two days keeps the pace relaxed.",
    },
    ja: {
      places: [
        ["伏見稲荷大社", "千本鳥居の定番。混雑を避けるなら朝一番に"],
        ["清水寺", "世界遺産。二年坂、三年坂の散策とつなげられる"],
        ["嵐山竹林の小径", "竹林と渡月橋。半日のんびり巡るのに最適"],
        ["金閣寺", "象徴的な金色の建物。午前中は光がきれい"],
        ["錦市場", "地元グルメやお土産。夕食の前後に"],
      ],
      tip: "東山と嵐山は2日に分けると慌ただしくなりません。",
    },
    ko: {
      places: [
        ["후시미 이나리 신사", "센본 도리이로 유명해요. 붐비기 전에 아침 일찍 가는 걸 추천해요"],
        ["기요미즈데라", "세계유산, 니넨자카와 산넨자카 산책으로 이어져요"],
        ["아라시야마 대나무숲", "대나무숲과 도게쓰교, 반나절 여유롭게 돌아보기 좋아요"],
        ["금각사", "상징적인 금빛 건물, 오전 빛이 더 좋아요"],
        ["니시키 시장", "현지 간식과 기념품, 저녁 전후로 들르기 좋아요"],
      ],
      tip: "히가시야마와 아라시야마를 이틀로 나누면 덜 바빠요.",
    },
  },
  大阪: {
    en: {
      places: [
        ["Osaka Castle Park", "City landmark, especially popular in cherry blossom season"],
        ["Dotonbori", "The heart of food and night views, best in the evening"],
        ["Tsutenkaku + Shinsekai", "Retro streets and kushikatsu, very photogenic"],
        ["Universal Studios Japan", "Set aside a full day if you love theme parks"],
        ["Kuromon Market", "Seafood and snacks, good for lunch"],
      ],
      tip: "City sights and food mix well; give Universal Studios its own day.",
    },
    ja: {
      places: [
        ["大阪城公園", "街のランドマーク。春の桜の季節は特に人気"],
        ["道頓堀", "グルメと夜景の中心。夜がおすすめ"],
        ["通天閣＋新世界", "レトロな街並みと串カツ。写真映え抜群"],
        ["ユニバーサル・スタジオ・ジャパン", "テーマパーク好きなら丸1日確保を"],
        ["黒門市場", "海鮮と食べ歩き。ランチに"],
      ],
      tip: "市内観光とグルメは組み合わせやすく、USJは別日にするのがおすすめです。",
    },
    ko: {
      places: [
        ["오사카성 공원", "도시의 랜드마크, 봄 벚꽃 시즌에 특히 인기예요"],
        ["도톤보리", "먹거리와 야경의 중심, 저녁에 가기 좋아요"],
        ["쓰텐카쿠 + 신세카이", "레트로한 거리와 쿠시카쓰, 사진 찍기 좋아요"],
        ["유니버설 스튜디오 재팬", "테마파크를 좋아한다면 하루를 통째로 비워 두세요"],
        ["구로몬 시장", "해산물과 간식, 점심으로 좋아요"],
      ],
      tip: "시내 명소와 맛집은 섞어서 다니고, 유니버설 스튜디오는 따로 하루를 잡는 걸 추천해요.",
    },
  },
  富士山: {
    en: {
      places: [
        ["Lake Kawaguchi", "Classic spot for Mount Fuji's reflection"],
        ["Arakurayama Sengen Park", "Chureito Pagoda and Mount Fuji in one frame"],
        ["Oshino Hakkai", "Spring-water village, good for a short stop"],
        ["Hakone", "Hot springs and Lake Ashi, works as an overnight trip"],
        ["Oishi Park", "Open Fuji views on the north shore of Lake Kawaguchi"],
      ],
      tip: "On clear days, don't miss Lake Kawaguchi and Arakurayama; on cloudy days, switch to Hakone's hot springs.",
    },
    ja: {
      places: [
        ["河口湖", "逆さ富士の定番スポット"],
        ["新倉山浅間公園", "忠霊塔と富士山を一緒に撮れる"],
        ["忍野八海", "湧水の集落。短い立ち寄りに"],
        ["箱根", "温泉と芦ノ湖。1泊2日で"],
        ["大石公園", "河口湖北岸の開けた富士山ビュースポット"],
      ],
      tip: "晴れた日は河口湖と新倉山が必須。曇りの日は箱根の温泉に切り替えましょう。",
    },
    ko: {
      places: [
        ["가와구치호", "후지산 반영을 담는 대표 명소"],
        ["아라쿠라야마 센겐 공원", "주레이토 탑과 후지산을 한 프레임에"],
        ["오시노핫카이", "용천수 마을, 잠깐 들르기 좋아요"],
        ["하코네", "온천과 아시노호, 1박 2일 코스로 좋아요"],
        ["오이시 공원", "가와구치호 북쪽 기슭의 탁 트인 후지산 전망 명소"],
      ],
      tip: "맑은 날에는 가와구치호와 아라쿠라야마를 꼭 넣고, 흐린 날에는 하코네 온천으로 바꿔 보세요.",
    },
  },
  東京: {
    en: {
      places: [
        ["Senso-ji + Tokyo Skytree", "Traditional and modern landmarks in one go"],
        ["Meiji Jingu + Harajuku / Omotesando", "Shrine greenery next to a fashion district"],
        ["Ueno Park + museums", "Culture and a cherry blossom hotspot"],
        ["Shibuya + Shinjuku", "Shopping, food and night views"],
        ["Kamakura day trip", "Great Buddha, Enoden and sea views, an easy side trip"],
      ],
      tip: "Plan city classics and side trips on separate days for a more comfortable pace.",
    },
    ja: {
      places: [
        ["浅草寺＋東京スカイツリー", "伝統と現代のランドマークを一度に"],
        ["明治神宮＋原宿表参道", "神社の緑からおしゃれな街並みへ"],
        ["上野公園＋博物館", "文化と桜の名所"],
        ["渋谷＋新宿", "ショッピング、グルメ、夜景"],
        ["鎌倉日帰り", "大仏、江ノ電、海の景色。近郊旅行に"],
      ],
      tip: "市内の定番と近郊は別日に分けると、ゆとりのある旅になります。",
    },
    ko: {
      places: [
        ["센소지 + 도쿄 스카이트리", "전통과 현대의 랜드마크를 한 번에"],
        ["메이지 신궁 + 하라주쿠 오모테산도", "신사의 녹음에서 패션 거리로 이어져요"],
        ["우에노 공원 + 박물관", "문화와 벚꽃 명소"],
        ["시부야 + 신주쿠", "쇼핑, 맛집, 야경"],
        ["가마쿠라 당일치기", "대불, 에노덴, 바다 풍경, 근교 여행으로 좋아요"],
      ],
      tip: "시내 명소와 근교는 날을 나눠 잡으면 일정이 더 편해요.",
    },
  },
  首爾: {
    en: {
      places: [
        ["Gyeongbokgung + Bukchon Hanok Village", "Traditional Korean architecture and alley walks"],
        ["Hongdae / Ewha area", "Youth culture, cafés and shopping"],
        ["Myeongdong", "Shopping and Korean street food in one place"],
        ["N Seoul Tower", "Night views and a panorama of the city"],
        ["Gwangjang Market", "Authentic street food, good for lunch"],
      ],
      tip: "Do the classics in the first few days, and save shopping districts and cafés for a slower final stretch.",
    },
    ja: {
      places: [
        ["景福宮＋北村韓屋村", "韓国の伝統建築と路地散策"],
        ["弘大、梨大エリア", "若者文化、カフェ、ショッピング"],
        ["明洞", "ショッピングと韓国グルメが集まる"],
        ["Nソウルタワー", "夜景と街の全景"],
        ["広蔵市場", "本場の屋台グルメ。ランチに"],
      ],
      tip: "前半は定番を回り、後半は繁華街やカフェでのんびり過ごすのがおすすめです。",
    },
    ko: {
      places: [
        ["경복궁 + 북촌 한옥마을", "전통 건축과 골목 산책"],
        ["홍대, 이대 상권", "젊은 문화, 카페, 쇼핑"],
        ["명동", "쇼핑과 길거리 음식이 모여 있어요"],
        ["N서울타워", "야경과 도시 전경"],
        ["광장시장", "현지 먹거리, 점심으로 좋아요"],
      ],
      tip: "앞쪽 며칠은 대표 명소를, 뒤쪽은 상권과 카페를 여유롭게 둘러보세요.",
    },
  },
  曼谷: {
    en: {
      places: [
        ["Grand Palace + Wat Phra Kaew", "Bangkok's most classic temple combo"],
        ["Wat Arun", "Landmark across the river, best toward sunset"],
        ["Chatuchak Weekend Market", "Weekend market for treasure hunting and snacks"],
        ["ICONSIAM", "Riverside mall, easy to reach by boat"],
        ["Jodd Fairs Night Market", "Food and nightlife"],
      ],
      tip: "Spread temples, markets and night markets across different days so it's never rushed.",
    },
    ja: {
      places: [
        ["王宮＋エメラルド寺院", "バンコク定番の寺院の組み合わせ"],
        ["ワット・アルン", "対岸のランドマーク。夕方がおすすめ"],
        ["チャトゥチャック・ウィークエンドマーケット", "週末市場。掘り出し物探しや食べ歩きに"],
        ["アイコンサイアム", "川沿いのモール。船で立ち寄れる"],
        ["ジョッドフェア", "グルメとナイトライフ"],
      ],
      tip: "寺院、市場、夜市を日ごとに分ければ慌ただしくなりません。",
    },
    ko: {
      places: [
        ["왕궁 + 왓 프라깨우", "방콕의 대표 사원 조합"],
        ["왓 아룬", "강 건너편 랜드마크, 해 질 무렵에 좋아요"],
        ["짜뚜짝 주말시장", "주말 시장, 보물찾기와 간식"],
        ["아이콘시암", "강변 쇼핑몰, 배로 함께 둘러보기 좋아요"],
        ["쩟페어 야시장", "먹거리와 나이트라이프"],
      ],
      tip: "사원, 시장, 야시장을 날마다 나누면 바쁘지 않아요.",
    },
  },
  清邁: {
    en: {
      places: [
        ["Old City temples", "Several temples within walking distance"],
        ["Wat Phra Singh", "Important Lanna temple inside the Old City"],
        ["Wat Phra That Doi Suthep", "Overlooks Chiang Mai from Doi Suthep"],
        ["Saturday / Sunday Walking Street", "Local snacks and handicrafts"],
        ["Nimman Road", "Cafés and indie shops"],
      ],
      tip: "Old City walks, markets and nearby sights can each take a day.",
    },
    ja: {
      places: [
        ["旧市街の寺院", "徒歩で複数の寺院を巡れる"],
        ["ワット・プラシン", "旧市街にある重要なランナー寺院"],
        ["ワット・プラタート・ドイステープ", "ステープ山からチェンマイを一望"],
        ["土曜、日曜ナイトマーケット", "ローカルグルメと手作り雑貨"],
        ["ニマン通り", "カフェとおしゃれな雑貨店"],
      ],
      tip: "旧市街散策、市場、近郊をそれぞれ1日ずつ組めます。",
    },
    ko: {
      places: [
        ["올드시티 사원", "걸어서 여러 사원을 둘러볼 수 있어요"],
        ["왓 프라싱", "올드시티 안의 중요한 란나 사원"],
        ["왓 프라탓 도이수텝", "도이수텝산에서 치앙마이를 내려다봐요"],
        ["토요일, 일요일 야시장", "현지 간식과 수공예품"],
        ["님만해민", "카페와 감성 소품숍"],
      ],
      tip: "올드시티 산책, 시장, 근교를 하루씩 잡을 수 있어요.",
    },
  },
  芭達雅: {
    en: {
      places: [
        ["Sanctuary of Truth", "Carved wooden architecture, stunning by the sea"],
        ["Pattaya Beach", "In-town beach walks and water sports"],
        ["Pattaya Floating Market", "Distinctive market, good for half a day"],
        ["Koh Larn (Coral Island)", "Island hopping, snorkeling and beaches"],
        ["Jomtien Beach", "Quieter, good for watching the sunset"],
      ],
      tip: "Better to split beach downtime and island hopping into separate days.",
    },
    ja: {
      places: [
        ["サンクチュアリ・オブ・トゥルース", "木造建築の芸術。海辺に建つ姿が圧巻"],
        ["パタヤビーチ", "市内のビーチ散歩とマリンアクティビティ"],
        ["パタヤ水上マーケット", "個性的な市場。半日で"],
        ["ラン島（コーラル島）", "島めぐり、シュノーケリング、ビーチ"],
        ["ジョムティエンビーチ", "比較的静かで夕日鑑賞に"],
      ],
      tip: "ビーチでのんびりする日と島めぐりの日は分けるのがおすすめです。",
    },
    ko: {
      places: [
        ["진리의 성전", "목조 건축 예술, 바닷가에 있어 웅장해요"],
        ["파타야 비치", "시내 해변 산책과 수상 액티비티"],
        ["파타야 수상시장", "특색 있는 시장, 반나절 코스"],
        ["꼬란 섬", "섬 투어, 스노클링, 해변"],
        ["좀티엔 비치", "비교적 조용해서 노을 보기 좋아요"],
      ],
      tip: "해변 휴식과 섬 투어는 날을 나누는 게 좋아요.",
    },
  },
  普吉島: {
    en: {
      places: [
        ["Patong Beach", "The liveliest beach and nightlife"],
        ["Phuket Old Town", "Sino-Portuguese architecture and small cafés"],
        ["Wat Chalong", "Phuket's largest Buddhist temple"],
        ["Promthep Cape", "Sunset viewpoint at the southern tip"],
        ["Phi Phi Islands", "Classic island-hopping day trip"],
      ],
      tip: "Island hopping early in the trip and beach time later keeps things balanced.",
    },
    ja: {
      places: [
        ["パトンビーチ", "最もにぎやかなビーチとナイトライフ"],
        ["プーケットオールドタウン", "シノポルトギース建築と小さなカフェ"],
        ["ワット・シャロン", "プーケット最大の寺院"],
        ["プロムテップ岬", "南端の夕日スポット"],
        ["ピピ島", "定番の島めぐり日帰りツアー"],
      ],
      tip: "前半に島めぐり、後半はビーチでのんびりするとバランスが取れます。",
    },
    ko: {
      places: [
        ["빠똥 비치", "가장 활기찬 해변과 나이트라이프"],
        ["푸껫 올드타운", "중국-포르투갈풍 건축과 작은 카페"],
        ["왓 찰롱", "푸껫 최대의 사원"],
        ["프롬텝 곶", "남쪽 끝의 노을 전망대"],
        ["피피섬", "대표적인 섬 투어 당일치기"],
      ],
      tip: "앞쪽은 섬 투어, 뒤쪽은 해변에서 쉬면 균형이 맞아요.",
    },
  },
};

function resolveGuideKey(destination: string): string | null {
  const label = normalizeDestinationLabel(destination);
  if (DESTINATION_MUST_VISIT[label]) return label;
  if (label.includes("曼谷")) return "曼谷";
  if (label.includes("普吉")) return "普吉島";
  return null;
}

function buildForeignMustVisitPlacesReply(
  label: string,
  city: string | undefined,
  kind: string,
  days: number | undefined,
  locale: ForeignLocale,
): string {
  const shown = displayDestinationForCopy(label, undefined, locale);
  const cityShown = city ? displayDestinationForCopy(city, undefined, locale) : "";
  const key = resolveGuideKey(label);
  const guide = key ? DESTINATION_MUST_VISIT_I18N[key]?.[locale] : undefined;
  const d =
    days == null
      ? ""
      : locale === "en"
        ? ` (based on ${days} days)`
        : locale === "ja"
          ? `（${days}日間の目安）`
          : ` (${days}일 기준)`;
  const withCity = kind === "landmark" && city && city !== label;
  const header = {
    en: withCity
      ? `Here are popular spots around ${shown} and in ${cityShown} that fit on the same route${d}:`
      : kind === "landmark"
        ? `Here are popular spots to pair with ${shown}${d}:`
        : `Here are some must-visit places in ${shown}${d}:`,
    ja: withCity
      ? `${shown}周辺と${cityShown}で一緒に回れる人気スポットを探しました${d}：`
      : kind === "landmark"
        ? `${shown}周辺で組み合わせやすい人気スポットを探しました${d}：`
        : `${shown}の必見スポットをまとめました${d}：`,
    ko: withCity
      ? `${shown} 주변과 ${cityShown}에서 함께 둘러보기 좋은 인기 장소를 찾아봤어요${d}:`
      : kind === "landmark"
        ? `${shown} 주변에서 함께 가기 좋은 인기 장소를 찾아봤어요${d}:`
        : `${shown}의 꼭 가볼 만한 곳을 정리했어요${d}:`,
  }[locale];
  const headerShown = applyEnglishPlaceArticles(header, locale);
  const lines = (guide?.places ?? []).map(([name, reason], index) => `${index + 1}. ${name} — ${reason}`);
  const parts = [headerShown, "", ...lines];
  if (guide?.tip) parts.push("", guide.tip);
  parts.push(
    "",
    {
      en: "If you'd like to add any to your trip, tell me which ones you want to schedule first.",
      ja: "旅程に加えたい場合は、まずどれを入れたいか教えてください。",
      ko: "일정에 넣고 싶다면 가장 먼저 넣고 싶은 곳을 알려 주세요.",
    }[locale],
  );
  return parts.join("\n");
}

/** 使用者明確要求必去景點／必去點 */
export function detectMustVisitIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return MUST_VISIT_RE.test(t);
}

/** 使用者要求推薦景點／列出地點（含「有哪些值得去」） */
export function detectPlaceRecommendationIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return PLACE_RECOMMENDATION_RE.test(t) || MUST_VISIT_RE.test(t);
}

export function parseMustVisitPlacesIntent(text: string): boolean {
  return detectMustVisitIntent(text) || detectPlaceRecommendationIntent(text);
}

export function parseDailyRhythmIntent(text: string): boolean {
  return DAILY_RHYTHM_RE.test(text.trim());
}

export function parsePlanningFollowUpIntent(text: string): PlanningFollowUpIntent | null {
  const t = text.trim();
  if (!t) return null;
  if (parseItineraryPlanModeIntent(t) === "full_itinerary") return "full_itinerary";
  if (isCreateItineraryRequest(t)) return "full_itinerary";
  if (detectMustVisitIntent(t) || detectPlaceRecommendationIntent(t)) return "must_visit_places";
  if (parseDailyRhythmIntent(t)) return "daily_rhythm";
  return null;
}

function parseDestinationForMustVisit(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;

  const leading = t.match(
    /^([\u4e00-\u9fff]{2,10})(?:的)?(?:必去點|必去景點|必去|推薦景點|有哪些|列景點|列出景點|值得去)/,
  );
  if (leading?.[1]) {
    const fromLeading = parseDestinationFromText(leading[1]);
    if (fromLeading) return fromLeading;
  }

  return parseDestinationFromText(t);
}

export function resolveMustVisitDestination(
  ctx: CanonicalTravelContext,
  userText?: string,
): string | undefined {
  const fromCtx =
    ctx.destination?.trim() ||
    ctx.destinationCities?.[0]?.trim() ||
    undefined;
  if (fromCtx) return normalizeDestinationLabel(fromCtx);
  if (!userText?.trim()) return undefined;
  const parsed = parseDestinationForMustVisit(userText);
  if (parsed) return normalizeDestinationLabel(parsed);
  const embedded = resolveDestinationFromText(userText);
  return embedded ? normalizeDestinationLabel(embedded) : undefined;
}

function resolveGuide(destination: string): DestinationMustVisitGuide | null {
  const label = normalizeDestinationLabel(destination);
  if (DESTINATION_MUST_VISIT[label]) return DESTINATION_MUST_VISIT[label];

  if (label.includes("曼谷")) return DESTINATION_MUST_VISIT["曼谷"];
  if (label.includes("普吉")) return DESTINATION_MUST_VISIT["普吉島"];

  return null;
}

export function getMustVisitPlacesForDestination(destination: string): MustVisitPlace[] {
  const guide = resolveGuide(destination);
  if (guide) return guide.places.slice(0, 5);
  // Unknown destination: never invent category-template place names.
  // Combination / itinerary pipelines must discover real Places instead.
  return [];
}

export function isGenericTemplatePlaceName(name: string, destination: string): boolean {
  return isGenericPlaceLabel(name, destination);
}

/** 具名真實地點 fallback（source=fallback，非泛用模板） */
export function buildNamedFallbackRecommendations(
  destination: string,
  /** Display locale; defaults to zh so callers that do not pass it keep the original output. */
  locale: Locale = "zh-TW",
): RoamieRecommendationItem[] {
  const label = normalizeDestinationLabel(destination);
  const guide = resolveGuide(label);
  const places = guide?.places ?? [];
  const realPlaces = places.filter((p) => !isGenericTemplatePlaceName(p.name, label));
  if (!realPlaces.length) return [];

  if (locale !== "zh-TW") {
    const key = resolveGuideKey(label);
    const foreign = key ? DESTINATION_MUST_VISIT_I18N[key]?.[locale] : undefined;
    const shownAddress = displayDestinationForCopy(label, undefined, locale);
    return realPlaces.slice(0, 5).map((place) => {
      // Same order as DESTINATION_MUST_VISIT; originalName keeps the source (zh) name.
      const entry = foreign?.places[places.indexOf(place)];
      const shownName = entry?.[0] ?? place.name;
      const shownReason = entry?.[1] ?? place.reason;
      return normalizeRecommendationItem(
        {
          name: shownName,
          placeName: shownName,
          originalName: place.name,
          type: "景點",
          description: shownReason,
          reason: shownReason,
          reasonSource: "fallback",
          estimatedTime: "1-2 小時",
          address: shownAddress,
        },
        locale,
      );
    });
  }

  return realPlaces.slice(0, 5).map((place) =>
    normalizeRecommendationItem({
      name: place.name,
      placeName: place.name,
      type: "景點",
      description: place.reason,
      reason: place.reason,
      reasonSource: "fallback",
      estimatedTime: "1-2 小時",
      address: label,
    }),
  );
}

export function buildMustVisitRecommendations(
  destination: string,
): RoamieRecommendationItem[] {
  const label = normalizeDestinationLabel(destination);
  return getMustVisitPlacesForDestination(label).map((place) =>
    normalizeRecommendationItem({
      name: place.name,
      placeName: place.name,
      type: "景點",
      description: place.reason,
      reason: place.reason,
      reasonSource: "template",
      estimatedTime: "1-2 小時",
      address: label,
    }),
  );
}

export function buildMustVisitPlacesReply(ctx: CanonicalTravelContext, locale?: Locale): string | null {
  const destination = resolveMustVisitDestination(ctx);
  if (!destination) return null;

  const label = normalizeDestinationLabel(destination);
  const places = getMustVisitPlacesForDestination(label);
  const days = ctx.days;
  const guide = resolveGuide(label);
  const profile = classifyDestinationForPlaceSearch(label);
  const city = profile.nearestCity?.trim();
  const resolvedLocale = locale ?? effectiveAppLocale();
  if (resolvedLocale !== "zh-TW") {
    return buildForeignMustVisitPlacesReply(label, city, profile.kind, days, resolvedLocale);
  }
  const header =
    profile.kind === "landmark" && city && city !== label
      ? days
        ? `我幫你找${label}周邊和${city}可順路安排的人氣地點（${days} 天參考）：`
        : `我幫你找${label}周邊和${city}可順路安排的人氣地點：`
      : profile.kind === "landmark"
        ? days
          ? `我幫你找${label}周邊可搭配的人氣地點（${days} 天參考）：`
          : `我幫你找${label}周邊可搭配的人氣地點：`
        : days
          ? `我幫你整理幾個${label}必去點（${days} 天參考）：`
          : `我幫你整理幾個${label}必去點：`;

  const lines = places.map((place, index) => `${index + 1}. ${place.name} — ${place.reason}`);

  const parts = [header, "", ...lines];
  if (guide?.rhythmTip) {
    parts.push("", guide.rhythmTip);
  }
  parts.push("", "想加進行程的話，跟我說你最想先排哪幾個。");

  return parts.join("\n");
}

export type MustVisitAdviceResult = {
  reply: string;
  recommendations: RoamieRecommendationItem[];
  contextPatch: Partial<CanonicalTravelContext>;
};

export function resolveMustVisitAdvice(
  ctx: CanonicalTravelContext,
  userText?: string,
  locale?: Locale,
): MustVisitAdviceResult | null {
  try {
  const text = userText?.trim() ?? "";
  if (text && hasCategoryPlaceQuery(text)) return null;
  if (!text && !ctx.mustVisitGenerated) return null;
  if (text && !detectMustVisitIntent(text) && !detectPlaceRecommendationIntent(text)) {
    if (!ctx.mustVisitGenerated) return null;
    if (isAffirmativeReply(text) || /^(嗯|對|對啊)$/i.test(text.trim())) return null;
  }

  const destination = resolveMustVisitDestination(ctx, text);
  if (!destination) return null;

  const mergedCtx = { ...ctx, destination };
  const reply = buildMustVisitPlacesReply(mergedCtx, locale);
  if (!reply) return null;

  const recommendations = buildMustVisitRecommendations(destination).filter((item) =>
    isSuggestionInDestinationScope(item.name, destination),
  );
  const stage = planningStageAfterRecommendations();

  return {
    reply,
    recommendations,
    contextPatch: {
      destination,
      mustVisitGenerated: true,
      tripPurpose: "must_visit_places",
      conversationState: "itinerary_draft",
      planningStage: stage,
    },
  };
  } catch (error) {
    console.warn(
      "[resolveMustVisitAdvice]",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export function mergeContextForPlaceFetch(
  ctx: CanonicalTravelContext = { interests: [] },
  session?: { travelContext?: CanonicalTravelContext | null },
): CanonicalTravelContext {
  return {
    ...ctx,
    ...(session?.travelContext ?? {}),
    interests: session?.travelContext?.interests ?? ctx.interests ?? [],
  };
}

export function shouldFetchDestinationPlaces(
  userText: string,
  ctx: CanonicalTravelContext = { interests: [] },
): boolean {
  if (isFutureTripPlanningStatement(userText) || isCountryCityInquiryText(userText)) {
    return false;
  }
  if (hasCategoryPlaceQuery(userText)) return false;
  if (!detectMustVisitIntent(userText) && !detectPlaceRecommendationIntent(userText)) {
    return false;
  }
  const destination = resolveMustVisitDestination(ctx, userText);
  if (!destination) return false;

  const scopeGate = evaluateDestinationScopeGate({
    destination,
    destinationType: ctx.destinationType,
    countryCode: ctx.destinationCountry,
    requestedIntent: "must_visit_places",
  });
  if (scopeGate.placesCallBlocked) {
    logDestinationScopeBlocked(scopeGate);
    return false;
  }
  return true;
}

export function buildDestinationDayPlanSuggestions(destination: string, days: number): string[] {
  const label = normalizeDestinationLabel(destination);
  const guide = resolveGuide(label);
  const places = (guide?.places ?? getMustVisitPlacesForDestination(label)).slice(0, 5);

  if (places.length >= 3) {
    return [
      days <= 1 ? `• ${places[0]!.name}` : `• 早上${places[0]!.name}`,
      days >= 2 && places[1] ? `• 下午${places[1]!.name}` : undefined,
      places[2]
        ? `• 晚上${places[2]!.name}`
        : `• 晚上${label}在地美食或商圈`,
    ].filter((line): line is string => line != null);
  }

  return [
    days <= 1 ? `• ${label}經典地標` : `• 早上${label}經典地標`,
    days >= 2 ? `• 下午${label}特色商圈或文化景點` : undefined,
    `• 晚上${label}在地美食或夜市`,
  ].filter((line): line is string => line != null);
}
export function buildMustVisitContextPatch(
  ctx: CanonicalTravelContext,
  userText?: string,
): Partial<CanonicalTravelContext> {
  const destination = resolveMustVisitDestination(ctx, userText);
  const stage = planningStageAfterMustVisitIntent(Boolean(destination));
  return {
    ...(destination ? { destination } : {}),
    planningStage: stage,
    tripPurpose: "must_visit_places",
  };
}

export function buildDailyRhythmReply(ctx: CanonicalTravelContext, locale?: Locale): string | null {
  const destination = resolveMustVisitDestination(ctx);
  if (!destination) return null;

  const label = normalizeDestinationLabel(destination);
  const days = ctx.days ?? 5;
  const resolvedLocale = locale ?? effectiveAppLocale();
  if (resolvedLocale !== "zh-TW") {
    const shown = displayDestinationForCopy(label, undefined, resolvedLocale);
    const bangkok = label === "曼谷" || label.includes("曼谷");
    const copy = {
      en: bangkok
        ? [
            `Okay, here's how I'd pace ${shown} over ${days} days:`,
            "Day 1: Grand Palace, Wat Phra Kaew, Wat Arun (city temples)",
            "Day 2: Wat Pho, ICONSIAM, a riverside night market",
            "Day 3: Chatuchak Market, a massage, Jodd Fairs Night Market",
            "Day 4: Half-day trip to a floating market or the Maeklong Railway Market",
            days >= 5 ? "Day 5: Free time for shopping, cafés or nearby sights" : undefined,
            "",
            "This plan mixes classics and markets, so it won't feel rushed.",
            "Would you like to give any day more shopping or massage time?",
          ]
        : [
            `Okay, for ${shown} over ${days} days, I'd put classic landmarks first, mix in food or markets in the middle, and keep the last day flexible or for a nearby trip.`,
            "Would you like a looser pace, or an extra day for shopping or night views?",
          ],
      ja: bangkok
        ? [
            `${shown}${days}日間なら、こんなペースで組みます：`,
            "1日目：王宮、エメラルド寺院、ワット・アルン（市内の寺院）",
            "2日目：ワット・ポー、アイコンサイアム、川沿いの夜市",
            "3日目：チャトゥチャック市場、マッサージ、ジョッドフェア",
            "4日目：水上マーケットかメークローン線路市場へ半日ツアー",
            days >= 5 ? "5日目：ショッピング、カフェ、近郊を自由に" : undefined,
            "",
            "定番と市場を組み合わせたプランなので、慌ただしくなりません。",
            "ショッピングやマッサージを多めにしたい日はありますか？",
          ]
        : [
            `${shown}${days}日間なら、前半は定番のランドマーク、中盤はグルメや市場を挟み、最後の1日は自由行動か近郊にするのがおすすめです。`,
            "ゆったりめのペースにしますか？それともショッピングや夜景に1日多く使いますか？",
          ],
      ko: bangkok
        ? [
            `좋아요, ${shown} ${days}일은 이런 흐름으로 잡아 볼게요:`,
            "1일차: 왕궁, 왓 프라깨우, 왓 아룬(시내 사원)",
            "2일차: 왓 포, 아이콘시암, 강변 야시장",
            "3일차: 짜뚜짝 시장, 마사지, 쩟페어 야시장",
            "4일차: 수상시장 또는 매끌롱 기찻길 시장 반나절 투어",
            days >= 5 ? "5일차: 쇼핑, 카페, 근교 자유 일정" : undefined,
            "",
            "대표 명소와 시장을 섞은 일정이라 바쁘지 않아요.",
            "쇼핑이나 마사지를 더 넣고 싶은 날이 있나요?",
          ]
        : [
            `좋아요, ${shown} ${days}일이라면 앞쪽에는 대표 랜드마크를, 중간에는 맛집이나 시장을, 마지막 하루는 자유 일정이나 근교로 남겨 두는 걸 추천해요.`,
            "일정을 더 여유롭게 할까요, 아니면 쇼핑이나 야경에 하루를 더 쓸까요?",
          ],
    }[resolvedLocale];
    return applyEnglishPlaceArticles(copy.filter((line) => line !== undefined).join("\n"), resolvedLocale);
  }

  if (label === "曼谷" || label.includes("曼谷")) {
    return [
      `好，${label} ${days} 天我會這樣抓節奏：`,
      "第 1 天：大皇宮、玉佛寺、鄭王廟（市區寺廟）",
      "第 2 天：臥佛寺、ICONSIAM、河畔夜市",
      "第 3 天：恰圖恰市集、按摩、喬德夜市",
      "第 4 天：水上市場或美功鐵道市場半日遊",
      days >= 5 ? "第 5 天：自由安排購物、咖啡廳或近郊" : undefined,
      "",
      "這版節奏偏經典＋市集混搭，不會太趕。",
      "你想把哪一天改成購物或按摩多一點嗎？",
    ]
      .filter((line) => line !== undefined)
      .join("\n");
  }

  return [
    `好，${label} ${days} 天我會建議前段排經典地標，中間穿插美食或市集，最後留 1 天彈性或近郊。`,
    "你想把節奏排得鬆一點，還是多留一天給購物或夜景？",
  ].join("\n");
}
