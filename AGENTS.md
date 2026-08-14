# foundfoundedmeet — 에이전트 작업 규칙

## 이 앱이 무엇인가
사내 자원 예약 PWA. 원래는 회의실 예약 전용이었고, 지금은
회의실 / 워크룸 / 3D 프린터(뱀부랩 1·2) 를 다루는 구조로 확장하는 중입니다.

## 스택
React + Vite + Tailwind v4 + Firebase(Firestore, Auth) / Vercel 배포 / 데스크톱 웹 + PWA

## 절대 규칙
0. **기존 회의실 예약은 한 건도 없어지면 안 됩니다. 워크룸·프린터는 빈 상태로 시작합니다.**
   - 회의실 예약 문서는 **삭제·초기화하지 않습니다.** 1단계는 기존 문서에 `resourceId` 필드만
     채우는 마이그레이션입니다. 예약 내용·시간·참석자는 그대로 둡니다.
   - 워크룸과 프린터는 **아무도 아직 안 썼으므로 예약이 0건이어야 합니다.**
     시드 스크립트로 넣는 것은 `resources/{id}` **정책 문서 1개뿐**입니다.
     예약(reservations)·세션(sessions) 문서는 만들지 마세요.
   - ⚠️ `02_프로토타입.html` 에는 **데모용 가짜 예약**이 들어 있습니다
     (경선님·여준님 워크룸 사용 중, 태영님 뱀부랩 출력 중 등). 이건 화면이 어떻게
     보이는지 보여주려고 넣은 **샘플**입니다. **이 예약들을 DB에 시드하지 마세요.**
     시안에서 가져올 것은 레이아웃·색·컴포넌트 구조뿐이고, 데이터는 빈 상태에서 출발합니다.
   - 첫 배포 직후 정상 상태: 회의실에는 기존 예약이 그대로, 워크룸·프린터는
     "지금 아무도 없음 / 정원 N명" 빈 카드.
1. **자원별로 코드를 복사하지 않습니다.** 자원의 차이는 코드가 아니라
   Firestore `resources/{id}.policy` 필드로 표현합니다.
   새 장비가 생기면 문서 한 개 추가로 끝나야 합니다.
   `if (resourceId === 'workroom')` 같은 분기가 보이면 잘못 가고 있는 겁니다.
2. **시각은 항상 서버 타임스탬프**(`serverTimestamp()`)를 씁니다.
   클라이언트 `new Date()` 를 DB에 저장하지 않습니다.
3. **기록은 지우지 않습니다.** 수정이 필요하면 수정 이력을 남깁니다.
4. **사람 이름 · 호칭 · 소속 표기는 기존 코드 규칙을 그대로 따릅니다.**
   새 규칙을 만들거나 임의의 팀 이름을 지어내지 마세요.
   - 멤버 목록은 **기존 데이터 소스 하나**에서만 가져옵니다. 화면마다 배열을 따로 만들지 않습니다.
   - 호칭(`님` 붙이는지), 그룹 이름(디렉터 / 임직원), 직함 문구(디렉터, 시니어 디자이너,
     디자이너, 프리랜서 디자이너, 인턴), 배지(ID / VD) — 전부 지금 코드에 있는 값을 씁니다.
   - 어디서는 `님`을 붙이고 어디서는 안 붙이는 차이가 있다면, 그것도 **현재 화면 그대로** 유지합니다.
     (예: 참석자 칩은 이름만, 참석자 선택 창은 `이름 + 님`)
   - "기획팀", "개발팀" 같은 조직 단위가 코드에 없다면 만들지 마세요. 직함으로 표시합니다.
   - 새 필드가 필요하면 먼저 물어보고, 임의로 스키마를 늘리지 않습니다.
5. **화면 구조를 바꾸지 않습니다.** 상단 내비, 서브바(타임라인/캘린더 전환),
   날짜 스트립, 자원 알약, 상태 카드, 타임라인, 하단 검은 버튼 —
   이 배치는 고정입니다. 새 자원은 이 뼈대에 **내용만 갈아 끼웁니다.**
6. **디자인 토큰을 새로 만들지 않습니다.** 색은 전부 기존 CSS 변수에서 가져옵니다.
   - 상태 카드: 사용 가능 `--mob-free-bg`, 사용 중/만석 `--mob-busy-bg`
   - 타임라인 카드: `--mob-card-normal` + 좌측선 `--mob-line-normal`
     (특이 상태는 `--mob-card-urgent` / `--mob-line-urgent`)
   - 텍스트·경계: `--text` `--muted` `--faint` `--border` `--line`
   - 히트맵(통계): `--heat-0` ~ `--heat-4`
   하드코딩 hex, Tailwind 기본 팔레트(`bg-blue-500`, `text-green-600` 등) 금지.
   다크모드는 `.dark` 클래스 기준으로 이미 동작합니다.
7. 서체는 Pretendard Variable. 새 폰트를 추가하지 않습니다.

## 데이터 모델
```
resources/{resourceId}
  name, type: 'space' | 'equipment', order: number, active: bool
  policy: {
    requiresReservation: bool   // 워크룸 false
    requiresApproval: bool
    requiredCerts: string[]     // 회의실 [], 뱀부랩 ['3dp-safety']
    capacity: number            // 회의실 1, 워크룸 4, 프린터 1
    allowOverlap: bool          // 워크룸만 true (capacity 까지)
    requiresReport: bool        // 프린터만 true
    slotMinutes: 30
    openHours: { days: number[], from: '09:00', to: '22:00' }  // 프린터는 24시간·주말
    autoCancelMinutes: number | null   // 워크룸 10, 나머지 null
    remindBeforeMinutes: number | null // 워크룸 5
    allowUrgentOverride: bool          // 회의실만 true
    notice: string[]                   // 주의사항 문구, 회의실은 []
  }

reservations/{resourceId}_{yyyyMMdd}_{slotIndex}   ← 결정적 ID (중요)
  resourceId, userId, date, slotIndex, start, end,
  status: 'booked' | 'cancelled' | 'done', title?, attendees?, createdAt

sessions/{autoId}                                  ← 실제 사용 기록
  resourceId, userId, reservationId?,
  checkInAt, checkOutAt, autoClosed: bool,
  source: 'button' | 'qr' | 'admin',
  report?: { result: 'success'|'partial'|'fail', filamentG?: number, note?: string }
  edits?: [{ by, at, field, before, after }]

users/{uid}
  name, dept, role: 'member' | 'admin', certs: string[]
```

## 작업 방식
- 요청을 받으면 **먼저 계획을 보여주고 승인을 기다립니다.** 승인 전에 파일을 쓰지 않습니다.
- 한 번에 한 단계만. 시키지 않은 리팩터링을 끼워 넣지 않습니다.
- 데이터 마이그레이션 스크립트는 항상 dry-run 모드를 기본으로 만듭니다.
- 작업이 끝나면 **무엇을 어떻게 확인하면 되는지** 검증 절차를 알려줍니다.
