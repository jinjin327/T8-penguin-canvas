// Server-side self-update route for Docker / bare-metal deployments
// Checks GitHub releases, performs git pull + rebuild + restart

const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const config = require('../config');

const router = express.Router();

const GITHUB_REPO = 'T8mars/T8-penguin-canvas';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const PROJECT_DIR = path.resolve(__dirname, '..', '..', '..');

let updateState = {
  status: 'idle',
  currentVersion: config.APP_VERSION,
  latestVersion: null,
  message: '',
  error: null,
  updatedAt: null,
  autoUpdateEnabled: false,
  autoUpdateInterval: 24,
  lastCheckTime: null,
};

// ---------- helpers ----------

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'T8-penguin-canvas-updater' } }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Failed to parse response: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

function run(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: PROJECT_DIR, timeout: 300000, ...options }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

function readUpdateSettings() {
  try {
    const settingsPath = path.join(config.DATA_DIR, 'settings.json');
    if (!fs.existsSync(settingsPath)) return {};
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return raw.serverUpdater || {};
  } catch { return {}; }
}

function writeUpdateSettings(partial) {
  try {
    const settingsPath = path.join(config.DATA_DIR, 'settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
    settings.serverUpdater = { ...(settings.serverUpdater || {}), ...partial };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[updater] Failed to persist settings:', e.message);
  }
}

function loadSettingsIntoState() {
  const saved = readUpdateSettings();
  if (saved.autoUpdateEnabled !== undefined) updateState.autoUpdateEnabled = saved.autoUpdateEnabled;
  if (saved.autoUpdateInterval !== undefined) updateState.autoUpdateInterval = saved.autoUpdateInterval;
  if (saved.lastCheckTime) updateState.lastCheckTime = saved.lastCheckTime;
}

// ---------- environment detection ----------

function isDockerEnvironment() {
  try {
    if (fs.existsSync('/.dockerenv')) return true;
    if (fs.existsSync('/proc/1/cgroup')) {
      const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf-8');
      if (cgroup.includes('docker') || cgroup.includes('containerd')) return true;
    }
    return false;
  } catch { return false; }
}

// ---------- check for updates ----------

async function checkForUpdate() {
  if (updateState.status === 'checking' || updateState.status === 'updating') {
    return updateState;
  }
  updateState.status = 'checking';
  updateState.message = '正在检查更新...';
  updateState.error = null;

  try {
    const release = await httpGetJson(GITHUB_API);
    const tagName = release.tag_name || '';
    const latestVersion = tagName.replace(/^v/, '');
    updateState.latestVersion = latestVersion;
    updateState.lastCheckTime = new Date().toISOString();
    writeUpdateSettings({ lastCheckTime: updateState.lastCheckTime });

    if (latestVersion && latestVersion !== config.APP_VERSION) {
      const isNewer = compareVersions(latestVersion, config.APP_VERSION) > 0;
      updateState.status = isNewer ? 'available' : 'idle';
      updateState.message = isNewer
        ? `发现新版本 v${latestVersion}（当前 v${config.APP_VERSION}）`
        : `当前已是最新版本 v${config.APP_VERSION}`;
    } else {
      updateState.status = 'idle';
      updateState.message = `当前已是最新版本 v${config.APP_VERSION}`;
    }
  } catch (e) {
    updateState.status = 'error';
    updateState.error = e.message;
    updateState.message = `检查更新失败: ${e.message}`;
  }

  updateState.updatedAt = new Date().toISOString();
  return updateState;
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// ---------- perform update ----------

async function performUpdate() {
  if (updateState.status === 'updating') {
    return { ...updateState, message: '更新正在进行中...' };
  }
  updateState.status = 'updating';
  updateState.message = '开始更新...';
  updateState.error = null;
  updateState.updatedAt = new Date().toISOString();

  const log = [];
  const logStep = (msg) => {
    log.push(msg);
    updateState.message = msg;
    console.log(`[updater] ${msg}`);
  };

  const isDocker = isDockerEnvironment();

  try {
    // Docker mode: try git pull if .git exists, otherwise advise user
    if (isDocker) {
      const isGitRepo = fs.existsSync(path.join(PROJECT_DIR, '.git'));
      if (!isGitRepo) {
        // No git in Docker container - advise to pull new image
        logStep('Docker 容器内无 Git 仓库，建议使用以下命令更新：');
        updateState.status = 'error';
        updateState.error = 'docker-compose-update-required';
        updateState.message = 'Docker 模式需要重新构建镜像更新。请在宿主机执行: cd /path/to/project && git pull && docker compose up -d --build';
        updateState.updatedAt = new Date().toISOString();
        return { ...updateState, log };
      }
    }

    // Git-based update (works for both bare-metal and Docker with mounted git repo)
    logStep('正在拉取最新代码 (git fetch + reset)...');
    try {
      await run('git fetch origin');
      let branch = 'main';
      try { branch = (await run('git rev-parse --abbrev-ref HEAD')).trim() || 'main'; } catch (_) {}
      await run(`git reset --hard origin/${branch}`);
      logStep('代码拉取完成');
    } catch (e) {
      throw new Error(`Git 操作失败: ${e.message}`);
    }

    // Install frontend dependencies
    logStep('正在安装前端依赖 (npm ci)...');
    try {
      // The updater normally runs with NODE_ENV=production in Docker. Explicitly
      // include dev dependencies because the frontend build needs TypeScript/Vite.
      await run('npm ci --include=dev --ignore-scripts');
      logStep('前端依赖安装完成');
    } catch (_) {
      try {
        await run('npm install --include=dev --ignore-scripts');
        logStep('前端依赖安装完成 (npm install)');
      } catch (e2) {
        throw new Error(`安装前端依赖失败: ${e2.message}`);
      }
    }

    // Build frontend
    logStep('正在构建前端 (npm run build)...');
    try {
      await run('npm run build');
      logStep('前端构建完成');
    } catch (e) {
      throw new Error(`前端构建失败: ${e.message}`);
    }

    // Install backend dependencies
    logStep('正在安装后端依赖...');
    try {
      await run('cd backend && npm ci --omit=dev');
      logStep('后端依赖安装完成');
    } catch (_) {
      try {
        await run('cd backend && npm install --omit=dev');
        logStep('后端依赖安装完成 (npm install)');
      } catch (e2) {
        throw new Error(`安装后端依赖失败: ${e2.message}`);
      }
    }

    logStep('更新完成，即将重启服务...');
    updateState.status = 'success';
    updateState.message = '更新完成！服务将在 3 秒后重启...';
    updateState.updatedAt = new Date().toISOString();

    // Restart: exit process and let Docker/systemd restart it
    setTimeout(() => {
      console.log('[updater] Restarting server due to update...');
      process.exit(0);
    }, 3000);

    return { ...updateState, log };
  } catch (e) {
    updateState.status = 'error';
    updateState.error = e.message;
    updateState.message = `更新失败: ${e.message}`;
    updateState.updatedAt = new Date().toISOString();
    return { ...updateState, log };
  }
}

// ---------- API routes ----------

router.get('/status', (_req, res) => {
  res.json({
    success: true,
    data: {
      ...updateState,
      isDocker: isDockerEnvironment(),
      projectDir: PROJECT_DIR,
      isGitRepo: fs.existsSync(path.join(PROJECT_DIR, '.git')),
    },
  });
});

router.post('/check', async (_req, res) => {
  try {
    const state = await checkForUpdate();
    res.json({ success: true, data: state });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/run', async (_req, res) => {
  if (updateState.status === 'updating') {
    return res.json({ success: false, message: '更新正在进行中', data: updateState });
  }
  res.json({
    success: true,
    message: '更新已开始，请稍候查看状态',
    data: { ...updateState },
  });
  performUpdate().catch((e) => {
    console.error('[updater] Update failed:', e);
  });
});

router.get('/settings', (_req, res) => {
  const saved = readUpdateSettings();
  res.json({
    success: true,
    data: {
      autoUpdateEnabled: saved.autoUpdateEnabled ?? false,
      autoUpdateInterval: saved.autoUpdateInterval ?? 24,
      lastCheckTime: saved.lastCheckTime ?? null,
    },
  });
});

router.put('/settings', (req, res) => {
  const { autoUpdateEnabled, autoUpdateInterval } = req.body;
  if (typeof autoUpdateEnabled === 'boolean') {
    updateState.autoUpdateEnabled = autoUpdateEnabled;
  }
  if (typeof autoUpdateInterval === 'number' && autoUpdateInterval >= 1) {
    updateState.autoUpdateInterval = autoUpdateInterval;
  }
  writeUpdateSettings({
    autoUpdateEnabled: updateState.autoUpdateEnabled,
    autoUpdateInterval: updateState.autoUpdateInterval,
    lastCheckTime: updateState.lastCheckTime,
  });
  resetAutoUpdateTimer();
  res.json({
    success: true,
    data: {
      autoUpdateEnabled: updateState.autoUpdateEnabled,
      autoUpdateInterval: updateState.autoUpdateInterval,
      lastCheckTime: updateState.lastCheckTime,
    },
  });
});

// ---------- auto-update scheduler ----------

let autoUpdateTimer = null;

function resetAutoUpdateTimer() {
  if (autoUpdateTimer) {
    clearInterval(autoUpdateTimer);
    autoUpdateTimer = null;
  }
  if (!updateState.autoUpdateEnabled) return;
  const intervalMs = Math.max(1, updateState.autoUpdateInterval) * 60 * 60 * 1000;
  console.log(`[updater] Auto-update enabled, checking every ${updateState.autoUpdateInterval} hour(s)`);
  autoUpdateTimer = setInterval(async () => {
    console.log('[updater] Auto-update check triggered');
    try {
      const state = await checkForUpdate();
      if (state.status === 'available') {
        console.log(`[updater] New version ${state.latestVersion} available, starting auto-update...`);
        await performUpdate();
      }
    } catch (e) {
      console.error('[updater] Auto-update check failed:', e.message);
    }
  }, intervalMs);
}

function startAutoUpdateScheduler() {
  loadSettingsIntoState();
  resetAutoUpdateTimer();
}

// Startup check when auto-update enabled
setTimeout(() => {
  if (updateState.autoUpdateEnabled) {
    console.log('[updater] Performing startup update check...');
    checkForUpdate().catch(() => {});
  }
}, 10000);

module.exports = { router, startAutoUpdateScheduler, checkForUpdate, performUpdate };
