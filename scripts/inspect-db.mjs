import { db, auth } from '../src/firebase.js';
import { signInAnonymously } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';

async function inspectDB() {
  console.log('====================================================');
  console.log('  FIRESTORE 읽기 전용 검사 (INSPECT-DB)  ');
  console.log('  프로젝트 ID: promptshot-d0190');
  console.log('  주의: 쓰기 API 0줄 (순수 읽기 전용 getDocs만 실행)');
  console.log('====================================================\n');

  try {
    console.log('[1] 익명 로그인(signInAnonymously)으로 읽기 권한 인증 중...');
    await signInAnonymously(auth);
    console.log('[1-완료] 인증 성공.\n');
  } catch (err) {
    console.error('❌ 인증 실패:', err.message || err);
    process.exit(1);
  }

  // 1. resources 컬렉션 전체 문서 JSON 출력
  console.log('----------------------------------------------------');
  console.log('[1] resources 컬렉션 전체 문서 JSON 출력');
  console.log('----------------------------------------------------');
  const resSnap = await getDocs(collection(db, 'resources'));
  console.log(`총 ${resSnap.size}개 문서 발견:\n`);
  resSnap.forEach((docSnap) => {
    console.log(`[문서 ID: ${docSnap.id}]`);
    console.log(JSON.stringify(docSnap.data(), null, 2));
    console.log('');
  });

  // 2. reservations 컬렉션 조회 및 분석
  console.log('----------------------------------------------------');
  console.log('[2] reservations 컬렉션 조회 및 분석');
  console.log('----------------------------------------------------');
  const revSnap = await getDocs(collection(db, 'reservations'));
  const allReservations = [];
  let withRoomIdCount = 0;
  let withoutRoomIdCount = 0;
  const roomIdCounts = {};

  revSnap.forEach((docSnap) => {
    const data = docSnap.data();
    const docObj = { id: docSnap.id, ...data };
    allReservations.push(docObj);

    if (data.roomId !== undefined && data.roomId !== null && data.roomId !== '') {
      withRoomIdCount++;
      const rId = String(data.roomId);
      roomIdCounts[rId] = (roomIdCounts[rId] || 0) + 1;
    } else {
      withoutRoomIdCount++;
      roomIdCounts['(없음/undefined)'] = (roomIdCounts['(없음/undefined)'] || 0) + 1;
    }
  });

  console.log(`2. reservations 컬렉션 총 문서 개수: ${revSnap.size}건`);
  console.log(`3. roomId 필드가 있는 문서: ${withRoomIdCount}건 / 없는 문서: ${withoutRoomIdCount}건`);
  console.log('4. roomId 값별 개수 집계:');
  for (const [k, v] of Object.entries(roomIdCounts)) {
    console.log(`   - ${k}: ${v}건`);
  }
  console.log('');

  // 5. 무작위 5건 샘플 전체 JSON 출력
  console.log('----------------------------------------------------');
  console.log('[5] reservations 문서 5건 무작위 샘플 JSON 전체 출력');
  console.log('----------------------------------------------------');
  const sampleCount = Math.min(5, allReservations.length);
  const shuffled = [...allReservations].sort(() => 0.5 - Math.random());
  const samples = shuffled.slice(0, sampleCount);

  samples.forEach((sample, idx) => {
    console.log(`--- [샘플 #${idx + 1} | 문서 ID: ${sample.id}] ---`);
    console.log(JSON.stringify(sample, null, 2));
    console.log('');
  });

  console.log('====================================================');
  console.log('  INSPECT-DB 완료 (변경 사항 0건)');
  console.log('====================================================');
  process.exit(0);
}

inspectDB().catch((err) => {
  console.error('❌ DB 조회 중 오류:', err.message || err);
  process.exit(1);
});
