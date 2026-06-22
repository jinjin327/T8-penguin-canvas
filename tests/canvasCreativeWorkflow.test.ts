import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CREATIVE_TARGET_NODE_TYPE,
  buildAnnotationEditRequest,
  buildCreativeTargetResult,
  collectCanvasSelectionSummary,
  createCanvasResourcePackageManifest,
} from '../src/utils/canvasCreativeWorkflow.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('creative selection summary captures ids, materials, text, bounds, and default right-side placement', () => {
  const nodes = [
    {
      id: 'text-1',
      type: 'text',
      selected: true,
      position: { x: 10, y: 20 },
      measured: { width: 280, height: 120 },
      data: { text: '春日牧场、木屋、柔和阳光' },
    },
    {
      id: 'out-1',
      type: 'output',
      selected: true,
      position: { x: 360, y: 40 },
      measured: { width: 320, height: 260 },
      data: {
        imageUrl: '/files/output/farm.png',
        videoUrls: ['/files/output/farm.mp4'],
        directOutputText: '一张完成图',
      },
    },
    {
      id: 'idle-1',
      type: 'image',
      selected: false,
      position: { x: 900, y: 100 },
      data: { prompt: '未选中内容不能进入摘要' },
    },
  ];

  const summary = collectCanvasSelectionSummary(nodes as any, {
    canvasId: 'canvas-a',
    viewportAnchor: { x: 1000, y: 500 },
  });

  assert.deepEqual(summary.selectedNodeIds, ['text-1', 'out-1']);
  assert.deepEqual(summary.nodeTypes, ['text', 'output']);
  assert.equal(summary.texts.map((item) => item.text).join('\n'), '春日牧场、木屋、柔和阳光\n一张完成图');
  assert.deepEqual(summary.images.map((item) => item.url), ['/files/output/farm.png']);
  assert.deepEqual(summary.videos.map((item) => item.url), ['/files/output/farm.mp4']);
  assert.deepEqual(summary.bounds, { x: 10, y: 20, w: 670, h: 280 });
  assert.equal(summary.defaultResultPosition.x, 760);
  assert.equal(summary.defaultResultPosition.y, 20);
  assert.equal(summary.canvasId, 'canvas-a');
});

test('creative target results support replace-in-slot and keep-version output beside target', () => {
  const targetNode = {
    id: 'target-1',
    type: CREATIVE_TARGET_NODE_TYPE,
    position: { x: 400, y: 300 },
    measured: { width: 360, height: 220 },
    data: {
      title: '首页主视觉',
      prompt: '生成一张温暖的牧场主视觉',
      resultUrl: '/files/output/old.png',
      resultVersions: [{ url: '/files/output/old.png', createdAt: 1 }],
    },
  };

  const replace = buildCreativeTargetResult(targetNode as any, ['/files/output/new.png'], {
    mode: 'replace',
    sourceNodeIds: ['text-1'],
    now: 100,
  });
  assert.equal(replace.targetPatch.status, 'success');
  assert.equal(replace.targetPatch.resultUrl, '/files/output/new.png');
  assert.deepEqual(replace.targetPatch.resultVersions.map((item: any) => item.url), [
    '/files/output/new.png',
    '/files/output/old.png',
  ]);
  assert.equal(replace.outputNode, null);

  const version = buildCreativeTargetResult(targetNode as any, ['/files/output/version.png'], {
    mode: 'keep-version',
    sourceNodeIds: ['text-1'],
    now: 120,
  });
  assert.equal(version.targetPatch.status, 'success');
  assert.equal(version.targetPatch.resultUrl, '/files/output/old.png');
  assert.equal(version.outputNode?.type, 'output');
  assert.deepEqual(version.outputNode?.position, { x: 840, y: 300 });
  assert.equal((version.outputNode?.data as any).imageUrl, '/files/output/version.png');
  assert.equal((version.outputNode?.data as any).creativeTargetId, 'target-1');
  assert.deepEqual((version.outputNode?.data as any).creativeSourceNodeIds, ['text-1']);
});

test('annotation edit request keeps clean source and annotated image separate and requires intent for shape-only marks', () => {
  const req = buildAnnotationEditRequest({
    sourceNodeId: 'out-1',
    sourceImageUrl: '/files/output/original.png',
    annotatedImageUrl: '/files/output/annotated.png',
    instruction: '把圈出的招牌改成木质公告牌，其他构图保持不变',
    annotationTextCount: 0,
    annotationShapeCount: 3,
  });

  assert.deepEqual(req.images, ['/files/output/original.png', '/files/output/annotated.png']);
  assert.match(req.prompt, /保留原图主体、构图和风格/);
  assert.match(req.prompt, /移除所有箭头、框线、标号和编辑痕迹/);
  assert.equal(req.metadata.sourceNodeId, 'out-1');
  assert.equal(req.metadata.annotationShapeCount, 3);

  assert.throws(
    () => buildAnnotationEditRequest({
      sourceImageUrl: '/files/output/original.png',
      annotatedImageUrl: '/files/output/annotated.png',
      instruction: '   ',
      annotationTextCount: 0,
      annotationShapeCount: 2,
    }),
    /请补充改图说明/,
  );
});

test('resource package manifest is lightweight, reports missing files, and strips secrets/base64 payloads', () => {
  const manifest = createCanvasResourcePackageManifest({
    canvasId: 'canvas-a',
    title: '交付画布',
    canvas: {
      nodes: [
        {
          id: 'out-1',
          type: 'output',
          position: { x: 0, y: 0 },
          data: {
            imageUrl: '/files/output/farm.png',
            imageUrls: ['/files/output/farm.png', '/files/output/missing.png'],
            directOutputText: '短文本保留',
            referenceImages: ['data:image/png;base64,AAAA'],
            apiKey: 'sk-secret',
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    existingFiles: new Set(['/files/output/farm.png']),
    portable: false,
    now: '2026-06-23T00:00:00.000Z',
  });

  assert.equal(manifest.schema, 't8-canvas-resource-package');
  assert.equal(manifest.resources.length, 2);
  assert.equal(manifest.resources.filter((item) => item.available).length, 1);
  assert.deepEqual(manifest.missingFiles.map((item) => item.url), ['/files/output/missing.png']);
  assert.equal(manifest.filesToCopy.length, 0);
  assert.equal((manifest.canvas.nodes[0].data as any).apiKey, undefined);
  assert.deepEqual((manifest.canvas.nodes[0].data as any).referenceImages, []);
  assert.equal(JSON.stringify(manifest).includes('data:image/png;base64'), false);
  assert.equal(JSON.stringify(manifest).includes('sk-secret'), false);
});

test('Cowart-inspired workflow is wired through node registry, toolbar, canvas, themes, and docs', () => {
  const registry = read('../src/config/nodeRegistry.ts');
  const ports = read('../src/config/portTypes.ts');
  const toolbar = read('../src/components/CanvasToolbar.tsx');
  const canvas = read('../src/components/Canvas.tsx');
  const targetNode = read('../src/components/nodes/GenerationTargetNode.tsx');
  const css = read('../src/styles/index.css');
  const features = read('../features.json');

  assert.match(registry, /type:\s*'generation-target'/);
  assert.match(registry, /label:\s*'生成目标框'/);
  assert.match(ports, /'generation-target':\s*\{\s*inputs:\s*\['text', 'image'\],\s*outputs:\s*\['image'\]/);

  assert.match(toolbar, /onCreateGenerationTarget:\s*\(\)\s*=>\s*void/);
  assert.match(toolbar, /生成目标框/);
  assert.match(toolbar, /onExportResourcePackage:\s*\(\)\s*=>\s*void/);
  assert.match(toolbar, /资源包/);

  assert.match(canvas, /GenerationTargetNode/);
  assert.match(canvas, /handleCreateGenerationTarget/);
  assert.match(canvas, /handleExportResourcePackage/);
  assert.match(canvas, /collectCanvasSelectionSummary/);
  assert.match(canvas, /buildCreativeTargetResult/);

  assert.match(targetNode, /替换到框内/);
  assert.match(targetNode, /保留版本/);
  assert.match(targetNode, /generateImage/);
  assert.match(targetNode, /creativeTargetId/);

  assert.match(css, /Generation target node v1/);
  assert.match(css, /\[data-theme-visual="farm-story"\] \.t8-generation-target-node/);
  assert.match(css, /\[data-theme-visual="saint-seiya"\] \.t8-generation-target-node/);

  assert.match(features, /cowartInspiredCanvasWorkflow/);
});
