export type AnimeTagOutputMode = 'tags' | 'image';
export type AnimeTagSource = 'builtin' | 'custom' | 'danbooru' | 'gelbooru';

export interface AnimeTagCategory {
  id: string;
  name: string;
  description?: string;
  builtIn?: boolean;
}

export interface AnimeTagItem {
  id: string;
  name: string;
  chineseName: string;
  categoryId: string;
  categoryName: string;
  tags: readonly string[];
  prompt: string;
  negativePrompt?: string;
  source: AnimeTagSource;
  imageUrl?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  attributes?: string;
  postCount?: number;
  userCreated?: boolean;
}

export interface AnimeTagSearchOptions {
  query?: string;
  category?: string;
  source?: string;
  limit?: number;
}

export interface AnimeTagUserLibrary {
  categories: AnimeTagCategory[];
  items: AnimeTagItem[];
}

export interface AnimeTagMaterialInput {
  imageUrl: string;
  title?: string;
  prompt: string;
  negativePrompt?: string;
  categoryName?: string;
  tags?: string[];
  sourceNodeId?: string;
}

export interface AnimeTagOutputPayload {
  kind: 'text' | 'image';
  data: {
    directOutputText: string;
    outputText: string;
    prompt: string;
    text: string;
    directImageUrl?: string;
    imageUrl?: string;
    directImageUrls?: string[];
    imageUrls?: string[];
    lastPrompt?: string;
    animeTagId?: string;
    animeTagName?: string;
    animeTagChineseName?: string;
    animeTags?: string[];
  };
}

export interface AnimeTagExportPack extends AnimeTagUserLibrary {
  schema: typeof ANIME_TAG_MASTER_EXPORT_SCHEMA;
  exportedAt: string;
}

export interface AnimeTagOnlineProvider {
  id: 'danbooru' | 'gelbooru';
  label: string;
  aliases: string[];
  categories: readonly string[];
}

export interface OnlineSearchOptions {
  category?: string;
  limit?: number;
  safe?: boolean;
  signal?: AbortSignal;
}

export const ANIME_TAG_MASTER_STORAGE_KEY = 't8-anime-tag-master:user-library:v1';
export const ANIME_TAG_MASTER_EXPORT_SCHEMA = 't8-anime-tag-master@1';
export const ANIME_TAG_MASTER_EVENT = 'penguin:anime-tag-master-changed';

export const ANIME_TAG_ONLINE_PROVIDERS: readonly AnimeTagOnlineProvider[] = [
  {
    id: 'danbooru',
    label: 'Danbooru',
    aliases: ['danbooru', 'dan'],
    categories: ['artist', 'copyright', 'character', 'general', 'meta'],
  },
  {
    id: 'gelbooru',
    label: 'Gelbooru / Galbooru',
    aliases: ['gelbooru', 'galbooru', 'gel'],
    categories: ['artist', 'copyright', 'character', 'general'],
  },
];

const COLLATOR = new Intl.Collator('zh-Hans-CN');

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const item = textOf(value);
    if (!item) return;
    const key = item.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function simpleHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function splitTags(value: string): string[] {
  return uniqueStrings(
    value
      .replace(/\n+/g, ',')
      .split(/[,\s，、]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function fileNameFromUrl(url: string): string {
  try {
    const parsed = url.startsWith('http') ? new URL(url) : new URL(url, 'http://local');
    return decodeURIComponent(parsed.pathname.split('/').pop() || '') || 'anime-tag';
  } catch {
    return url.split(/[\\/]/).pop()?.split(/[?#]/)[0] || 'anime-tag';
  }
}

function stripExtension(value: string): string {
  return value.replace(/\.[a-z0-9]{2,8}$/i, '').trim();
}

export function slugifyAnimeTag(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'anime-tag';
}

export function normalizeAnimeTagItem(input: Partial<AnimeTagItem> & { name?: string }): AnimeTagItem {
  const name = textOf(input.name) || 'anime tag';
  const chineseName = textOf(input.chineseName) || name;
  const categoryName = textOf(input.categoryName) || '未分类';
  const categoryId = textOf(input.categoryId) || slugifyAnimeTag(categoryName);
  const prompt = textOf(input.prompt) || uniqueStrings([...(Array.isArray(input.tags) ? input.tags : []), name]).join(', ');
  const tags = uniqueStrings([
    ...(Array.isArray(input.tags) ? input.tags : []),
    ...splitTags(prompt),
    name,
    chineseName,
    categoryName,
  ]);

  return {
    id: textOf(input.id) || `${slugifyAnimeTag(name)}-${simpleHash(`${name}\n${prompt}`)}`,
    name,
    chineseName,
    categoryId,
    categoryName,
    tags,
    prompt,
    negativePrompt: textOf(input.negativePrompt),
    source: input.source || 'custom',
    imageUrl: textOf(input.imageUrl),
    thumbnailUrl: textOf(input.thumbnailUrl) || textOf(input.imageUrl),
    sourceUrl: textOf(input.sourceUrl),
    attributes: textOf(input.attributes),
    postCount: Number.isFinite(input.postCount) ? Number(input.postCount) : undefined,
    userCreated: input.userCreated ?? input.source === 'custom',
  };
}

export function normalizeAnimeTagLibrary(input: Partial<AnimeTagUserLibrary> | null | undefined): AnimeTagUserLibrary {
  const categories = Array.isArray(input?.categories)
    ? input.categories
        .map((item) => ({
          id: textOf(item?.id) || slugifyAnimeTag(textOf(item?.name)),
          name: textOf(item?.name) || textOf(item?.id) || '未分类',
          description: textOf(item?.description),
          builtIn: Boolean(item?.builtIn),
        }))
        .filter((item) => item.id && item.name)
    : [];
  const items = Array.isArray(input?.items)
    ? input.items
        .map((item) => normalizeAnimeTagItem(item))
        .filter((item) => item.name && item.tags.length)
    : [];

  return {
    categories: dedupeCategories(categories),
    items: dedupeItems(items),
  };
}

function dedupeCategories(categories: AnimeTagCategory[]): AnimeTagCategory[] {
  const byId = new Map<string, AnimeTagCategory>();
  categories.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values()).sort((a, b) => COLLATOR.compare(a.name, b.name));
}

function dedupeItems(items: AnimeTagItem[]): AnimeTagItem[] {
  const byId = new Map<string, AnimeTagItem>();
  items.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values()).sort((a, b) => COLLATOR.compare(a.chineseName || a.name, b.chineseName || b.name));
}

export function searchAnimeTags(items: readonly AnimeTagItem[], options: AnimeTagSearchOptions = {}): AnimeTagItem[] {
  const query = textOf(options.query).toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const category = textOf(options.category);
  const source = textOf(options.source);
  const limit = Number.isFinite(options.limit) ? Math.max(1, Number(options.limit)) : undefined;

  const matches = items
    .filter((item) => {
      if (category && category !== 'all' && item.categoryId !== category && item.categoryName !== category) return false;
      if (source && source !== 'all' && item.source !== source) return false;
      if (!terms.length) return true;
      const haystack = [
        item.name,
        item.chineseName,
        item.categoryId,
        item.categoryName,
        item.prompt,
        item.negativePrompt,
        item.attributes,
        item.source,
        ...item.tags,
      ].join(' ').toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => {
      const scoreA = (a.source === 'builtin' ? 0 : 1) + (a.imageUrl ? 0 : 0.4);
      const scoreB = (b.source === 'builtin' ? 0 : 1) + (b.imageUrl ? 0 : 0.4);
      return scoreA - scoreB || COLLATOR.compare(a.chineseName || a.name, b.chineseName || b.name);
    });

  return typeof limit === 'number' ? matches.slice(0, limit) : matches;
}

export function buildAnimeTagPrompt(item: AnimeTagItem): string {
  const tags = uniqueStrings(item.tags as string[]).join(', ');
  return [
    `Anime tag reference: ${item.name} (${item.chineseName})`,
    `中文分类: ${item.categoryName}`,
    `Tags: ${tags}`,
    item.prompt ? `Prompt: ${item.prompt}` : '',
    item.negativePrompt ? `Negative prompt: ${item.negativePrompt}` : '',
    item.attributes ? `Attributes: ${item.attributes}` : '',
  ].filter(Boolean).join('\n');
}

export function buildAnimeTagTextOutputPayload(item: AnimeTagItem): AnimeTagOutputPayload {
  const prompt = buildAnimeTagPrompt(item);
  return {
    kind: 'text',
    data: {
      directOutputText: prompt,
      outputText: prompt,
      prompt,
      text: prompt,
      lastPrompt: prompt,
      animeTagId: item.id,
      animeTagName: item.name,
      animeTagChineseName: item.chineseName,
      animeTags: [...item.tags],
    },
  };
}

export function buildAnimeTagImageOutputPayload(item: AnimeTagItem): AnimeTagOutputPayload {
  const prompt = buildAnimeTagPrompt(item);
  const imageUrl = textOf(item.imageUrl);
  return {
    kind: 'image',
    data: {
      directOutputText: prompt,
      outputText: prompt,
      prompt,
      text: prompt,
      lastPrompt: prompt,
      directImageUrl: imageUrl,
      imageUrl,
      directImageUrls: imageUrl ? [imageUrl] : [],
      imageUrls: imageUrl ? [imageUrl] : [],
      animeTagId: item.id,
      animeTagName: item.name,
      animeTagChineseName: item.chineseName,
      animeTags: [...item.tags],
    },
  };
}

export function buildAnimeTagOutputPayload(item: AnimeTagItem, mode: AnimeTagOutputMode): AnimeTagOutputPayload {
  return mode === 'image' ? buildAnimeTagImageOutputPayload(item) : buildAnimeTagTextOutputPayload(item);
}

export function createAnimeTagFromMaterial(input: AnimeTagMaterialInput): AnimeTagItem {
  const imageUrl = textOf(input.imageUrl);
  const prompt = textOf(input.prompt);
  const title = stripExtension(textOf(input.title) || fileNameFromUrl(imageUrl));
  const categoryName = textOf(input.categoryName) || '素材收藏';
  const tags = uniqueStrings([
    ...(Array.isArray(input.tags) ? input.tags : []),
    ...splitTags(prompt),
    categoryName,
    textOf(input.sourceNodeId),
  ]);

  return normalizeAnimeTagItem({
    id: `material-${slugifyAnimeTag(title)}-${simpleHash(`${imageUrl}\n${prompt}`)}`,
    name: title || 'anime-reference',
    chineseName: title || '动漫参考',
    categoryId: slugifyAnimeTag(categoryName),
    categoryName,
    tags,
    prompt,
    negativePrompt: input.negativePrompt,
    source: 'custom',
    imageUrl,
    thumbnailUrl: imageUrl,
    attributes: '从画布素材右键保存的动漫标签参考',
    userCreated: true,
  });
}

export function createAnimeTagExport(library: AnimeTagUserLibrary): AnimeTagExportPack {
  const normalized = normalizeAnimeTagLibrary(library);
  return {
    schema: ANIME_TAG_MASTER_EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    ...normalized,
  };
}

export function importAnimeTagExport(input: unknown): AnimeTagUserLibrary {
  const candidate = input as Partial<AnimeTagExportPack> | null | undefined;
  if (!candidate || candidate.schema !== ANIME_TAG_MASTER_EXPORT_SCHEMA) {
    throw new Error('不是有效的动漫标签大师导出文件');
  }
  return normalizeAnimeTagLibrary(candidate);
}

export function mergeAnimeTagLibraries(base: AnimeTagUserLibrary, incoming: AnimeTagUserLibrary): AnimeTagUserLibrary {
  return normalizeAnimeTagLibrary({
    categories: [...base.categories, ...incoming.categories],
    items: [...base.items, ...incoming.items],
  });
}

export function upsertAnimeTagInLibrary(
  library: AnimeTagUserLibrary,
  item: AnimeTagItem,
  category?: AnimeTagCategory,
): AnimeTagUserLibrary {
  const categories = category ? [...library.categories, category] : library.categories;
  const items = library.items.map((current) => (current.id === item.id ? item : current));
  if (!items.some((current) => current.id === item.id)) items.push(item);
  return normalizeAnimeTagLibrary({ categories, items });
}

function withSafeTag(query: string, safe: boolean | undefined): string {
  const value = query.trim();
  if (!safe) return value;
  return /\brating:/i.test(value) ? value : `${value} rating:general`;
}

export function buildDanbooruPostsUrl(query: string, options: OnlineSearchOptions = {}): string {
  const tags = encodeURIComponent(withSafeTag(query || '1girl', options.safe !== false));
  const limit = Math.max(1, Math.min(Number(options.limit || 12), 20));
  return `https://danbooru.donmai.us/posts.json?tags=${tags}&limit=${limit}&only=id,tag_string,large_file_url,file_url,preview_file_url,source,rating,score`;
}

export function buildGelbooruPostsUrl(query: string, options: OnlineSearchOptions = {}): string {
  const tags = encodeURIComponent(withSafeTag(query || '1girl', options.safe !== false));
  const limit = Math.max(1, Math.min(Number(options.limit || 12), 20));
  return `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${tags}&limit=${limit}`;
}

export function buildAnimeTagProxySearchUrl(
  provider: AnimeTagOnlineProvider['id'],
  query: string,
  options: OnlineSearchOptions = {},
): string {
  const params = new URLSearchParams({
    provider,
    q: query || '1girl',
    limit: String(Math.max(1, Math.min(Number(options.limit || 12), 20))),
    safe: options.safe === false ? '0' : '1',
  });
  return `/api/anime-tags/search?${params.toString()}`;
}

function normalizeRemoteImageUrl(value: unknown): string {
  const url = textOf(value);
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

export function mapDanbooruPostToAnimeTagItem(post: any, query: string): AnimeTagItem {
  const tags = splitTags(String(post?.tag_string || query || 'danbooru'));
  const imageUrl = normalizeRemoteImageUrl(post?.large_file_url || post?.file_url || post?.preview_file_url);
  const thumb = normalizeRemoteImageUrl(post?.preview_file_url || imageUrl);
  const name = tags.slice(0, 3).join(', ') || `danbooru-${post?.id || Date.now()}`;
  return normalizeAnimeTagItem({
    id: `danbooru-${post?.id || simpleHash(`${name}\n${imageUrl}`)}`,
    name,
    chineseName: `Danbooru ${name}`,
    categoryId: 'online-danbooru',
    categoryName: '在线图库 Danbooru',
    tags,
    prompt: tags.join(', '),
    source: 'danbooru',
    imageUrl,
    thumbnailUrl: thumb,
    sourceUrl: textOf(post?.source) || (post?.id ? `https://danbooru.donmai.us/posts/${post.id}` : ''),
    attributes: `Danbooru lazy preview · score ${post?.score ?? '-'}`,
    postCount: undefined,
    userCreated: false,
  });
}

export function mapGelbooruPostToAnimeTagItem(post: any, query: string): AnimeTagItem {
  const tags = splitTags(String(post?.tags || query || 'gelbooru'));
  const imageUrl = normalizeRemoteImageUrl(post?.file_url || post?.sample_url || post?.preview_url);
  const thumb = normalizeRemoteImageUrl(post?.preview_url || post?.sample_url || imageUrl);
  const idValue = post?.id || simpleHash(`${tags.join(',')}\n${imageUrl}`);
  const name = tags.slice(0, 3).join(', ') || `gelbooru-${idValue}`;
  return normalizeAnimeTagItem({
    id: `gelbooru-${idValue}`,
    name,
    chineseName: `Gelbooru ${name}`,
    categoryId: 'online-gelbooru',
    categoryName: '在线图库 Gelbooru',
    tags,
    prompt: tags.join(', '),
    source: 'gelbooru',
    imageUrl,
    thumbnailUrl: thumb,
    sourceUrl: post?.id ? `https://gelbooru.com/index.php?page=post&s=view&id=${post.id}` : '',
    attributes: `Gelbooru lazy preview · score ${post?.score ?? '-'}`,
    userCreated: false,
  });
}

export async function searchOnlineAnimeTags(
  provider: AnimeTagOnlineProvider['id'],
  query: string,
  options: OnlineSearchOptions = {},
): Promise<AnimeTagItem[]> {
  const proxyUrl = buildAnimeTagProxySearchUrl(provider, query, options);
  let proxyError: Error | null = null;
  try {
    const proxyResponse = await fetch(proxyUrl, {
      signal: options.signal,
      headers: { Accept: 'application/json' },
    });
    if (proxyResponse.ok) {
      const payload = await proxyResponse.json();
      const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
      return items
        .map((row: any) => normalizeAnimeTagItem(row))
        .filter((item: AnimeTagItem) => item.imageUrl || item.tags.length);
    }
    let message = `本地在线图库代理 HTTP ${proxyResponse.status}`;
    try {
      const payload = await proxyResponse.json();
      message = payload?.error || message;
    } catch {
      /* ignore */
    }
    proxyError = new Error(message);
  } catch (error: any) {
    proxyError = error instanceof Error ? error : new Error(String(error || '本地在线图库代理不可用'));
  }

  const url = provider === 'gelbooru'
    ? buildGelbooruPostsUrl(query, options)
    : buildDanbooruPostsUrl(query, options);
  try {
    const response = await fetch(url, {
      signal: options.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`${provider} HTTP ${response.status}`);
    }
    const data = await response.json();
    const rows = provider === 'gelbooru'
      ? (Array.isArray(data?.post) ? data.post : Array.isArray(data) ? data : data?.post ? [data.post] : [])
      : (Array.isArray(data) ? data : []);
    return rows
      .map((row: any) => (provider === 'gelbooru'
        ? mapGelbooruPostToAnimeTagItem(row, query)
        : mapDanbooruPostToAnimeTagItem(row, query)))
      .filter((item: AnimeTagItem) => item.imageUrl || item.tags.length);
  } catch (error: any) {
    const directMessage = error?.message || `${provider} 在线图库加载失败`;
    if (proxyError) throw new Error(`${proxyError.message}；直连也失败：${directMessage}`);
    throw new Error(directMessage);
  }
}
