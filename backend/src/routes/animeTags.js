/**
 * Anime tag online gallery proxy.
 *
 * The front-end Anime Tag Master node lazy-loads reference previews from
 * Danbooru / Gelbooru. Direct browser requests are unreliable because both
 * sites can apply CORS, hotlink, or auth rules, so this route keeps the node
 * same-origin while mirroring the lightweight behavior from comfyui-anima-t8.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const router = express.Router();

const USER_AGENT = 'Mozilla/5.0 (T8 Penguin Canvas AnimeTagMaster/1.0)';
const GELBOORU_BASE = 'https://gelbooru.com';
const DANBOORU_BASE = 'https://danbooru.donmai.us';
const IMAGE_HOSTS = new Set(['cdn.donmai.us', 'danbooru.donmai.us', 'gelbooru.com']);

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function withSafeTag(query, safe) {
  const text = String(query || '').trim() || '1girl';
  if (!safe) return text;
  return /\brating:/i.test(text) ? text : `${text} rating:general`;
}

function normalizeRemoteUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('//')) return `https:${text}`;
  return text;
}

function proxiedImageUrl(rawUrl) {
  const url = normalizeRemoteUrl(rawUrl);
  if (!url) return '';
  return `/api/anime-tags/image?u=${encodeURIComponent(url)}`;
}

function splitTags(value) {
  return String(value || '')
    .replace(/_/g, '_')
    .split(/[,\s，、]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 80);
}

function sourceFromId(provider, id) {
  if (!id) return provider === 'danbooru' ? DANBOORU_BASE : GELBOORU_BASE;
  if (provider === 'danbooru') return `${DANBOORU_BASE}/posts/${encodeURIComponent(id)}`;
  return `${GELBOORU_BASE}/index.php?page=post&s=view&id=${encodeURIComponent(id)}`;
}

async function fetchText(url, accept = '*/*') {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: accept,
    },
    redirect: 'follow',
  });
  const text = await response.text();
  if (!response.ok) {
    const err = new Error(`HTTP ${response.status}`);
    err.status = response.status;
    err.body = text;
    throw err;
  }
  return text;
}

async function fetchJson(url) {
  const text = await fetchText(url, 'application/json,*/*');
  return JSON.parse(text || 'null');
}

function extractGelbooruRecords(data, key = 'post') {
  if (Array.isArray(data)) return data.filter((item) => item && typeof item === 'object');
  if (!data || typeof data !== 'object') return [];
  const direct = data[key];
  if (Array.isArray(direct)) return direct.filter((item) => item && typeof item === 'object');
  if (direct && typeof direct === 'object') return [direct];
  const plural = data[`${key}s`];
  if (Array.isArray(plural)) return plural.filter((item) => item && typeof item === 'object');
  if (plural && typeof plural === 'object') {
    const nested = plural[key];
    if (Array.isArray(nested)) return nested.filter((item) => item && typeof item === 'object');
    if (nested && typeof nested === 'object') return [nested];
  }
  if (key === 'post' && (data.file_url || data.preview_url || data.sample_url)) return [data];
  return [];
}

function loadGelbooruAuth() {
  const envKey = String(process.env.GELBOORU_API_KEY || '').trim();
  const envUid = String(process.env.GELBOORU_USER_ID || '').trim();
  if (envKey && envUid) return { apiKey: envKey, userId: envUid };
  try {
    const authPath = path.join(config.DATA_DIR, 'gelbooru_auth.json');
    if (fs.existsSync(authPath)) {
      const data = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
      const apiKey = String(data.api_key || '').trim();
      const userId = String(data.user_id || '').trim();
      if (apiKey && userId) return { apiKey, userId };
    }
  } catch {
    // Optional auth only.
  }
  return { apiKey: '', userId: '' };
}

function mapDanbooruPost(post, query) {
  const rawUrl = normalizeRemoteUrl(post.large_file_url || post.file_url || post.preview_file_url);
  const rawThumb = normalizeRemoteUrl(post.preview_file_url || rawUrl);
  const tags = splitTags(post.tag_string || query || 'danbooru');
  const id = post.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `danbooru-${id}`,
    provider: 'danbooru',
    name: tags.slice(0, 3).join(', ') || `danbooru-${id}`,
    chineseName: `Danbooru ${tags.slice(0, 3).join(', ') || id}`,
    categoryId: 'online-danbooru',
    categoryName: '在线图库 Danbooru',
    tags,
    prompt: tags.join(', '),
    source: 'danbooru',
    imageUrl: proxiedImageUrl(rawUrl),
    thumbnailUrl: proxiedImageUrl(rawThumb || rawUrl),
    rawImageUrl: rawUrl,
    rawThumbnailUrl: rawThumb || rawUrl,
    sourceUrl: sourceFromId('danbooru', id),
    attributes: `Danbooru lazy preview · score ${post.score ?? '-'}`,
  };
}

function mapGelbooruPost(post, query) {
  const rawUrl = normalizeRemoteUrl(post.file_url || post.sample_url || post.preview_url);
  const rawThumb = normalizeRemoteUrl(post.preview_url || post.sample_url || rawUrl);
  const tags = splitTags(post.tags || query || 'gelbooru');
  const id = post.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `gelbooru-${id}`,
    provider: 'gelbooru',
    name: tags.slice(0, 3).join(', ') || `gelbooru-${id}`,
    chineseName: `Gelbooru ${tags.slice(0, 3).join(', ') || id}`,
    categoryId: 'online-gelbooru',
    categoryName: '在线图库 Gelbooru',
    tags,
    prompt: tags.join(', '),
    source: 'gelbooru',
    imageUrl: proxiedImageUrl(rawUrl),
    thumbnailUrl: proxiedImageUrl(rawThumb || rawUrl),
    rawImageUrl: rawUrl,
    rawThumbnailUrl: rawThumb || rawUrl,
    sourceUrl: sourceFromId('gelbooru', id),
    attributes: `Gelbooru lazy preview · score ${post.score ?? '-'}`,
  };
}

async function searchDanbooru(query, { limit, safe }) {
  const params = new URLSearchParams({
    tags: withSafeTag(query, safe),
    limit: String(limit),
    only: 'id,tag_string,large_file_url,file_url,preview_file_url,source,rating,score',
  });
  const rows = await fetchJson(`${DANBOORU_BASE}/posts.json?${params.toString()}`);
  return Array.isArray(rows) ? rows.map((row) => mapDanbooruPost(row, query)) : [];
}

async function searchGelbooruDapi(query, { limit, safe }) {
  const auth = loadGelbooruAuth();
  const params = new URLSearchParams({
    page: 'dapi',
    s: 'post',
    q: 'index',
    json: '1',
    limit: String(limit),
    pid: '0',
    tags: withSafeTag(query, safe),
  });
  if (auth.apiKey && auth.userId) {
    params.set('api_key', auth.apiKey);
    params.set('user_id', auth.userId);
  }
  const data = await fetchJson(`${GELBOORU_BASE}/index.php?${params.toString()}`);
  return extractGelbooruRecords(data, 'post').map((row) => mapGelbooruPost(row, query));
}

async function searchGelbooruHtml(query, { limit, safe }) {
  const params = new URLSearchParams({
    page: 'post',
    s: 'list',
    tags: withSafeTag(query, safe),
  });
  const html = await fetchText(`${GELBOORU_BASE}/index.php?${params.toString()}`, 'text/html,*/*');
  const imageMatches = [...html.matchAll(/(?:src|data-original|href)=["']([^"']+(?:thumbnail|samples|images)[^"']+?\.(?:jpg|jpeg|png|webp))(?:\?[^"']*)?["']/gi)]
    .map((m) => normalizeRemoteUrl(m[1]));
  const idMatches = [...html.matchAll(/index\.php\?page=post(?:&amp;|&)s=view(?:&amp;|&)id=(\d+)/g)]
    .map((m) => m[1]);
  const seen = new Set();
  const rows = [];
  for (let i = 0; i < imageMatches.length && rows.length < limit; i += 1) {
    const imageUrl = imageMatches[i];
    if (!imageUrl || seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    rows.push(mapGelbooruPost({
      id: idMatches[i] || `html-${i}-${imageUrl}`,
      tags: query,
      preview_url: imageUrl,
      sample_url: imageUrl,
      file_url: imageUrl,
      score: 'html',
    }, query));
  }
  return rows;
}

router.get('/search', async (req, res) => {
  const provider = String(req.query.provider || 'danbooru').trim().toLowerCase();
  const normalizedProvider = provider === 'galbooru' ? 'gelbooru' : provider;
  const query = String(req.query.q || req.query.query || '').trim();
  const limit = clampInt(req.query.limit, 1, 20, 12);
  const safe = req.query.safe !== '0' && req.query.safe !== 'false';

  if (!['danbooru', 'gelbooru'].includes(normalizedProvider)) {
    return res.status(400).json({ success: false, error: '不支持的在线图库来源' });
  }
  if (!query) {
    return res.status(400).json({ success: false, error: '请输入搜索词' });
  }

  try {
    let items = [];
    let source = 'api';
    let warning = '';
    if (normalizedProvider === 'gelbooru') {
      try {
        items = await searchGelbooruDapi(query, { limit, safe });
      } catch (error) {
        warning = error?.status === 401
          ? 'Gelbooru DAPI 需要 user_id/api_key，已切换公开 HTML 兜底。'
          : `Gelbooru DAPI 失败，已切换公开 HTML 兜底：${error?.message || error}`;
      }
      if (!items.length) {
        source = 'html';
        items = await searchGelbooruHtml(query, { limit, safe });
      }
    } else {
      items = await searchDanbooru(query, { limit, safe });
    }
    return res.json({
      success: true,
      data: { provider: normalizedProvider, query, source, warning, items },
    });
  } catch (error) {
    const message = error?.message || '在线图库加载失败';
    return res.status(error?.status || 502).json({
      success: false,
      error: message,
      code: normalizedProvider === 'danbooru' ? 'danbooru_unavailable' : 'gelbooru_unavailable',
    });
  }
});

router.get('/image', async (req, res) => {
  const raw = String(req.query.u || '').trim();
  if (!raw) return res.status(400).json({ success: false, error: '缺少图片 URL' });
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return res.status(400).json({ success: false, error: '图片 URL 无效' });
  }
  const hostname = (parsed.hostname || '').toLowerCase();
  const allowed = IMAGE_HOSTS.has(hostname) || hostname.endsWith('.gelbooru.com') || hostname.endsWith('.donmai.us');
  if (!allowed || !['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ success: false, error: `不允许代理该图片域名：${hostname}` });
  }
  try {
    const referer = hostname.includes('gelbooru') ? GELBOORU_BASE : DANBOORU_BASE;
    const response = await fetch(parsed.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${referer}/`,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(buffer);
  } catch (error) {
    return res.status(502).json({ success: false, error: error?.message || '图片代理失败' });
  }
});

module.exports = router;
module.exports._internals = {
  withSafeTag,
  extractGelbooruRecords,
  mapGelbooruPost,
  searchGelbooruHtml,
};
