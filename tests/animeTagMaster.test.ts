import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANIME_TAG_MASTER_EXPORT_SCHEMA,
  ANIME_TAG_MASTER_STORAGE_KEY,
  ANIME_TAG_ONLINE_PROVIDERS,
  buildAnimeTagImageOutputPayload,
  buildAnimeTagProxySearchUrl,
  buildAnimeTagPrompt,
  buildDanbooruPostsUrl,
  buildGelbooruPostsUrl,
  createAnimeTagExport,
  createAnimeTagFromMaterial,
  importAnimeTagExport,
  normalizeAnimeTagItem,
  searchAnimeTags,
  upsertAnimeTagInLibrary,
} from '../src/utils/animeTagMaster.ts';
import { ANIME_TAG_MASTER_ITEMS } from '../src/data/animeTagMasterManifest.ts';

function read(rel: string) {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

test('anime tag master is registered in the Inspiration category', () => {
  const types = read('../src/types/canvas.ts');
  const registry = read('../src/config/nodeRegistry.ts');
  const ports = read('../src/config/portTypes.ts');
  const canvas = read('../src/components/Canvas.tsx');
  const sidebar = read('../src/components/Sidebar.tsx');
  const placement = read('../src/utils/nodePlacement.ts');
  const server = read('../backend/src/server.js');
  const backendRoute = read('../backend/src/routes/animeTags.js');
  const features = read('../features.json');

  assert.match(types, /'anime-tag-master'/);
  assert.match(registry, /type:\s*'anime-tag-master'[\s\S]*label:\s*'动漫标签大师'[\s\S]*category:\s*'inspiration'/);
  assert.match(ports, /'anime-tag-master':\s*\{\s*inputs:\s*\['text', 'image'\],\s*outputs:\s*\['text', 'image'\]/);
  assert.match(canvas, /AnimeTagMasterNode/);
  assert.match(canvas, /import\('\.\/nodes\/AnimeTagMasterNode'\)/);
  assert.match(canvas, /'anime-tag-master': AnimeTagMasterNode/);
  assert.match(sidebar, /'anime-tag-master': 'Tags'/);
  assert.match(placement, /'anime-tag-master':\s*\{\s*w:\s*500,\s*h:\s*660\s*\}/);
  assert.match(server, /animeTagsRouter/);
  assert.match(server, /\/api\/anime-tags/);
  assert.match(backendRoute, /Gelbooru DAPI 需要 user_id\/api_key/);
  assert.match(backendRoute, /searchGelbooruHtml/);
  assert.match(backendRoute, /\/image/);
  assert.match(features, /animeTagMasterNode/);
  assert.match(features, /"type":\s*"anime-tag-master"/);
});

test('anime tag manifest and prompt output cover anime creation basics', () => {
  assert.ok(ANIME_TAG_MASTER_ITEMS.length >= 24);
  const keyVisual = searchAnimeTags(ANIME_TAG_MASTER_ITEMS, { query: '少女 海报 1girl', category: 'character' })[0];
  assert.ok(keyVisual);
  assert.match(keyVisual.tags.join(', '), /1girl/);

  const prompt = buildAnimeTagPrompt(keyVisual);
  assert.match(prompt, /Anime tag reference/);
  assert.match(prompt, /1girl/);
  assert.match(prompt, /中文/);

  const custom = normalizeAnimeTagItem({
    name: 'maid character sheet',
    chineseName: '女仆角色设定',
    categoryId: 'character',
    categoryName: '角色人设',
    tags: ['maid', 'character_sheet', 'front_view'],
    prompt: 'clean anime character sheet',
    imageUrl: '/custom/maid.webp',
  });
  const library = upsertAnimeTagInLibrary({ categories: [], items: [] }, custom, {
    id: 'character',
    name: '角色人设',
  });
  assert.equal(library.items.length, 1);
  assert.equal(library.categories[0].name, '角色人设');
});

test('anime tag master lazy-loads Danbooru and Gelbooru/Galbooru online libraries', () => {
  assert.deepEqual(ANIME_TAG_ONLINE_PROVIDERS.map((item) => item.id), ['danbooru', 'gelbooru']);
  assert.equal(ANIME_TAG_ONLINE_PROVIDERS[1].aliases.includes('galbooru'), true);

  const danbooruUrl = buildDanbooruPostsUrl('hatsune_miku', { limit: 6 });
  assert.match(danbooruUrl, /^https:\/\/danbooru\.donmai\.us\/posts\.json/);
  assert.match(danbooruUrl, /hatsune_miku/);
  assert.match(danbooruUrl, /rating%3Ageneral/);

  const gelbooruUrl = buildGelbooruPostsUrl('1girl', { limit: 6 });
  assert.match(gelbooruUrl, /^https:\/\/gelbooru\.com\/index\.php/);
  assert.match(gelbooruUrl, /page=dapi/);
  assert.match(gelbooruUrl, /tags=1girl%20rating%3Ageneral/);

  const proxyUrl = buildAnimeTagProxySearchUrl('gelbooru', '1girl', { limit: 6 });
  assert.equal(proxyUrl, '/api/anime-tags/search?provider=gelbooru&q=1girl&limit=6&safe=1');
});

test('anime tag image output carries standard image fields', () => {
  const item = normalizeAnimeTagItem({
    name: 'sakura miku',
    chineseName: '樱花初音',
    categoryId: 'character',
    categoryName: '角色人设',
    tags: ['hatsune_miku', 'sakura', 'long_hair'],
    prompt: 'sakura miku under cherry blossoms',
    imageUrl: '/anime-tags/sakura-miku.webp',
  });
  const payload = buildAnimeTagImageOutputPayload(item);
  assert.equal(payload.kind, 'image');
  assert.equal(payload.data.directImageUrl, '/anime-tags/sakura-miku.webp');
  assert.deepEqual(payload.data.directImageUrls, ['/anime-tags/sakura-miku.webp']);
  assert.deepEqual(payload.data.imageUrls, ['/anime-tags/sakura-miku.webp']);
  assert.match(payload.data.directOutputText, /hatsune_miku/);
});

test('anime tag custom library import/export and material conversion are confirmed', () => {
  assert.equal(ANIME_TAG_MASTER_STORAGE_KEY, 't8-anime-tag-master:user-library:v1');
  assert.equal(ANIME_TAG_MASTER_EXPORT_SCHEMA, 't8-anime-tag-master@1');

  const material = createAnimeTagFromMaterial({
    imageUrl: '/files/output/anime.png',
    title: 'anime-reference.png',
    prompt: '1girl, kimono, night festival',
    categoryName: '素材收藏',
    tags: ['right-click', 'reference'],
  });
  assert.equal(material.imageUrl, '/files/output/anime.png');
  assert.equal(material.userCreated, true);
  assert.match(material.tags.join(','), /kimono/);

  const exported = createAnimeTagExport({
    categories: [{ id: 'my-anime', name: '我的动漫标签' }],
    items: [material],
  });
  assert.equal(exported.schema, ANIME_TAG_MASTER_EXPORT_SCHEMA);
  const imported = importAnimeTagExport(exported);
  assert.equal(imported.items.length, 1);
  assert.equal(imported.categories[0].name, '我的动漫标签');
});

test('material context menu can save image materials to anime tag master', () => {
  const contextMenu = read('../src/components/MaterialContextMenu.tsx');
  const uploadNode = read('../src/components/nodes/UploadNode.tsx');
  const outputNode = read('../src/components/nodes/OutputNode.tsx');
  const node = read('../src/components/nodes/AnimeTagMasterNode.tsx');

  assert.match(contextMenu, /保存动漫标签到动漫标签大师/);
  assert.match(contextMenu, /openAnimeTagSaveDialog/);
  assert.match(contextMenu, /createAnimeTagFromMaterial/);
  assert.match(contextMenu, /menu\.kind !== 'image'/);
  assert.match(contextMenu, /ANIME_TAG_MASTER_EVENT/);
  assert.match(contextMenu, /请确认或修改动漫标签提示词/);
  assert.match(contextMenu, /自动获取提示词/);
  assert.match(uploadNode, /data-drag-kind="image"/);
  assert.match(outputNode, /data-prompt-template-prompt=\{mediaPromptByUrl\.get\(u\)\?\.prompt \|\| displayText\}/);
  assert.match(node, /ANIME_TAG_MASTER_EVENT/);
});

test('anime tag master frontend keeps compact scrolling, lightbox and theme hooks', () => {
  const node = read('../src/components/nodes/AnimeTagMasterNode.tsx');
  const styles = read('../src/styles/index.css');

  assert.match(node, /data-anime-tag-master-root/);
  assert.match(node, /data-anime-tag-master-drag-surface/);
  assert.match(node, /data-anime-tag-library-modal/);
  assert.match(node, /data-anime-tag-lightbox/);
  assert.match(node, /onWheelCapture=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(node, /ArrowRight/);
  assert.match(node, /ArrowLeft/);
  assert.match(node, /Danbooru/);
  assert.match(node, /Gelbooru/);
  assert.match(node, /懒加载搜索/);
  assert.match(node, /输出标签/);
  assert.match(node, /输出图像/);
  assert.match(node, /runAnimeTagOutput\('tags'\)/);
  assert.match(node, /runAnimeTagOutput\('image'\)/);
  assert.match(node, /新增分类/);
  assert.match(node, /删除分类/);
  assert.match(node, /导入/);
  assert.match(node, /导出/);
  assert.match(node, /type="file" accept="image\/\*"/);
  assert.match(node, /上传标签图/);

  assert.match(styles, /anime-tag-master-node/);
  assert.match(styles, /anime-tag-master-modal/);
  assert.match(styles, /anime-tag-master-lightbox/);
  assert.match(styles, /anime-tag-master-grid[\s\S]*overflow-y:\s*auto/);
  assert.match(styles, /anime-tag-master-grid button[\s\S]*min-width:\s*0/);
  assert.match(styles, /\[data-theme-mode="dark"\][\s\S]*anime-tag-master-node/);
  assert.match(styles, /\[data-theme-mode="light"\][\s\S]*anime-tag-master-node/);
  assert.match(styles, /color:\s*var\(--atm-text\)/);
});
