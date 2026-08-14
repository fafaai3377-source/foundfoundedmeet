/**
 * 가벼운 업데이트 확인기 (추가 의존성 없음)
 *
 * 동작
 *  1. GitHub Releases 의 최신 릴리스 태그(v1.2.3)를 읽는다.
 *  2. 현재 앱 버전과 비교해 더 높으면 안내 창을 띄운다.
 *  3. [지금 받기] 를 누르면 설치 파일 다운로드 페이지를 기본 브라우저로 연다.
 *     NSIS 설치 프로그램은 기존 버전 위에 그대로 덮어써서 설치된다.
 *
 * 새 버전 배포 방법
 *  1) package.json 의 version 을 올린다 (예: 1.0.0 → 1.0.1)
 *  2) npm run dist:win
 *  3) GitHub 저장소 → Releases → New release → 태그를 v1.0.1 로 만들고
 *     release/foundfoundedmeet-Setup-1.0.1.exe 파일을 첨부해 게시
 *  → 사용자들의 앱이 다음 실행 때 자동으로 새 버전을 안내한다.
 */

const { app, dialog, shell, Notification } = require('electron');
const https = require('node:https');

// 저장소 위치는 package.json 의 "repository" 를 따라간다.
// (저장소를 옮기면 package.json 만 고치면 됨)
function resolveRepo() {
  if (process.env.FFM_REPO) return process.env.FFM_REPO;
  try {
    const pkg = require('../package.json');
    const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    const m = String(url || '').match(/github\.com[:/]([^/]+\/[^/.]+)/i);
    if (m) return m[1];
  } catch {
    /* noop */
  }
  return 'fafaai3377-source/foundfoundedmeet';
}

const REPO = resolveRepo();
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6시간

function parseVersion(v) {
  return String(v || '')
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n));
}

function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function fetchLatest() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      API,
      {
        headers: {
          'User-Agent': `foundfoundedmeet/${app.getVersion()}`,
          Accept: 'application/vnd.github+json',
        },
        timeout: 10000,
      },
      (res) => {
        if (res.statusCode === 404) return reject(new Error('아직 게시된 릴리스가 없습니다.'));
        if (res.statusCode !== 200) return reject(new Error(`GitHub 응답 오류 (${res.statusCode})`));
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('요청 시간 초과')));
    req.on('error', reject);
  });
}

function pickInstallerAsset(release) {
  const assets = release.assets || [];
  const wanted =
    process.platform === 'win32'
      ? /Setup.*\.exe$/i
      : process.platform === 'darwin'
        ? /\.dmg$/i
        : /\.AppImage$/i;
  const hit = assets.find((a) => wanted.test(a.name || ''));
  return hit?.browser_download_url || release.html_url;
}

/**
 * @param {object} opts
 * @param {boolean} opts.silent  최신 버전이거나 실패해도 조용히 넘어갈지 여부
 * @param {import('electron').BrowserWindow|null} opts.parent
 */
async function checkForUpdates({ silent = true, parent = null } = {}) {
  try {
    const release = await fetchLatest();
    const latest = release.tag_name || release.name;
    const current = app.getVersion();

    if (!isNewer(latest, current)) {
      if (!silent) {
        await dialog.showMessageBox(parent || undefined, {
          type: 'info',
          title: '업데이트 확인',
          message: '최신 버전을 사용 중입니다.',
          detail: `현재 버전 ${current}`,
          buttons: ['확인'],
        });
      }
      return { updateAvailable: false, current, latest };
    }

    const downloadUrl = pickInstallerAsset(release);

    if (silent && Notification.isSupported()) {
      new Notification({
        title: '새 버전이 나왔어요',
        body: `foundfoundedmeet ${String(latest).replace(/^v/i, '')} 로 업데이트할 수 있습니다.`,
      }).show();
    }

    const { response } = await dialog.showMessageBox(parent || undefined, {
      type: 'info',
      title: '업데이트 안내',
      message: `새 버전 ${String(latest).replace(/^v/i, '')} 이 나왔습니다.`,
      detail:
        `현재 버전: ${current}\n\n` +
        (release.body ? `${String(release.body).slice(0, 400)}\n\n` : '') +
        '[지금 받기] 를 누르면 설치 파일 다운로드가 시작됩니다.\n' +
        '내려받은 파일을 실행하면 기존 앱 위에 그대로 설치됩니다.',
      buttons: ['지금 받기', '나중에'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) await shell.openExternal(downloadUrl);
    return { updateAvailable: true, current, latest, downloadUrl };
  } catch (err) {
    if (!silent) {
      await dialog.showMessageBox(parent || undefined, {
        type: 'warning',
        title: '업데이트 확인 실패',
        message: '업데이트 정보를 가져오지 못했습니다.',
        detail: String(err.message || err),
        buttons: ['확인'],
      });
    }
    return { updateAvailable: false, error: err };
  }
}

function startAutoCheck(getParent) {
  // 실행 직후 한 번 (앱이 뜨는 걸 방해하지 않도록 지연)
  setTimeout(() => checkForUpdates({ silent: true, parent: getParent?.() }), 8000);
  setInterval(() => checkForUpdates({ silent: true, parent: getParent?.() }), CHECK_INTERVAL_MS);
}

module.exports = { checkForUpdates, startAutoCheck, isNewer };
