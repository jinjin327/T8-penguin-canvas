// ============================================================================
// T8-penguin-canvas 打包前加密脚本 (encrypt.js)
//
// 流程:
//   1. 读取 backend/src/**/*.js (排除 node_modules)
//   2. 用 bytenode.compileCode(src) 生成 V8 字节码 (.jsc 缓冲)
//   3. 调用 loader.encryptBuffer 加 T8ENC1 magic + AES-256-CBC
//   4. 写入 build/backend-enc/<rel>.t8c
//   5. 重写所有相对路径 require:
//        ./config / ./routes/canvas 等 → 仍然是相对路径,运行时由 .t8c 后缀 hook 解析
//
// 使用方式:
//   node electron/encrypt.js
// 输出:
//   build/backend-enc/server.t8c
//   build/backend-enc/config.t8c
//   build/backend-enc/routes/canvas.t8c ...
//   build/backend-enc/utils/*.t8c
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const bytenode = require('bytenode');
const { encryptBuffer } = require('./loader.cjs');

const BACKEND_SRC = path.resolve(__dirname, '..', 'backend', 'src');
const LOCAL_PRIVATE_SRC = path.resolve(__dirname, '..', 'local-private');
const OUT_DIR = path.resolve(__dirname, '..', 'build', 'backend-enc');
const LOCAL_PRIVATE_BACKEND_DIRS = [
  path.join(LOCAL_PRIVATE_SRC, 'extensions', 'backend'),
  path.join(LOCAL_PRIVATE_SRC, 'recharge', 'backend'),
];

function walk(dir, results = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      walk(full, results);
    } else if (full.endsWith('.js') || full.endsWith('.cjs')) {
      results.push(full);
    } else if (full.endsWith('.json')) {
      results.push(full); // settings/canvas 模板等
    }
  }
  return results;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// 把 require('./foo') / require('./foo.js') 重写为 require('./foo.t8c')
// 使内部模块在加密产物里仍能正确 resolve(.t8c hook 已注册到 require.extensions)
function rewriteRequires(src) {
  // 匹配 require('./xxx') 或 require("../xxx")  形式
  return src.replace(
    /require\((['"])(\.\.?\/[^'"]+)\1\)/g,
    (m, q, p) => {
      // 已有 .t8c / .json 后缀:不动
      if (/\.(t8c|json)$/.test(p)) return m;
      // 去掉 .js 后缀(若有)
      const stripped = p.replace(/\.(?:js|cjs)$/, '');
      return `require(${q}${stripped}.t8c${q})`;
    },
  );
}

function encryptFile(srcAbs, sourceRoot = BACKEND_SRC, outRoot = OUT_DIR) {
  const rel = path.relative(sourceRoot, srcAbs).replace(/\\/g, '/');
  const dst = path.join(outRoot, rel.replace(/\.(?:js|cjs)$/, '.t8c'));
  ensureDir(path.dirname(dst));

  if (srcAbs.endsWith('.json')) {
    // JSON 直接复制(本项目 backend/src 暂未直接含 json,保留扩展性)
    fs.copyFileSync(srcAbs, path.join(OUT_DIR, rel));
    console.log('[copy ]', rel);
    return;
  }

  let src = fs.readFileSync(srcAbs, 'utf-8');
  src = rewriteRequires(src);

  // bytenode.compileCode 同步返回 Buffer (V8 cached data + 8-byte length header)
  // 包装为 CommonJS module 以保留 require/module/exports/__filename/__dirname
  const wrapped = require('module').wrap(src);
  const jsc = bytenode.compileCode(wrapped);

  const enc = encryptBuffer(jsc);
  fs.writeFileSync(dst, enc);
  console.log('[T8ENC]', rel, '→', path.relative(path.resolve(__dirname, '..'), dst));
}

function main() {
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  ensureDir(OUT_DIR);

  const files = walk(BACKEND_SRC);
  console.log(`[encrypt] backend src files: ${files.length}`);
  for (const f of files) {
    encryptFile(f);
  }

  const localPrivateDisabled = process.env.T8_ENABLE_LOCAL_PRIVATE === '0'
    || process.env.T8_DISABLE_LOCAL_EXTENSIONS === '1';
  const localPrivateEntry = path.join(LOCAL_PRIVATE_SRC, 'extensions', 'backend', 'index.cjs');
  if (!localPrivateDisabled && fs.existsSync(localPrivateEntry)) {
    const localOut = path.join(OUT_DIR, 'local-private');
    const localFiles = LOCAL_PRIVATE_BACKEND_DIRS
      .filter((dir) => fs.existsSync(dir))
      .flatMap((dir) => walk(dir));
    console.log(`[encrypt] local private files: ${localFiles.length}`);
    for (const f of localFiles) {
      encryptFile(f, LOCAL_PRIVATE_SRC, localOut);
    }
  } else {
    console.log('[encrypt] local private extensions: skipped');
  }
  console.log(`[encrypt] DONE → ${OUT_DIR}`);
}

if (require.main === module) {
  // 必须用 electron 运行本脚本 (npx electron electron/encrypt.js)
  // 使 bytenode 编译出的字节码与运行时 Electron V8 版本一致
  // 检测: process.versions.electron 存在则表明是 Electron 进程
  if (!process.versions.electron) {
    console.warn('[encrypt] WARNING: 该脚本未在 Electron 下执行! V8 版本不匹配会导致打包后崩溃。');
    console.warn('[encrypt]   请改用: npx electron electron/encrypt.js');
  }
  try {
    main();
    // Electron 环境下需主动退出,否则事件循环不退
    if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
      try { require('electron').app.exit(0); } catch (_) { process.exit(0); }
    } else {
      process.exit(0);
    }
  } catch (e) {
    console.error('[encrypt] FAILED:', e && e.stack ? e.stack : e);
    if (process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE) {
      try { require('electron').app.exit(1); } catch (_) { process.exit(1); }
    } else {
      process.exit(1);
    }
  }
}

module.exports = { main, encryptFile, rewriteRequires };
