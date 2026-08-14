/**
 * foundfoundedmeet — Desktop (Electron)
 *
 * 설계 요약
 *  - vite build 결과(dist)를 앱 내부에 완전히 내장하고, 로컬 HTTP 서버(127.0.0.1)로 서빙한다.
 *    → file:// 이 아니라 http://127.0.0.1 이므로 secure context 가 유지되어
 *      Service Worker / Notification / IndexedDB / Firebase 가 웹과 100% 동일하게 동작한다.
 *  - /api/* 요청은 배포된 Vercel 서버로 그대로 프록시한다.
 *    → 소스 코드를 고치지 않아도 fetch('/api/notify') 가 그대로 살아있다.
 *  - 로그인 비밀번호(VITE_ADMIN_PASSWORD / VITE_MEMBER_PASSWORD)는 빌드에 굽지 않고
 *    설치 후 앱 메뉴에서 설정 → userData/env.json 에 저장 → index.html 에 주입한다.
 */

const { app, BrowserWindow, Menu, shell, ipcMain, dialog, Notification } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { checkForUpdates, startAutoCheck } = require('./updater.cjs');

const REMOTE_ORIGIN = process.env.FFM_REMOTE_ORIGIN || 'https://foundfoundedmeet.vercel.app';
const DIST_DIR = path.join(__dirname, '..', 'dist');

// 개발 실행과 설치본이 같은 설정 폴더를 쓰도록 이름을 고정한다.
app.setName('foundfoundedmeet');
const ENV_FILE = path.join(app.getPath('userData'), 'env.json');

let mainWindow = null;
let settingsWindow = null;
let serverPort = 0;

/* ------------------------------------------------------------------ */
/* 런타임 환경변수 (설치 후 설정 가능)                                   */
/* ------------------------------------------------------------------ */
function readEnv() {
  try {
    if (fs.existsSync(ENV_FILE)) return JSON.parse(fs.readFileSync(ENV_FILE, 'utf8')) || {};
  } catch (e) {
    console.error('env.json 읽기 실패:', e);
  }
  return {};
}

function writeEnv(next) {
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  fs.writeFileSync(ENV_FILE, JSON.stringify(next, null, 2), 'utf8');
}

/* ------------------------------------------------------------------ */
/* 정적 파일 서버 + /api 프록시                                          */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function injectEnv(html) {
  const env = readEnv();
  const payload = JSON.stringify({
    VITE_ADMIN_PASSWORD: env.VITE_ADMIN_PASSWORD || '',
    VITE_MEMBER_PASSWORD: env.VITE_MEMBER_PASSWORD || '',
  });
  const tag = `<script>window.__APP_ENV__=${payload};window.__IS_DESKTOP__=true;</script>`;
  return html.includes('</head>') ? html.replace('</head>', `${tag}\n</head>`) : tag + html;
}

function proxyApi(req, res) {
  const target = new URL(req.url, REMOTE_ORIGIN);
  const client = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: target.host, origin: REMOTE_ORIGIN, referer: REMOTE_ORIGIN + '/' };
  delete headers['accept-encoding'];

  const upstream = client.request(
    target,
    { method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    console.error('API 프록시 실패:', err.message);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'proxy_failed', message: err.message }));
  });
  req.pipe(upstream);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  // Service Worker 는 스코프 제한이 있으므로 루트 스코프를 허용
  if (path.basename(filePath) === 'service-worker.js') {
    headers['Service-Worker-Allowed'] = '/';
    headers['Cache-Control'] = 'no-cache';
  }
  if (ext === '.html') {
    const html = injectEnv(body.toString('utf8'));
    headers['Cache-Control'] = 'no-store';
    res.writeHead(200, headers);
    res.end(html);
    return;
  }
  res.writeHead(200, headers);
  res.end(body);
}

function createServer() {
  return http.createServer((req, res) => {
    try {
      if (req.url.startsWith('/api/')) return proxyApi(req, res);

      const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      let filePath = path.join(DIST_DIR, safe);

      if (!filePath.startsWith(DIST_DIR)) {
        res.writeHead(403);
        return res.end('forbidden');
      }
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      if (!fs.existsSync(filePath)) {
        // SPA fallback
        filePath = path.join(DIST_DIR, 'index.html');
      }
      serveFile(res, filePath);
    } catch (err) {
      console.error('정적 서버 오류:', err);
      res.writeHead(500);
      res.end('internal error');
    }
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await findFreePort();
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  serverPort = port;
  console.log(`[ffm] local server ready: http://127.0.0.1:${port} (api → ${REMOTE_ORIGIN})`);
  return `http://127.0.0.1:${port}`;
}

/* ------------------------------------------------------------------ */
/* 비밀번호 설정 창                                                      */
/* ------------------------------------------------------------------ */
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 420,
    height: 400,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: '로그인 비밀번호 설정',
    parent: mainWindow || undefined,
    modal: !!mainWindow,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

ipcMain.handle('env:get', () => readEnv());
ipcMain.handle('env:set', (_e, next) => {
  writeEnv({
    VITE_ADMIN_PASSWORD: String(next?.VITE_ADMIN_PASSWORD ?? ''),
    VITE_MEMBER_PASSWORD: String(next?.VITE_MEMBER_PASSWORD ?? ''),
  });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  return true;
});
ipcMain.handle('settings:close', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.close();
});

/* ------------------------------------------------------------------ */
/* 메뉴                                                                 */
/* ------------------------------------------------------------------ */
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about', label: 'foundfoundedmeet 정보' },
            { type: 'separator' },
            { label: '로그인 비밀번호 설정…', accelerator: 'Cmd+,', click: openSettings },
            { type: 'separator' },
            { role: 'hide', label: '가리기' },
            { role: 'quit', label: '종료' },
          ],
        }]
      : []),
    {
      label: '파일',
      submenu: [
        { label: '로그인 비밀번호 설정…', accelerator: 'Ctrl+,', click: openSettings, visible: !isMac },
        {
          label: '설정 폴더 열기',
          click: () => shell.openPath(app.getPath('userData')),
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '창 닫기' } : { role: 'quit', label: '종료' },
      ],
    },
    {
      label: '보기',
      submenu: [
        { label: '새로고침', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.reload() },
        { role: 'forceReload', label: '강제 새로고침' },
        { type: 'separator' },
        { role: 'resetZoom', label: '기본 크기' },
        { role: 'zoomIn', label: '확대' },
        { role: 'zoomOut', label: '축소' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '전체 화면' },
        { role: 'toggleDevTools', label: '개발자 도구' },
      ],
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo', label: '실행 취소' },
        { role: 'redo', label: '다시 실행' },
        { type: 'separator' },
        { role: 'cut', label: '잘라내기' },
        { role: 'copy', label: '복사' },
        { role: 'paste', label: '붙여넣기' },
        { role: 'selectAll', label: '모두 선택' },
      ],
    },
    {
      label: '도움말',
      submenu: [
        {
          label: '업데이트 확인…',
          click: () => checkForUpdates({ silent: false, parent: mainWindow }),
        },
        { label: '웹 버전 열기', click: () => shell.openExternal(REMOTE_ORIGIN) },
        {
          label: '정보',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'foundfoundedmeet',
              message: `foundfoundedmeet 데스크톱 v${app.getVersion()}`,
              detail: `회의실 예약 시스템\n\n서버: ${REMOTE_ORIGIN}\n설정 파일: ${ENV_FILE}`,
              buttons: ['확인'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/* 메인 윈도우                                                           */
/* ------------------------------------------------------------------ */
async function createWindow() {
  const origin = await startServer();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: 'foundfoundedmeet — 회의실 예약',
    backgroundColor: '#ffffff',
    show: false,
    icon: process.platform === 'linux' ? path.join(__dirname, 'icons', 'icon.png') : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 알림 권한 자동 허용 (로컬 앱이므로)
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['notifications', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission));
  });

  // 외부 링크는 기본 브라우저로
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(origin);

  // 최초 실행 시 비밀번호가 비어 있으면 설정 창 안내
  const env = readEnv();
  if (!env.VITE_MEMBER_PASSWORD && !env.VITE_ADMIN_PASSWORD) {
    setTimeout(openSettings, 900);
  }
}

/* ------------------------------------------------------------------ */
/* 앱 수명주기                                                           */
/* ------------------------------------------------------------------ */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.foundfounded.meet');
    buildMenu();
    createWindow();
    if (app.isPackaged) startAutoCheck(() => mainWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = { Notification, serverPort };
