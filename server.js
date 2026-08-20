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
let mongoReady = false;
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://kortripfollow.shop")
  .replace(/\/$/, "");
const COOKIE_SECURE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === "true"
  : FRONTEND_URL.startsWith("https://");

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
  "https://kortripfollowfront.pages.dev",
  FRONTEND_URL
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
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

// ----- Authentication schemas -----
// Social providers are the source of identity. Passwords are never stored.
const userSchema = new mongoose.Schema({
  accounts: [{
    _id: false,
    provider: {
      type: String,
      required: true,
      enum: ["google", "kakao", "naver"]
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
  days: { type: [itineraryDaySchema], default: [] }
}, { collection: "itineraries", versionKey: false, timestamps: true });

itinerarySchema.index({ userId: 1, updatedAt: -1 }, { name: "user_itineraries_recent" });
itinerarySchema.index({ visibility: 1, updatedAt: -1 }, { name: "visible_itineraries_recent" });

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
const Visit = mongoose.model("Visit", visitSchema);

if (mongoReady) {
  try {
    await Promise.all([
      User.init(),
      Session.init(),
      Favorite.init(),
      Itinerary.init(),
      Visit.init()
    ]);
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
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "https://api.kortripfollow.shop/auth/google/callback";
const NAVER_STATE_COOKIE = "kortrip_naver_state";
const NAVER_REDIRECT_URI = process.env.NAVER_REDIRECT_URI || "https://api.kortripfollow.shop/auth/naver/callback";
const KAKAO_STATE_COOKIE = "kortrip_kakao_state";
const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI || "https://api.kortripfollow.shop/auth/kakao/callback";

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
    .select("displayName accounts.provider createdAt")
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
  if (USE_LOCAL_DB) {
    const collection = placeCollectionByType[placeType];
    if (!collection) return null;
    return localDB?.[collection]?.find(
      place => place.id === placeId && place.visibility !== false
    ) || null;
  }

  const model = placeModelByType[placeType];
  if (!model) return null;
  return model.findOne({ id: placeId, visibility: { $ne: false } }).lean();
}

function placeSummary(placeType, place) {
  if (!place) return null;
  return {
    placeType,
    placeId: place.id,
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
  if (USE_LOCAL_DB) {
    return Object.entries(placeCollectionByType)
      .flatMap(([placeType, collection]) => (localDB?.[collection] || [])
        .filter(place => place.visibility !== false && matchesPlaceSearch(place, query))
        .map(place => placeSummary(placeType, place)))
      .slice(0, limit);
  }

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
  return groups.flat().slice(0, limit);
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
  const days = await Promise.all((item.days || []).map(async day => ({
    ...day,
    places: await Promise.all((day.places || []).map(async reference => {
      const place = await findVisiblePlace(reference.placeType, reference.placeId);
      return { ...reference, place: placeSummary(reference.placeType, place) };
    }))
  })));
  return { ...item, days };
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
        providers: user.accounts.map(account => account.provider)
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
    const references = Array.isArray(payload.days)
      ? payload.days.flatMap(day => day.places || [])
      : [];
    if (!await validatePlaceReferences(references)) {
      return res.status(400).json({ error: "Invalid place reference" });
    }
    const itinerary = await Itinerary.create({ userId: req.user._id, ...payload });
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
    return res.json(await Promise.all(itineraries.map(attachItineraryPlaces)));
  } catch (error) {
    return next(error);
  }
});

app.get("/itineraries/public", async (req, res, next) => {
  try {
    const itineraries = await Itinerary.find({ visibility: "public" })
      .select("title description visibility days createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .lean();
    return res.json(await Promise.all(itineraries.map(attachItineraryPlaces)));
  } catch (error) {
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
    if (itinerary.visibility === "private" && !isOwner) {
      return res.status(404).json({ error: "Itinerary not found" });
    }
    const response = await attachItineraryPlaces(itinerary);
    if (!isOwner) delete response.userId;
    return res.json({ ...response, isOwner: Boolean(isOwner) });
  } catch (error) {
    return next(error);
  }
});

app.patch("/itineraries/:id", requireAuth, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Itinerary not found" });
    const payload = parseItineraryPayload(req.body, true);
    if (payload.days !== undefined) {
      const references = Array.isArray(payload.days) ? payload.days.flatMap(day => day.places || []) : [];
      if (!Array.isArray(payload.days) || !await validatePlaceReferences(references)) {
        return res.status(400).json({ error: "Invalid place reference" });
      }
    }
    const itinerary = await Itinerary.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
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
  if (USE_LOCAL_DB) {
    return res.json(await attachRatingSummaries("attraction", localDB.rankings));
  }
  const data = await Ranking.find({}).lean();
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
  if (USE_LOCAL_DB) {
    return res.json(await attachRatingSummaries("cafe", localDB.cafes));
  }
  const data = await Cafe.find({}).lean();
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
  if (USE_LOCAL_DB) {
    return res.json(await attachRatingSummaries("restaurant", localDB.restaurants));
  }
  const data = await Restaurant.find({}).lean();
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
  if (USE_LOCAL_DB) {
    return res.json(await attachRatingSummaries("lodging", localDB.lodgings));
  }
  const data = await Lodging.find({}).lean();
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
  if (USE_LOCAL_DB) {
    return res.json(await attachRatingSummaries("food", localDB.foods));
  }
  const data = await Food.find({}).lean();
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
  return res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
