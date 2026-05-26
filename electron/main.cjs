// ============================================================================
// T8-penguin-canvas Electron 主进程
// 设计要点 (与参考项目 gpt-image-2-web Python 方案的区别):
//   1. 本项目无 Python 依赖,直接复用 Electron 内置 Node.js runtime 启动 Express
//   2. 后端核心源码已被 bytenode 编译为 .jsc 字节码 + T8ENC1 加密 (.t8c)
//   3. 启动时通过 loader.js 内存解密 .t8c → 字节码,require 到主进程
//   4. 前端 Vite 产物 (dist/) 由 Express 静态托管;BrowserWindow 直接 loadURL
//   5. 打包模式数据目录指向 app.getPath('userData') 而非项目目录
// ============================================================================

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

// 允许在 Linux/某些机型上规避 GPU 沙盒导致的启动延迟
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

let mainWindow = null;
let logWindow = null;
let backendModule = null; // 后端 Express app(同进程加载) 或 子进程句柄
let backendProcess = null;
let backendPort = 18766;
let logBuffer = [];

// ---------- 路径解析 (开发/打包双模式) ----------
function isPackaged() {
  return app.isPackaged;
}

function getResourcePath(rel) {
  if (isPackaged()) {
    return path.join(process.resourcesPath, rel);
  }
  return path.join(__dirname, '..', rel);
}

function getUserDataDir() {
  if (isPackaged()) {
    return app.getPath('userData');
  }
  return path.resolve(__dirname, '..');
}

// ---------- 日志 ----------
function dbgLog(msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${ts}] ${msg}`;
  console.log(line);
  logBuffer.push(line);
  if (logBuffer.length > 500) logBuffer.shift();
  appendToLogWindow(line);
}

function appendToLogWindow(msg) {
  if (logWindow && !logWindow.isDestroyed()) {
    const safe = JSON.stringify(msg + '\n');
    logWindow.webContents
      .executeJavaScript(
        `(function(){var e=document.getElementById('log');if(e){e.textContent+=${safe};e.scrollTop=e.scrollHeight;}})()`
      )
      .catch(() => {});
  }
}

// ---------- 端口探测 ----------
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort(preferred, maxTries = 20) {
  for (let i = 0; i < maxTries; i++) {
    if (await isPortFree(preferred + i)) return preferred + i;
  }
  return preferred + Math.floor(Math.random() * 900) + 100;
}

// ---------- 启动后端 ----------
async function startBackend() {
  backendPort = await findFreePort(18766);
  dbgLog(`[backend] picked port=${backendPort}`);

  const userData = getUserDataDir();
  // 预创建 userData 子目录(避免 backend 启动时 mkdir 错误)
  for (const sub of ['data', 'input', 'output', 'thumbnails']) {
    const p = path.join(userData, sub);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }

  // 环境变量传递给后端
  process.env.PORT = String(backendPort);
  process.env.HOST = '127.0.0.1';
  process.env.T8PC_USER_DATA = userData;         // 后端所有数据目录落到 userData (origin/main config.js 期望变量名)
  process.env.T8PC_PACKAGED = isPackaged() ? '1' : '0';
  process.env.T8PC_FRONTEND_DIST = isPackaged()
    ? path.join(process.resourcesPath, 'frontend')
    : path.resolve(__dirname, '..', 'dist');

  // 同进程加载明文后端(不再走字节码加密那套)
  try {
    const entry = isPackaged()
      ? path.join(process.resourcesPath, 'app.asar', 'backend', 'src', 'server.js')
      : path.resolve(__dirname, '..', 'backend', 'src', 'server.js');
    dbgLog(`[backend] loading entry: ${entry}`);
    require(entry);
    dbgLog(`[backend] started in-process on http://127.0.0.1:${backendPort}`);
  } catch (e) {
    dbgLog(`[backend] FAILED to start: ${e && e.stack ? e.stack : e}`);
    throw e;
  }
}

// ---------- 创建主窗口 ----------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0b0d',
    title: '贞贞的无限画布（企鹅共创版） v1.4.2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.removeMenu();

  const url = `http://127.0.0.1:${backendPort}/`;
  dbgLog(`[main] loading ${url}`);
  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // F12 打开 DevTools
  mainWindow.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

// ---------- 启动时显示加载窗 ----------
function createLogWindow() {
  const tmpDir = app.getPath('temp');
  const logHtmlPath = path.join(tmpDir, 't8pc-app-log.html');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>启动中...</title>
<style>html,body{margin:0;padding:0;background:#0b0b0d;color:#9be9ff;font-family:Consolas,monospace;}
.h{padding:14px 18px;border-bottom:1px solid #222;font-size:14px;}
.h b{color:#ffd76b;}
#log{padding:12px 18px;white-space:pre-wrap;line-height:1.5;font-size:12px;}
</style></head><body>
<div class="h">🐧 <b>贞贞的无限画布</b>（企鹅共创版）<span style="float:right;color:#666;">v1.4.2</span></div>
<div id="log">[启动] 正在启动 Express 后端 + 前端静态服务...\n</div>
</body></html>`;
  fs.writeFileSync(logHtmlPath, html, 'utf-8');

  logWindow = new BrowserWindow({
    width: 720,
    height: 360,
    show: true,
    frame: true,
    backgroundColor: '#0b0b0d',
    title: '🐧 启动中…',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  logWindow.removeMenu();
  logWindow.loadFile(logHtmlPath);
  logWindow.on('closed', () => {
    logWindow = null;
  });
}

// ---------- IPC ----------
ipcMain.handle('t8pc:get-info', () => ({
  packaged: isPackaged(),
  backendPort,
  userData: getUserDataDir(),
  version: '1.4.2',
}));

// ---------- 生命周期 ----------
app.whenReady().then(async () => {
  createLogWindow();
  try {
    await startBackend();
    // 等后端真正可访问
    await waitForBackend(backendPort, 30);
    createMainWindow();
    setTimeout(() => {
      if (logWindow && !logWindow.isDestroyed()) logWindow.close();
    }, 600);
  } catch (e) {
    dbgLog(`[fatal] ${e && e.stack ? e.stack : e}`);
  }
});

function waitForBackend(port, maxTries = 30) {
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      n += 1;
      const sock = net.createConnection({ port, host: '127.0.0.1' }, () => {
        sock.end();
        resolve(true);
      });
      sock.on('error', () => {
        if (n >= maxTries) return resolve(false);
        setTimeout(tick, 200);
      });
    };
    tick();
  });
}

app.on('window-all-closed', () => {
  // Windows / Linux 关闭所有窗口直接退出
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t'], {
          windowsHide: true,
        });
      } else {
        backendProcess.kill('SIGTERM');
      }
    } catch (_) {}
  }
});
