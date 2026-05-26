import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FolderPlus,
  Image as ImageIcon,
  Library,
  Music,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { useThemeStore } from '../stores/theme';
import * as api from '../services/api';
import type { ResourceCategory, ResourceItem, ResourceKind } from '../services/api';

const KIND_META: Record<ResourceKind, { label: string; icon: typeof ImageIcon; accent: string }> = {
  image: { label: '图像', icon: ImageIcon, accent: '#fbbf24' },
  video: { label: '视频', icon: Video, accent: '#fb7185' },
  audio: { label: '音频', icon: Music, accent: '#a78bfa' },
};

interface ResourceLibraryDrawerProps {
  open: boolean;
  onClose: () => void;
  onInsertMaterial: (item: ResourceItem) => void;
}

function formatSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function resultData<T>(r: api.Result<T> | any): T | null {
  return r?.success ? (r.data as T) : null;
}

export default function ResourceLibraryDrawer({ open, onClose, onInsertMaterial }: ResourceLibraryDrawerProps) {
  const { theme, style } = useThemeStore();
  const isDark = theme === 'dark';
  const isPixel = style === 'pixel';
  const [kind, setKind] = useState<ResourceKind>('image');
  const [categoryId, setCategoryId] = useState('all');
  const [q, setQ] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [categories, setCategories] = useState<ResourceCategory[]>([]);
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    const [catRes, itemRes] = await Promise.all([
      api.getResourceCategories(kind),
      api.getResourceItems({ kind, categoryId, q, favorite: favoriteOnly }),
    ]);
    const nextCats = resultData<ResourceCategory[]>(catRes);
    const nextItems = resultData<ResourceItem[]>(itemRes);
    if (nextCats) setCategories(nextCats);
    if (nextItems) setItems(nextItems);
    if (!nextCats || !nextItems) {
      setMsg((catRes as any)?.error || (itemRes as any)?.error || '资源库加载失败');
    }
    setLoading(false);
  }, [open, kind, categoryId, q, favoriteOnly]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onChanged = () => load();
    window.addEventListener('penguin:resources-changed', onChanged);
    return () => window.removeEventListener('penguin:resources-changed', onChanged);
  }, [open, load]);

  useEffect(() => {
    setCategoryId('all');
    setFavoriteOnly(false);
  }, [kind]);

  const activeMeta = KIND_META[kind];
  const ActiveIcon = activeMeta.icon;
  const totalText = useMemo(() => `${items.length} 个资源`, [items.length]);

  const addCategory = async () => {
    const name = window.prompt(`新建${activeMeta.label}分类`);
    if (!name?.trim()) return;
    const r = await api.addResourceCategory(kind, name.trim());
    if (r.success) {
      setMsg(`已创建分类：${name.trim()}`);
      await load();
    } else {
      setMsg(r.error || '分类创建失败');
    }
  };

  const renameCategory = async (cat: ResourceCategory) => {
    if (cat.system) return;
    const name = window.prompt('重命名分类', cat.name);
    if (!name?.trim() || name.trim() === cat.name) return;
    const r = await api.renameResourceCategory(cat.id, name.trim());
    setMsg(r.success ? '分类已重命名' : r.error || '分类重命名失败');
    await load();
  };

  const removeCategory = async (cat: ResourceCategory) => {
    if (cat.system) return;
    if (!window.confirm(`删除分类「${cat.name}」？该分类内资源会移动到未分类。`)) return;
    const r = await api.deleteResourceCategory(cat.id);
    setMsg(r.success ? '分类已删除' : r.error || '分类删除失败');
    if (categoryId === cat.id) setCategoryId('all');
    await load();
  };

  const updateItem = async (item: ResourceItem, patch: Parameters<typeof api.updateResourceItem>[1]) => {
    const r = await api.updateResourceItem(item.id, patch);
    if (r.success) {
      setItems((prev) => prev.map((x) => (x.id === item.id ? r.data : x)));
      window.dispatchEvent(new CustomEvent('penguin:resources-changed'));
    } else {
      setMsg(r.error || '资源更新失败');
    }
  };

  const renameItem = async (item: ResourceItem) => {
    const title = window.prompt('资源名称', item.title);
    if (!title?.trim() || title.trim() === item.title) return;
    await updateItem(item, { title: title.trim() });
  };

  const deleteItem = async (item: ResourceItem) => {
    if (!window.confirm(`从资源库删除「${item.title}」？`)) return;
    const r = await api.deleteResourceItem(item.id);
    if (r.success) {
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      setMsg('资源已删除');
      window.dispatchEvent(new CustomEvent('penguin:resources-changed'));
    } else {
      setMsg(r.error || '资源删除失败');
    }
  };

  const insertItem = async (item: ResourceItem) => {
    onInsertMaterial(item);
    await api.updateResourceItem(item.id, { touch: true });
    setMsg('已插入画布');
  };

  if (!open) return null;

  const panelCls = isPixel
    ? 'bg-[var(--px-surface)] text-[var(--px-ink)] border-l-2 border-[var(--px-ink)]'
    : isDark
      ? 'bg-zinc-950 text-zinc-100 border-l border-white/10'
      : 'bg-white text-zinc-900 border-l border-black/10';
  const inputCls = isPixel
    ? 'px-input h-9 text-sm'
    : `h-9 px-3 rounded-md border text-sm outline-none ${
        isDark ? 'bg-white/5 border-white/10 text-white placeholder:text-white/30' : 'bg-black/5 border-black/10 text-zinc-900 placeholder:text-zinc-400'
      }`;
  const subtle = isPixel ? 'text-[var(--px-ink-soft)]' : isDark ? 'text-white/45' : 'text-zinc-500';
  const itemBtn = isPixel
    ? 'px-btn px-btn--sm'
    : `px-2 py-1 rounded-md text-xs border ${isDark ? 'border-white/10 hover:bg-white/10' : 'border-black/10 hover:bg-black/5'}`;

  return (
    <div className={`fixed top-0 right-0 z-50 h-screen w-[440px] max-w-[calc(100vw-18px)] shadow-2xl flex flex-col ${panelCls}`}>
      <div className={`h-[52px] px-4 py-3 flex items-center justify-between shrink-0 ${isPixel ? 'border-b-2 border-[var(--px-ink)] bg-[var(--px-muted)]' : isDark ? 'border-b border-white/10' : 'border-b border-black/10'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <Library size={18} style={{ color: activeMeta.accent }} />
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-none">资源库</div>
            <div className={`text-[11px] mt-1 ${subtle}`}>{totalText}</div>
          </div>
        </div>
        <button onClick={onClose} className={isPixel ? 'px-btn px-btn--icon px-btn--ghost' : `p-2 rounded-md ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`} title="关闭">
          <X size={16} />
        </button>
      </div>

      <div className={`px-3 py-2 flex items-center gap-1.5 shrink-0 ${isPixel ? 'border-b-2 border-[var(--px-ink)]' : isDark ? 'border-b border-white/10' : 'border-b border-black/10'}`}>
        {(Object.keys(KIND_META) as ResourceKind[]).map((k) => {
          const meta = KIND_META[k];
          const Icon = meta.icon;
          const active = kind === k;
          return (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={isPixel ? `px-btn px-btn--sm ${active ? 'px-btn--yellow' : ''}` : `flex-1 h-8 rounded-md text-xs flex items-center justify-center gap-1.5 ${active ? 'text-zinc-950' : subtle}`}
              style={!isPixel && active ? { background: meta.accent } : undefined}
            >
              <Icon size={13} /> {meta.label}
            </button>
          );
        })}
      </div>

      <div className={`px-3 py-2 shrink-0 space-y-2 ${isPixel ? 'border-b-2 border-[var(--px-ink)]' : isDark ? 'border-b border-white/10' : 'border-b border-black/10'}`}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${subtle}`} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索名称 / 标签"
              className={`${inputCls} w-full pl-8`}
            />
          </div>
          <button
            onClick={() => setFavoriteOnly((v) => !v)}
            className={isPixel ? `px-btn px-btn--icon ${favoriteOnly ? 'px-btn--yellow' : 'px-btn--ghost'}` : `h-9 w-9 rounded-md border flex items-center justify-center ${favoriteOnly ? 'text-amber-300 border-amber-400/50 bg-amber-400/10' : isDark ? 'border-white/10 hover:bg-white/10' : 'border-black/10 hover:bg-black/5'}`}
            title="收藏"
          >
            <Star size={15} fill={favoriteOnly ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <aside className={`w-32 shrink-0 overflow-y-auto p-2 space-y-1 ${isPixel ? 'border-r-2 border-[var(--px-ink)] bg-[var(--px-muted)]' : isDark ? 'border-r border-white/10 bg-white/[0.02]' : 'border-r border-black/10 bg-black/[0.02]'}`}>
          <button
            onClick={() => setCategoryId('all')}
            className={`w-full text-left px-2 py-1.5 text-xs rounded ${categoryId === 'all' ? (isPixel ? 'bg-[var(--px-yellow)] border-2 border-[var(--px-ink)]' : 'bg-cyan-500/15 text-cyan-300') : ''}`}
          >
            全部
          </button>
          {categories.map((cat) => (
            <div key={cat.id} className="group flex items-center gap-1">
              <button
                onClick={() => setCategoryId(cat.id)}
                className={`flex-1 min-w-0 text-left px-2 py-1.5 text-xs rounded truncate ${categoryId === cat.id ? (isPixel ? 'bg-[var(--px-yellow)] border-2 border-[var(--px-ink)]' : 'bg-cyan-500/15 text-cyan-300') : isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
                title={cat.name}
              >
                {cat.name}
              </button>
              {!cat.system && (
                <div className="hidden group-hover:flex items-center">
                  <button onClick={() => renameCategory(cat)} className="p-1 opacity-70 hover:opacity-100" title="重命名"><Pencil size={10} /></button>
                  <button onClick={() => removeCategory(cat)} className="p-1 opacity-70 hover:opacity-100 text-red-400" title="删除"><Trash2 size={10} /></button>
                </div>
              )}
            </div>
          ))}
          <button onClick={addCategory} className={`w-full mt-2 ${itemBtn} flex items-center justify-center gap-1`} title="新建分类">
            <FolderPlus size={12} /> 分类
          </button>
        </aside>

        <main className="flex-1 min-w-0 overflow-y-auto p-3">
          {msg && (
            <div className={`mb-2 text-[11px] px-2 py-1 rounded ${isPixel ? 'bg-[var(--px-yellow)] border-2 border-[var(--px-ink)]' : isDark ? 'bg-white/10 text-white/70' : 'bg-black/5 text-zinc-600'}`}>
              {msg}
            </div>
          )}
          {loading && (
            <div className={`text-xs ${subtle}`}>加载中...</div>
          )}
          {!loading && items.length === 0 && (
            <div className={`h-56 flex flex-col items-center justify-center text-xs ${subtle}`}>
              <ActiveIcon size={28} style={{ color: activeMeta.accent }} />
              <span className="mt-2">暂无资源</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {items.map((item) => (
              <article
                key={item.id}
                className={`resource-card overflow-hidden transition-transform ${isPixel ? 'border-2 border-[var(--px-ink)] bg-[var(--px-surface)] shadow-[3px_3px_0_var(--px-ink)]' : isDark ? 'rounded-lg border border-white/10 bg-white/[0.04]' : 'rounded-lg border border-black/10 bg-black/[0.03]'}`}
                data-drag-source
                data-drag-kind={item.kind}
                data-drag-url={item.fileUrl}
                data-drag-preview={item.thumbUrl || item.fileUrl}
                data-drag-node-id="resource-library"
                title="Ctrl+拖拽到节点"
              >
                <div className="relative h-28 overflow-hidden bg-black/80">
                  {item.kind === 'image' && (
                    <img src={item.thumbUrl || item.fileUrl} className="resource-media w-full h-full object-cover transition-transform duration-200" draggable={false} />
                  )}
                  {item.kind === 'video' && (
                    <video
                      src={item.fileUrl}
                      muted
                      loop
                      preload="metadata"
                      className="resource-media w-full h-full object-cover transition-transform duration-200"
                      onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                      onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                    />
                  )}
                  {item.kind === 'audio' && (
                    <div className="resource-media w-full h-full flex items-center justify-center transition-transform duration-200" style={{ background: 'linear-gradient(135deg,#312e81,#7c3aed,#db2777)' }}>
                      <Music size={34} className="text-white drop-shadow" />
                    </div>
                  )}
                  <button
                    onClick={() => updateItem(item, { favorite: !item.favorite })}
                    className="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-black/55 text-amber-300 flex items-center justify-center"
                    title="收藏"
                  >
                    <Star size={13} fill={item.favorite ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <div className="p-2 space-y-1.5">
                  <div className="text-xs font-medium truncate" title={item.title}>{item.title}</div>
                  <div className={`text-[10px] truncate ${subtle}`}>{formatSize(item.size) || item.mime || item.kind}</div>
                  {item.kind === 'audio' && <audio src={item.fileUrl} controls className="w-full h-8" />}
                  <select
                    value={item.categoryId}
                    onChange={(e) => updateItem(item, { categoryId: e.target.value })}
                    className={isPixel ? 'px-input w-full h-7 text-[11px]' : `w-full h-7 px-1.5 rounded text-[11px] ${isDark ? 'bg-zinc-900 border border-white/10' : 'bg-white border border-black/10'}`}
                  >
                    {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </select>
                  <div className={isPixel ? 'flex items-center justify-center gap-2 pt-0.5' : 'flex items-center gap-1'}>
                    <button
                      onClick={() => insertItem(item)}
                      className={
                        isPixel
                          ? 'px-btn px-btn--icon px-btn--mint h-8 w-8 justify-center'
                          : `${itemBtn} flex-1 flex items-center justify-center gap-1`
                      }
                      style={isPixel ? { padding: 0 } : undefined}
                      title="插入画布"
                      aria-label="插入画布"
                    >
                      <Plus size={isPixel ? 15 : 12} />
                      {!isPixel && '插入'}
                    </button>
                    <button
                      onClick={() => renameItem(item)}
                      className={
                        isPixel
                          ? 'px-btn px-btn--icon h-8 w-8 justify-center'
                          : `${itemBtn} w-8 flex items-center justify-center`
                      }
                      style={isPixel ? { padding: 0 } : undefined}
                      title="重命名"
                    >
                      <Pencil size={isPixel ? 13 : 12} />
                    </button>
                    <button
                      onClick={() => deleteItem(item)}
                      className={
                        isPixel
                          ? 'px-btn px-btn--icon h-8 w-8 justify-center text-red-500'
                          : `${itemBtn} w-8 flex items-center justify-center text-red-400`
                      }
                      style={isPixel ? { padding: 0 } : undefined}
                      title="删除"
                    >
                      <Trash2 size={isPixel ? 13 : 12} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
