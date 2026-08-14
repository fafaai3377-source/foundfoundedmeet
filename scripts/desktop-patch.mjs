/**
 * 웹 소스(개인 계정 최신본)에 데스크톱 앱용 최소 패치를 적용한다.
 * 같은 파일에 두 번 돌려도 안전하도록(idempotent) 이미 적용된 항목은 건너뛴다.
 *
 *   node scripts/desktop-patch.mjs
 */
import fs from 'node:fs';

let changed = 0;
let skipped = 0;

function patch(file, label, from, to) {
  const s = fs.readFileSync(file, 'utf8');
  if (s.includes(to)) {
    console.log(`  · ${label} — 이미 적용됨`);
    skipped++;
    return;
  }
  if (!s.includes(from)) {
    console.error(`  ✗ ${label} — 원본 패턴을 찾지 못했습니다. 웹 코드가 바뀐 것 같습니다.`);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(file, s.replace(from, to), 'utf8');
  console.log(`  ✓ ${label}`);
  changed++;
}

const APP = 'src/App.jsx';
const NOTIFY = 'api/notify.js';

console.log('\n[1/2] src/App.jsx');

// (1) 런타임 환경변수 헬퍼 import
patch(APP, 'runtimeEnv import',
  'import { db, auth, isFirebaseConfigured } from "./firebase";',
  'import { db, auth, isFirebaseConfigured } from "./firebase";\nimport { env } from "./runtimeEnv";');

// (2) 비밀번호 조회를 런타임 오버라이드 가능하게
patch(APP, '관리자 비밀번호 조회',
  'pw !== import.meta.env.VITE_ADMIN_PASSWORD',
  'pw !== env("VITE_ADMIN_PASSWORD")');

patch(APP, '멤버 비밀번호 조회',
  'pw !== import.meta.env.VITE_MEMBER_PASSWORD',
  'pw !== env("VITE_MEMBER_PASSWORD")');

// (3) 로그인 모달 — "로그인 정보 저장" 체크박스
patch(APP, '로그인 모달 remember 상태',
  'const [name, setName] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState("");',
  'const [name, setName] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState("");\n  const [remember, setRemember] = useState(() => { try { return localStorage.getItem("remember_login") !== "0"; } catch { return true; } });');

patch(APP, 'admin 로그인에 remember 전달',
  'return onLogin("admin");',
  'return onLogin("admin", remember);');

patch(APP, 'guest 로그인에 remember 전달',
  'return onLogin("Guest");',
  'return onLogin("Guest", remember);');

patch(APP, '멤버 로그인에 remember 전달',
  'onLogin(trimmedName); \n  };',
  'onLogin(trimmedName, remember); \n  };');

patch(APP, '체크박스 UI',
  '        {err && <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold" style={{ color: PASTEL.red.text }}><AlertCircle size={13} />{err}</div>}',
  `        {err && <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold" style={{ color: PASTEL.red.text }}><AlertCircle size={13} />{err}</div>}
        <label className="mt-3.5 flex w-fit cursor-pointer select-none items-center gap-2 text-[13px]" style={{ color: C.muted }}>
          <input type="checkbox" className="sr-only" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span className="grid h-[18px] w-[18px] place-items-center rounded-[5px] border" style={{ borderColor: remember ? C.ink : C.border, background: remember ? C.ink : "transparent" }}>
            {remember && <Check size={12} strokeWidth={3} style={{ color: "var(--bg)" }} />}
          </span>
          로그인 정보 저장
        </label>`);

// (4) doLogin — remember 여부에 따라 토큰 저장
patch(APP, 'doLogin remember 처리',
  'function doLogin(name) { \n' +
  '    setReservations((p) => p.map((r) => (r.owner === "나" ? { ...r, owner: name } : r))); \n' +
  '    setUser(name); \n' +
  '    localStorage.setItem("last_user", name);\n' +
  '    const token = { name: name, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 };\n' +
  '    localStorage.setItem("auth_token", btoa(unescape(encodeURIComponent(JSON.stringify(token)))));',
  'function doLogin(name, remember = true) {\n' +
  '    setReservations((p) => p.map((r) => (r.owner === "나" ? { ...r, owner: name } : r)));\n' +
  '    setUser(name);\n' +
  '    try { localStorage.setItem("remember_login", remember ? "1" : "0"); } catch { /* noop */ }\n' +
  '    if (remember) {\n' +
  '      localStorage.setItem("last_user", name);\n' +
  '      const token = { name: name, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 };\n' +
  '      localStorage.setItem("auth_token", btoa(unescape(encodeURIComponent(JSON.stringify(token)))));\n' +
  '    } else {\n' +
  '      localStorage.removeItem("last_user");\n' +
  '      localStorage.removeItem("auth_token");\n' +
  '    }');

console.log('\n[2/2] api/notify.js  (푸시 알림이 한 건도 안 나가던 버그)');

// (5) TTL 중복 지정 제거 — web-push 가 "Duplicated headers defined [TTL]" 로 전송을 거부하던 문제
patch(NOTIFY, 'TTL 중복 제거 + 동기 예외 방어',
  `      return webpush.sendNotification(sub, payload, {
        headers: {
          'Urgency': 'high',
          'TTL': '86400'
        },
        urgency: 'high',
        TTL: 86400
      }).catch(err => {
        console.error('Web push error:', err);
      });`,
  `      // TTL 을 headers 와 최상위 옵션에 동시에 주면 web-push 가
      // "Duplicated headers defined [TTL]" 로 전송 자체를 거부한다. 한 곳에만 둔다.
      try {
        return webpush.sendNotification(sub, payload, {
          TTL: 86400,
          urgency: 'high'
        }).catch(err => {
          console.error('Web push error:', err.statusCode, err.body || err.message);
          if (err.statusCode === 410 || err.statusCode === 404) deadEndpoints.push(sub.endpoint);
        });
      } catch (err) {
        // 잘못된 구독 객체는 동기 예외를 던져 함수 전체를 500 으로 만든다. 여기서 막는다.
        console.error('Web push threw synchronously:', err.message);
        return Promise.resolve();
      }`);

patch(NOTIFY, '만료 구독 집계 변수',
  '    const webPushPromises = uniqueWebTokens.map(sub => {',
  '    const deadEndpoints = [];\n    const webPushPromises = uniqueWebTokens.map(sub => {');

patch(NOTIFY, '응답에 실제 발송 수 표기',
  'res.status(200).json({ success: true, sentWeb: webTokens.length,',
  'res.status(200).json({ success: true, sentWeb: uniqueWebTokens.length, dead: deadEndpoints.length,');

console.log('\n[3/3] package.json  (웹 설정은 유지하고 데스크톱 항목만 병합)');

{
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const before = JSON.stringify(pkg);

  pkg.main = 'electron/main.cjs';
  pkg.description ||= 'foundfounded 회의실 예약 시스템';
  pkg.author ||= 'foundfounded';
  pkg.repository = {
    type: 'git',
    url: 'https://github.com/fafaai3377-source/foundfoundedmeet.git',
  };
  if (!pkg.version || pkg.version === '0.0.0') pkg.version = '1.0.0';

  Object.assign(pkg.scripts, {
    'electron:dev': 'npm run build && electron .',
    'dist:win': 'npm run build && electron-builder --win --config electron-builder.yml',
    'dist:mac': 'npm run build && electron-builder --mac --config electron-builder.yml',
    'dist:linux': 'npm run build && electron-builder --linux --config electron-builder.yml',
  });

  pkg.devDependencies ||= {};
  pkg.devDependencies.electron ||= '^43.4.0';
  pkg.devDependencies['electron-builder'] ||= '^26.15.3';

  if (JSON.stringify(pkg) === before) {
    console.log('  · 이미 적용됨');
    skipped++;
  } else {
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`  ✓ main / repository / 빌드 스크립트 / electron 의존성  (version ${pkg.version})`);
    changed++;
  }
}

if (!fs.readFileSync('.gitignore', 'utf8').includes('release/')) {
  fs.appendFileSync('.gitignore', '\n# Electron build output\nrelease/\n');
  console.log('  ✓ .gitignore 에 release/ 추가');
  changed++;
}

console.log(`\n적용 ${changed}건 / 건너뜀 ${skipped}건`);
if (process.exitCode === 1) console.error('일부 패치가 실패했습니다. 위 로그를 확인하세요.');
