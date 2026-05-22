import { memo, useEffect, useMemo } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { ArrowRightLeft } from 'lucide-react';
import { useUpdateNodeData } from './useUpdateNodeData';

/**
 * RelayNode - 数据中转
 * 自动透传上游所有 data 字段(prompt / imageUrl / urls 等)给下游
 * 用于跨距离/合并多个数据流
 */
const COLOR = '#94a3b8';

const RelayNode = (p: NodeProps) => {
  const update = useUpdateNodeData(p.id);
  const { getEdges, getNodes } = useReactFlow();
  const d = p.data as any;

  // 计算上游签名 - 仅在上游 data 变化时 effect 才会重跑,
  // 避免原来 useEffect 无 deps 导致的 setState 风暴循环。
  const upstreamSignature = useMemo(() => {
    const edges = getEdges();
    const nodes = getNodes();
    const upstreamIds = edges.filter((e) => e.target === p.id).map((e) => e.source);
    return upstreamIds
      .map((uid) => {
        const n = nodes.find((x) => x.id === uid);
        const ud = (n?.data as any) || {};
        return `${uid}|${ud.prompt || ''}|${ud.imageUrl || ''}|${(ud.urls || []).length}`;
      })
      .join('::');
    // p.data 变化作为一个轻量重算触发点, 但计算出的字符串在上游未变时会相等
  }, [p.id, p.data, getEdges, getNodes]);

  // 监听上游变化,自动透传
  useEffect(() => {
    const edges = getEdges();
    const nodes = getNodes();
    const upstreamIds = edges.filter((e) => e.target === p.id).map((e) => e.source);
    if (upstreamIds.length === 0) return;

    const merged: any = {};
    const prompts: string[] = [];
    const urls: string[] = [];
    let imageUrl: string | undefined;
    for (const uid of upstreamIds) {
      const n = nodes.find((x) => x.id === uid);
      const ud = (n?.data as any) || {};
      if (ud.prompt) prompts.push(String(ud.prompt));
      if (ud.imageUrl && !imageUrl) imageUrl = String(ud.imageUrl);
      if (Array.isArray(ud.urls)) urls.push(...ud.urls);
    }
    if (prompts.length) merged.prompt = prompts.join('\n');
    if (imageUrl) merged.imageUrl = imageUrl;
    if (urls.length) merged.urls = urls;
    // 仅当变化时才更新,避免循环
    const cur = JSON.stringify({ prompt: d?.prompt, imageUrl: d?.imageUrl, urls: d?.urls });
    const next = JSON.stringify({ prompt: merged.prompt, imageUrl: merged.imageUrl, urls: merged.urls });
    if (cur !== next) update(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upstreamSignature]);

  const upstreamCount = getEdges().filter((e) => e.target === p.id).length;

  return (
    <div
      className={`relative rounded-xl border-2 transition-all ${
        p.selected ? 'shadow-2xl' : 'border-white/15 hover:border-white/30'
      }`}
      style={{
        background: 'rgba(20,20,22,.92)',
        backdropFilter: 'blur(8px)',
        width: 200,
        borderColor: p.selected ? COLOR : undefined,
        boxShadow: p.selected ? `0 0 0 1px ${COLOR}, 0 16px 32px rgba(148,163,184,.2)` : undefined,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: COLOR, border: 0 }} />
      <Handle type="source" position={Position.Right} style={{ background: COLOR, border: 0 }} />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(148,163,184,.2)', color: '#cbd5e1', boxShadow: `inset 0 0 0 1px ${COLOR}` }}
        >
          <ArrowRightLeft size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">中继</div>
          <div className="text-[10px] text-white/40">{upstreamCount} 个上游</div>
        </div>
      </div>

      <div className="p-2 space-y-1 text-[10px] text-white/50">
        {d?.prompt && <div className="truncate">📝 {String(d.prompt).slice(0, 30)}...</div>}
        {d?.imageUrl && <div>🖼 1 张图</div>}
        {Array.isArray(d?.urls) && d.urls.length > 0 && <div>🖼 {d.urls.length} 张图</div>}
        {!d?.prompt && !d?.imageUrl && !d?.urls?.length && (
          <div className="text-white/30 italic text-center py-1">无数据透传</div>
        )}
      </div>
    </div>
  );
};

export default memo(RelayNode);
