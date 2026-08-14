import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyB-4Eu769Zen7p__ZTrepFDuZfTvyIMYww",
  projectId: "promptshot-d0190",
  authDomain: "promptshot-d0190.firebaseapp.com"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const PRINTERS = [
  {
    id: 'bambu-1',
    name: '968 (LEFT)',
    type: 'equipment',
    order: 3,
    active: true,
    policy: {
      requiresReservation: true,
      requiresApproval: false,
      requiredCerts: ['3dp-safety'],
      capacity: 1,
      allowOverlap: false,
      requiresReport: true,
      slotMinutes: 30,
      openHours: { days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '24:00' },
      autoCancelMinutes: null,
      remindBeforeMinutes: null,
      allowUrgentOverride: false,
      notice: [
        "출력 전 베드 안착 및 노즐 상태를 꼭 확인해 주세요.",
        "출력 완료 후 부산물 제거 및 베드 청소는 필수입니다.",
        "3D 프린터 안전 교육 이수자만 예약 및 사용할 수 있습니다."
      ]
    }
  },
  {
    id: 'bambu-2',
    name: '990 (RIGHT)',
    type: 'equipment',
    order: 4,
    active: true,
    policy: {
      requiresReservation: true,
      requiresApproval: false,
      requiredCerts: ['3dp-safety'],
      capacity: 1,
      allowOverlap: false,
      requiresReport: true,
      slotMinutes: 30,
      openHours: { days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '24:00' },
      autoCancelMinutes: null,
      remindBeforeMinutes: null,
      allowUrgentOverride: false,
      notice: [
        "출력 전 베드 안착 및 노즐 상태를 꼭 확인해 주세요.",
        "출력 완료 후 부산물 제거 및 베드 청소는 필수입니다.",
        "3D 프린터 안전 교육 이수자만 예약 및 사용할 수 있습니다."
      ]
    }
  }
];

async function seedPrinters() {
  const isApply = process.argv.includes('--apply');
  console.log(`=== 3D 프린터(뱀부랩 1·2) 자원 정책 시드 스크립트 (${isApply ? 'APPLY MODE' : 'DRY-RUN MODE'}) ===\n`);

  if (!isApply) {
    console.log("[DRY-RUN] 아래 2개 정책 문서가 resources 컬렉션에 추가됩니다:\n");
    PRINTERS.forEach(p => {
      console.log(`Document ID: resources/${p.id}`);
      console.log(JSON.stringify(p, null, 2));
      console.log("--------------------------------------------------\n");
    });
    console.log("※ 절대 규칙 0번 준수: 예약(reservations) 및 세션(sessions) 문서는 일절 생성하지 않고 0건으로 유지합니다.");
    console.log("※ 실제 DB에 반영하려면 `node scripts/seed-printers.mjs --apply`를 실행하세요.\n");
    process.exit(0);
  }

  console.log("Firebase Auth 익명 로그인 진행 중...");
  await signInAnonymously(auth);
  console.log("인증 성공. Firestore에 자원 정책 문서를 기록합니다...\n");

  for (const printer of PRINTERS) {
    const docRef = doc(db, "resources", printer.id);
    await setDoc(docRef, printer, { merge: true });
    console.log(`[Success] resources/${printer.id} ('${printer.name}') 정책 문서 저장 완료!`);
  }

  console.log("\n✅ 뱀부랩 1, 2 자원 시딩이 성공적으로 완료되었습니다! (예약 및 세션 데이터: 0건)");
  process.exit(0);
}

seedPrinters().catch(err => {
  console.error("오류 발생:", err);
  process.exit(1);
});
