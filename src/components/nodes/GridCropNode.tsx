import { memo, useEffect, useMemo, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import { ImageOpFrame } from './ImageOpFrame';
import { useUpdateNodeData } from './useUpdateNodeData';
import { useUpstreamMaterials } from './useUpstreamMaterials';
import { opGridCrop } from '../../services/imageOps';

const clampInt = (value: any, min: number, max: number, fallback: number) => {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const GRID_PRESETS = [
  { label: '2×2', rows: 2, cols: 2 },
  { label: '3×3', rows: 3, cols: 3 },
  { label: '2×3', rows: 2, cols: 3 },
  { label: '1×4', rows: 1, cols: 4 },
  { label: '4×1', rows: 4, cols: 1 },
];

interface GridPreviewProps {
  imageUrl?: string;
  imageCount: number;
  rows: number;
  cols: number;
  gap: number;
}

const GridPreview = ({ imageUrl, imageCount, rows, cols, gap }: GridPreviewProps) => {
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    setNaturalSize(null);
  }, [imageUrl]);

  const lines = useMemo(() => {
    if (!naturalSize) return [];
    const next: Array<{ type: 'h' | 'v'; pos: number }> = [];
    for (let i = 1; i < rows; i++) next.push({ type: 'h', pos: (i * naturalSize.h) / rows });
    for (let i = 1; i < cols; i++) next.push({ type: 'v', pos: (i * naturalSize.w) / cols });
    return next;
  }, [cols, naturalSize, rows]);

  if (!imageUrl) {
    return (
      <div className="col-span-2 rounded-lg border border-dashed border-white/15 bg-white/5 px-3 py-4 text-center text-[11px] text-white/40">
        连接上游图像后显示切线和去缝预览
      </div>
    );
  }

  return (
    <div className="col-span-2 rounded-lg border border-white/10 bg-black/20 p-1.5">
      <div className="flex justify-center rounded bg-black/25 p-1">
        <div className="relative inline-block max-w-full overflow-hidden rounded" style={{ lineHeight: 0 }}>
          <img
            src={imageUrl}
            alt="宫格剪裁预览"
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
            }}
            className="block max-h-44 max-w-full object-contain"
          />
          {naturalSize && (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${naturalSize.w} ${naturalSize.h}`}
              preserveAspectRatio="none"
            >
              {gap > 0 &&
                lines.map((line, index) => {
                  const half = gap / 2;
                  if (line.type === 'h') {
                    const y = Math.max(0, line.pos - half);
                    const h = Math.min(gap, naturalSize.h - y);
                    return (
                      <rect
                        key={`gap-h-${index}`}
                        x={0}
                        y={y}
                        width={naturalSize.w}
                        height={h}
                        fill="#fb923c"
                        opacity={0.28}
                      />
                    );
                  }
                  const x = Math.max(0, line.pos - half);
                  const w = Math.min(gap, naturalSize.w - x);
                  return (
                    <rect
                      key={`gap-v-${index}`}
                      x={x}
                      y={0}
                      width={w}
                      height={naturalSize.h}
                      fill="#fb923c"
                      opacity={0.28}
                    />
                  );
                })}
              {lines.map((line, index) => {
                const half = gap / 2;
                if (line.type === 'h') {
                  return (
                    <g key={`line-h-${index}`}>
                      <line x1={0} x2={naturalSize.w} y1={line.pos} y2={line.pos} stroke="#111827" strokeWidth={4} opacity={0.55} />
                      <line x1={0} x2={naturalSize.w} y1={line.pos} y2={line.pos} stroke="#fb923c" strokeWidth={2.2} />
                      {gap > 0 && (
                        <>
                          <line x1={0} x2={naturalSize.w} y1={line.pos - half} y2={line.pos - half} stroke="#fff7ed" strokeWidth={1.2} strokeDasharray="10 7" opacity={0.9} />
                          <line x1={0} x2={naturalSize.w} y1={line.pos + half} y2={line.pos + half} stroke="#fff7ed" strokeWidth={1.2} strokeDasharray="10 7" opacity={0.9} />
                        </>
                      )}
                    </g>
                  );
                }
                return (
                  <g key={`line-v-${index}`}>
                    <line x1={line.pos} x2={line.pos} y1={0} y2={naturalSize.h} stroke="#111827" strokeWidth={4} opacity={0.55} />
                    <line x1={line.pos} x2={line.pos} y1={0} y2={naturalSize.h} stroke="#fb923c" strokeWidth={2.2} />
                    {gap > 0 && (
                      <>
                        <line x1={line.pos - half} x2={line.pos - half} y1={0} y2={naturalSize.h} stroke="#fff7ed" strokeWidth={1.2} strokeDasharray="10 7" opacity={0.9} />
                        <line x1={line.pos + half} x2={line.pos + half} y1={0} y2={naturalSize.h} stroke="#fff7ed" strokeWidth={1.2} strokeDasharray="10 7" opacity={0.9} />
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-white/40">
        <span>预览第 1 张上游图像</span>
        <span>
          {imageCount > 1 ? `共 ${imageCount} 张 · ` : ''}
          {rows}×{cols}
          {gap > 0 ? ` · 去缝 ${gap}px` : ''}
        </span>
      </div>
    </div>
  );
};

const GridCropNode = (p: NodeProps) => {
  const update = useUpdateNodeData(p.id);
  const upstream = useUpstreamMaterials(p.id);
  const d = p.data as any;
  const rows = clampInt(d?.rows, 1, 20, 3);
  const cols = clampInt(d?.cols, 1, 20, 3);
  const gap = clampInt(d?.gap, 0, 240, 0);
  const inputImages = upstream.images.map((item) => item.url);
  const previewUrl = inputImages[0];
  return (
    <ImageOpFrame
      id={p.id}
      data={p.data}
      selected={p.selected}
      title="宫格剪裁"
      subtitle={gap > 0 ? `${rows}×${cols} · 去缝 ${gap}px` : `${rows}×${cols}`}
      icon={<Grid3x3 size={13} />}
      colorHex="#fb923c"
      bgRgba="rgba(251,146,60,.2)"
      shadowRgba="rgba(251,146,60,.2)"
      textHex="#fed7aa"
      buttonClasses="bg-orange-500/20 hover:bg-orange-500/30 text-orange-200"
      renderSettings={() => (
        <div className="grid grid-cols-2 gap-2">
          <GridPreview
            imageUrl={previewUrl}
            imageCount={inputImages.length}
            rows={rows}
            cols={cols}
            gap={gap}
          />
          <div>
            <label className="text-[10px] text-white/50 block mb-1">行</label>
            <input
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={(e) => update({ rows: clampInt(e.target.value, 1, 20, 3) })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-1">列</label>
            <input
              type="number"
              min={1}
              max={20}
              value={cols}
              onChange={(e) => update({ cols: clampInt(e.target.value, 1, 20, 3) })}
              className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
            />
          </div>
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-white/50">去缝间距</label>
              <span className="text-[10px] text-white/40">{gap}px</span>
            </div>
            <div className="grid grid-cols-[1fr_56px] gap-2">
              <input
                type="range"
                min={0}
                max={240}
                value={gap}
                onChange={(e) => update({ gap: clampInt(e.target.value, 0, 240, 0) })}
                className="w-full accent-orange-400"
              />
              <input
                type="number"
                min={0}
                max={240}
                value={gap}
                onChange={(e) => update({ gap: clampInt(e.target.value, 0, 240, 0) })}
                className="w-full rounded bg-white/5 border border-white/10 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
              />
            </div>
            <div className="mt-1 text-[10px] text-white/35">用于裁掉宫格线、拼图缝或截图留白边缘</div>
          </div>
          <div className="col-span-2 grid grid-cols-5 gap-1">
            {GRID_PRESETS.map((preset) => {
              const active = rows === preset.rows && cols === preset.cols;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => update({ rows: preset.rows, cols: preset.cols })}
                  className={`py-1 rounded text-[10px] transition-colors border ${
                    active
                      ? 'bg-orange-500/30 text-orange-100 border-orange-400/40'
                      : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      inputImages={inputImages}
      runOp={async (img) => opGridCrop(img as string, rows, cols, gap)}
    />
  );
};

export default memo(GridCropNode);
