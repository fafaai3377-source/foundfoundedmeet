import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";

const KEY_PATH = "c:/Users/User/Desktop/ffm-backup/serviceAccountKey.json";

if (!fs.existsSync(KEY_PATH)) {
  console.error(`키 파일을 찾을 수 없습니다: ${KEY_PATH}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

(async () => {
  try {
    const snap = await db.collection("reservations").get();
    const results = [];
    
    snap.forEach(doc => {
      const data = doc.data();
      // 조건: 날짜가 2026-07-29 이거나, title에 '꼭두'가 포함된 경우
      if (data.date === "2026-07-29" || (data.title && data.title.includes("꼭두"))) {
        results.push(data);
      }
    });

    console.log(`\n=== 검색 결과 (총 ${results.length}건) ===\n`);
    results.forEach(r => {
      console.log(`[${r.date} ${r.start}~${r.end}] ${r.title} (Room: ${r.roomId}, Resource: ${r.resourceId || '없음'}) - ID: ${r.id}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error("에러 발생:", err);
    process.exit(1);
  }
})();
