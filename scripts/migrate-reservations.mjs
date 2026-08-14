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

const isConfirm = process.argv.includes("--confirm");

(async () => {
  try {
    const snap = await db.collection("reservations").get();
    const docsToUpdate = [];

    snap.forEach((doc) => {
      const data = doc.data();
      if (!data.resourceId) {
        docsToUpdate.push(doc);
      }
    });

    console.log(`총 ${snap.size}개의 예약 문서 중 마이그레이션 대상: ${docsToUpdate.length}건`);

    if (!isConfirm) {
      console.log("현재 DRY-RUN 모드입니다. 실제로 업데이트하려면 '--confirm' 플래그를 추가하세요.");
      docsToUpdate.forEach(d => console.log(` - 대상 예약 ID: ${d.id}`));
      process.exit(0);
    }

    if (docsToUpdate.length === 0) {
      console.log("업데이트할 예약이 없습니다.");
      process.exit(0);
    }

    console.log("실제 마이그레이션을 시작합니다...");
    
    // Firestore batch has a limit of 500 operations
    let batch = db.batch();
    let count = 0;

    for (const doc of docsToUpdate) {
      batch.update(doc.ref, { resourceId: "meeting-room" });
      count++;
      
      if (count % 400 === 0) {
        await batch.commit();
        batch = db.batch();
        console.log(`${count}건 완료...`);
      }
    }
    
    if (count % 400 !== 0) {
      await batch.commit();
    }

    console.log(`총 ${count}건 마이그레이션 완료.`);
    process.exit(0);
  } catch (err) {
    console.error("에러 발생:", err);
    process.exit(1);
  }
})();
