import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react';
import { AlertCircle, Loader2, Workflow, Sparkles, Square, Search } from 'lucide-react';
import { submitRh, queryRh, fetchRhAppInfo } from '../../services/generation';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useHasAutoOutput } from './useHasAutoOutput';
import { useRunTrigger } from '../../hooks/useRunTrigger';

/**
 * RunningHubNode - 主工作流节点
 * 输入: webappId(必填) + 上游 RhConfig 节点提供 nodeInfoList 注入
 * 流程: submit → 5s 轮询 outputs → 转存到 /output → 显示
 */
const RunningHubNode = ({ id, data, selected }: NodeProps) => {
  const update = useUpdateNodeData(id);
  const hasAutoOutput = useHasAutoOutput(id);
  const { getEdges, getNodes } = useReactFlow();
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const d = data as any;
  const webappId: string = d?.webappId || '';
  const instanceType: string = d?.instanceType || '';
  const status: 'idle' | 'submitting' | 'polling' | 'success' | 'error' = d?.status || 'idle';
  const taskId: string | undefined = d?.taskId;
  const urls: string[] = d?.urls || [];
  const appInfo: any = d?.appInfo;

  const stopPoll = () => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };
  useEffect(() => () => stopPoll(), []);

  // 收集上游 rh-config 节点的 nodeInfoList
  const collectNodeInfoList = () => {
    const edges = getEdges();
    const nodes = getNodes();
    const upstreamIds = edges.filter((e) => e.target === id).map((e) => e.source);
    const list: any[] = [];
    for (const uid of upstreamIds) {
      const n = nodes.find((x) => x.id === uid);
      const arr = (n?.data as any)?.nodeInfoList;
      if (Array.isArray(arr)) list.push(...arr);
    }
    return list;
  };

  const startPolling = (tid: string) => {
    stopPoll();
    let elapsed = 0;
    const POLL_INT = 5000;
    const MAX = 480;
    pollTimer.current = window.setInterval(async () => {
      elapsed += 1;
      if (elapsed > MAX) {
        stopPoll();
        update({ status: 'error', error: '轮询超时' });
        setError('轮询超时');
        return;
      }
      try {
        const r = await queryRh(tid);
        if (r.status === 'SUCCESS') {
          stopPoll();
          update({
            status: 'success',
            urls: r.urls,
            // 把第一张图作为 imageUrl 输出给下游
            imageUrl: r.urls[0],
          });
        } else if (r.status === 'FAILED') {
          stopPoll();
          update({ status: 'error', error: r.failReason || `RH 失败 code=${r.code}` });
          setError(r.failReason || `RH 失败 code=${r.code}`);
        } else {
          update({ status: 'polling', rhCode: r.code });
        }
      } catch (e: any) {
        console.warn('RH 轮询出错', e?.message);
      }
    }, POLL_INT);
  };

  const handleFetchInfo = async () => {
    setError(null);
    if (!webappId) {
      setError('请先填写 webappId');
      return;
    }
    try {
      const info = await fetchRhAppInfo(webappId);
      update({ appInfo: info });
    } catch (e: any) {
      setError(e?.message || '查询失败');
    }
  };

  const handleRun = async () => {
    setError(null);
    if (!webappId) {
      setError('请先填写 webappId');
      return;
    }
    const nodeInfoList = collectNodeInfoList();
    update({ status: 'submitting', error: null, urls: [], taskId: null });
    try {
      const r = await submitRh({
        webappId,
        nodeInfoList,
        instanceType: instanceType || undefined,
      });
      update({ status: 'polling', taskId: r.taskId });
      startPolling(r.taskId);
    } catch (e: any) {
      setError(e?.message || '提交失败');
      update({ status: 'error', error: e?.message });
    }
  };

  // 接入运行总线,供批量运行调起(不重复调起轮询中的任务)
  useRunTrigger(id, async () => {
    if (status === 'submitting' || status === 'polling') return;
    await handleRun();
  });

  const handleStop = () => {
    stopPoll();
    update({ status: 'idle' });
  };

  const isBusy = status === 'submitting' || status === 'polling';

  return (
    <div
      className={`relative rounded-xl border-2 transition-all w-[300px] ${
        selected ? 'border-cyan-400 shadow-2xl shadow-cyan-500/20' : 'border-white/15 hover:border-white/30'
      }`}
      style={{ background: 'rgba(20,20,22,.92)', backdropFilter: 'blur(8px)' }}
    >
      <Handle type="target" position={Position.Left} className="!bg-cyan-400 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-cyan-400 !border-0" />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'rgba(6,182,212,.2)', color: '#67e8f9', boxShadow: 'inset 0 0 0 1px rgba(6,182,212,.45)' }}
        >
          <Workflow size={13} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">RunningHub</div>
          <div className="text-[10px] text-white/40">{appInfo?.appName || appInfo?.name || 'AI 工作流'}</div>
        </div>
      </div>

      <div className="p-2.5 space-y-2" onMouseDown={(e) => e.stopPropagation()}>
        <div>
          <label className="text-[10px] text-white/50 block mb-1">Webapp ID</label>
          <div className="flex gap-1">
            <input
              type="text"
              value={webappId}
              onChange={(e) => update({ webappId: e.target.value })}
              placeholder="1234567890"
              className="flex-1 rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30 placeholder:text-white/30"
            />
            <button
              onClick={handleFetchInfo}
              title="拉取应用信息"
              className="px-2 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-white/70"
            >
              <Search size={11} />
            </button>
          </div>
        </div>

        {appInfo?.nodeInfoList && Array.isArray(appInfo.nodeInfoList) && (
          <div className="text-[10px] text-cyan-200/70 bg-cyan-500/5 border border-cyan-500/20 rounded px-2 py-1 max-h-20 overflow-auto">
            {appInfo.nodeInfoList.length} 个节点参数可注入(连接 rh-config 节点)
          </div>
        )}

        <div>
          <label className="text-[10px] text-white/50 block mb-1">实例类型(可选)</label>
          <input
            type="text"
            value={instanceType}
            onChange={(e) => update({ instanceType: e.target.value })}
            placeholder="plus"
            className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30 placeholder:text-white/30"
          />
        </div>

        {!isBusy ? (
          <button
            onClick={handleRun}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-xs font-medium transition-colors"
          >
            <Sparkles size={12} /> 运行工作流
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded bg-zinc-500/20 hover:bg-zinc-500/30 text-zinc-200 text-xs font-medium transition-colors"
          >
            <Square size={11} /> 停止
          </button>
        )}

        {isBusy && (
          <div className="flex items-center gap-1 text-[10px] text-cyan-200/80">
            <Loader2 size={11} className="animate-spin" />
            {status === 'submitting' ? '提交任务...' : '轮询中'}
            {taskId && <span className="ml-auto text-white/30">{String(taskId).slice(0, 10)}…</span>}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-1 text-[10px] text-red-300 bg-red-500/10 border border-red-500/20 rounded px-2 py-1">
            <AlertCircle size={11} className="mt-0.5 flex-shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}
      </div>

      {urls.length > 0 && !hasAutoOutput && (
        <div className="border-t border-white/10 p-2 space-y-1">
          {urls.map((u, i) => {
            if (/\.(mp4|webm|mov)$/i.test(u)) {
              return <video key={i} src={u} controls className="w-full rounded" />;
            }
            if (/\.(mp3|wav|ogg)$/i.test(u)) {
              return <audio key={i} src={u} controls className="w-full h-8" />;
            }
            return <img key={i} src={u} alt={`输出 ${i}`} className="w-full rounded object-cover" />;
          })}
        </div>
      )}
    </div>
  );
};

export default memo(RunningHubNode);
