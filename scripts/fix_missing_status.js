import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// --dry-run 기본
const isApply = process.argv.includes('--apply');

// 이 스크립트를 실행하기 위해서는 Firebase Admin SDK 서비스 계정 키가 필요합니다.
// 예: export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
// 환경변수가 없으면 에러가 납니다.

try {
  initializeApp(); // Uses GOOGLE_APPLICATION_CREDENTIALS
} catch (error) {
  console.error("Firebase Admin 초기화 실패. GOOGLE_APPLICATION_CREDENTIALS 환경 변수가 설정되어 있는지 확인하세요.");
  process.exit(1);
}

const db = getFirestore();

async function run() {
  console.log(`[시작] status 필드가 없는 예약 문서 스캔 중... (모드: ${isApply ? 'APPLY' : 'DRY-RUN'})`);
  
  const snapshot = await db.collection('reservations').get();
  const targetDocs = [];
  
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.status === undefined) {
      targetDocs.push(doc);
    }
  });
  
  console.log(`\n총 ${snapshot.size}개의 문서 중, status 필드가 없는 문서는 ${targetDocs.length}건 입니다.`);
  
  if (targetDocs.length === 0) {
    console.log('수정할 문서가 없습니다. 스크립트를 종료합니다.');
    return;
  }
  
  console.log('\n--- 대상 문서 목록 (최대 10건만 출력) ---');
  targetDocs.slice(0, 10).forEach(doc => {
    const d = doc.data();
    console.log(`- ID: ${doc.id} | 예약자: ${d.owner} | 날짜: ${d.date} ${d.start}~${d.end}`);
  });
  if (targetDocs.length > 10) console.log(`...외 ${targetDocs.length - 10}건`);
  
  if (!isApply) {
    console.log('\n[안내] 현재 --dry-run 모드입니다. 위 문서들을 수정하려면 --apply 플래그를 붙여 다시 실행하세요.');
    console.log('명령어: node scripts/fix_missing_status.js --apply');
    return;
  }
  
  console.log('\n[진행] --apply 모드: 데이터 수정을 시작합니다...');
  
  const batchSize = 500;
  let batch = db.batch();
  let count = 0;
  let batchCount = 0;
  
  for (const doc of targetDocs) {
    batch.update(doc.ref, { status: 'booked' });
    count++;
    
    if (count % batchSize === 0) {
      await batch.commit();
      batchCount++;
      console.log(`... ${batchCount * batchSize}건 처리 완료`);
      batch = db.batch();
    }
  }
  
  if (count % batchSize !== 0) {
    await batch.commit();
  }
  
  console.log(`\n[완료] 총 ${count}건의 문서에 status: 'booked' 업데이트를 성공적으로 완료했습니다!`);
}

run().catch(console.error);
