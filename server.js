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

// ----- Schema (strict:false) -----
const Ranking = mongoose.model("Ranking", new mongoose.Schema({}, { strict: false, collection: "rankings" }));

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

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: !USE_LOCAL_DB,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_MS
  };
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

app.get("/blogs", async (req, res) => {
  if (USE_LOCAL_DB) {
    return res.json(localDB.blogs);
  }
  const data = await Ranking.find({});
  res.json(data);
});

app.get("/blogs/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.blogs.find(item => item.id === Number(req.params.id));
    return data ? res.json(data) : res.status(404).send("Not Found");
  }
  const data = await Ranking.findOne({ id: Number(req.params.id) });
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
  const data = await Ranking.find({});
  res.json(data);
});


app.get("/cafes", async (req, res) => {
  if (USE_LOCAL_DB) {
    return res.json(localDB.cafes);
  }
  const data = await Ranking.find({});
  res.json(data);
});

app.get("/cafes/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.cafes.find(item => item.id === Number(req.params.id));
    return data ? res.json(data) : res.status(404).send("Not Found");
  }
  const data = await Ranking.findOne({ id: Number(req.params.id) });
  data ? res.json(data) : res.status(404).send("Not Found");
});


app.get("/restaurants", async (req, res) => {
  if (USE_LOCAL_DB) {
    return res.json(localDB.restaurants);
  }
  const data = await Ranking.find({});
  res.json(data);
});

app.get("/restaurants/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.restaurants.find(item => item.id === Number(req.params.id));
    return data ? res.json(data) : res.status(404).send("Not Found");
  }
  const data = await Ranking.findOne({ id: Number(req.params.id) });
  data ? res.json(data) : res.status(404).send("Not Found");
});


app.get("/lodgings", async (req, res) => {
  if (USE_LOCAL_DB) {
    return res.json(localDB.lodgings);
  }
  const data = await Ranking.find({});
  res.json(data);
});

app.get("/lodgings/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.lodgings.find(item => item.id === Number(req.params.id));
    return data ? res.json(data) : res.status(404).send("Not Found");
  }
  const data = await Ranking.findOne({ id: Number(req.params.id) });
  data ? res.json(data) : res.status(404).send("Not Found");
});

app.get("/foods", async (req, res) => {
  if (USE_LOCAL_DB) {
    return res.json(localDB.foods);
  }
  const data = await Ranking.find({});
  res.json(data);
});

app.get("/foods/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.foods.find(item => item.id === Number(req.params.id));
    return data ? res.json(data) : res.status(404).send("Not Found");
  }
  const data = await Ranking.findOne({ id: Number(req.params.id) });
  data ? res.json(data) : res.status(404).send("Not Found");
});


app.get("/collections", async (req, res) => {
  if (USE_LOCAL_DB) {
    return res.json(localDB.collections);
  }
  const data = await Ranking.find({ type: "collection" });
  res.json(data);
});

app.get("/collections/:id", async (req, res) => {
  if (USE_LOCAL_DB) {
    const data = localDB.collections.find(
      item => item.id === Number(req.params.id)
    );
    return data ? res.json(data) : res.status(404).send("Not Found");
  }

  const data = await Ranking.findOne({
    id: Number(req.params.id),
    type: "collection"
  });

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
