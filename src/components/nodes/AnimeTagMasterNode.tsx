import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Images,
  Library,
  Plus,
  Save,
  Search,
  Tags,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { PORT_COLOR } from '../../config/portTypes';
import { ANIME_TAG_MASTER_CATEGORIES, ANIME_TAG_MASTER_ITEMS } from '../../data/animeTagMasterManifest';
import { useRunTrigger } from '../../hooks/useRunTrigger';
import { defaultSizeOf, placeSingleNode } from '../../utils/nodePlacement';
import {
  ANIME_TAG_MASTER_EVENT,
  ANIME_TAG_MASTER_STORAGE_KEY,
  ANIME_TAG_ONLINE_PROVIDERS,
  buildAnimeTagOutputPayload,
  buildAnimeTagPrompt,
  createAnimeTagExport,
  importAnimeTagExport,
  mergeAnimeTagLibraries,
  normalizeAnimeTagItem,
  normalizeAnimeTagLibrary,
  searchAnimeTags,
  searchOnlineAnimeTags,
  slugifyAnimeTag,
  upsertAnimeTagInLibrary,
  type AnimeTagCategory,
  type AnimeTagItem,
  type AnimeTagOutputMode,
  type AnimeTagUserLibrary,
} from '../../utils/animeTagMaster';
import { useUpdateNodeData } from './useUpdateNodeData';

const EMPTY_LIBRARY: AnimeTagUserLibrary = { categories: [], items: [] };
const EMPTY_CUSTOM_DRAFT = {
  name: '',
  chineseName: '',
  category: '',
  tags: '',
  prompt: '',
  negativePrompt: '',
  imageUrl: '',
  attributes: '',
};

const handleStyle = {
  width: 12,
  height: 12,
  border: '2px solid var(--atm-handle-border, #0f172a)',
  boxShadow: '0 0 0 2px var(--atm-bg, #f7fee7)',
};

function stopCanvasWheel(event: React.WheelEvent) {
  event.stopPropagation();
}

function readLibrary(): AnimeTagUserLibrary {
  if (typeof window === 'undefined') return EMPTY_LIBRARY;
  try {
    const raw = window.localStorage.getItem(ANIME_TAG_MASTER_STORAGE_KEY);
    return raw ? normalizeAnimeTagLibrary(JSON.parse(raw)) : EMPTY_LIBRARY;
  } catch {
    return EMPTY_LIBRARY;
  }
}

function writeLibrary(library: AnimeTagUserLibrary) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ANIME_TAG_MASTER_STORAGE_KEY, JSON.stringify(normalizeAnimeTagLibrary(library)));
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toCategoryOptions(items: readonly AnimeTagCategory[]) {
  return items.map((item) => ({
    value: item.id,
    label: item.name,
  }));
}

function previewImageOf(item?: AnimeTagItem | null) {
  return item?.thumbnailUrl || item?.imageUrl || '';
}

function AnimeTagMasterNode({ id, data, selected }: NodeProps) {
  const rf = useReactFlow();
  const update = useUpdateNodeData(id);
  const importRef = useRef<HTMLInputElement | null>(null);
  const customImageUploadRef = useRef<HTMLInputElement | null>(null);
  const onlineAbortRef = useRef<AbortController | null>(null);
  const [library, setLibrary] = useState<AnimeTagUserLibrary>(() => readLibrary());
  const [query, setQuery] = useState(String((data as any)?.animeTagQuery || ''));
  const [category, setCategory] = useState(String((data as any)?.animeTagCategory || 'all'));
  const [source, setSource] = useState(String((data as any)?.animeTagSource || 'all'));
  const [provider, setProvider] = useState<'danbooru' | 'gelbooru'>(
    (data as any)?.animeTagProvider === 'gelbooru' ? 'gelbooru' : 'danbooru',
  );
  const [onlineQuery, setOnlineQuery] = useState(String((data as any)?.animeTagOnlineQuery || '1girl'));
  const [onlineResults, setOnlineResults] = useState<AnimeTagItem[]>([]);
  const [outputMode, setOutputMode] = useState<AnimeTagOutputMode>(
    (data as any)?.animeTagOutputMode === 'image' ? 'image' : 'tags',
  );
  const [selectedId, setSelectedId] = useState(String((data as any)?.animeTagSelectedId || ANIME_TAG_MASTER_ITEMS[0]?.id || ''));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renameCategoryId, setRenameCategoryId] = useState('');
  const [renameCategoryName, setRenameCategoryName] = useState('');
  const [customDraft, setCustomDraft] = useState(EMPTY_CUSTOM_DRAFT);
  const [editingItemId, setEditingItemId] = useState('');
  const [status, setStatus] = useState('搜索动漫标签，运行后输出标签文本或图库参考图。');

  useEffect(() => {
    writeLibrary(library);
  }, [library]);

  useEffect(() => {
    const onLibraryChanged = () => setLibrary(readLibrary());
    window.addEventListener(ANIME_TAG_MASTER_EVENT, onLibraryChanged);
    return () => window.removeEventListener(ANIME_TAG_MASTER_EVENT, onLibraryChanged);
  }, []);

  const allItems = useMemo(() => {
    return [...ANIME_TAG_MASTER_ITEMS, ...library.items, ...onlineResults] as AnimeTagItem[];
  }, [library.items, onlineResults]);

  const categoryOptions = useMemo(() => {
    const merged = new Map<string, AnimeTagCategory>();
    [...ANIME_TAG_MASTER_CATEGORIES, ...library.categories].forEach((item) => {
      if (item.id) merged.set(item.id, item);
    });
    onlineResults.forEach((item) => {
      merged.set(item.categoryId, { id: item.categoryId, name: item.categoryName, builtIn: true });
    });
    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }, [library.categories, onlineResults]);

  const filteredItems = useMemo(() => {
    return searchAnimeTags(allItems, { query, category, source, limit: libraryOpen ? undefined : 12 });
  }, [allItems, category, libraryOpen, query, source]);

  const selectedTag = useMemo(() => {
    return allItems.find((item) => item.id === selectedId) || filteredItems[0] || allItems[0];
  }, [allItems, filteredItems, selectedId]);

  useEffect(() => {
    if (selectedTag && selectedTag.id !== selectedId) {
      setSelectedId(selectedTag.id);
    }
  }, [selectedId, selectedTag]);

  useEffect(() => {
    update({
      animeTagQuery: query,
      animeTagCategory: category,
      animeTagSource: source,
      animeTagProvider: provider,
      animeTagOnlineQuery: onlineQuery,
      animeTagOutputMode: outputMode,
      animeTagSelectedId: selectedTag?.id,
    });
  }, [category, onlineQuery, outputMode, provider, query, selectedTag?.id, source, update]);

  const openLightbox = useCallback((item: AnimeTagItem) => {
    if (!item.imageUrl) return;
    const index = filteredItems.findIndex((candidate) => candidate.id === item.id);
    setSelectedId(item.id);
    setLightboxIndex(Math.max(0, index));
  }, [filteredItems]);

  const moveLightbox = useCallback((delta: number) => {
    setLightboxIndex((current) => {
      const imageItems = filteredItems.filter((item) => item.imageUrl);
      const total = imageItems.length;
      if (current === null || total < 1) return current;
      return (current + delta + total) % total;
    });
  }, [filteredItems]);

  useEffect(() => {
    if (lightboxIndex === null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxIndex(null);
      if (event.key === 'ArrowRight') moveLightbox(1);
      if (event.key === 'ArrowLeft') moveLightbox(-1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxIndex, moveLightbox]);

  const copyPrompt = useCallback(async (item = selectedTag) => {
    if (!item) return;
    const prompt = buildAnimeTagPrompt(item);
    await navigator.clipboard?.writeText(prompt);
    setStatus('已复制动漫标签提示词。');
  }, [selectedTag]);

  const searchOnline = useCallback(async () => {
    const term = onlineQuery.trim();
    if (!term) {
      setStatus('请输入 Danbooru / Gelbooru 搜索词。');
      return;
    }
    onlineAbortRef.current?.abort();
    const controller = new AbortController();
    onlineAbortRef.current = controller;
    setStatus(`正在懒加载 ${provider === 'danbooru' ? 'Danbooru' : 'Gelbooru'} 图片与标签...`);
    try {
      const timeout = window.setTimeout(() => controller.abort(), 12000);
      const items = await searchOnlineAnimeTags(provider, term, { limit: 12, signal: controller.signal });
      window.clearTimeout(timeout);
      setOnlineResults(items);
      if (items[0]) {
        setSelectedId(items[0].id);
        setCategory(items[0].categoryId);
        setSource(provider);
      }
      setStatus(items.length ? `已懒加载 ${items.length} 个在线结果。` : '在线图库没有返回结果，换个关键词试试。');
    } catch (error: any) {
      setStatus(`在线图库加载失败：${error?.message || '网络或跨域错误'}`);
    }
  }, [onlineQuery, provider]);

  const saveCurrentTag = useCallback(() => {
    if (!selectedTag) return;
    const saved = normalizeAnimeTagItem({
      ...selectedTag,
      id: `saved-${selectedTag.id}`,
      source: 'custom',
      userCreated: true,
    });
    setLibrary((current) => upsertAnimeTagInLibrary(current, saved, {
      id: saved.categoryId,
      name: saved.categoryName,
    }));
    setStatus('已保存到动漫标签大师自定义库。');
  }, [selectedTag]);

  const addCategory = useCallback(() => {
    const name = newCategoryName.trim();
    if (!name) return;
    const next: AnimeTagCategory = { id: slugifyAnimeTag(name), name };
    setLibrary((current) => mergeAnimeTagLibraries(current, { categories: [next], items: [] }));
    setNewCategoryName('');
    setStatus('新增分类已保存。');
  }, [newCategoryName]);

  const renameCategory = useCallback(() => {
    if (!renameCategoryId || !renameCategoryName.trim()) return;
    const name = renameCategoryName.trim();
    setLibrary((current) => normalizeAnimeTagLibrary({
      categories: current.categories.map((item) => (item.id === renameCategoryId ? { ...item, name } : item)),
      items: current.items.map((item) => (
        item.categoryId === renameCategoryId ? { ...item, categoryName: name } : item
      )),
    }));
    setStatus('分类已重命名。');
  }, [renameCategoryId, renameCategoryName]);

  const deleteCategory = useCallback(() => {
    if (!renameCategoryId) return;
    setLibrary((current) => normalizeAnimeTagLibrary({
      categories: current.categories.filter((item) => item.id !== renameCategoryId),
      items: current.items.map((item) => (
        item.categoryId === renameCategoryId ? { ...item, categoryId: 'uncategorized', categoryName: '未分类' } : item
      )),
    }));
    setRenameCategoryId('');
    setRenameCategoryName('');
    setStatus('分类已删除，相关标签移动到未分类。');
  }, [renameCategoryId]);

  const saveCustomTag = useCallback(() => {
    if (!customDraft.name.trim() || (!customDraft.tags.trim() && !customDraft.prompt.trim())) {
      setStatus('新增动漫标签至少需要名称和标签/提示词。');
      return;
    }
    const categoryName = customDraft.category.trim() || '未分类';
    const existing = editingItemId ? library.items.find((item) => item.id === editingItemId) : undefined;
    const tag = normalizeAnimeTagItem({
      id: editingItemId || undefined,
      name: customDraft.name,
      chineseName: customDraft.chineseName || customDraft.name,
      categoryId: slugifyAnimeTag(categoryName),
      categoryName,
      tags: customDraft.tags.split(/[,\s，、]+/).filter(Boolean),
      prompt: customDraft.prompt || customDraft.tags,
      negativePrompt: customDraft.negativePrompt,
      imageUrl: customDraft.imageUrl,
      thumbnailUrl: customDraft.imageUrl,
      attributes: customDraft.attributes,
      source: 'custom',
      postCount: existing?.postCount,
      userCreated: true,
    });
    setLibrary((current) => upsertAnimeTagInLibrary(current, tag, { id: tag.categoryId, name: tag.categoryName }));
    setSelectedId(tag.id);
    setCustomDraft(EMPTY_CUSTOM_DRAFT);
    setEditingItemId('');
    setStatus(editingItemId ? '自定义动漫标签已更新。' : '自定义动漫标签已保存。');
  }, [customDraft, editingItemId, library.items]);

  const editUserTag = useCallback((item: AnimeTagItem) => {
    if (!item.userCreated) return;
    setEditingItemId(item.id);
    setCustomDraft({
      name: item.name,
      chineseName: item.chineseName,
      category: item.categoryName,
      tags: [...item.tags].join(', '),
      prompt: item.prompt,
      negativePrompt: item.negativePrompt || '',
      imageUrl: item.imageUrl || '',
      attributes: item.attributes || '',
    });
    setStatus('正在编辑自定义动漫标签。');
  }, []);

  const deleteUserTag = useCallback((itemId: string) => {
    setLibrary((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== itemId),
    }));
    if (editingItemId === itemId) {
      setEditingItemId('');
      setCustomDraft(EMPTY_CUSTOM_DRAFT);
    }
    setStatus('自定义动漫标签已删除。');
  }, [editingItemId]);

  const exportLibrary = useCallback(() => {
    downloadJson(`anime-tag-master-${Date.now()}.json`, createAnimeTagExport(library));
    setStatus('已导出动漫标签大师配置。');
  }, [library]);

  const importLibrary = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = importAnimeTagExport(parsed);
      setLibrary((current) => mergeAnimeTagLibraries(current, imported));
      setStatus('导入完成。');
    } catch (error: any) {
      setStatus(error?.message || '导入失败。');
    }
  }, []);

  const handleCustomImageUpload = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('请选择图片文件。');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = typeof reader.result === 'string' ? reader.result : '';
      const name = file.name.replace(/\.[^.]+$/, '');
      setCustomDraft((draft) => ({
        ...draft,
        name: draft.name || name,
        chineseName: draft.chineseName || name,
        imageUrl,
      }));
      setStatus('已上传标签图，保存后进入对应自定义分类。');
    };
    reader.onerror = () => setStatus('读取图片失败，请重试。');
    reader.readAsDataURL(file);
  }, []);

  const runAnimeTagOutput = useCallback(async (mode: AnimeTagOutputMode = outputMode) => {
    if (!selectedTag) throw new Error('请先选择一个动漫标签');
    if (mode === 'image' && !selectedTag.imageUrl) {
      setStatus('当前标签没有图像，请先懒加载在线图库或上传自定义图片。');
      return;
    }
    const payload = buildAnimeTagOutputPayload(selectedTag, mode);
    const nodes = rf.getNodes();
    const me = rf.getNode(id);
    const mySize = defaultSizeOf('anime-tag-master');
    const baseX = (me?.position.x ?? 0) + ((me as any)?.measured?.width || mySize.w) + 80;
    const baseY = me?.position.y ?? 0;
    const position = placeSingleNode(baseX, baseY, 'output', nodes, { source: `placement:anime-tag-master-output:${id}` });
    const outputNode: Node = {
      id: `anime-tag-output-${mode}-${Date.now()}`,
      type: 'output',
      position,
      data: {
        ...payload.data,
        title: mode === 'image' ? `${selectedTag.chineseName} 标签图` : `${selectedTag.chineseName} 标签提示词`,
        animeTagOutputMode: mode,
        sourceNodeId: id,
      },
    };
    rf.addNodes(outputNode);
    update({
      lastAnimeTagOutputMode: mode,
      lastAnimeTagText: payload.data.directOutputText,
      lastAnimeTagImageUrl: payload.data.directImageUrl || '',
    });
    setStatus(mode === 'image' ? '已输出动漫标签图像。' : '已输出动漫标签提示词。');
  }, [id, outputMode, rf, selectedTag, update]);

  const handleRun = useCallback(() => runAnimeTagOutput(outputMode), [outputMode, runAnimeTagOutput]);
  useRunTrigger(id, handleRun, 'anime-tag-master');

  const imageItems = filteredItems.filter((item) => item.imageUrl);
  const activeLightboxTag = lightboxIndex === null ? null : imageItems[lightboxIndex] || imageItems[0];

  const libraryModal = libraryOpen ? createPortal(
    <div className="anime-tag-master-modal-backdrop nodrag nopan" onWheelCapture={(event) => event.stopPropagation()}>
      <section className="anime-tag-master-modal" data-anime-tag-library-modal onWheelCapture={stopCanvasWheel}>
        <header className="anime-tag-master-modal-header">
          <div>
            <div className="anime-tag-master-kicker">灵感之源</div>
            <h2>动漫标签大师</h2>
            <p>管理常用动漫标签，按需懒加载 Danbooru / Gelbooru 在线图库。</p>
          </div>
          <button type="button" className="atm-icon-button" aria-label="关闭动漫标签库" onClick={() => setLibraryOpen(false)}>
            <X size={18} />
          </button>
        </header>

        <div className="anime-tag-master-modal-tools">
          <label className="anime-tag-master-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索中文 / 英文 / booru tag" />
          </label>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">全部分类</option>
            {toCategoryOptions(categoryOptions).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="all">全部来源</option>
            <option value="builtin">内置</option>
            <option value="custom">自定义</option>
            <option value="danbooru">Danbooru</option>
            <option value="gelbooru">Gelbooru</option>
          </select>
          <button type="button" onClick={exportLibrary}><Download size={15} /> 导出</button>
          <button type="button" onClick={() => importRef.current?.click()}><Upload size={15} /> 导入</button>
          <input ref={importRef} type="file" accept="application/json" className="hidden" onChange={importLibrary} />
        </div>

        <div className="anime-tag-master-modal-layout">
          <div className="anime-tag-master-gallery" onWheelCapture={stopCanvasWheel}>
            {filteredItems.map((item) => (
              <article key={item.id} className={`anime-tag-master-card ${selectedTag?.id === item.id ? 'is-selected' : ''}`}>
                <button type="button" className="anime-tag-master-thumb-button" onClick={() => item.imageUrl ? openLightbox(item) : setSelectedId(item.id)}>
                  {previewImageOf(item) ? (
                    <img src={previewImageOf(item)} alt={`${item.name} ${item.chineseName}`} loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="anime-tag-master-no-image"><Tags size={26} /> TAG</span>
                  )}
                </button>
                <div className="anime-tag-master-card-body">
                  <strong>{item.chineseName}</strong>
                  <span>{item.name}</span>
                  <small>{item.categoryName} · {item.source}</small>
                  <p>{item.tags.slice(0, 12).join(', ')}</p>
                  <div className="anime-tag-master-card-actions">
                    <button type="button" onClick={() => setSelectedId(item.id)}>选用</button>
                    <button type="button" onClick={() => void copyPrompt(item)}>复制标签</button>
                    {item.userCreated ? <button type="button" onClick={() => editUserTag(item)}>编辑</button> : null}
                    {item.userCreated ? <button type="button" className="danger" onClick={() => deleteUserTag(item.id)}>删除</button> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <aside className="anime-tag-master-manager" onWheelCapture={stopCanvasWheel}>
            <h3><Library size={16} /> 在线图库懒加载</h3>
            <div className="anime-tag-master-inline-form">
              <select value={provider} onChange={(event) => setProvider(event.target.value === 'gelbooru' ? 'gelbooru' : 'danbooru')}>
                {ANIME_TAG_ONLINE_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <input value={onlineQuery} onChange={(event) => setOnlineQuery(event.target.value)} placeholder="例如 hatsune_miku / 1girl" />
              <button type="button" onClick={() => void searchOnline()}>懒加载搜索</button>
            </div>

            <h3><Save size={16} /> 保存当前标签</h3>
            <button type="button" className="anime-tag-master-wide-button" onClick={saveCurrentTag}>保存到自定义库</button>

            <h3><Plus size={16} /> 新增分类</h3>
            <div className="anime-tag-master-inline-form">
              <input value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="分类名称，例如：洛丽塔服饰" />
              <button type="button" onClick={addCategory}>新增分类</button>
            </div>

            <h3><BookOpen size={16} /> 重命名 / 删除分类</h3>
            <select value={renameCategoryId} onChange={(event) => {
              setRenameCategoryId(event.target.value);
              const item = library.categories.find((candidate) => candidate.id === event.target.value);
              setRenameCategoryName(item?.name || '');
            }}>
              <option value="">选择自定义分类</option>
              {library.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <div className="anime-tag-master-inline-form">
              <input value={renameCategoryName} onChange={(event) => setRenameCategoryName(event.target.value)} placeholder="新分类名" />
              <button type="button" onClick={renameCategory}>重命名分类</button>
              <button type="button" className="danger" onClick={deleteCategory}>删除分类</button>
            </div>

            <h3><Tags size={16} /> {editingItemId ? '编辑自定义动漫标签' : '新增自定义动漫标签'}</h3>
            <input value={customDraft.name} onChange={(event) => setCustomDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="原始 tag / 英文名" />
            <input value={customDraft.chineseName} onChange={(event) => setCustomDraft((draft) => ({ ...draft, chineseName: event.target.value }))} placeholder="中文翻译" />
            <input value={customDraft.category} onChange={(event) => setCustomDraft((draft) => ({ ...draft, category: event.target.value }))} placeholder="分类" />
            <div className="anime-tag-master-custom-upload">
              {customDraft.imageUrl ? (
                <img src={customDraft.imageUrl} alt="自定义动漫标签预览" />
              ) : (
                <div className="anime-tag-master-custom-upload-placeholder">未上传</div>
              )}
              <div>
                <button type="button" onClick={() => customImageUploadRef.current?.click()}>
                  <Upload size={15} /> 上传标签图
                </button>
                <small>可直接上传本地图片，保存后进入对应自定义分类。</small>
              </div>
              <input type="file" accept="image/*" ref={customImageUploadRef} className="hidden" onChange={handleCustomImageUpload} />
            </div>
            <textarea value={customDraft.tags} onChange={(event) => setCustomDraft((draft) => ({ ...draft, tags: event.target.value }))} placeholder="标签，用逗号分隔，例如：1girl, solo, kimono" />
            <textarea value={customDraft.prompt} onChange={(event) => setCustomDraft((draft) => ({ ...draft, prompt: event.target.value }))} placeholder="提示词说明，可留空时使用标签" />
            <input value={customDraft.negativePrompt} onChange={(event) => setCustomDraft((draft) => ({ ...draft, negativePrompt: event.target.value }))} placeholder="负面提示词（可选）" />
            <textarea value={customDraft.attributes} onChange={(event) => setCustomDraft((draft) => ({ ...draft, attributes: event.target.value }))} placeholder="属性信息 / 用途说明" />
            <div className="anime-tag-master-custom-actions">
              <button type="button" className="anime-tag-master-wide-button" onClick={saveCustomTag}>
                {editingItemId ? '更新自定义标签' : '保存自定义标签'}
              </button>
              {editingItemId ? (
                <button type="button" className="anime-tag-master-wide-button" onClick={() => {
                  setEditingItemId('');
                  setCustomDraft(EMPTY_CUSTOM_DRAFT);
                }}>
                  取消编辑
                </button>
              ) : null}
            </div>

            <div className="anime-tag-master-status">{status}</div>
          </aside>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  const lightbox = activeLightboxTag ? createPortal(
    <div className="anime-tag-master-lightbox-backdrop nodrag nopan" data-anime-tag-lightbox onWheelCapture={(event) => event.stopPropagation()}>
      <button type="button" className="atm-icon-button lightbox-close" aria-label="关闭预览" onClick={() => setLightboxIndex(null)}>
        <X size={18} />
      </button>
      <button type="button" className="atm-icon-button lightbox-prev" aria-label="上一张" onClick={() => moveLightbox(-1)}>
        <ChevronLeft size={22} />
      </button>
      <figure className="anime-tag-master-lightbox">
        <img src={activeLightboxTag.imageUrl} alt={`${activeLightboxTag.name} ${activeLightboxTag.chineseName}`} referrerPolicy="no-referrer" />
        <figcaption>
          <strong>{activeLightboxTag.chineseName}</strong>
          <span>{activeLightboxTag.name} · {activeLightboxTag.categoryName}</span>
          <p>{activeLightboxTag.tags.slice(0, 18).join(', ')}</p>
          <button type="button" onClick={() => void copyPrompt(activeLightboxTag)}>复制标签提示词</button>
        </figcaption>
      </figure>
      <button type="button" className="atm-icon-button lightbox-next" aria-label="下一张" onClick={() => moveLightbox(1)}>
        <ChevronRight size={22} />
      </button>
    </div>,
    document.body,
  ) : null;

  return (
    <div
      className={`anime-tag-master-node ${selected ? 'is-selected' : ''}`}
      data-anime-tag-master-root
      onWheelCapture={(event) => event.stopPropagation()}
    >
      <Handle id="text" type="target" position={Position.Left} style={{ ...handleStyle, background: PORT_COLOR.text, top: 166 }} />
      <Handle id="image" type="target" position={Position.Left} style={{ ...handleStyle, background: PORT_COLOR.image, top: 204 }} />
      <Handle id="text" type="source" position={Position.Right} style={{ ...handleStyle, background: PORT_COLOR.text, top: 164 }} />
      <Handle id="image" type="source" position={Position.Right} style={{ ...handleStyle, background: PORT_COLOR.image, top: 204 }} />

      <header className="anime-tag-master-header" data-anime-tag-master-drag-surface>
        <div className="anime-tag-master-icon"><Tags size={22} /></div>
        <div>
          <h3>动漫标签大师</h3>
          <p>Danbooru / Gelbooru 懒加载标签图鉴</p>
        </div>
        <button type="button" className="atm-icon-button nodrag nopan" aria-label="打开动漫标签库" onClick={() => setLibraryOpen(true)}>
          <Images size={18} />
        </button>
      </header>

      <section className="anime-tag-master-section nodrag nopan">
        <div className="anime-tag-master-selected">
          {previewImageOf(selectedTag) ? (
            <img src={previewImageOf(selectedTag)} alt={selectedTag?.name || '动漫标签'} referrerPolicy="no-referrer" />
          ) : (
            <div className="anime-tag-master-selected-placeholder"><Tags size={24} /></div>
          )}
          <div>
            <strong>{selectedTag?.chineseName || '请选择标签'}</strong>
            <span>{selectedTag?.name || 'No tag selected'}</span>
            <small>{selectedTag?.categoryName || '打开标签库选择'}</small>
          </div>
        </div>
        <p className="anime-tag-master-cue">{selectedTag?.tags.slice(0, 14).join(', ')}</p>
      </section>

      <section className="anime-tag-master-section nodrag nopan">
        <label>
          <span><Search size={14} /> 搜索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="中文名 / 英文 tag / 风格标签" />
        </label>
        <div className="anime-tag-master-two-cols">
          <label>
            <span><BookOpen size={14} /> 分类</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">全部分类</option>
              {toCategoryOptions(categoryOptions).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span><Library size={14} /> 来源</span>
            <select value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="all">全部来源</option>
              <option value="builtin">内置</option>
              <option value="custom">自定义</option>
              <option value="danbooru">Danbooru</option>
              <option value="gelbooru">Gelbooru</option>
            </select>
          </label>
        </div>
        <div className="anime-tag-master-online">
          <select value={provider} onChange={(event) => setProvider(event.target.value === 'gelbooru' ? 'gelbooru' : 'danbooru')}>
            {ANIME_TAG_ONLINE_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <input value={onlineQuery} onChange={(event) => setOnlineQuery(event.target.value)} placeholder="hatsune_miku / 1girl" />
          <button type="button" onClick={() => void searchOnline()}>懒加载搜索</button>
        </div>
        <div className="anime-tag-master-mode">
          <button
            type="button"
            className={outputMode === 'tags' ? 'active' : ''}
            onClick={() => {
              setOutputMode('tags');
              void runAnimeTagOutput('tags');
            }}
          >
            <FileText size={15} /> 输出标签
          </button>
          <button
            type="button"
            className={outputMode === 'image' ? 'active' : ''}
            onClick={() => {
              setOutputMode('image');
              void runAnimeTagOutput('image');
            }}
          >
            <ImageIcon size={15} /> 输出图像
          </button>
        </div>
      </section>

      <section className="anime-tag-master-section nodrag nopan">
        <div className="anime-tag-master-grid">
          {filteredItems.slice(0, 8).map((item) => (
            <button key={item.id} type="button" className={selectedTag?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}>
              {previewImageOf(item) ? (
                <img src={previewImageOf(item)} alt={item.chineseName} loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <span className="anime-tag-master-tag-badge"><Tags size={16} /></span>
              )}
              <span>{item.chineseName}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="anime-tag-master-actions nodrag nopan">
        <button type="button" onClick={() => setLibraryOpen(true)}><Images size={16} /> 打开标签库</button>
        <button type="button" onClick={() => void copyPrompt()}><Copy size={16} /> 复制标签提示词</button>
        <button type="button" onClick={saveCurrentTag}><Save size={16} /> 保存到动漫标签大师</button>
      </section>

      <footer className="anime-tag-master-footer nodrag nopan">
        <span>{filteredItems.length} 个匹配 · {library.items.length} 个自定义</span>
        <button type="button" onClick={() => void handleRun()}>
          {outputMode === 'image' ? <ImageIcon size={17} /> : <FileText size={17} />}
          运行
        </button>
      </footer>

      {libraryModal}
      {lightbox}
    </div>
  );
}

export default AnimeTagMasterNode;
