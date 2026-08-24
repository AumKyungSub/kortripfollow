import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";
dotenv.config();

const app = express();

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME;
const HAS_MONGO_DB = Boolean(MONGO_URI);
const TOUR_API_SERVICE_KEY = process.env.TOUR_API_SERVICE_KEY?.trim() || "";
const HAS_TOUR_API = Boolean(TOUR_API_SERVICE_KEY);
let mongoReady = false;
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://kortripfollow.com")
  .replace(/\/$/, "");
const COOKIE_SECURE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === "true"
  : FRONTEND_URL.startsWith("https://");
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEV_LOGIN_ENABLED = !IS_PRODUCTION && process.env.ENABLE_DEV_LOGIN === "true";
const DEFAULT_OPERATOR_ACCOUNT = IS_PRODUCTION
  ? { provider: "naver", providerUserId: "MseWCjpbk4rEv60wMmoJb3ccntNZad9wBxpLvc-ZZW8" }
  : { provider: "google", providerUserId: "109319327339050443610" };
const OPERATOR_PROVIDER = process.env.OPERATOR_PROVIDER || DEFAULT_OPERATOR_ACCOUNT.provider;
const OPERATOR_PROVIDER_USER_ID = process.env.OPERATOR_PROVIDER_USER_ID || DEFAULT_OPERATOR_ACCOUNT.providerUserId;
const TOUR_API_BASE_URL = "https://apis.data.go.kr/B551011/KorService2";
const TOUR_API_ENGLISH_BASE_URL = "https://apis.data.go.kr/B551011/EngService2";
const TOUR_API_TIMEOUT_MS = 8000;

if (!HAS_TOUR_API) {
  console.info("TourAPI integration is disabled: TOUR_API_SERVICE_KEY is not configured");
}

function isPrivateHostname(hostname = "") {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" ||
    /^10\./.test(hostname) || /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}

function isPrivateRequest(req) {
  const address = (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  return isPrivateHostname(address);
}

async function requestTourApi(path, query = {}, baseUrl = TOUR_API_BASE_URL) {
  if (!HAS_TOUR_API) {
    const error = new Error("TourAPI is not configured");
    error.status = 503;
    throw error;
  }

  const params = new URLSearchParams({
    MobileOS: "ETC",
    MobileApp: "Kortrip",
    _type: "json",
    ...query
  });
  const encodedServiceKey = /%[0-9A-F]{2}/i.test(TOUR_API_SERVICE_KEY)
    ? TOUR_API_SERVICE_KEY
    : encodeURIComponent(TOUR_API_SERVICE_KEY);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOUR_API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${baseUrl}/${path}?serviceKey=${encodedServiceKey}&${params}`,
      {
      signal: controller.signal,
      headers: { Accept: "application/json" }
      }
    );
    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      const error = new Error("TourAPI returned an invalid response");
      error.status = 502;
      throw error;
    }

    const resultCode = payload?.response?.header?.resultCode;
    if (!response.ok || resultCode !== "0000") {
      const error = new Error("TourAPI request failed");
      error.status = response.status >= 400 ? response.status : 502;
      error.tourApiCode = resultCode || null;
      throw error;
    }

    return payload.response.body;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("TourAPI request timed out");
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTourApiPlace(item = {}) {
  const overview = normalizeTourApiOverview(item.overview);
  return {
    source: "tourApi",
    externalId: String(item.contentid || ""),
    contentTypeId: item.contenttypeid ? String(item.contenttypeid) : null,
    name: item.title || "",
    address: [item.addr1, item.addr2].filter(Boolean).join(" "),
    areaCode: item.areacode || item.lDongRegnCd
      ? String(item.areacode || item.lDongRegnCd)
      : null,
    sigunguCode: item.sigungucode || item.lDongSignguCd
      ? String(item.sigungucode || item.lDongSignguCd)
      : null,
    coordinates: {
      latitude: item.mapy ? Number(item.mapy) : null,
      longitude: item.mapx ? Number(item.mapx) : null
    },
    thumbnail: item.firstimage2 || item.firstimage || null,
    overview,
    shortOverview: createTourApiShortOverview(overview)
  };
}

function normalizeTourApiOverview(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

function createTourApiShortOverview(overview, maxLength = 220) {
  const text = String(overview || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength + 1);
  const lastSpace = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, lastSpace > maxLength * 0.7 ? lastSpace : maxLength).trim()}…`;
}

const KORTRIP_REGION_BY_LEGAL_CODE = {
  "11": { code: "SEOUL", name: "서울특별시" },
  "26": { code: "GSBUSANDAEGUULSAN", name: "부산광역시" },
  "27": { code: "GSBUSANDAEGUULSAN", name: "대구광역시" },
  "28": { code: "GGICN", name: "인천광역시" },
  "29": { code: "JRGWANGJU", name: "광주광역시" },
  "30": { code: "CCDAEJEON", name: "대전광역시" },
  "31": { code: "GSBUSANDAEGUULSAN", name: "울산광역시" },
  "36": { code: "CCDAEJEON", name: "세종특별자치시" },
  "41": { code: "GGICN", name: "경기도" },
  "42": { code: "GANGWON", name: "강원특별자치도" },
  "43": { code: "CCDAEJEON", name: "충청북도" },
  "44": { code: "CCDAEJEON", name: "충청남도" },
  "45": { code: "JRGWANGJU", name: "전북특별자치도" },
  "46": { code: "JRGWANGJU", name: "전라남도" },
  "47": { code: "GSBUSANDAEGUULSAN", name: "경상북도" },
  "48": { code: "GSBUSANDAEGUULSAN", name: "경상남도" },
  "50": { code: "JEJU", name: "제주특별자치도" },
  "51": { code: "GANGWON", name: "강원특별자치도" },
  "52": { code: "JRGWANGJU", name: "전북특별자치도" }
};

function inferPlaceType(contentTypeId) {
  if (String(contentTypeId) === "32") return "lodging";
  if (String(contentTypeId) === "39") return "restaurant";
  return "attraction";
}

async function searchTourApiPlaces(keyword, limit = 5) {
  const body = await requestTourApi("searchKeyword2", {
    keyword,
    numOfRows: String(limit),
    pageNo: "1",
    arrange: "A"
  });
  const items = body?.items?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  return {
    totalCount: Number(body?.totalCount || 0),
    items: list.map(normalizeTourApiPlace)
  };
}

function normalizeTourApiImage(item = {}) {
  return {
    source: "tourApi",
    contentId: String(item.contentid || ""),
    serialNumber: item.serialnum ? String(item.serialnum) : null,
    name: item.imgname || "",
    originalUrl: item.originimgurl || null,
    thumbnailUrl: item.smallimageurl || item.originimgurl || null,
    copyrightType: item.cpyrhtDivCd || null,
    license: item.cpyrhtDivCd === "Type1" ? "KOGL-1" : null,
    provider: "한국관광공사 TourAPI"
  };
}

async function getTourApiType1Images(contentId, limit = 20) {
  const body = await requestTourApi("detailImage2", {
    contentId,
    numOfRows: String(limit),
    pageNo: "1"
  });
  const items = body?.items?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  const type1Images = list
    .filter(item => item?.cpyrhtDivCd === "Type1" && item?.originimgurl)
    .map(normalizeTourApiImage);

  return {
    totalCount: Number(body?.totalCount || 0),
    usableCount: type1Images.length,
    items: type1Images
  };
}

async function getTourApiPlaceDetail(contentId) {
  const body = await requestTourApi("detailCommon2", {
    contentId,
    numOfRows: "1",
    pageNo: "1"
  });
  const items = body?.items?.item;
  const item = Array.isArray(items) ? items[0] : items;
  return item ? normalizeTourApiPlace(item) : null;
}

function distanceInMeters(first, second) {
  const toRadians = value => value * Math.PI / 180;
  const lat1 = toRadians(first.latitude);
  const lat2 = toRadians(second.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(second.longitude - first.longitude);
  const value = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

const ENGLISH_CONTENT_TYPE_BY_KOREAN = {
  "12": "76", "14": "78", "15": "85", "25": "75",
  "28": "77", "32": "80", "38": "79", "39": "82"
};

function koreanNameKey(value) {
  return String(value || "")
    .replace(/\[[^\]]*]/g, "")
    .match(/[가-힣0-9]+/g)?.join("") || "";
}

async function getTourApiEnglishPlace(koreanPlace) {
  const coordinates = koreanPlace?.coordinates;
  if (coordinates?.latitude == null || coordinates?.longitude == null) return null;

  try {
    const targetName = koreanNameKey(koreanPlace.name);
    if (!targetName) return null;
    const body = await requestTourApi("searchKeyword2", {
      keyword: targetName,
      numOfRows: "30",
      pageNo: "1",
      arrange: "A"
    }, TOUR_API_ENGLISH_BASE_URL);
    const items = body?.items?.item;
    const candidates = (Array.isArray(items) ? items : items ? [items] : [])
      .map(normalizeTourApiPlace)
      .filter(place => place.externalId &&
        place.coordinates.latitude != null && place.coordinates.longitude != null)
      .map(place => ({
        place,
        distance: distanceInMeters(coordinates, place.coordinates),
        candidateName: koreanNameKey(place.name),
        sameType: String(place.contentTypeId || "") ===
          String(ENGLISH_CONTENT_TYPE_BY_KOREAN[String(koreanPlace.contentTypeId)] || "")
      }))
      .filter(candidate => candidate.distance <= 1000 && candidate.candidateName.includes(targetName))
      .sort((first, second) =>
        Number(second.candidateName === targetName) - Number(first.candidateName === targetName) ||
        Number(second.sameType) - Number(first.sameType) ||
        first.distance - second.distance
      );

    const match = candidates[0]?.place;
    if (!match) return null;

    const detailBody = await requestTourApi("detailCommon2", {
      contentId: match.externalId,
      numOfRows: "1",
      pageNo: "1"
    }, TOUR_API_ENGLISH_BASE_URL);
    const detailItems = detailBody?.items?.item;
    const detail = Array.isArray(detailItems) ? detailItems[0] : detailItems;
    return detail ? normalizeTourApiPlace(detail) : null;
  } catch (error) {
    console.info(`TourAPI English data skipped (${error.tourApiCode || error.status || "unavailable"})`);
    return null;
  }
}

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

const ALLOWED_ORIGINS = new Set([
  "https://kortripfollow.shop",
  "https://www.kortripfollow.shop",
  "https://m.kortripfollow.shop",
  "https://iridescent-semolina-29f8f8.netlify.app",
  "http://localhost:5173",
  "http://172.30.1.54:5173",

  // Cloudflare
  "https://kortripfollow.com",
  "https://www.kortripfollow.com",
  "https://kortripfollowfront.pages.dev",
  FRONTEND_URL
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    try {
      const url = new URL(origin);
      if (!IS_PRODUCTION && url.protocol === "http:" && url.port === "5173" && isPrivateHostname(url.hostname)) {
        return callback(null, true);
      }
    } catch {}
    return callback(new Error("Origin not allowed by CORS"));
  },
  credentials: true
}));

// 🔥 dev 모드 감지 (localhost or LOCAL_DB=true 사용 가능)
const USE_LOCAL_DB = process.env.USE_LOCAL_DB === "true";

// ----- MongoDB 연결 (prod에서만 실행) -----
if (HAS_MONGO_DB) {
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      ...(MONGO_DB_NAME ? { dbName: MONGO_DB_NAME } : {})
    });
    mongoReady = true;
    console.log(`MongoDB Connected: ${mongoose.connection.name}`);
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    if (!USE_LOCAL_DB) process.exit(1);
  }
} else if (!USE_LOCAL_DB) {
  console.error("MONGO_URI not found in environment variables");
  process.exit(1);
}

// ----- LOCAL MOCK 데이터 로딩 -----
let localDB = null;
if (USE_LOCAL_DB) {
  const rawData = fs.readFileSync("./db.json");
  localDB = JSON.parse(rawData);
  console.log("🔥 Using Local DB JSON!");
}

// ----- Content schemas (strict:false) -----
function createContentModel(name, collection) {
  return mongoose.model(
    name,
    new mongoose.Schema({}, { strict: false, collection })
  );
}

const Blog = createContentModel("Blog", "blogs");
const Ranking = createContentModel("Ranking", "rankings");
const Season = createContentModel("Season", "seasons");
const Cafe = createContentModel("Cafe", "cafes");
const Restaurant = createContentModel("Restaurant", "restaurants");
const Lodging = createContentModel("Lodging", "lodgings");
const Food = createContentModel("Food", "foods");
const Collection = createContentModel("Collection", "collections");

const externalPlaceImageSchema = new mongoose.Schema({
  serialNumber: { type: String, default: null },
  name: { type: String, default: "", maxlength: 300 },
  originalUrl: { type: String, required: true },
  thumbnailUrl: { type: String, required: true },
  copyrightType: { type: String, enum: ["Type1"], required: true },
  license: { type: String, enum: ["KOGL-1"], required: true },
  provider: { type: String, default: "한국관광공사 TourAPI" }
}, { _id: false });

const externalPlaceSchema = new mongoose.Schema({
  source: { type: String, enum: ["tourApi", "manual"], required: true },
  externalId: { type: String, required: true, trim: true },
  publicId: { type: Number, default: null },
  status: { type: String, enum: ["draft", "published"], default: "draft" },
  contentTypeId: { type: String, default: null },
  placeType: {
    type: String,
    enum: ["attraction", "cafe", "restaurant", "lodging", "food"],
    default: "attraction"
  },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  nameEn: { type: String, default: "", trim: true, maxlength: 200 },
  address: { type: String, default: "", trim: true, maxlength: 500 },
  addressEn: { type: String, default: "", trim: true, maxlength: 500 },
  regionCode: { type: String, default: "", trim: true, maxlength: 40 },
  regionName: { type: String, default: "", trim: true, maxlength: 100 },
  shortDescription: { type: String, default: "", trim: true, maxlength: 500 },
  shortDescriptionEn: { type: String, default: "", trim: true, maxlength: 500 },
  description: { type: String, default: "", trim: true, maxlength: 5000 },
  descriptionEn: { type: String, default: "", trim: true, maxlength: 5000 },
  officialLinks: {
    homepage: { type: String, default: "", trim: true, maxlength: 1000 },
    instagram: { type: String, default: "", trim: true, maxlength: 1000 }
  },
  areaCode: { type: String, default: null },
  sigunguCode: { type: String, default: null },
  coordinates: {
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null }
  },
  selectedImage: { type: externalPlaceImageSchema, default: undefined },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { collection: "external_places", versionKey: false, timestamps: true });

externalPlaceSchema.index(
  { source: 1, externalId: 1 },
  { unique: true, name: "unique_external_place" }
);
externalPlaceSchema.index(
  { publicId: 1 },
  { unique: true, partialFilterExpression: { publicId: { $type: "number" } }, name: "unique_external_public_id" }
);

const ExternalPlace = mongoose.model("ExternalPlace", externalPlaceSchema);

const EXTERNAL_PUBLIC_ID_OFFSET = 1_000_000_000;
const MANUAL_PUBLIC_ID_OFFSET = 3_000_000_000;
const EXTERNAL_REGION_LABELS = {
  SEOUL: { ko: "서울", en: "Seoul" },
  GGICN: { ko: "경기도 / 인천", en: "Gyeonggi / Incheon" },
  GANGWON: { ko: "강원특별자치도", en: "Gangwon" },
  CCDAEJEON: { ko: "충청도", en: "Chungcheong" },
  GSBUSANDAEGUULSAN: { ko: "경상도", en: "Gyeongsang" },
  JRGWANGJU: { ko: "전라도", en: "Jeolla" },
  JEJU: { ko: "제주도", en: "Jeju Island" },
  OTHER: { ko: "기타", en: "Other" }
};

function externalPublicId(externalId, source = "tourApi") {
  const contentId = Number(externalId);
  if (!Number.isSafeInteger(contentId) || contentId < 1) return null;
  const publicId = (source === "manual" ? MANUAL_PUBLIC_ID_OFFSET : EXTERNAL_PUBLIC_ID_OFFSET) + contentId;
  return Number.isSafeInteger(publicId) ? publicId : null;
}

function externalPlaceToPublic(place) {
  if (!place) return null;
  const publicId = place.publicId || externalPublicId(place.externalId, place.source);
  const koName = place.name || "";
  const enName = place.nameEn || koName;
  const region = EXTERNAL_REGION_LABELS[place.regionCode] || EXTERNAL_REGION_LABELS.OTHER;
  const koSummary = place.shortDescription || place.description || "";
  const enSummary = place.shortDescriptionEn || koSummary;
  const image = place.selectedImage || {};
  const hasImage = Boolean(image.originalUrl || image.thumbnailUrl);

  return {
    id: publicId,
    source: place.source,
    externalId: place.externalId,
    placeType: place.placeType,
    visibility: place.status === "published",
    img: {
      link: image.thumbnailUrl || image.originalUrl || "",
      originalUrl: image.originalUrl || image.thumbnailUrl || "",
      direct: true
    },
    location: {
      name: { ko: koName, en: enName },
      region: { code: place.regionCode || "OTHER", ko: region.ko, en: region.en },
      address: {
        ko: place.address ? [place.address] : [],
        en: place.addressEn ? [place.addressEn] : (place.address ? [place.address] : [])
      },
      coordinates: place.coordinates || {},
      latLng: place.coordinates?.latitude != null && place.coordinates?.longitude != null
        ? `${place.coordinates.latitude},${place.coordinates.longitude}`
        : ""
    },
    description: {
      short: { ko: koSummary, en: enSummary },
      slide: { ko: koSummary, en: enSummary },
      title: { ko: koName, en: enName },
      detail: {
        ko: place.description || koSummary,
        en: place.descriptionEn || place.description || enSummary
      }
    },
    attribution: place.source === "tourApi" ? {
      provider: image.provider || "한국관광공사 TourAPI",
      hasImage,
      copyrightType: hasImage ? (image.copyrightType || "Type1") : null,
      license: hasImage ? (image.license || "KOGL-1") : null
    } : null,
    officialLinks: {
      homepage: place.officialLinks?.homepage || "",
      instagram: place.officialLinks?.instagram || ""
    }
  };
}

async function publishedExternalPlaces(placeType) {
  if (!mongoReady) return [];
  const places = await ExternalPlace.find({ placeType, status: "published" }).lean();
  return places.map(externalPlaceToPublic).filter(place => place?.id);
}

// ----- Authentication schemas -----
// Social providers are the source of identity. Passwords are never stored.
const userSchema = new mongoose.Schema({
  accounts: [{
    _id: false,
    provider: {
      type: String,
      required: true,
      enum: ["google", "kakao", "naver", "dev"]
    },
    providerUserId: { type: String, required: true },
    email: { type: String, default: null }
  }],
  displayName: { type: String, default: null, trim: true, maxlength: 80 },
  createdAt: { type: Date, default: Date.now, immutable: true },
  updatedAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date, default: null }
}, { collection: "users", versionKey: false });

userSchema.index(
  { "accounts.provider": 1, "accounts.providerUserId": 1 },
  { unique: true, name: "unique_social_account" }
);

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  tokenHash: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
  expiresAt: { type: Date, required: true }
}, { collection: "sessions", versionKey: false });

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expire_sessions" });

const User = mongoose.model("User", userSchema);
const Session = mongoose.model("Session", sessionSchema);

const PLACE_TYPES = ["attraction", "cafe", "restaurant", "lodging", "food"];
const VISIBILITY_TYPES = ["private", "unlisted", "public"];

const placeReferenceFields = {
  placeType: { type: String, required: true, enum: PLACE_TYPES },
  placeId: { type: Number, required: true, min: 1 }
};

const favoriteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  ...placeReferenceFields,
  createdAt: { type: Date, default: Date.now, immutable: true }
}, { collection: "favorites", versionKey: false });

favoriteSchema.index(
  { userId: 1, placeType: 1, placeId: 1 },
  { unique: true, name: "unique_user_favorite" }
);
favoriteSchema.index({ userId: 1, createdAt: -1 }, { name: "user_favorites_recent" });

const itineraryPlaceSchema = new mongoose.Schema({
  ...placeReferenceFields,
  order: { type: Number, required: true, min: 0 },
  memo: { type: String, default: "", trim: true, maxlength: 500 }
}, { _id: false });

const itineraryDaySchema = new mongoose.Schema({
  date: { type: Date, default: null },
  title: { type: String, default: "", trim: true, maxlength: 100 },
  places: { type: [itineraryPlaceSchema], default: [] }
}, { _id: false });

const scheduleItemSchema = new mongoose.Schema({
  time: { type: String, required: true, trim: true, maxlength: 5 },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  memo: { type: String, default: "", trim: true, maxlength: 500 }
}, { versionKey: false });

const scheduleDaySchema = new mongoose.Schema({
  date: { type: Date, required: true },
  items: { type: [scheduleItemSchema], default: [] }
}, { versionKey: false });

const checklistItemSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 120 },
  checked: { type: Boolean, default: false },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true, versionKey: false });

const itinerarySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, default: "", trim: true, maxlength: 2000 },
  visibility: { type: String, enum: VISIBILITY_TYPES, default: "private" },
  days: { type: [itineraryDaySchema], default: [] },
  schedule: { type: [scheduleDaySchema], default: [] },
  checklist: { type: [checklistItemSchema], default: [] },
  editorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  editPasswordHash: { type: String, default: null },
  sourceItineraryId: { type: mongoose.Schema.Types.ObjectId, ref: "Itinerary", default: null },
  importCount: { type: Number, default: 0, min: 0 },
  operatorRecommended: { type: Boolean, default: false }
}, { collection: "itineraries", versionKey: false, timestamps: true });

itinerarySchema.index({ userId: 1, updatedAt: -1 }, { name: "user_itineraries_recent" });
itinerarySchema.index({ visibility: 1, updatedAt: -1 }, { name: "visible_itineraries_recent" });
itinerarySchema.index(
  { userId: 1, sourceItineraryId: 1 },
  {
    unique: true,
    partialFilterExpression: { sourceItineraryId: { $type: "objectId" } },
    name: "unique_imported_itinerary"
  }
);

const itineraryImportSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  sourceItineraryId: { type: mongoose.Schema.Types.ObjectId, ref: "Itinerary", required: true },
  createdAt: { type: Date, default: Date.now, immutable: true }
}, { collection: "itinerary_imports", versionKey: false });

itineraryImportSchema.index(
  { userId: 1, sourceItineraryId: 1 },
  { unique: true, name: "unique_member_itinerary_import" }
);

const visitSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  ...placeReferenceFields,
  visitedAt: { type: Date, required: true },
  rating: { type: Number, default: null, min: 1, max: 5 },
  memo: { type: String, default: "", trim: true, maxlength: 2000 }
}, { collection: "visits", versionKey: false, timestamps: true });

visitSchema.index({ userId: 1, visitedAt: -1 }, { name: "user_visits_recent" });
visitSchema.index(
  { userId: 1, placeType: 1, placeId: 1 },
  { name: "user_visits_by_place" }
);

const Favorite = mongoose.model("Favorite", favoriteSchema);
const Itinerary = mongoose.model("Itinerary", itinerarySchema);
const ItineraryImport = mongoose.model("ItineraryImport", itineraryImportSchema);
const Visit = mongoose.model("Visit", visitSchema);

if (mongoReady) {
  try {
    await Promise.all([
      User.init(),
      Session.init(),
      Favorite.init(),
      Itinerary.init(),
      ItineraryImport.init(),
      Visit.init(),
      ExternalPlace.init()
    ]);
    const existingImports = await Itinerary.find({ sourceItineraryId: { $ne: null } })
      .select("userId sourceItineraryId")
      .lean();
    for (const existingImport of existingImports) {
      const seeded = await ItineraryImport.updateOne(
        { userId: existingImport.userId, sourceItineraryId: existingImport.sourceItineraryId },
        { $setOnInsert: {
          userId: existingImport.userId,
          sourceItineraryId: existingImport.sourceItineraryId,
          createdAt: new Date()
        } },
        { upsert: true }
      );
      if (seeded.upsertedCount === 1) {
        await Itinerary.updateOne(
          { _id: existingImport.sourceItineraryId },
          { $inc: { importCount: 1 } }
        );
      }
    }
    console.log("Authentication and member feature indexes ready");
  } catch (error) {
    console.error("MongoDB index initialization failed:", error.message);
    if (!USE_LOCAL_DB) process.exit(1);
  }
}

const SESSION_COOKIE_NAME = "kortrip_session";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const OAUTH_COOKIE_MAX_AGE_MS = 1000 * 60 * 10;
const GOOGLE_STATE_COOKIE = "kortrip_google_state";
const GOOGLE_VERIFIER_COOKIE = "kortrip_google_verifier";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "https://api.kortripfollow.com/auth/google/callback";
const NAVER_STATE_COOKIE = "kortrip_naver_state";
const NAVER_REDIRECT_URI = process.env.NAVER_REDIRECT_URI || "https://api.kortripfollow.com/auth/naver/callback";
const KAKAO_STATE_COOKIE = "kortrip_kakao_state";
const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI || "https://api.kortripfollow.com/auth/kakao/callback";

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader.split(";").flatMap(part => {
      const separator = part.indexOf("=");
      if (separator < 0) return [];
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      return key ? [[key, decodeURIComponent(value)]] : [];
    })
  );
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function randomBase64Url(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256Base64Url(value) {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS
  };
}

function oauthCookieOptions(path = "/auth/google") {
  return {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path,
    maxAge: OAUTH_COOKIE_MAX_AGE_MS
  };
}

function clearNaverOAuthCookie(res) {
  res.clearCookie(NAVER_STATE_COOKIE, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/auth/naver"
  });
}

function clearKakaoOAuthCookie(res) {
  res.clearCookie(KAKAO_STATE_COOKIE, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/auth/kakao"
  });
}

function clearGoogleOAuthCookies(res) {
  const options = {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/auth/google"
  };
  res.clearCookie(GOOGLE_STATE_COOKIE, options);
  res.clearCookie(GOOGLE_VERIFIER_COOKIE, options);
}

async function createSession(userId) {
  const token = randomBase64Url(32);
  await Session.create({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS)
  });
  return token;
}

async function findOrCreateGoogleUser(profile) {
  const accountQuery = {
    accounts: {
      $elemMatch: { provider: "google", providerUserId: profile.sub }
    }
  };
  const now = new Date();
  const displayName = typeof profile.name === "string"
    ? profile.name.trim().slice(0, 80) || null
    : null;

  let user = await User.findOneAndUpdate(
    accountQuery,
    { $set: { displayName, updatedAt: now, lastLoginAt: now } },
    { new: true, runValidators: true }
  );
  if (user) return user;

  try {
    return await User.create({
      accounts: [{
        provider: "google",
        providerUserId: profile.sub,
        email: null
      }],
      displayName,
      lastLoginAt: now
    });
  } catch (error) {
    // A simultaneous first login can race with the unique social-account index.
    if (error?.code !== 11000) throw error;
    user = await User.findOneAndUpdate(
      accountQuery,
      { $set: { displayName, updatedAt: now, lastLoginAt: now } },
      { new: true, runValidators: true }
    );
    if (!user) throw error;
    return user;
  }
}

async function findOrCreateNaverUser(profile) {
  const providerUserId = typeof profile.id === "string" ? profile.id : "";
  if (!providerUserId) throw new Error("Naver user ID missing");

  const accountQuery = {
    accounts: {
      $elemMatch: { provider: "naver", providerUserId }
    }
  };
  const now = new Date();
  const displayName = typeof profile.nickname === "string"
    ? profile.nickname.trim().slice(0, 80) || null
    : null;

  let user = await User.findOneAndUpdate(
    accountQuery,
    { $set: { displayName, updatedAt: now, lastLoginAt: now } },
    { new: true, runValidators: true }
  );
  if (user) return user;

  try {
    return await User.create({
      accounts: [{ provider: "naver", providerUserId, email: null }],
      displayName,
      lastLoginAt: now
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    user = await User.findOneAndUpdate(
      accountQuery,
      { $set: { displayName, updatedAt: now, lastLoginAt: now } },
      { new: true, runValidators: true }
    );
    if (!user) throw error;
    return user;
  }
}

async function findOrCreateKakaoUser(profile) {
  const providerUserId = profile?.id == null ? "" : String(profile.id);
  if (!providerUserId) throw new Error("Kakao user ID missing");

  const accountQuery = {
    accounts: {
      $elemMatch: { provider: "kakao", providerUserId }
    }
  };
  const now = new Date();
  const nickname = profile?.properties?.nickname ?? profile?.kakao_account?.profile?.nickname;
  const displayName = typeof nickname === "string"
    ? nickname.trim().slice(0, 80) || null
    : null;

  let user = await User.findOneAndUpdate(
    accountQuery,
    { $set: { displayName, updatedAt: now, lastLoginAt: now } },
    { new: true, runValidators: true }
  );
  if (user) return user;

  try {
    return await User.create({
      accounts: [{ provider: "kakao", providerUserId, email: null }],
      displayName,
      lastLoginAt: now
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    user = await User.findOneAndUpdate(
      accountQuery,
      { $set: { displayName, updatedAt: now, lastLoginAt: now } },
      { new: true, runValidators: true }
    );
    if (!user) throw error;
    return user;
  }
}

async function getSessionUser(req) {
  if (!mongoReady) return null;

  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (!token) return null;

  const session = await Session.findOne({
    tokenHash: hashSessionToken(token),
    expiresAt: { $gt: new Date() }
  }).lean();
  if (!session) return null;

  return User.findById(session.userId)
    .select("displayName accounts.provider accounts.providerUserId createdAt")
    .lean();
}

async function requireAuth(req, res, next) {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

function isOperatorUser(user) {
  return Boolean(user?.accounts?.some(account => {
    const isConfiguredOperator =
      account.provider === OPERATOR_PROVIDER &&
      account.providerUserId === OPERATOR_PROVIDER_USER_ID;
    const isDevelopmentOperator =
      DEV_LOGIN_ENABLED &&
      account.provider === "dev" &&
      account.providerUserId === process.env.DEV_LOGIN_ID;
    return isConfiguredOperator || isDevelopmentOperator;
  }));
}

function requireOperator(req, res, next) {
  if (!isOperatorUser(req.user)) {
    return res.status(403).json({ error: "Operator access required" });
  }
  return next();
}

const placeModelByType = {
  attraction: Ranking,
  cafe: Cafe,
  restaurant: Restaurant,
  lodging: Lodging,
  food: Food
};

const placeCollectionByType = {
  attraction: "rankings",
  cafe: "cafes",
  restaurant: "restaurants",
  lodging: "lodgings",
  food: "foods"
};

function parsePlaceReference(value = {}) {
  const placeType = typeof value.placeType === "string" ? value.placeType : "";
  const placeId = Number(value.placeId);
  if (!PLACE_TYPES.includes(placeType) || !Number.isInteger(placeId) || placeId < 1) {
    return null;
  }
  return { placeType, placeId };
}

async function findVisiblePlace(placeType, placeId) {
  let place = null;
  if (USE_LOCAL_DB) {
    const collection = placeCollectionByType[placeType];
    if (!collection) return null;
    place = localDB?.[collection]?.find(
      place => place.id === placeId && place.visibility !== false
    ) || null;
  } else {
    const model = placeModelByType[placeType];
    if (!model) return null;
    place = await model.findOne({ id: placeId, visibility: { $ne: false } }).lean();
  }

  if (place || !mongoReady) return place;
  const external = await ExternalPlace.findOne({
    publicId: placeId,
    placeType,
    status: "published"
  }).lean();
  return externalPlaceToPublic(external);
}

function placeSummary(placeType, place) {
  if (!place) return null;
  return {
    placeType,
    placeId: place.id,
    source: place.source || "kortrip",
    location: place.location,
    img: place.img,
    description: {
      short: place.description?.short,
      slide: place.description?.slide,
      title: place.description?.title
    }
  };
}

function matchesPlaceSearch(place, query) {
  if (!query) return true;
  const searchable = [
    place.location?.name?.ko,
    place.location?.name?.en,
    place.location?.region?.ko,
    place.location?.region?.en,
    ...(place.location?.address?.ko || []),
    ...(place.location?.address?.en || [])
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  return searchable.includes(query.toLocaleLowerCase());
}

async function searchVisiblePlaces(query, limit = 100) {
  let internalPlaces;
  if (USE_LOCAL_DB) {
    internalPlaces = Object.entries(placeCollectionByType)
      .flatMap(([placeType, collection]) => (localDB?.[collection] || [])
        .filter(place => place.visibility !== false && matchesPlaceSearch(place, query))
        .map(place => placeSummary(placeType, place)));
  } else {
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const filter = {
      visibility: { $ne: false },
      ...(query ? { $or: [
        { "location.name.ko": { $regex: escapedQuery, $options: "i" } },
        { "location.name.en": { $regex: escapedQuery, $options: "i" } },
        { "location.region.ko": { $regex: escapedQuery, $options: "i" } },
        { "location.region.en": { $regex: escapedQuery, $options: "i" } },
        { "location.address.ko": { $regex: escapedQuery, $options: "i" } },
        { "location.address.en": { $regex: escapedQuery, $options: "i" } }
      ] } : {})
    };
    const groups = await Promise.all(Object.entries(placeModelByType).map(
      async ([placeType, model]) => (await model.find(filter).limit(limit).lean())
        .map(place => placeSummary(placeType, place))
    ));
    internalPlaces = groups.flat();
  }

  const externalPlaces = mongoReady
    ? (await ExternalPlace.find({ status: "published" }).limit(limit).lean())
      .map(externalPlaceToPublic)
      .filter(place => place && matchesPlaceSearch(place, query))
      .map(place => placeSummary(place.placeType, place))
    : [];

  return [...internalPlaces, ...externalPlaces].slice(0, limit);
}

async function validatePlaceReferences(references) {
  const unique = new Map();
  for (const value of references) {
    const reference = parsePlaceReference(value);
    if (!reference) return false;
    unique.set(`${reference.placeType}:${reference.placeId}`, reference);
  }
  const results = await Promise.all(
    [...unique.values()].map(({ placeType, placeId }) => findVisiblePlace(placeType, placeId))
  );
  return results.every(Boolean);
}

async function attachPlaces(documents) {
  return Promise.all(documents.map(async document => {
    const item = document.toObject ? document.toObject() : document;
    const place = await findVisiblePlace(item.placeType, item.placeId);
    return { ...item, place: placeSummary(item.placeType, place) };
  }));
}

async function attachItineraryPlaces(document) {
  const item = document.toObject ? document.toObject() : document;
  const hasEditPassword = Boolean(item.editPasswordHash);
  delete item.editPasswordHash;
  const days = await Promise.all((item.days || []).map(async day => ({
    ...day,
    places: await Promise.all((day.places || []).map(async reference => {
      const place = await findVisiblePlace(reference.placeType, reference.placeId);
      return { ...reference, place: placeSummary(reference.placeType, place) };
    }))
  })));
  const editors = item.editorIds?.length
    ? await User.find({ _id: { $in: item.editorIds } })
        .select("displayName accounts.email")
        .lean()
    : [];
  const owner = await User.findById(item.userId).select("displayName").lean();
  return {
    ...item,
    days,
    hasEditPassword,
    owner: owner ? { _id: owner._id, displayName: owner.displayName } : null,
    editors: editors.map(editor => ({
      _id: editor._id,
      displayName: editor.displayName,
      email: editor.accounts?.find(account => account.email)?.email || null
    }))
  };
}

function hashEditPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyEditPassword(password, storedValue) {
  const [salt, storedHash] = String(storedValue || "").split(":");
  if (!salt || !storedHash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(storedHash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function validEditPassword(value) {
  return typeof value === "string" && value.length >= 4 && value.length <= 32;
}

async function attachRatingSummaries(placeType, places) {
  const items = Array.isArray(places) ? places : [places];
  const existingItems = items.filter(Boolean);
  if (!mongoReady || !existingItems.length) return Array.isArray(places) ? items : places;

  const placeIds = [...new Set(existingItems.map(place => place.id))];
  const summaries = await Visit.aggregate([
    {
      $match: {
        placeType,
        placeId: { $in: placeIds },
        rating: { $gte: 1, $lte: 5 }
      }
    },
    {
      $group: {
        _id: "$placeId",
        average: { $avg: "$rating" },
        count: { $sum: 1 }
      }
    }
  ]);
  const summaryById = new Map(summaries.map(summary => [summary._id, {
    average: Math.round(summary.average * 10) / 10,
    count: summary.count
  }]));
  const result = items.map(place => {
    if (!place) return place;
    const item = place.toObject ? place.toObject() : place;
    const ratingSummary = summaryById.get(item.id);
    return ratingSummary ? { ...item, ratingSummary } : item;
  });
  return Array.isArray(places) ? result : result[0];
}

function parseItineraryPayload(body = {}, partial = false) {
  const payload = {};
  if (!partial || body.title !== undefined) payload.title = body.title;
  if (!partial || body.description !== undefined) payload.description = body.description ?? "";
  if (!partial || body.visibility !== undefined) payload.visibility = body.visibility ?? "private";
  if (!partial || body.days !== undefined) {
    payload.days = Array.isArray(body.days)
      ? body.days.map(day => ({
          date: day?.date || null,
          title: day?.title ?? "",
          places: Array.isArray(day?.places)
            ? day.places.map((place, index) => ({
                placeType: place?.placeType,
                placeId: Number(place?.placeId),
                order: Number.isInteger(place?.order) ? place.order : index,
                memo: place?.memo ?? ""
              }))
            : []
        }))
      : body.days;
  }
  if (!partial || body.schedule !== undefined) {
    payload.schedule = Array.isArray(body.schedule)
      ? body.schedule.map(day => ({
          date: day?.date,
          items: Array.isArray(day?.items) ? day.items.map(item => ({
            ...((item?._id && mongoose.isValidObjectId(item._id)) ? { _id: item._id } : {}),
            time: item?.time,
            title: item?.title,
            memo: item?.memo ?? ""
          })) : []
        }))
      : body.schedule;
  }
  if (!partial || body.checklist !== undefined) {
    payload.checklist = Array.isArray(body.checklist)
      ? body.checklist.map(item => ({
          ...((item?._id && mongoose.isValidObjectId(item._id)) ? { _id: item._id } : {}),
          text: item?.text,
          checked: Boolean(item?.checked),
          ownerId: item?.ownerId || null
        }))
      : body.checklist;
  }
  return payload;
}

function parseVisitPayload(body = {}, partial = false) {
  const payload = {};
  if (!partial || body.placeType !== undefined) payload.placeType = body.placeType;
  if (!partial || body.placeId !== undefined) payload.placeId = Number(body.placeId);
  if (!partial || body.visitedAt !== undefined) payload.visitedAt = body.visitedAt;
  if (!partial || body.rating !== undefined) {
    payload.rating = body.rating === "" || body.rating === null ? null : Number(body.rating);
  }
  if (!partial || body.memo !== undefined) payload.memo = body.memo ?? "";
  return payload;
}

// ----- API 라우트 -----

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/tour-api/test", async (req, res, next) => {
  if (IS_PRODUCTION || !USE_LOCAL_DB || !isPrivateRequest(req)) {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const keyword = typeof req.query.keyword === "string"
      ? req.query.keyword.trim().slice(0, 50)
      : "경복궁";
    if (keyword.length < 2) {
      return res.status(400).json({ error: "Keyword must be at least 2 characters" });
    }
    return res.json(await searchTourApiPlaces(keyword));
  } catch (error) {
    return next(error);
  }
});

app.get("/tour-api/test/:contentId/images", async (req, res, next) => {
  if (IS_PRODUCTION || !USE_LOCAL_DB || !isPrivateRequest(req)) {
    return res.status(404).json({ error: "Not found" });
  }

  try {
    const contentId = String(req.params.contentId || "").trim();
    if (!/^\d{1,20}$/.test(contentId)) {
      return res.status(400).json({ error: "Invalid TourAPI content ID" });
    }
    return res.json(await getTourApiType1Images(contentId));
  } catch (error) {
    return next(error);
  }
});

app.get("/operator/tour-api/places", requireAuth, requireOperator, async (req, res, next) => {
  try {
    const keyword = typeof req.query.keyword === "string"
      ? req.query.keyword.trim().slice(0, 50)
      : "";
    if (keyword.length < 2) {
      return res.status(400).json({ error: "Keyword must be at least 2 characters" });
    }
    return res.json(await searchTourApiPlaces(keyword, 12));
  } catch (error) {
    return next(error);
  }
});

app.get(
  "/operator/tour-api/places/:contentId/images",
  requireAuth,
  requireOperator,
  async (req, res, next) => {
    try {
      const contentId = String(req.params.contentId || "").trim();
      if (!/^\d{1,20}$/.test(contentId)) {
        return res.status(400).json({ error: "Invalid TourAPI content ID" });
      }
      return res.json(await getTourApiType1Images(contentId));
    } catch (error) {
      return next(error);
    }
  }
);

app.post(
  "/operator/tour-api/places/:contentId/draft",
  requireAuth,
  requireOperator,
  async (req, res, next) => {
    try {
      if (!mongoReady) {
        return res.status(503).json({ error: "Database is not available" });
      }

      const contentId = String(req.params.contentId || "").trim();
      const serialNumber = typeof req.body?.serialNumber === "string"
        ? req.body.serialNumber.trim()
        : "";
      const withoutImage = req.body?.withoutImage === true;
      if (!/^\d{1,20}$/.test(contentId) || (!serialNumber && !withoutImage)) {
        return res.status(400).json({ error: "Invalid TourAPI place or image" });
      }

      const [place, imageResult] = await Promise.all([
        getTourApiPlaceDetail(contentId),
        serialNumber ? getTourApiType1Images(contentId, 50) : Promise.resolve({ items: [] })
      ]);
      const selectedImage = serialNumber
        ? imageResult.items.find(image => image.serialNumber === serialNumber)
        : null;
      if (!place || (serialNumber && !selectedImage)) {
        return res.status(400).json({ error: "Verified TourAPI place or Type1 image not found" });
      }
      const englishPlace = await getTourApiEnglishPlace(place);
      const region = KORTRIP_REGION_BY_LEGAL_CODE[place.areaCode] || {
        code: "OTHER",
        name: place.address.split(" ")[0] || ""
      };
      const existing = await ExternalPlace.findOne({ source: "tourApi", externalId: contentId })
        .select("status nameEn addressEn shortDescription description shortDescriptionEn descriptionEn")
        .lean();
      const importedFields = existing?.status === "published" ? {} : {
        contentTypeId: place.contentTypeId,
        placeType: inferPlaceType(place.contentTypeId),
        name: place.name,
        address: place.address,
        areaCode: place.areaCode,
        sigunguCode: place.sigunguCode,
        regionCode: region.code,
        regionName: region.name,
        coordinates: place.coordinates,
        ...(!existing?.shortDescription?.trim() && place.shortOverview
          ? { shortDescription: place.shortOverview }
          : {}),
        ...(!existing?.description?.trim() && place.overview
          ? { description: place.overview }
          : {}),
        ...(!existing?.nameEn?.trim() && englishPlace?.name
          ? { nameEn: englishPlace.name }
          : {}),
        ...(!existing?.addressEn?.trim() && englishPlace?.address
          ? { addressEn: englishPlace.address }
          : {}),
        ...(!existing?.shortDescriptionEn?.trim() && englishPlace?.shortOverview
          ? { shortDescriptionEn: englishPlace.shortOverview }
          : {}),
        ...(!existing?.descriptionEn?.trim() && englishPlace?.overview
          ? { descriptionEn: englishPlace.overview }
          : {})
      };

      const draftUpdate = {
        $set: {
          status: existing?.status || "draft",
          ...importedFields,
          ...(selectedImage ? { selectedImage } : {}),
          updatedBy: req.user._id
        },
        $setOnInsert: {
          source: "tourApi",
          externalId: contentId,
          createdBy: req.user._id
        }
      };
      if (!selectedImage) draftUpdate.$unset = { selectedImage: 1 };
      const draft = await ExternalPlace.findOneAndUpdate(
        { source: "tourApi", externalId: contentId },
        draftUpdate,
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
      ).lean();

      return res.status(201).json({
        id: draft._id,
        source: draft.source,
        externalId: draft.externalId,
        status: draft.status,
        name: draft.name,
        selectedImage: draft.selectedImage,
        updatedAt: draft.updatedAt
      });
    } catch (error) {
      return next(error);
    }
  }
);

app.post("/operator/manual-places/draft", requireAuth, requireOperator, async (req, res, next) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: "Database is not available" });
    const externalId = String(Date.now() * 1000 + crypto.randomInt(1000));
    const draft = await ExternalPlace.create({
      source: "manual",
      externalId,
      status: "draft",
      placeType: "attraction",
      name: "새 장소",
      regionCode: "OTHER",
      createdBy: req.user._id,
      updatedBy: req.user._id
    });
    return res.status(201).json(draft);
  } catch (error) {
    return next(error);
  }
});

app.get("/operator/external-places", requireAuth, requireOperator, async (req, res, next) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: "Database is not available" });
    const source = typeof req.query.source === "string" ? req.query.source : "";
    if (source && !["tourApi", "manual"].includes(source)) {
      return res.status(400).json({ error: "Invalid external place source" });
    }
    const drafts = await ExternalPlace.find({
      status: { $in: ["draft", "published"] },
      ...(source ? { source } : {})
    })
      .sort({ updatedAt: -1 })
      .lean();
    return res.json(drafts.map(draft => {
      if (!draft.selectedImage?.originalUrl) delete draft.selectedImage;
      return draft;
    }));
  } catch (error) {
    return next(error);
  }
});

app.patch("/operator/external-places/:id", requireAuth, requireOperator, async (req, res, next) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: "Database is not available" });
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid draft ID" });
    }

    const allowed = {
      placeType: req.body?.placeType,
      name: req.body?.name,
      nameEn: req.body?.nameEn,
      address: req.body?.address,
      addressEn: req.body?.addressEn,
      regionCode: req.body?.regionCode,
      shortDescription: req.body?.shortDescription,
      shortDescriptionEn: req.body?.shortDescriptionEn,
      description: req.body?.description,
      descriptionEn: req.body?.descriptionEn
    };
    const updates = Object.fromEntries(
      Object.entries(allowed).filter(([, value]) => typeof value === "string")
    );
    for (const coordinate of ["latitude", "longitude"]) {
      if (req.body?.[coordinate] === undefined || req.body?.[coordinate] === "") continue;
      const value = Number(req.body[coordinate]);
      const valid = Number.isFinite(value) && (coordinate === "latitude"
        ? value >= -90 && value <= 90
        : value >= -180 && value <= 180);
      if (!valid) return res.status(400).json({ error: `올바른 ${coordinate === "latitude" ? "위도" : "경도"}를 입력하세요` });
      updates[`coordinates.${coordinate}`] = value;
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "No editable fields supplied" });
    }
    if (updates.regionCode && !EXTERNAL_REGION_LABELS[updates.regionCode]) {
      return res.status(400).json({ error: "Invalid region code" });
    }
    const officialLinks = {
      homepage: req.body?.homepage,
      instagram: req.body?.instagram
    };
    for (const [type, value] of Object.entries(officialLinks)) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed) {
        try {
          const url = new URL(trimmed);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Invalid protocol");
        } catch {
          return res.status(400).json({ error: `${type} 링크는 http 또는 https 전체 주소로 입력하세요` });
        }
      }
      updates[`officialLinks.${type}`] = trimmed;
    }
    updates.updatedBy = req.user._id;

    const existing = await ExternalPlace.findById(req.params.id)
      .select("selectedImage.originalUrl")
      .lean();
    const updateOperation = { $set: updates };
    if (existing?.selectedImage && !existing.selectedImage.originalUrl) {
      updateOperation.$unset = { selectedImage: 1 };
    }
    const draft = await ExternalPlace.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ["draft", "published"] } },
      updateOperation,
      { new: true, runValidators: true }
    ).lean();
    if (!draft) return res.status(404).json({ error: "Place not found" });
    return res.json(draft);
  } catch (error) {
    if (error?.name === "ValidationError") {
      return res.status(400).json({ error: "Invalid draft data" });
    }
    return next(error);
  }
});

app.delete("/operator/external-places/:id", requireAuth, requireOperator, async (req, res, next) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: "Database is not available" });
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid place ID" });
    }

    const place = await ExternalPlace.findByIdAndDelete(req.params.id).lean();
    if (!place) return res.status(404).json({ error: "Place not found" });
    return res.json({
      deleted: true,
      id: place._id,
      publicId: place.publicId,
      name: place.name,
      status: place.status
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/operator/external-places/:id/publish", requireAuth, requireOperator, async (req, res, next) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: "Database is not available" });
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid draft ID" });
    }

    const draft = await ExternalPlace.findOne({ _id: req.params.id, status: "draft" });
    if (!draft) return res.status(404).json({ error: "Draft not found" });

    const missing = [];
    if (!draft.name?.trim()) missing.push("한국어 이름");
    if (!draft.nameEn?.trim()) missing.push("영어 이름");
    if (!draft.address?.trim()) missing.push("한국어 주소");
    if (!draft.addressEn?.trim()) missing.push("영어 주소");
    if (!EXTERNAL_REGION_LABELS[draft.regionCode]) missing.push("지역");
    if (!draft.shortDescription?.trim()) missing.push("한국어 짧은 소개");
    if (!draft.shortDescriptionEn?.trim()) missing.push("영어 짧은 소개");
    if (!draft.description?.trim()) missing.push("한국어 상세 설명");
    if (!draft.descriptionEn?.trim()) missing.push("영어 상세 설명");
    if (draft.source === "manual" && !Number.isFinite(draft.coordinates?.latitude)) missing.push("위도");
    if (draft.source === "manual" && !Number.isFinite(draft.coordinates?.longitude)) missing.push("경도");
    if (missing.length) {
      return res.status(400).json({ error: `공개 전 필수 항목을 입력하세요: ${missing.join(", ")}` });
    }

    if (draft.selectedImage && !draft.selectedImage.originalUrl) {
      draft.selectedImage = undefined;
    }

    const publicId = externalPublicId(draft.externalId, draft.source);
    if (!publicId) return res.status(400).json({ error: "외부 API ID로 공개 ID를 만들 수 없습니다" });

    draft.publicId = publicId;
    draft.status = "published";
    draft.updatedBy = req.user._id;
    await draft.save();
    return res.json({ id: publicId, status: draft.status, place: externalPlaceToPublic(draft.toObject()) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "이미 같은 공개 ID를 사용하는 장소가 있습니다" });
    }
    return next(error);
  }
});

app.get("/external-places/:id", async (req, res, next) => {
  try {
    if (!mongoReady) return res.status(503).json({ error: "Database is not available" });
    const publicId = Number(req.params.id);
    if (!Number.isSafeInteger(publicId) || publicId < 1) {
      return res.status(400).json({ error: "Invalid place ID" });
    }
    const place = await ExternalPlace.findOne({ publicId, status: "published" }).lean();
    return place ? res.json(externalPlaceToPublic(place)) : res.status(404).json({ error: "Place not found" });
  } catch (error) {
    return next(error);
  }
});

app.get("/places/search", async (req, res, next) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
    return res.json(await searchVisiblePlaces(query));
  } catch (error) {
    return next(error);
  }
});

app.get("/auth/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!mongoReady || !clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ error: "Google login is not configured" });
  }

  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  res.cookie(GOOGLE_STATE_COOKIE, state, oauthCookieOptions());
  res.cookie(GOOGLE_VERIFIER_COOKIE, codeVerifier, oauthCookieOptions());

  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid profile",
    state,
    code_challenge: sha256Base64Url(codeVerifier),
    code_challenge_method: "S256",
    prompt: "select_account"
  }).toString();

  return res.redirect(authorizationUrl.toString());
});

app.get("/auth/google/callback", async (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const storedState = cookies[GOOGLE_STATE_COOKIE];
  const codeVerifier = cookies[GOOGLE_VERIFIER_COOKIE];

  clearGoogleOAuthCookies(res);

  if (req.query.error || !code || !codeVerifier || !safeEqual(state, storedState)) {
    return res.redirect(`${FRONTEND_URL}/?login=google_failed`);
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: GOOGLE_REDIRECT_URI
      })
    });
    if (!tokenResponse.ok) throw new Error(`Google token exchange failed: ${tokenResponse.status}`);

    const tokens = await tokenResponse.json();
    if (typeof tokens.access_token !== "string") {
      throw new Error("Google access token missing");
    }

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    if (!profileResponse.ok) throw new Error(`Google userinfo failed: ${profileResponse.status}`);

    const profile = await profileResponse.json();
    if (typeof profile.sub !== "string" || !profile.sub) {
      throw new Error("Google subject missing");
    }

    const user = await findOrCreateGoogleUser(profile);
    const sessionToken = await createSession(user._id);
    res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
    return res.redirect(`${FRONTEND_URL}/?login=google_success`);
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    return res.redirect(`${FRONTEND_URL}/?login=google_failed`);
  }
});

app.get("/auth/naver", (req, res) => {
  const clientId = process.env.NAVER_CLIENT_ID;
  if (!mongoReady || !clientId || !process.env.NAVER_CLIENT_SECRET) {
    return res.status(503).json({ error: "Naver login is not configured" });
  }

  const state = randomBase64Url(24);
  res.cookie(NAVER_STATE_COOKIE, state, oauthCookieOptions("/auth/naver"));

  const authorizationUrl = new URL("https://nid.naver.com/oauth2.0/authorize");
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: NAVER_REDIRECT_URI,
    state
  }).toString();

  return res.redirect(authorizationUrl.toString());
});

app.get("/auth/naver/callback", async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const storedState = cookies[NAVER_STATE_COOKIE];

  clearNaverOAuthCookie(res);

  if (req.query.error || !code || !safeEqual(state, storedState)) {
    return res.redirect(`${FRONTEND_URL}/?login=naver_failed`);
  }

  try {
    const tokenUrl = new URL("https://nid.naver.com/oauth2.0/token");
    tokenUrl.search = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.NAVER_CLIENT_ID,
      client_secret: process.env.NAVER_CLIENT_SECRET,
      code,
      state
    }).toString();

    const tokenResponse = await fetch(tokenUrl);
    if (!tokenResponse.ok) throw new Error(`Naver token exchange failed: ${tokenResponse.status}`);
    const tokens = await tokenResponse.json();
    if (typeof tokens.access_token !== "string") {
      throw new Error(`Naver access token missing: ${tokens.error || "unknown error"}`);
    }

    const profileResponse = await fetch("https://openapi.naver.com/v1/nid/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    if (!profileResponse.ok) throw new Error(`Naver profile failed: ${profileResponse.status}`);

    const profileResult = await profileResponse.json();
    if (profileResult.resultcode !== "00" || !profileResult.response) {
      throw new Error(`Naver profile invalid: ${profileResult.message || "unknown error"}`);
    }

    const user = await findOrCreateNaverUser(profileResult.response);
    const sessionToken = await createSession(user._id);
    res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
    return res.redirect(`${FRONTEND_URL}/?login=naver_success`);
  } catch (error) {
    console.error("Naver OAuth callback failed", error);
    return res.redirect(`${FRONTEND_URL}/?login=naver_failed`);
  }
});

app.get("/auth/kakao", (req, res) => {
  const clientId = process.env.KAKAO_REST_API_KEY;
  if (!mongoReady || !clientId || !process.env.KAKAO_CLIENT_SECRET) {
    return res.status(503).json({ error: "Kakao login is not configured" });
  }

  const state = randomBase64Url(24);
  res.cookie(KAKAO_STATE_COOKIE, state, oauthCookieOptions("/auth/kakao"));

  const authorizationUrl = new URL("https://kauth.kakao.com/oauth/authorize");
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: KAKAO_REDIRECT_URI,
    state
  }).toString();

  return res.redirect(authorizationUrl.toString());
});

app.get("/auth/kakao/callback", async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const storedState = cookies[KAKAO_STATE_COOKIE];

  clearKakaoOAuthCookie(res);

  if (req.query.error || !code || !safeEqual(state, storedState)) {
    return res.redirect(`${FRONTEND_URL}/?login=kakao_failed`);
  }

  try {
    const tokenResponse = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: process.env.KAKAO_REST_API_KEY,
        client_secret: process.env.KAKAO_CLIENT_SECRET,
        redirect_uri: KAKAO_REDIRECT_URI,
        code
      })
    });
    if (!tokenResponse.ok) throw new Error(`Kakao token exchange failed: ${tokenResponse.status}`);

    const tokens = await tokenResponse.json();
    if (typeof tokens.access_token !== "string") {
      throw new Error(`Kakao access token missing: ${tokens.error || "unknown error"}`);
    }

    const profileResponse = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8"
      }
    });
    if (!profileResponse.ok) throw new Error(`Kakao profile failed: ${profileResponse.status}`);

    const profile = await profileResponse.json();
    const user = await findOrCreateKakaoUser(profile);
    const sessionToken = await createSession(user._id);
    res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
    return res.redirect(`${FRONTEND_URL}/?login=kakao_success`);
  } catch (error) {
    console.error("Kakao OAuth callback failed", error);
    return res.redirect(`${FRONTEND_URL}/?login=kakao_failed`);
  }
});

app.get("/auth/session", async (req, res, next) => {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.json({ authenticated: false, user: null });

    return res.json({
      authenticated: true,
      user: {
        id: user._id,
        displayName: user.displayName,
        providers: user.accounts.map(account => account.provider),
        isOperator: isOperatorUser(user)
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/auth/dev-login", async (req, res, next) => {
  try {
    if (!DEV_LOGIN_ENABLED || !isPrivateRequest(req)) {
      return res.status(404).json({ error: "Not found" });
    }
    if (!mongoReady) {
      return res.status(503).json({ error: "Development login requires MongoDB" });
    }

    const configuredId = process.env.DEV_LOGIN_ID || "";
    const configuredPassword = process.env.DEV_LOGIN_PASSWORD || "";
    const suppliedId = typeof req.body?.id === "string" ? req.body.id : "";
    const suppliedPassword = typeof req.body?.password === "string" ? req.body.password : "";
    if (!configuredId || !configuredPassword || !safeEqual(suppliedId, configuredId) || !safeEqual(suppliedPassword, configuredPassword)) {
      return res.status(401).json({ error: "Invalid development credentials" });
    }

    const now = new Date();
    const user = await User.findOneAndUpdate(
      { accounts: { $elemMatch: { provider: "dev", providerUserId: configuredId } } },
      {
        $set: { displayName: "Kortrip Developer", updatedAt: now, lastLoginAt: now },
        $setOnInsert: { accounts: [{ provider: "dev", providerUserId: configuredId, email: null }] }
      },
      { new: true, upsert: true, runValidators: true }
    );
    const sessionToken = await createSession(user._id);
    res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieOptions());
    return res.json({
      authenticated: true,
      user: {
        id: user._id,
        displayName: user.displayName,
        providers: ["dev"],
        isOperator: isOperatorUser(user)
      }
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/auth/logout", async (req, res, next) => {
  try {
    if (mongoReady) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
      if (token) await Session.deleteOne({ tokenHash: hashSessionToken(token) });
    }

    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "lax",
      path: "/"
    });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.delete("/auth/account", async (req, res, next) => {
  try {
    if (!mongoReady) {
      return res.status(503).json({ error: "Account deletion requires MongoDB" });
    }

    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "Authentication required" });

    const session = await Session.findOne({
      tokenHash: hashSessionToken(token),
      expiresAt: { $gt: new Date() }
    }).select("userId").lean();

    if (!session) {
      res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        secure: COOKIE_SECURE,
        sameSite: "lax",
        path: "/"
      });
      return res.status(401).json({ error: "Authentication required" });
    }

    await Promise.all([
      User.deleteOne({ _id: session.userId }),
      Session.deleteMany({ userId: session.userId }),
      Favorite.deleteMany({ userId: session.userId }),
      Itinerary.deleteMany({ userId: session.userId }),
      Visit.deleteMany({ userId: session.userId })
    ]);

    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: COOKIE_SECURE,
      sameSite: "lax",
      path: "/"
    });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.get("/favorites", requireAuth, async (req, res, next) => {
  try {
    const favorites = await Favorite.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    return res.json(await attachPlaces(favorites));
  } catch (error) {
    return next(error);
  }
});

app.get("/favorites/status", requireAuth, async (req, res, next) => {
  try {
    const reference = parsePlaceReference(req.query);
    if (!reference) return res.status(400).json({ error: "Invalid place reference" });
    const favorite = await Favorite.exists({ userId: req.user._id, ...reference });
    return res.json({ favorite: Boolean(favorite) });
  } catch (error) {
    return next(error);
  }
});

app.post("/favorites", requireAuth, async (req, res, next) => {
  try {
    const reference = parsePlaceReference(req.body);
    if (!reference) return res.status(400).json({ error: "Invalid place reference" });
    const place = await findVisiblePlace(reference.placeType, reference.placeId);
    if (!place) return res.status(404).json({ error: "Place not found" });

    const favorite = await Favorite.findOneAndUpdate(
      { userId: req.user._id, ...reference },
      { $setOnInsert: { userId: req.user._id, ...reference, createdAt: new Date() } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    return res.status(201).json({ ...favorite, place: placeSummary(reference.placeType, place) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: "Favorite already exists" });
    return next(error);
  }
});

app.delete("/favorites/:placeType/:placeId", requireAuth, async (req, res, next) => {
  try {
    const reference = parsePlaceReference(req.params);
    if (!reference) return res.status(400).json({ error: "Invalid place reference" });
    await Favorite.deleteOne({ userId: req.user._id, ...reference });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.post("/itineraries", requireAuth, async (req, res, next) => {
  try {
    const payload = parseItineraryPayload(req.body);
    const editPassword = req.body?.editPassword;
    if (editPassword && !validEditPassword(editPassword)) {
      return res.status(400).json({ error: "Edit password must be 4 to 32 characters" });
    }
    const references = Array.isArray(payload.days)
      ? payload.days.flatMap(day => day.places || [])
      : [];
    if (!await validatePlaceReferences(references)) {
      return res.status(400).json({ error: "Invalid place reference" });
    }
    const itinerary = await Itinerary.create({
      userId: req.user._id,
      ...payload,
      editPasswordHash: editPassword ? hashEditPassword(editPassword) : null
    });
    return res.status(201).json(await attachItineraryPlaces(itinerary));
  } catch (error) {
    if (error?.name === "ValidationError" || error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid itinerary" });
    }
    return next(error);
  }
});

app.get("/itineraries/mine", requireAuth, async (req, res, next) => {
  try {
    const itineraries = await Itinerary.find({ userId: req.user._id }).sort({ updatedAt: -1 }).lean();
    const result = await Promise.all(itineraries.map(async itinerary => ({
      ...(await attachItineraryPlaces(itinerary)),
      isOwner: true,
      canEdit: true
    })));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.get("/itineraries/joined", requireAuth, async (req, res, next) => {
  try {
    const itineraries = await Itinerary.find({
      $or: [
        { userId: req.user._id, "editorIds.0": { $exists: true } },
        { editorIds: req.user._id }
      ]
    })
      .sort({ updatedAt: -1 })
      .lean();
    const result = await Promise.all(itineraries.map(async itinerary => {
      const isOwner = itinerary.userId.equals(req.user._id);
      return {
        ...(await attachItineraryPlaces(itinerary)),
        isOwner,
        canEdit: true,
        shareRole: isOwner ? "sharedByMe" : "sharedWithMe"
      };
    }));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.get("/itineraries/public", async (req, res, next) => {
  try {
    const category = ["operator", "member", "popular"].includes(req.query.category)
      ? req.query.category
      : "member";
    const operator = await User.findOne({
      accounts: {
        $elemMatch: {
          provider: OPERATOR_PROVIDER,
          providerUserId: OPERATOR_PROVIDER_USER_ID
        }
      }
    }).select("_id").lean();
    const filter = {
      visibility: "public",
      ...(category === "operator"
        ? { userId: operator?._id || new mongoose.Types.ObjectId() }
        : {}),
      ...(category === "member" && operator?._id
        ? { userId: { $ne: operator._id } }
        : {})
    };
    let itineraries = await Itinerary.find(filter)
      .select("userId title description visibility days importCount operatorRecommended createdAt updatedAt")
      .sort(category === "popular" ? { importCount: -1 } : { updatedAt: -1 })
      .lean();
    if (category === "popular") {
      for (let start = 0; start < itineraries.length;) {
        let end = start + 1;
        while (end < itineraries.length && itineraries[end].importCount === itineraries[start].importCount) end += 1;
        for (let index = end - 1; index > start; index -= 1) {
          const swapIndex = start + crypto.randomInt(index - start + 1);
          [itineraries[index], itineraries[swapIndex]] = [itineraries[swapIndex], itineraries[index]];
        }
        start = end;
      }
      itineraries = itineraries.slice(0, 10);
    }
    const user = await getSessionUser(req);
    const importedSourceIds = user
      ? new Set((await Itinerary.find({
          userId: user._id,
          sourceItineraryId: { $in: itineraries.map(item => item._id) }
        }).select("sourceItineraryId").lean()).map(item => String(item.sourceItineraryId)))
      : new Set();
    const result = await Promise.all(itineraries.map(async itinerary => {
      const attached = await attachItineraryPlaces(itinerary);
      delete attached.userId;
      return { ...attached, imported: importedSourceIds.has(String(itinerary._id)) };
    }));
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post("/itineraries/:id/copy", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Itinerary not found" });
    const source = await Itinerary.findOne({ _id: req.params.id, visibility: "public" }).lean();
    if (!source) return res.status(404).json({ error: "Public itinerary not found" });
    const alreadyImported = await Itinerary.exists({ userId: req.user._id, sourceItineraryId: source._id });
    if (alreadyImported) return res.status(409).json({ error: "Itinerary already imported" });

    const copied = await Itinerary.create({
      userId: req.user._id,
      title: source.title,
      description: source.description || "",
      visibility: "unlisted",
      days: (source.days || []).map(day => ({
        date: day.date || null,
        title: day.title || "",
        places: (day.places || []).map((place, order) => ({
          placeType: place.placeType,
          placeId: place.placeId,
          order,
          memo: place.memo || ""
        }))
      })),
      schedule: (source.schedule || []).map(day => ({
        date: day.date,
        items: (day.items || []).map(item => ({
          time: item.time,
          title: item.title,
          memo: item.memo || ""
        }))
      })),
      checklist: (source.checklist || []).map(item => ({
        text: item.text,
        checked: Boolean(item.checked),
        ownerId: null
      })),
      editorIds: [],
      editPasswordHash: null,
      sourceItineraryId: source._id
    });
    const importRecord = await ItineraryImport.updateOne(
      { userId: req.user._id, sourceItineraryId: source._id },
      { $setOnInsert: { userId: req.user._id, sourceItineraryId: source._id, createdAt: new Date() } },
      { upsert: true }
    );
    if (importRecord.upsertedCount === 1) {
      await Itinerary.updateOne({ _id: source._id }, { $inc: { importCount: 1 } });
    }
    return res.status(201).json({
      ...(await attachItineraryPlaces(copied)),
      isOwner: true,
      canEdit: true
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: "Itinerary already imported" });
    if (error?.name === "ValidationError" || error?.name === "CastError") {
      return res.status(400).json({ error: "Unable to copy itinerary" });
    }
    return next(error);
  }
});

app.get("/itineraries/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Itinerary not found" });
    const itinerary = await Itinerary.findById(req.params.id).lean();
    if (!itinerary) return res.status(404).json({ error: "Itinerary not found" });

    const user = await getSessionUser(req);
    const isOwner = user && itinerary.userId.equals(user._id);
    const canEdit = Boolean(user && (isOwner || itinerary.editorIds?.some(id => id.equals(user._id))));
    if (itinerary.visibility === "private" && !canEdit) {
      return res.status(404).json({ error: "Itinerary not found" });
    }
    const response = await attachItineraryPlaces(itinerary);
    if (!isOwner) {
      delete response.userId;
      delete response.editorIds;
    }
    return res.json({ ...response, isOwner: Boolean(isOwner), canEdit });
  } catch (error) {
    return next(error);
  }
});

app.patch("/itineraries/:id", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Itinerary not found" });
    const payload = parseItineraryPayload(req.body, true);
    const existing = await Itinerary.findById(req.params.id).select("userId editorIds");
    if (!existing) return res.status(404).json({ error: "Itinerary not found" });
    const isOwner = existing.userId.equals(req.user._id);
    const isEditor = existing.editorIds?.some(id => id.equals(req.user._id));
    if (!isOwner && !isEditor) return res.status(404).json({ error: "Itinerary not found" });
    if (!isOwner) delete payload.visibility;
    delete payload.checklist;
    if (payload.days !== undefined) {
      const references = Array.isArray(payload.days) ? payload.days.flatMap(day => day.places || []) : [];
      if (!Array.isArray(payload.days) || !await validatePlaceReferences(references)) {
        return res.status(400).json({ error: "Invalid place reference" });
      }
    }
    const itinerary = await Itinerary.findOneAndUpdate(
      { _id: req.params.id },
      { $set: payload },
      { new: true, runValidators: true }
    );
    if (!itinerary) return res.status(404).json({ error: "Itinerary not found" });
    return res.json(await attachItineraryPlaces(itinerary));
  } catch (error) {
    if (error?.name === "ValidationError" || error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid itinerary" });
    }
    return next(error);
  }
});

app.post("/itineraries/:id/checklist", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Itinerary not found" });
    const itinerary = await Itinerary.findById(req.params.id);
    if (!itinerary) return res.status(404).json({ error: "Itinerary not found" });
    const canEdit = itinerary.userId.equals(req.user._id) || itinerary.editorIds?.some(id => id.equals(req.user._id));
    if (!canEdit) return res.status(403).json({ error: "Edit access required" });
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "Checklist text is required" });
    itinerary.checklist.push({
      text,
      checked: false,
      ownerId: req.body?.scope === "personal" ? req.user._id : null
    });
    await itinerary.save();
    return res.status(201).json(await attachItineraryPlaces(itinerary));
  } catch (error) {
    if (error?.name === "ValidationError") return res.status(400).json({ error: "Invalid checklist item" });
    return next(error);
  }
});

app.patch("/itineraries/:id/checklist/:itemId", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.itemId)) {
      return res.status(404).json({ error: "Checklist item not found" });
    }
    const itinerary = await Itinerary.findById(req.params.id);
    if (!itinerary) return res.status(404).json({ error: "Itinerary not found" });
    const canEdit = itinerary.userId.equals(req.user._id) || itinerary.editorIds?.some(id => id.equals(req.user._id));
    const item = itinerary.checklist.id(req.params.itemId);
    if (!canEdit || !item) return res.status(404).json({ error: "Checklist item not found" });
    if (item.ownerId && !item.ownerId.equals(req.user._id)) {
      return res.status(403).json({ error: "Only the checklist owner can update this item" });
    }
    if (req.body?.checked !== undefined) item.checked = Boolean(req.body.checked);
    await itinerary.save();
    return res.json(await attachItineraryPlaces(itinerary));
  } catch (error) {
    return next(error);
  }
});

app.delete("/itineraries/:id/checklist/:itemId", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.itemId)) {
      return res.status(404).json({ error: "Checklist item not found" });
    }
    const itinerary = await Itinerary.findById(req.params.id);
    if (!itinerary) return res.status(404).json({ error: "Itinerary not found" });
    const canEdit = itinerary.userId.equals(req.user._id) || itinerary.editorIds?.some(id => id.equals(req.user._id));
    const item = itinerary.checklist.id(req.params.itemId);
    if (!canEdit || !item) return res.status(404).json({ error: "Checklist item not found" });
    if (item.ownerId && !item.ownerId.equals(req.user._id)) {
      return res.status(403).json({ error: "Only the checklist owner can delete this item" });
    }
    item.deleteOne();
    await itinerary.save();
    return res.json(await attachItineraryPlaces(itinerary));
  } catch (error) {
    return next(error);
  }
});

app.post("/itineraries/:id/edit-access", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Itinerary not found" });
    const password = String(req.body?.password || "");
    const itinerary = await Itinerary.findById(req.params.id).select("+editPasswordHash");
    if (!itinerary || itinerary.visibility === "private") return res.status(404).json({ error: "Itinerary not found" });
    if (!itinerary.editPasswordHash) return res.status(403).json({ error: "Edit password is not enabled" });
    if (!verifyEditPassword(password, itinerary.editPasswordHash)) {
      return res.status(403).json({ error: "Incorrect edit password" });
    }
    if (!itinerary.userId.equals(req.user._id)) {
      await Itinerary.updateOne({ _id: itinerary._id }, { $addToSet: { editorIds: req.user._id } });
    }
    const updated = await Itinerary.findById(itinerary._id);
    return res.json({ ...(await attachItineraryPlaces(updated)), canEdit: true, isOwner: itinerary.userId.equals(req.user._id) });
  } catch (error) {
    return next(error);
  }
});

app.put("/itineraries/:id/edit-password", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Itinerary not found" });
    const password = String(req.body?.password || "");
    if (!validEditPassword(password)) {
      return res.status(400).json({ error: "Edit password must be 4 to 32 characters" });
    }
    const itinerary = await Itinerary.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { editPasswordHash: hashEditPassword(password) } },
      { new: true }
    );
    if (!itinerary) return res.status(403).json({ error: "Only the owner can change the edit password" });
    return res.json({ hasEditPassword: true });
  } catch (error) {
    return next(error);
  }
});

app.delete("/itineraries/:id/editors/:userId", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.userId)) {
      return res.status(404).json({ error: "Itinerary not found" });
    }
    const itinerary = await Itinerary.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $pull: { editorIds: req.params.userId } },
      { new: true }
    );
    if (!itinerary) return res.status(403).json({ error: "Only the owner can manage editors" });
    return res.json(await attachItineraryPlaces(itinerary));
  } catch (error) {
    return next(error);
  }
});

app.delete("/itineraries/:id", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Itinerary not found" });
    const result = await Itinerary.deleteOne({ _id: req.params.id, userId: req.user._id });
    if (!result.deletedCount) return res.status(404).json({ error: "Itinerary not found" });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.post("/visits", requireAuth, async (req, res, next) => {
  try {
    const payload = parseVisitPayload(req.body);
    const reference = parsePlaceReference(payload);
    if (!reference || !await findVisiblePlace(reference.placeType, reference.placeId)) {
      return res.status(400).json({ error: "Invalid place reference" });
    }
    const visit = await Visit.create({ userId: req.user._id, ...payload });
    return res.status(201).json((await attachPlaces([visit]))[0]);
  } catch (error) {
    if (error?.name === "ValidationError" || error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid visit" });
    }
    return next(error);
  }
});

app.get("/visits", requireAuth, async (req, res, next) => {
  try {
    const visits = await Visit.find({ userId: req.user._id }).sort({ visitedAt: -1 }).lean();
    return res.json(await attachPlaces(visits));
  } catch (error) {
    return next(error);
  }
});

app.get("/visits/:id", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Visit not found" });
    const visit = await Visit.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!visit) return res.status(404).json({ error: "Visit not found" });
    return res.json((await attachPlaces([visit]))[0]);
  } catch (error) {
    return next(error);
  }
});

app.patch("/visits/:id", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Visit not found" });
    const payload = parseVisitPayload(req.body, true);
    if (payload.placeType !== undefined || payload.placeId !== undefined) {
      const current = await Visit.findOne({ _id: req.params.id, userId: req.user._id }).lean();
      if (!current) return res.status(404).json({ error: "Visit not found" });
      const reference = parsePlaceReference({
        placeType: payload.placeType ?? current.placeType,
        placeId: payload.placeId ?? current.placeId
      });
      if (!reference || !await findVisiblePlace(reference.placeType, reference.placeId)) {
        return res.status(400).json({ error: "Invalid place reference" });
      }
    }
    const visit = await Visit.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: payload },
      { new: true, runValidators: true }
    );
    if (!visit) return res.status(404).json({ error: "Visit not found" });
    return res.json((await attachPlaces([visit]))[0]);
  } catch (error) {
    if (error?.name === "ValidationError" || error?.name === "CastError") {
      return res.status(400).json({ error: "Invalid visit" });
    }
    return next(error);
  }
});

app.delete("/visits/:id", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Visit not found" });
    const result = await Visit.deleteOne({ _id: req.params.id, userId: req.user._id });
    if (!result.deletedCount) return res.status(404).json({ error: "Visit not found" });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

app.get("/blogs", async (req, res) => {
  const query = {};
  if (req.query.typeTable) query.typeTable = req.query.typeTable;
  if (req.query.otherID !== undefined) {
    const otherID = Number(req.query.otherID);
    if (!Number.isInteger(otherID)) {
      return res.status(400).json({ error: "Invalid otherID" });
    }
    query.otherID = otherID;
  }

  if (USE_LOCAL_DB) {
    const data = localDB.blogs.filter(item => (
      (!query.typeTable || item.typeTable === query.typeTable) &&
      (query.otherID === undefined || item.otherID === query.otherID)
    ));
    return res.json(data);
  }

  const data = await Blog.find(query);
  res.json(data);
});

app.get("/blogs/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.blogs.find(item => item.id === Number(req.params.id));
    return data ? res.json(data) : res.status(404).send("Not Found");
  }
  const data = await Blog.findOne({ id: Number(req.params.id) });
  data ? res.json(data) : res.status(404).send("Not Found");
});

app.get("/rankings", async (req, res) => {
  const stored = USE_LOCAL_DB ? localDB.rankings : await Ranking.find({}).lean();
  const data = [...stored, ...await publishedExternalPlaces("attraction")];
  res.json(await attachRatingSummaries("attraction", data));
});

app.get("/rankings/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.rankings.find(item => item.id === Number(req.params.id));
    return data ? res.json(await attachRatingSummaries("attraction", data)) : res.status(404).send("Not Found");
  }
  const data = await Ranking.findOne({ id: Number(req.params.id) }).lean();
  data ? res.json(await attachRatingSummaries("attraction", data)) : res.status(404).send("Not Found");
});


app.get("/seasons", async (req, res) => {
  if (USE_LOCAL_DB) {
    return res.json(localDB.seasons);
  }
  const data = await Season.find({});
  res.json(data);
});


app.get("/cafes", async (req, res) => {
  const stored = USE_LOCAL_DB ? localDB.cafes : await Cafe.find({}).lean();
  const data = [...stored, ...await publishedExternalPlaces("cafe")];
  res.json(await attachRatingSummaries("cafe", data));
});

app.get("/cafes/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.cafes.find(item => item.id === Number(req.params.id));
    return data ? res.json(await attachRatingSummaries("cafe", data)) : res.status(404).send("Not Found");
  }
  const data = await Cafe.findOne({ id: Number(req.params.id) }).lean();
  data ? res.json(await attachRatingSummaries("cafe", data)) : res.status(404).send("Not Found");
});


app.get("/restaurants", async (req, res) => {
  const stored = USE_LOCAL_DB ? localDB.restaurants : await Restaurant.find({}).lean();
  const data = [...stored, ...await publishedExternalPlaces("restaurant")];
  res.json(await attachRatingSummaries("restaurant", data));
});

app.get("/restaurants/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.restaurants.find(item => item.id === Number(req.params.id));
    return data ? res.json(await attachRatingSummaries("restaurant", data)) : res.status(404).send("Not Found");
  }
  const data = await Restaurant.findOne({ id: Number(req.params.id) }).lean();
  data ? res.json(await attachRatingSummaries("restaurant", data)) : res.status(404).send("Not Found");
});


app.get("/lodgings", async (req, res) => {
  const stored = USE_LOCAL_DB ? localDB.lodgings : await Lodging.find({}).lean();
  const data = [...stored, ...await publishedExternalPlaces("lodging")];
  res.json(await attachRatingSummaries("lodging", data));
});

app.get("/lodgings/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.lodgings.find(item => item.id === Number(req.params.id));
    return data ? res.json(await attachRatingSummaries("lodging", data)) : res.status(404).send("Not Found");
  }
  const data = await Lodging.findOne({ id: Number(req.params.id) }).lean();
  data ? res.json(await attachRatingSummaries("lodging", data)) : res.status(404).send("Not Found");
});

app.get("/foods", async (req, res) => {
  const stored = USE_LOCAL_DB ? localDB.foods : await Food.find({}).lean();
  const data = [...stored, ...await publishedExternalPlaces("food")];
  res.json(await attachRatingSummaries("food", data));
});

app.get("/foods/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.foods.find(item => item.id === Number(req.params.id));
    return data ? res.json(await attachRatingSummaries("food", data)) : res.status(404).send("Not Found");
  }
  const data = await Food.findOne({ id: Number(req.params.id) }).lean();
  data ? res.json(await attachRatingSummaries("food", data)) : res.status(404).send("Not Found");
});


app.get("/collections", async (req, res) => {
  if (USE_LOCAL_DB) {
    return res.json(localDB.collections);
  }
  const data = await Collection.find({});
  res.json(data);
});

app.get("/collections/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.collections.find(
      item => item.id === Number(req.params.id)
    );
    return data ? res.json(data) : res.status(404).send("Not Found");
  }

  const data = await Collection.findOne({ id: Number(req.params.id) });

  data ? res.json(data) : res.status(404).send("Not Found");
});
// TODO: /cafes, /restaurants 등 동일하게 설정

app.use((error, req, res, next) => {
  console.error(error);
  if (error.message === "Origin not allowed by CORS") {
    return res.status(403).json({ error: "Forbidden origin" });
  }
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 600) {
    const safeApiMessage = error.status >= 500
        ? "외부 API 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요."
        : error.message;
    return res.status(error.status).json({ error: safeApiMessage });
  }
  return res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
