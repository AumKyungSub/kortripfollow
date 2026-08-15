import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import crypto from "crypto";
dotenv.config();

const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

const ALLOWED_ORIGINS = new Set([
  "https://kortripfollow.shop",
  "https://www.kortripfollow.shop",
  "https://m.kortripfollow.shop",
  "https://iridescent-semolina-29f8f8.netlify.app",
  "http://localhost:5173",
  "http://172.30.1.54:5173"
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
if (!USE_LOCAL_DB) {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not found in environment variables");
    process.exit(1);
  }

  await mongoose.connect(uri)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.error(err));
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

if (!USE_LOCAL_DB) {
  await Promise.all([User.init(), Session.init()]);
  console.log("Authentication indexes ready");
}

const SESSION_COOKIE_NAME = "kortrip_session";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const OAUTH_COOKIE_MAX_AGE_MS = 1000 * 60 * 10;
const GOOGLE_STATE_COOKIE = "kortrip_google_state";
const GOOGLE_VERIFIER_COOKIE = "kortrip_google_verifier";
const GOOGLE_REDIRECT_URI = "https://api.kortripfollow.shop/auth/google/callback";
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://kortripfollow.shop")
  .replace(/\/$/, "");

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
    secure: !USE_LOCAL_DB,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS
  };
}

function oauthCookieOptions() {
  return {
    httpOnly: true,
    secure: !USE_LOCAL_DB,
    sameSite: "lax",
    path: "/auth/google",
    maxAge: OAUTH_COOKIE_MAX_AGE_MS
  };
}

function clearGoogleOAuthCookies(res) {
  const options = {
    httpOnly: true,
    secure: !USE_LOCAL_DB,
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

async function getSessionUser(req) {
  if (USE_LOCAL_DB) return null;

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

// ----- API 라우트 -----

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/auth/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
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
    if (!USE_LOCAL_DB) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
      if (token) await Session.deleteOne({ tokenHash: hashSessionToken(token) });
    }

    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: !USE_LOCAL_DB,
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
    if (USE_LOCAL_DB) {
      return res.status(503).json({ error: "Account deletion is unavailable in local mode" });
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
        secure: !USE_LOCAL_DB,
        sameSite: "lax",
        path: "/"
      });
      return res.status(401).json({ error: "Authentication required" });
    }

    await Promise.all([
      User.deleteOne({ _id: session.userId }),
      Session.deleteMany({ userId: session.userId })
    ]);

    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: !USE_LOCAL_DB,
      sameSite: "lax",
      path: "/"
    });
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
    return res.json(localDB.rankings);
  }
  const data = await Ranking.find({});
  res.json(data);
});

app.get("/rankings/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.rankings.find(item => item.id === Number(req.params.id));
    return data ? res.json(data) : res.status(404).send("Not Found");
  }
  const data = await Ranking.findOne({ id: Number(req.params.id) });
  data ? res.json(data) : res.status(404).send("Not Found");
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
    return res.json(localDB.cafes);
  }
  const data = await Cafe.find({});
  res.json(data);
});

app.get("/cafes/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.cafes.find(item => item.id === Number(req.params.id));
    return data ? res.json(data) : res.status(404).send("Not Found");
  }
  const data = await Cafe.findOne({ id: Number(req.params.id) });
  data ? res.json(data) : res.status(404).send("Not Found");
});


app.get("/restaurants", async (req, res) => {
  if (USE_LOCAL_DB) {
    return res.json(localDB.restaurants);
  }
  const data = await Restaurant.find({});
  res.json(data);
});

app.get("/restaurants/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.restaurants.find(item => item.id === Number(req.params.id));
    return data ? res.json(data) : res.status(404).send("Not Found");
  }
  const data = await Restaurant.findOne({ id: Number(req.params.id) });
  data ? res.json(data) : res.status(404).send("Not Found");
});


app.get("/lodgings", async (req, res) => {
  if (USE_LOCAL_DB) {
    return res.json(localDB.lodgings);
  }
  const data = await Lodging.find({});
  res.json(data);
});

app.get("/lodgings/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.lodgings.find(item => item.id === Number(req.params.id));
    return data ? res.json(data) : res.status(404).send("Not Found");
  }
  const data = await Lodging.findOne({ id: Number(req.params.id) });
  data ? res.json(data) : res.status(404).send("Not Found");
});

app.get("/foods", async (req, res) => {
  if (USE_LOCAL_DB) {
    return res.json(localDB.foods);
  }
  const data = await Food.find({});
  res.json(data);
});

app.get("/foods/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.foods.find(item => item.id === Number(req.params.id));
    return data ? res.json(data) : res.status(404).send("Not Found");
  }
  const data = await Food.findOne({ id: Number(req.params.id) });
  data ? res.json(data) : res.status(404).send("Not Found");
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
