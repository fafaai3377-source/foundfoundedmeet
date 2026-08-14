import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const KEY_PATH = "c:/Users/User/Desktop/ffm-backup/serviceAccountKey.json";
if (!fs.existsSync(KEY_PATH)) {
  console.error(`키 파일을 찾을 수 없습니다: ${KEY_PATH}`);
  process.exit(1);
}
const serviceAccount = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function run() {
  const isDryRun = process.argv.includes('--dry-run');
  console.log(`Starting seed script... ${isDryRun ? '(DRY RUN)' : ''}`);

  const workroomData = {
    name: "워크룸",
    type: "space",
    order: 2,
    active: true,
    policy: {
      requiresReservation: true,
      requiresApproval: false,
      requiredCerts: [],
      capacity: 3,
      allowOverlap: true,
      requiresReport: false,
      slotMinutes: 30,
      openHours: { days: [1, 2, 3, 4, 5], from: '09:00', to: '22:00' },
      autoCancelMinutes: 10,
      remindBeforeMinutes: 5,
      allowUrgentOverride: false,
      notice: [
        '책상 위 정리하고 의자 제자리에',
        '쓰레기는 가지고 나가기 (특히 음식물)',
        '개인 물건 두고 가지 않기',
        '다 쓰면 사용 종료를 눌러 자리 비워주기'
      ]
    }
  };

  try {
    if (isDryRun) {
      console.log('Would write the following document to resources/workroom:');
      console.dir(workroomData, { depth: null });
    } else {
      await db.collection('resources').doc('workroom').set(workroomData);
      console.log('Successfully seeded resources/workroom');
    }
  } catch (error) {
    console.error('Error seeding data:', error);
  }
}

run();
