import express from "express";
import cors from "cors";
import mongoose from "mongoose";

import dotenv from "dotenv";
dotenv.config();

const app = express();

// CORS 설정 
app.use(cors({
  origin: [
    "https://kortripfollow.shop",
    "https://www.kortripfollow.shop",
    "https://m.kortripfollow.shop",
    "https://iridescent-semolina-29f8f8.netlify.app",
    "http://localhost:5173",
    "http://172.30.1.1:5173"
  ],
  credentials: true
}));

// ----- MongoDB 연결 -----
const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("MONGO_URI not found in environment variables");
  process.exit(1);
}

await mongoose.connect(uri)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.error(err));

// ----- 스키마 모델 선언 (strict:false로 어떤 구조든 허용) -----
const options = { strict: false, id: false };

const Ranking = mongoose.model("Ranking", new mongoose.Schema({}, { ...options, collection: "rankings" }));
const Season = mongoose.model("Season", new mongoose.Schema({}, { ...options, collection: "seasons" }));
const Cafe = mongoose.model("Cafe", new mongoose.Schema({}, { ...options, collection: "cafes" }));
const Restaurant = mongoose.model("Restaurant", new mongoose.Schema({}, { ...options, collection: "restaurants" }));

// ----- API 라우트 -----

// 전체 목록 조회
app.get("/rankings", async (req, res) => {
  const data = await Ranking.find({});
  res.json(data);
});

app.get("/seasons", async (req, res) => {
  const data = await Season.find({});
  res.json(data);
});

app.get("/cafes", async (req, res) => {
  const data = await Cafe.find({});
  res.json(data);
});

app.get("/restaurants", async (req, res) => {
  const data = await Restaurant.find({});
  res.json(data);
});

// 상세 조회 (id 기준)
app.get("/rankings/:id", async (req, res) => {
  const data = await Ranking.findOne({ id: Number(req.params.id) });
  if (data) res.json(data);
  else res.status(404).send("Not Found");
});

app.get("/cafes/:id", async (req, res) => {
  const data = await Cafe.findOne({ id: Number(req.params.id) });
  if (data) res.json(data);
  else res.status(404).send("Not Found");
});

app.get("/restaurants/:id", async (req, res) => {
  const data = await Restaurant.findOne({ id: Number(req.params.id) });
  if (data) res.json(data);
  else res.status(404).send("Not Found");
});

// ----- 서버 실행 -----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
