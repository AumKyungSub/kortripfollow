import express from "express";
import cors from "cors";
import fs from "fs";

const app = express();
app.use(cors());

// db.json 불러오기
const db = JSON.parse(fs.readFileSync("./db.json", "utf-8"));

// ✅ /rankings 라우트
app.get("/rankings", (req, res) => {
  res.json(db.rankings);
});

// ✅ /rankings/:id 상세 라우트
app.get("/rankings/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const item = db.rankings.find(r => r.id === id);
  if (item) res.json(item);
  else res.status(404).send("Not found");
});

// ✅ /seasons 라우트 (여기 추가!)
app.get("/seasons", (req, res) => {
  res.json(db.seasons);
});

// ✅ /seasons 라우트 (여기 추가!)
app.get("/cafes", (req, res) => {
  res.json(db.cafes);
});

// ✅ /seasons 라우트 (여기 추가!)
app.get("/restaurants", (req, res) => {
  res.json(db.restaurants);
});

// ✅ /cafes/:id 상세 라우트
app.get("/cafes/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const item = db.cafes.find(r => r.id === id);
  if (item) res.json(item);
  else res.status(404).send("Not found");
});

// ✅ /restaurants/:id 상세 라우트
app.get("/restaurants/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const item = db.restaurants.find(r => r.id === id);
  if (item) res.json(item);
  else res.status(404).send("Not found");
});

// ✅ 포트 설정
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://172.30.1.1:${PORT}`));
