import { db, auth } from '../src/firebase.js';
import { signInAnonymously } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

const isApply = process.argv.includes('--apply');

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
      requiredCerts: [],
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
      requiredCerts: [],
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
        "출력 완료 후 부산물 제거 및 베드 청소는 필수입니다."
      ]
    }
  }
];

async function main() {
  console.log('====================================================');
  console.log('  5단계: 3D 프린터(뱀부랩 1·2) 정책 문서 시딩 스크립트  ');
  console.log('====================================================');
  console.log(`모드: ${isApply ? '🔴 APPLY MODE (실제 Firestore 반영)' : '🟡 DRY-RUN MODE (--apply 플래그 미입력 시 미리보기)'}`);
  console.log('⚠️ 주의: 절대 규칙 0번에 따라 예약(reservations), 사용 기록(sessions)은 0건 상태를 유지하며 어떤 문서도 생성하지 않습니다.');
  console.log('----------------------------------------------------\n');

  if (isApply) {
    try {
      console.log('  => [인증] Firestore 접근 규칙(request.auth != null) 통과를 위해 익명 로그인(signInAnonymously)을 수행합니다...');
      await signInAnonymously(auth);
      console.log('  => [인증 성공] 이제 Firestore 문서 시딩을 시작합니다.\n');
    } catch (authErr) {
      console.error('❌ 익명 로그인 실패 (스크립트 중단):', authErr.message || authErr);
      process.exit(1);
    }
  }

  for (const p of PRINTERS) {
    const docPath = `resources/${p.id}`;
    console.log(`[대상 문서] ${docPath}`);
    console.log('  - name:', p.name);
    console.log('  - type:', p.type);
    console.log('  - order:', p.order);
    console.log('  - policy.openHours:', JSON.stringify(p.policy.openHours));
    console.log('  - policy.requiredCerts:', JSON.stringify(p.policy.requiredCerts));
    console.log('  - policy.requiresReport:', p.policy.requiresReport);
    console.log('  - policy.notice.length:', p.policy.notice.length, '항목');

    if (isApply) {
      try {
        const ref = doc(db, 'resources', p.id);
        await setDoc(ref, p, { merge: true });
        console.log(`  => ✅ Firestore [${docPath}] 문서가 반영되었습니다.\n`);
      } catch (err) {
        console.error(`❌ [${docPath}] 시딩 실패:`, err.message || err);
        console.error('⚠️ 오류가 발생하여 재시도하지 않고 즉시 스크립트를 중단합니다.');
        process.exit(1);
      }
    } else {
      console.log(`  => 🟡 (dry-run) 실제 DB에 반영되지 않았습니다. 반영하려면 --apply 옵션을 사용하세요.\n`);
    }
  }

  console.log('====================================================');
  console.log('  작업 완료!  ');
  console.log('====================================================');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ 시딩 중 오류 발생:', err.message || err);
  process.exit(1);
});
