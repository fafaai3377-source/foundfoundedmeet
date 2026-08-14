# foundfoundedmeet 데스크톱 앱

웹 버전(`https://foundfoundedmeet.vercel.app`)의 **모든 기능을 그대로 유지**하면서
Windows / macOS 에 설치해서 쓸 수 있게 만든 Electron 앱입니다.

---

## 1. 설치하기 (Windows)

1. `foundfoundedmeet-Setup-1.0.0.exe` 를 실행합니다.
2. "Windows의 PC 보호" 파란 창이 뜨면 → **추가 정보** → **실행** 을 누릅니다.
   (코드 서명 인증서가 없어서 뜨는 안내로, 처음 한 번만 나옵니다.)
3. 설치 경로를 고른 뒤 설치하면 바탕화면과 시작 메뉴에 아이콘이 생깁니다.

> 설치 없이 쓰고 싶으면 `foundfoundedmeet-Portable-1.0.0.exe` 를 그냥 실행하세요.
> USB 에 넣어 다녀도 됩니다.

### 첫 실행 — 비밀번호 설정

처음 실행하면 **로그인 비밀번호 설정** 창이 뜹니다.
웹에서 쓰던 멤버/관리자 비밀번호를 그대로 넣고 저장하면 끝입니다.

- 나중에 바꾸려면 메뉴 **파일 → 로그인 비밀번호 설정…** (`Ctrl+,`)
- 저장 위치: `%APPDATA%\foundfoundedmeet\env.json` (이 PC에만 저장됩니다)

---

## 2. 앱 업데이트하는 방법

### 사용자 입장

앱을 켜면 자동으로 새 버전이 있는지 확인하고, 있으면 안내 창을 띄웁니다.
**[지금 받기]** 를 누르면 새 설치 파일이 다운로드되고, 실행하면 기존 앱 위에 덮어씌워집니다.
(설정과 로그인 비밀번호는 그대로 유지됩니다.)

수동 확인은 메뉴 **도움말 → 업데이트 확인…**

### 배포하는 입장 (코드를 고쳤을 때)

**방법 A — 자동 (추천)**

```bash
# 1. package.json 의 version 을 올린다  (1.0.0 → 1.0.1)
# 2. 태그를 만들어 푸시
git add -A && git commit -m "v1.0.1"
git tag v1.0.1
git push origin main --tags
```

`.github/workflows/release.yml` 이 GitHub Actions 에서 Windows·macOS 설치 파일을
자동으로 빌드해 **Releases** 에 올려줍니다. 팀원들 앱은 다음 실행 때 알아서 안내가 뜹니다.

**방법 B — 수동**

```bash
npm install
npm run dist:win     # release/ 폴더에 설치 파일 생성
```

만들어진 `release/foundfoundedmeet-Setup-x.y.z.exe` 를
GitHub → Releases → New release 에서 태그 `vx.y.z` 로 올리면 됩니다.

> ⚠️ 업데이트 안내가 뜨려면 **릴리스 태그가 `v` + package.json 의 version** 과 같아야 합니다.

### 화면/기능만 고쳤는데 재설치가 싫다면?

`src/` 아래 화면 코드는 앱 안에 내장되어 있어서 재빌드가 필요합니다.
다만 **회의실 목록, 멤버 명단(`src/constants.js`)** 같은 것도 내장이므로 마찬가지입니다.
자주 바뀌는 값이라면 Firestore 로 옮겨두는 걸 추천드려요 — 그러면 앱 재설치 없이 반영됩니다.

---

## 3. 구조 (어떻게 동작하는가)

```
Electron 메인 프로세스 (electron/main.cjs)
  ├─ 내부 HTTP 서버  127.0.0.1:랜덤포트
  │    ├─ /            → 앱에 내장된 dist/ 를 서빙
  │    └─ /api/*       → https://foundfoundedmeet.vercel.app/api/* 로 프록시
  └─ BrowserWindow  →  http://127.0.0.1:랜덤포트 로드
```

**왜 `file://` 이 아니라 로컬 서버인가?**

`file://` 로 띄우면 브라우저가 "안전하지 않은 컨텍스트"로 취급해서
Service Worker · 알림(Notification) · IndexedDB · Firebase 인증이 전부 막힙니다.
`127.0.0.1` 은 secure context 로 인정되기 때문에 **웹과 100% 동일하게** 동작합니다.

**왜 `/api` 프록시인가?**

`src/App.jsx` 의 `fetch('/api/notify')` 를 한 글자도 고치지 않고 살리기 위해서입니다.
푸시 알림 발송, 세션 자동 종료 등 서버 기능이 웹과 똑같이 동작합니다.

### 원래 코드에서 바뀐 것 (최소 변경)

| 파일 | 변경 내용 |
|---|---|
| `src/App.jsx` | `import.meta.env.VITE_*_PASSWORD` → `env("VITE_*_PASSWORD")` 2줄 |
| `src/runtimeEnv.js` | **신규.** 빌드 시점 env + 런타임 주입 env 를 함께 읽음 |
| `package.json` | `main`, `version`, 빌드 스크립트 추가 |
| `electron/` | **신규.** 데스크톱 셸 |
| `electron-builder.yml` | **신규.** 설치 파일 빌드 설정 |
| `.github/workflows/release.yml` | **신규.** 자동 빌드·배포 |

웹(Vercel) 배포는 아무 영향 없이 그대로 동작합니다.

---

## 4. 알아두면 좋은 점

- **인터넷 필요**: Firestore 기반이라 오프라인에서는 데이터가 안 보입니다. (웹과 동일)
- **알림**: 앱이 켜져 있는 동안의 실시간 알림은 Windows 알림 센터로 그대로 뜹니다.
  앱이 꺼진 상태의 백그라운드 푸시는 모바일/웹(PWA)에서 받는 게 확실합니다.
- **자동 시작**: 부팅 시 자동 실행이 필요하면 말씀해주세요. 한 줄로 추가됩니다.
- **트레이 상주**: 창을 닫아도 트레이에 남게 하는 것도 가능합니다.

## 5. macOS / 모바일

- **macOS**: `npm run dist:mac` → `release/*.dmg` (Apple Silicon + Intel).
  macOS 러너가 필요해서 GitHub Actions 로 빌드하는 게 가장 쉽습니다.
- **iOS / Android**: 지금도 브라우저에서 **홈 화면에 추가**(PWA)로 앱처럼 쓸 수 있습니다.
  App Store / Play 스토어 정식 배포가 필요하면 Capacitor 로 감싸면 됩니다.
