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

// ✅ 포트 설정
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
