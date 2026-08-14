import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";

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
    const meetingRoomRef = db.collection("resources").doc("meeting-room");
    await meetingRoomRef.set({
      name: "회의실",
      type: "space",
      order: 1,
      active: true,
      policy: {
        requiresReservation: true,
        requiresApproval: false,
        requiredCerts: [],
        capacity: 1,
        allowOverlap: false,
        requiresReport: false,
        slotMinutes: 30,
        openHours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "22:00" },
        autoCancelMinutes: null,
        remindBeforeMinutes: null,
        allowUrgentOverride: true,
        notice: []
      }
    });
    console.log("resources/meeting-room 문서가 성공적으로 생성되었습니다.");
    process.exit(0);
  } catch (err) {
    console.error("에러 발생:", err);
    process.exit(1);
  }
})();
