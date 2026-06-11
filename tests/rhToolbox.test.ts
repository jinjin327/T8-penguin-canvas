import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loadRhToolboxUtils = async () => import('../src/utils/rhToolbox.ts');
const loadRhToolboxManifest = async () => import('../src/data/rhToolboxManifest.ts');

test('RH toolbox node is registered as a visible executable RH node', () => {
  const registry = readFileSync(new URL('../src/config/nodeRegistry.ts', import.meta.url), 'utf8');
  const ports = readFileSync(new URL('../src/config/portTypes.ts', import.meta.url), 'utf8');
  const types = readFileSync(new URL('../src/types/canvas.ts', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const actionBar = readFileSync(new URL('../src/components/NodeActionBar.tsx', import.meta.url), 'utf8');
  const loop = readFileSync(new URL('../src/components/nodes/LoopNode.tsx', import.meta.url), 'utf8');

  assert.match(registry, /type:\s*'rh-toolbox'[\s\S]*label:\s*'RH工具箱'[\s\S]*category:\s*'rh'/);
  assert.match(ports, /'rh-toolbox':\s*\{\s*inputs:\s*\['text', 'image', 'video', 'audio'\],\s*outputs:\s*\['text', 'image', 'video', 'audio'\]\s*\}/);
  assert.match(types, /\|\s*'rh-toolbox'/);
  assert.match(canvas, /const RHToolboxNode = lazyCanvasNode\(\(\) => import\('\.\/nodes\/RHToolboxNode'\), 'RHToolboxNode'\)/);
  assert.match(canvas, /'rh-toolbox': RHToolboxNode/);
  assert.match(canvas, /'rh-toolbox':\s*\{/);
  assert.match(canvas, /'rh-tools', 'rh-toolbox'/);
  assert.match(actionBar, /'rh-tools', 'rh-toolbox'/);
  assert.match(loop, /'rh-tools', 'rh-toolbox'/);
});

test('RH toolbox manifest keeps draft tools disabled until webappId is supplied', async () => {
  const { RH_TOOLBOX_MANIFEST } = await loadRhToolboxManifest();
  const {
    buildRhToolboxQuickActions,
    filterRhToolboxTools,
    getRhToolboxToolMajorCategory,
    isRhToolboxBuiltinCategoryId,
    listRhToolboxTools,
    normalizeRhToolboxManifest,
  } = await loadRhToolboxUtils();

  const manifest = normalizeRhToolboxManifest(RH_TOOLBOX_MANIFEST);

  assert.equal(manifest.schema, 't8-rh-toolbox-manifest');
  assert.equal(manifest.categories.length, 5);
  assert.deepEqual(
    manifest.categories.map((category) => [category.id, category.parentId]),
    [
      ['image-tools', 'image'],
      ['video-tools', 'video'],
      ['text-tools', 'text'],
      ['audio-tools', 'audio'],
      ['model3d-tools', 'model3d'],
    ],
  );
  assert.equal(listRhToolboxTools(manifest).length, 0);
  assert.equal(listRhToolboxTools(manifest, { includeDisabled: true }).length, 4);
  assert.equal(isRhToolboxBuiltinCategoryId('image-tools'), true);
  assert.equal(isRhToolboxBuiltinCategoryId('custom-rh-tools'), false);
  assert.equal(getRhToolboxToolMajorCategory(manifest.tools[0], manifest.categories), 'image');
  assert.deepEqual(
    filterRhToolboxTools(manifest, { majorCategoryId: 'video', includeDisabled: true }).map((tool) => tool.id),
    ['video-upscale-template'],
  );
  assert.deepEqual(
    filterRhToolboxTools(manifest, { capability: 'image.cutout', includeDisabled: true }).map((tool) => tool.id),
    ['image-cutout-template'],
  );
  assert.deepEqual(
    buildRhToolboxQuickActions(manifest, 'image', { includeDisabled: true }).map((action) => [action.toolId, action.label, action.enabled]),
    [['image-cutout-template', '智能抠图（模板）', false]],
  );
  assert.deepEqual(
    buildRhToolboxQuickActions(manifest, 'video', { includeDisabled: true }).map((action) => action.toolId),
    ['video-upscale-template'],
  );
});

test('RH toolbox builds nodeInfoList from configured mappings without per-tool code', async () => {
  const {
    buildRhToolboxNodeInfoList,
    classifyRhToolboxOutputs,
    normalizeRhToolboxManifest,
    pickRhToolboxInputs,
  } = await loadRhToolboxUtils();

  const manifest = normalizeRhToolboxManifest({
    schema: 't8-rh-toolbox-manifest',
    version: 1,
    categories: [{ id: 'image-tools', name: '图像工具' }],
    tools: [
      {
        id: 'cutout',
        title: '抠图',
        categoryId: 'image-tools',
        webappId: '200000',
        enabled: true,
        capabilities: ['image.cutout'],
        inputSchema: [
          { key: 'image', kind: 'image', rhNodeId: '7', fieldName: 'image', required: true },
          { key: 'prompt', kind: 'text', rhNodeId: '30', fieldName: 'prompt', required: false },
        ],
        fixedParams: [{ rhNodeId: '31', fieldName: 'mode', value: 'transparent', valueType: 'text' }],
        userParams: [
          {
            key: 'strength',
            label: '强度',
            kind: 'number',
            rhNodeId: '32',
            fieldName: 'strength',
            defaultValue: 0.8,
          },
        ],
        outputSchema: [{ key: 'out', kind: 'image', role: 'replace-source' }],
      },
    ],
  });
  const tool = manifest.tools[0];

  const picked = pickRhToolboxInputs(tool, {
    images: ['/files/input/a.png'],
    texts: ['主体抠图'],
  });
  assert.equal(picked.missing.length, 0);

  const nodeInfoList = buildRhToolboxNodeInfoList(tool, {
    inputValues: { ...picked.values, image: 'rh-uploaded-a.png' },
    userParamValues: { strength: 0.6 },
  });

  assert.deepEqual(nodeInfoList, [
    { nodeId: '7', fieldName: 'image', fieldValue: 'rh-uploaded-a.png', valueType: 'image' },
    { nodeId: '30', fieldName: 'prompt', fieldValue: '主体抠图', valueType: 'text' },
    { nodeId: '32', fieldName: 'strength', fieldValue: 0.6, valueType: 'number' },
    { nodeId: '31', fieldName: 'mode', fieldValue: 'transparent', valueType: 'text' },
  ]);

  assert.deepEqual(classifyRhToolboxOutputs(['/files/output/a.png', '/files/output/b.mp4', '/files/output/c.wav']).imageUrls, ['/files/output/a.png']);
  assert.deepEqual(classifyRhToolboxOutputs(['/files/output/a.png', '/files/output/b.mp4', '/files/output/c.wav']).videoUrls, ['/files/output/b.mp4']);
  assert.deepEqual(classifyRhToolboxOutputs(['/files/output/a.png', '/files/output/b.mp4', '/files/output/c.wav']).audioUrls, ['/files/output/c.wav']);
});

test('RH toolbox service exposes a single callable runner for future quick actions', () => {
  const service = readFileSync(new URL('../src/services/rhToolbox.ts', import.meta.url), 'utf8');
  const component = readFileSync(new URL('../src/components/nodes/RHToolboxNode.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8');

  assert.match(service, /export async function runRhToolboxTool/);
  assert.match(service, /uploadRhAsset/);
  assert.match(service, /submitRh/);
  assert.match(service, /queryRh/);
  assert.match(component, /runRhToolboxTool/);
  assert.match(component, /MentionPromptInput/);
  assert.match(component, /rhToolboxTextInputs/);
  assert.match(component, /hasTextInputValue/);
  assert.match(component, /input\.defaultValue == null \? '' : String\(input\.defaultValue\)/);
  assert.match(component, /defaultTextInputs/);
  assert.match(component, /prompt:\s*defaultPrompt/);
  assert.match(component, /hoveredToolId/);
  assert.match(component, /previewTool/);
  assert.match(component, /onMouseEnter=\{\(\) => setHoveredToolId\(tool\.id\)\}/);
  assert.match(component, /悬停工具查看说明/);
  assert.match(component, /previewTool\.description/);
  assert.match(component, /rhToolboxLocalInputs/);
  assert.match(component, /inputValues:\s*explicitInputValues/);
  assert.match(component, /素材输入/);
  assert.match(component, /opacity-0 transition-opacity group-hover:opacity-100/);
  assert.match(component, /RH_TOOLBOX_MAJOR_CATEGORIES/);
  assert.match(component, /rhToolboxMajorCategoryId/);
  assert.match(component, /notifyRhToolboxDeveloperToolEdit/);
  assert.match(component, /rh-toolbox-app-grid grid grid-cols-2 gap-2/);
  assert.match(component, /rh-toolbox-app-button/);
  assert.match(component, /rh-toolbox-app-edit-button/);
  assert.match(component, /isRhToolboxBuiltinCategoryId/);
  assert.match(component, /visibleCategoryId/);
  assert.match(styles, /\.rh-toolbox-app-grid button\.rh-toolbox-app-button/);
  assert.match(styles, /box-shadow:\s*none !important/);
  assert.match(styles, /border-radius:\s*6px !important/);
  assert.match(component, /status !== 'idle'/);
  assert.doesNotMatch(component, /buildRhToolboxQuickActions/);
  assert.doesNotMatch(component, /快捷接入位/);
  assert.doesNotMatch(component, /toolCategory\?\.name \|\| tool\.categoryId/);
  assert.doesNotMatch(component, /title=\{\`\$\{tool\.title\}\$\{toolCategory/);
  assert.match(component, /MaterialPreviewSection/);
  assert.match(service, /inputValues\?: Record<string, string \| string\[\]>/);
  assert.match(service, /缺少输入/);
});

test('RH toolbox display config follows theme and does not expose per-tool color or button labels', () => {
  const utils = readFileSync(new URL('../src/utils/rhToolbox.ts', import.meta.url), 'utf8');
  const manifest = readFileSync(new URL('../src/data/rhToolboxManifest.ts', import.meta.url), 'utf8');
  const node = readFileSync(new URL('../src/components/nodes/RHToolboxNode.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(utils, /quickActionLabel\?:/);
  assert.doesNotMatch(utils, /accent\?: string/);
  assert.doesNotMatch(utils, /raw\.ui\.accent/);
  assert.doesNotMatch(utils, /raw\.ui\.quickActionLabel/);
  assert.match(utils, /label:\s*tool\.title/);
  assert.doesNotMatch(manifest, /quickActionLabel/);
  assert.doesNotMatch(manifest, /accent:\s*['"]/);
  assert.match(node, /const accent = isPixel \? 'var\(--px-ink\)' : isLight \? '#0891b2' : '#67e8f9'/);
  assert.doesNotMatch(node, /activeTool\?\.ui\?\.accent/);
});

test('RH toolbox runtime can consume private maker events without shipping maker source', () => {
  const node = readFileSync(new URL('../src/components/nodes/RHToolboxNode.tsx', import.meta.url), 'utf8');

  assert.match(node, /const RH_TOOLBOX_DEVELOPER_MODULE = '\.\.\/\.\.\/utils\/rhToolboxDeveloper'/);
  assert.match(node, /import\(\/\* @vite-ignore \*\/ RH_TOOLBOX_DEVELOPER_MODULE\)/);
  assert.match(node, /penguin:rh-toolbox-manifest-updated/);
  assert.match(node, /detail\?\.kind === 'tool-saved'/);
  assert.match(node, /mergeRhToolboxManifestWithDeveloperDrafts\(base, detail\?\.manifest\)/);
  assert.match(node, /window\.setInterval\(\(\) => refreshManifest\(\), 1500\)/);
  assert.match(node, /当前 manifest 有 \{allTools\.length\} 个工具/);
  assert.match(node, /rhToolboxSearchQuery:\s*''/);
  assert.match(node, /rhToolboxCategoryId:\s*RH_TOOLBOX_ALL_CATEGORY_ID/);
  assert.match(node, /rhToolboxActiveToolId:\s*nextTool && nextTool\.enabled !== false/);
});

test('RH toolbox maker is dev-only and guarded from packaged builds', () => {
  const registry = readFileSync(new URL('../src/config/nodeRegistry.ts', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const ports = readFileSync(new URL('../src/config/portTypes.ts', import.meta.url), 'utf8');
  const postBuild = readFileSync(new URL('../electron/_post_build.cjs', import.meta.url), 'utf8');
  const publicCheck = readFileSync(new URL('../scripts/check-public-clean.cjs', import.meta.url), 'utf8');
  const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  const features = readFileSync(new URL('../features.json', import.meta.url), 'utf8');

  assert.match(registry, /import\.meta\.env\?\.DEV[\s\S]*type:\s*'rh-toolbox-maker'[\s\S]*label:\s*'RH工具箱制作器'/);
  assert.match(canvas, /const RH_TOOLBOX_MAKER_MODULE = '\.\/nodes\/RHToolboxMakerNode'/);
  assert.match(canvas, /lazyCanvasNode\(\(\) => import\(\/\* @vite-ignore \*\/ RH_TOOLBOX_MAKER_MODULE\), 'RHToolboxMakerNode'\)/);
  assert.match(canvas, /import\.meta\.env\?\.DEV \? \{ 'rh-toolbox-maker': RHToolboxMakerNode \} : \{\}/);
  assert.match(ports, /import\.meta\.env\?\.DEV[\s\S]*'rh-toolbox-maker':\s*\{\s*inputs:\s*\[\],\s*outputs:\s*\['text'\]\s*\}/);
  assert.match(postBuild, /checkNoRhToolboxMaker/);
  assert.match(postBuild, /RHToolboxMakerNode/);
  assert.match(postBuild, /RH工具箱制作器/);
  assert.match(publicCheck, /src\/components\/nodes\/RHToolboxMakerNode\.tsx/);
  assert.match(publicCheck, /src\/utils\/rhToolboxDeveloper\.ts/);
  assert.match(gitignore, /\/src\/components\/nodes\/RHToolboxMakerNode\.tsx/);
  assert.match(gitignore, /\/src\/utils\/rhToolboxDeveloper\.ts/);
  assert.match(features, /RH工具箱制作器/);
});

test('RH toolbox developer helpers stay private and runtime uses guarded imports', () => {
  const service = readFileSync(new URL('../src/services/rhToolbox.ts', import.meta.url), 'utf8');
  const component = readFileSync(new URL('../src/components/nodes/RHToolboxNode.tsx', import.meta.url), 'utf8');
  const publicCheck = readFileSync(new URL('../scripts/check-public-clean.cjs', import.meta.url), 'utf8');

  assert.doesNotMatch(service, /RH_TOOLBOX_DEVELOPER_STORAGE_KEY|mergeRhToolboxManifestWithDeveloperDrafts/);
  assert.match(component, /if \(!import\.meta\.env\.DEV\)/);
  assert.match(component, /RH_TOOLBOX_DEVELOPER_MODULE/);
  assert.match(component, /@vite-ignore/);
  assert.match(publicCheck, /src\/utils\/rhToolboxDeveloper\.ts/);
});
