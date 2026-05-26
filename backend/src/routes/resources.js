'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const sharp = require('sharp');
const config = require('../config');

const router = express.Router();

const KINDS = new Set(['image', 'video', 'audio']);
const DB_FILE = 'resource_library.json';
const THUMB_DIR = '_thumbs';
const REMOTE_FETCH_TIMEOUT_MS = 30_000;
const REMOTE_MAX_BYTES = 512 * 1024 * 1024;

const DEFAULT_CATEGORY_NAMES = {
  image: ['未分类', '角色', '场景', '风格参考', '成品'],
  video: ['未分类', '镜头', '动作', '成片'],
  audio: ['未分类', '音乐', '人声', '音效'],
};

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

function now() {
  return Date.now();
}

function genId(prefix) {
  return `${prefix}_${now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function safeText(value, fallback = '') {
  return String(value || fallback).trim().slice(0, 200);
}

function safeFilename(value, fallback = 'asset') {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
  return cleaned || fallback;
}

function normalizeKind(kind) {
  const k = String(kind || '').toLowerCase();
  return KINDS.has(k) ? k : '';
}

function normalizeExt(ext) {
  return String(ext || '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 10);
}

function kindFromExt(ext) {
  const e = normalizeExt(ext);
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'].includes(e)) return 'image';
  if (['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'].includes(e)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(e)) return 'audio';
  return '';
}

function extFromMime(mime) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  const pair = Object.entries(MIME_BY_EXT).find(([, v]) => v === m);
  if (!pair) return '';
  return pair[0] === 'jpeg' ? 'jpg' : pair[0];
}

function mimeFromExt(ext) {
  return MIME_BY_EXT[normalizeExt(ext)] || 'application/octet-stream';
}

function readSettings() {
  try {
    if (!fs.existsSync(config.SETTINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(config.SETTINGS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function getLibraryRoot() {
  const settings = readSettings();
  const root = String(settings.resourceLibraryPath || config.DEFAULT_RESOURCE_LIBRARY_DIR || '').trim();
  if (!root) throw new Error('未配置 resourceLibraryPath');
  fs.mkdirSync(root, { recursive: true });
  for (const kind of KINDS) fs.mkdirSync(path.join(root, kind), { recursive: true });
  fs.mkdirSync(path.join(root, THUMB_DIR), { recursive: true });
  return root;
}

function defaultCategories() {
  const out = [];
  for (const kind of KINDS) {
    const names = DEFAULT_CATEGORY_NAMES[kind] || ['未分类'];
    names.forEach((name, idx) => {
      out.push({
        id: idx === 0 ? `${kind}_uncategorized` : `${kind}_${idx}_${name}`,
        kind,
        name,
        order: idx,
        system: idx === 0,
        createdAt: 0,
      });
    });
  }
  return out;
}

function normalizeDb(raw) {
  const db = raw && typeof raw === 'object' ? raw : {};
  const defaults = defaultCategories();
  const categories = Array.isArray(db.categories) ? db.categories : [];
  const items = Array.isArray(db.items) ? db.items : [];
  const catMap = new Map();

  for (const c of [...defaults, ...categories]) {
    const kind = normalizeKind(c?.kind);
    const name = safeText(c?.name);
    if (!kind || !name) continue;
    const id = safeText(c?.id, genId('rescat')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96) || genId('rescat');
    if (catMap.has(id)) continue;
    catMap.set(id, {
      id,
      kind,
      name,
      order: Number.isFinite(Number(c?.order)) ? Number(c.order) : catMap.size,
      system: !!c?.system || id.endsWith('_uncategorized'),
      createdAt: Number(c?.createdAt) || now(),
    });
  }

  const normalizedCategories = Array.from(catMap.values())
    .sort((a, b) => a.kind.localeCompare(b.kind) || (a.order || 0) - (b.order || 0))
    .map((c, idx) => ({ ...c, order: Number.isFinite(Number(c.order)) ? c.order : idx }));
  const catIds = new Set(normalizedCategories.map((c) => c.id));
  const normalizedItems = [];
  const seen = new Set();

  for (const item of items) {
    const kind = normalizeKind(item?.kind);
    const id = safeText(item?.id, genId('res')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96) || genId('res');
    if (!kind || seen.has(id)) continue;
    const fileRel = safeText(item?.fileRel);
    if (!fileRel) continue;
    seen.add(id);
    const fallbackCat = `${kind}_uncategorized`;
    const categoryId = catIds.has(item?.categoryId) ? item.categoryId : fallbackCat;
    normalizedItems.push({
      id,
      kind,
      categoryId,
      title: safeText(item?.title, item?.originalName || id),
      originalName: safeText(item?.originalName, ''),
      fileRel,
      thumbRel: safeText(item?.thumbRel, ''),
      mime: safeText(item?.mime, mimeFromExt(path.extname(fileRel))),
      size: Number(item?.size) || 0,
      sha256: safeText(item?.sha256, ''),
      tags: Array.isArray(item?.tags) ? item.tags.map((t) => safeText(t)).filter(Boolean).slice(0, 20) : [],
      favorite: !!item?.favorite,
      sourceUrl: safeText(item?.sourceUrl, ''),
      sourceNodeId: safeText(item?.sourceNodeId, ''),
      sourceCanvasId: safeText(item?.sourceCanvasId, ''),
      createdAt: Number(item?.createdAt) || now(),
      updatedAt: Number(item?.updatedAt) || Number(item?.createdAt) || now(),
      lastUsedAt: Number(item?.lastUsedAt) || 0,
    });
  }

  return {
    schema: 't8-resource-library',
    version: 1,
    updatedAt: safeText(db.updatedAt, new Date().toISOString()),
    categories: normalizedCategories,
    items: normalizedItems,
  };
}

function readDb() {
  const root = getLibraryRoot();
  const file = path.join(root, DB_FILE);
  let raw = null;
  try {
    if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    raw = null;
  }
  const db = normalizeDb(raw);
  if (!fs.existsSync(file) || JSON.stringify(raw || {}) !== JSON.stringify(db)) {
    writeDb(root, db);
  }
  return { root, db };
}

function writeDb(root, db) {
  db.updatedAt = new Date().toISOString();
  const file = path.join(root, DB_FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function assertInside(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  if (t !== r && !t.startsWith(r + path.sep)) throw new Error('非法资源路径');
  return t;
}

function toLocalPathnameIfSameApp(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
      return decodeURIComponent(u.pathname || '');
    }
  } catch {
    // Relative URLs stay on the normal path below.
  }
  return url;
}

function isPrivateAddress(address) {
  const ip = net.isIP(address);
  if (ip === 4) {
    const parts = address.split('.').map((x) => Number(x));
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    );
  }
  if (ip === 6) {
    const v = address.toLowerCase();
    return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80:');
  }
  return false;
}

async function assertSafeRemoteUrl(url) {
  const u = new URL(url);
  if (!/^https?:$/i.test(u.protocol)) throw new Error('不支持的资源 URL');
  const host = u.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) throw new Error('不允许从本机地址拉取远端资源');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some((x) => isPrivateAddress(x.address))) {
    throw new Error('不允许从内网地址拉取远端资源');
  }
}

function decorateItem(item) {
  return {
    ...item,
    fileUrl: `/api/resources/file/${encodeURIComponent(item.id)}`,
    thumbUrl: item.thumbRel ? `/api/resources/thumb/${encodeURIComponent(item.id)}` : '',
  };
}

function decorateItems(items) {
  return items.map(decorateItem);
}

function findItem(db, id) {
  return db.items.find((x) => x.id === id);
}

function resolveLocalSource(url, root, db) {
  const clean = toLocalPathnameIfSameApp(String(url || '')).split(/[?#]/)[0];
  const decodeTail = (prefix) => decodeURIComponent(clean.slice(prefix.length)).replace(/^[/\\]+/, '');
  if (clean.startsWith('/files/output/')) {
    const rel = decodeTail('/files/output/');
    const fp = assertInside(config.OUTPUT_DIR, path.join(config.OUTPUT_DIR, rel));
    return { filePath: fp, originalName: path.basename(rel) };
  }
  if (clean.startsWith('/files/input/')) {
    const rel = decodeTail('/files/input/');
    const fp = assertInside(config.INPUT_DIR, path.join(config.INPUT_DIR, rel));
    return { filePath: fp, originalName: path.basename(rel) };
  }
  const m = /^\/api\/resources\/file\/([^/?#]+)/.exec(clean);
  if (m) {
    const item = findItem(db, decodeURIComponent(m[1]));
    if (!item) throw new Error('资源库源文件不存在');
    return {
      filePath: assertInside(root, path.join(root, item.fileRel)),
      originalName: item.originalName || path.basename(item.fileRel),
      mime: item.mime,
    };
  }
  return null;
}

async function readSource(url, root, db) {
  const local = resolveLocalSource(url, root, db);
  if (local) {
    if (!fs.existsSync(local.filePath)) throw new Error('源文件不存在');
    return {
      buffer: fs.readFileSync(local.filePath),
      originalName: local.originalName,
      mime: local.mime || mimeFromExt(path.extname(local.originalName)),
    };
  }

  if (/^https?:\/\//i.test(url)) {
    await assertSafeRemoteUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!resp.ok) throw new Error(`拉取远端资源失败: HTTP ${resp.status}`);
      const declaredSize = Number(resp.headers.get('content-length') || 0);
      if (declaredSize > REMOTE_MAX_BYTES) throw new Error('远端资源过大');
      const ab = await resp.arrayBuffer();
      if (ab.byteLength > REMOTE_MAX_BYTES) throw new Error('远端资源过大');
      const u = new URL(url);
      const originalName = decodeURIComponent(path.basename(u.pathname || 'remote_asset')) || 'remote_asset';
      return {
        buffer: Buffer.from(ab),
        originalName,
        mime: resp.headers.get('content-type') || mimeFromExt(path.extname(originalName)),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('不支持的资源 URL');
}

async function makeImageThumb(buffer, root, id) {
  const rel = path.join(THUMB_DIR, `${id}.webp`);
  const target = path.join(root, rel);
  try {
    await sharp(buffer, { limitInputPixels: false })
      .rotate()
      .resize({ width: 420, height: 420, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(target);
    return rel.replace(/\\/g, '/');
  } catch {
    return '';
  }
}

function serveFile(req, res, filePath, mime) {
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: '文件不存在' });
  }
  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mime || 'application/octet-stream');
  if (!range) {
    res.setHeader('Content-Length', stat.size);
    return fs.createReadStream(filePath).pipe(res);
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m) {
    res.setHeader('Content-Length', stat.size);
    return fs.createReadStream(filePath).pipe(res);
  }
  const start = m[1] ? Number(m[1]) : 0;
  const end = m[2] ? Number(m[2]) : stat.size - 1;
  if (start >= stat.size || end >= stat.size || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`);
    return res.end();
  }
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Content-Length', end - start + 1);
  return fs.createReadStream(filePath, { start, end }).pipe(res);
}

router.get('/categories', (_req, res) => {
  try {
    const { db } = readDb();
    const kind = normalizeKind(_req.query.kind);
    const list = db.categories
      .filter((c) => !kind || c.kind === kind)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    res.json({ success: true, data: list });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

router.post('/categories', express.json({ limit: '1mb' }), (req, res) => {
  try {
    const kind = normalizeKind(req.body?.kind);
    const name = safeText(req.body?.name);
    if (!kind || !name) return res.status(400).json({ success: false, error: '缺少分类类型或名称' });
    const { root, db } = readDb();
    const order = db.categories.filter((c) => c.kind === kind).length;
    const item = { id: genId('rescat'), kind, name, order, system: false, createdAt: now() };
    db.categories.push(item);
    writeDb(root, db);
    res.json({ success: true, data: item });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

router.put('/categories/:id', express.json({ limit: '1mb' }), (req, res) => {
  try {
    const name = safeText(req.body?.name);
    if (!name) return res.status(400).json({ success: false, error: '缺少分类名称' });
    const { root, db } = readDb();
    const item = db.categories.find((c) => c.id === req.params.id);
    if (!item) return res.status(404).json({ success: false, error: '分类不存在' });
    item.name = name;
    writeDb(root, db);
    res.json({ success: true, data: item });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

router.delete('/categories/:id', (req, res) => {
  try {
    const { root, db } = readDb();
    const item = db.categories.find((c) => c.id === req.params.id);
    if (!item) return res.status(404).json({ success: false, error: '分类不存在' });
    if (item.system) return res.status(400).json({ success: false, error: '默认分类不能删除' });
    const fallback = `${item.kind}_uncategorized`;
    db.items.forEach((it) => {
      if (it.categoryId === item.id) it.categoryId = fallback;
    });
    db.categories = db.categories.filter((c) => c.id !== item.id);
    writeDb(root, db);
    res.json({ success: true, data: { movedTo: fallback } });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

router.get('/items', (req, res) => {
  try {
    const { db } = readDb();
    const kind = normalizeKind(req.query.kind);
    const categoryId = safeText(req.query.categoryId);
    const q = safeText(req.query.q).toLowerCase();
    const favorite = String(req.query.favorite || '') === '1';
    let list = db.items.slice();
    if (kind) list = list.filter((item) => item.kind === kind);
    if (categoryId && categoryId !== 'all') list = list.filter((item) => item.categoryId === categoryId);
    if (favorite) list = list.filter((item) => item.favorite);
    if (q) {
      list = list.filter((item) => {
        const hay = [item.title, item.originalName, item.tags.join(' '), item.mime].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    list.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
    res.json({ success: true, data: decorateItems(list) });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

router.post('/items/add', express.json({ limit: '4mb' }), async (req, res) => {
  try {
    const url = safeText(req.body?.url, '');
    if (!url) return res.status(400).json({ success: false, error: '缺少 url' });
    const { root, db } = readDb();
    const src = await readSource(url, root, db);
    const ext = normalizeExt(path.extname(src.originalName)) || extFromMime(src.mime) || 'bin';
    const kind = normalizeKind(req.body?.kind) || kindFromExt(ext) || kindFromExt(extFromMime(src.mime));
    if (!kind) return res.status(400).json({ success: false, error: '资源类型仅支持图像 / 视频 / 音频' });
    const sha256 = crypto.createHash('sha256').update(src.buffer).digest('hex');
    const existing = db.items.find((item) => item.kind === kind && item.sha256 === sha256);
    const requestedCat = safeText(req.body?.categoryId);
    const categoryOk = db.categories.some((c) => c.id === requestedCat && c.kind === kind);
    if (existing) {
      if (categoryOk) existing.categoryId = requestedCat;
      existing.updatedAt = now();
      existing.lastUsedAt = now();
      writeDb(root, db);
      return res.json({ success: true, duplicate: true, data: decorateItem(existing) });
    }

    const id = genId('res');
    const safeOriginal = safeFilename(src.originalName, `${kind}.${ext}`);
    const fileRel = path.join(kind, `${id}.${ext}`).replace(/\\/g, '/');
    const target = assertInside(root, path.join(root, fileRel));
    fs.writeFileSync(target, src.buffer);
    const thumbRel = kind === 'image' ? await makeImageThumb(src.buffer, root, id) : '';
    const fallbackCat = `${kind}_uncategorized`;
    const item = {
      id,
      kind,
      categoryId: categoryOk ? requestedCat : fallbackCat,
      title: safeText(req.body?.title, path.parse(safeOriginal).name),
      originalName: safeOriginal,
      fileRel,
      thumbRel,
      mime: safeText(src.mime, mimeFromExt(ext)),
      size: src.buffer.length,
      sha256,
      tags: Array.isArray(req.body?.tags) ? req.body.tags.map((t) => safeText(t)).filter(Boolean).slice(0, 20) : [],
      favorite: !!req.body?.favorite,
      sourceUrl: url,
      sourceNodeId: safeText(req.body?.sourceNodeId),
      sourceCanvasId: safeText(req.body?.sourceCanvasId),
      createdAt: now(),
      updatedAt: now(),
      lastUsedAt: 0,
    };
    db.items.push(item);
    writeDb(root, db);
    res.json({ success: true, duplicate: false, data: decorateItem(item) });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

router.put('/items/:id', express.json({ limit: '1mb' }), (req, res) => {
  try {
    const { root, db } = readDb();
    const item = findItem(db, req.params.id);
    if (!item) return res.status(404).json({ success: false, error: '资源不存在' });
    if (typeof req.body?.title === 'string') item.title = safeText(req.body.title, item.title);
    if (typeof req.body?.favorite !== 'undefined') item.favorite = !!req.body.favorite;
    if (Array.isArray(req.body?.tags)) item.tags = req.body.tags.map((t) => safeText(t)).filter(Boolean).slice(0, 20);
    const categoryId = safeText(req.body?.categoryId);
    if (categoryId && db.categories.some((c) => c.id === categoryId && c.kind === item.kind)) item.categoryId = categoryId;
    item.updatedAt = now();
    if (req.body?.touch) item.lastUsedAt = now();
    writeDb(root, db);
    res.json({ success: true, data: decorateItem(item) });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

router.delete('/items/:id', (req, res) => {
  try {
    const { root, db } = readDb();
    const item = findItem(db, req.params.id);
    if (!item) return res.status(404).json({ success: false, error: '资源不存在' });
    for (const rel of [item.fileRel, item.thumbRel]) {
      if (!rel) continue;
      try {
        const fp = assertInside(root, path.join(root, rel));
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch { /* ignore file cleanup */ }
    }
    db.items = db.items.filter((x) => x.id !== item.id);
    writeDb(root, db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

router.get('/file/:id', (req, res) => {
  try {
    const { root, db } = readDb();
    const item = findItem(db, req.params.id);
    if (!item) return res.status(404).json({ success: false, error: '资源不存在' });
    const fp = assertInside(root, path.join(root, item.fileRel));
    return serveFile(req, res, fp, item.mime || mimeFromExt(path.extname(fp)));
  } catch (e) {
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

router.get('/thumb/:id', (req, res) => {
  try {
    const { root, db } = readDb();
    const item = findItem(db, req.params.id);
    if (!item) return res.status(404).json({ success: false, error: '资源不存在' });
    const rel = item.thumbRel || item.fileRel;
    const fp = assertInside(root, path.join(root, rel));
    return serveFile(req, res, fp, item.thumbRel ? 'image/webp' : item.mime || mimeFromExt(path.extname(fp)));
  } catch (e) {
    return res.status(500).json({ success: false, error: e?.message || String(e) });
  }
});

module.exports = router;
