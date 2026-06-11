import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const loadFalToolboxUtils = async () => import('../src/utils/falToolbox.ts');
const loadFalToolboxManifest = async () => import('../src/data/falToolboxManifest.ts');

test('Fal toolbox node is registered as a visible executable FAL node', () => {
  const registry = readFileSync(new URL('../src/config/nodeRegistry.ts', import.meta.url), 'utf8');
  const ports = readFileSync(new URL('../src/config/portTypes.ts', import.meta.url), 'utf8');
  const types = readFileSync(new URL('../src/types/canvas.ts', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const actionBar = readFileSync(new URL('../src/components/NodeActionBar.tsx', import.meta.url), 'utf8');
  const loop = readFileSync(new URL('../src/components/nodes/LoopNode.tsx', import.meta.url), 'utf8');
  const node = readFileSync(new URL('../src/components/nodes/FalToolboxNode.tsx', import.meta.url), 'utf8');

  assert.match(registry, /type:\s*'fal-toolbox'[\s\S]*label:\s*'Fal超市'[\s\S]*category:\s*'fal'/);
  assert.match(registry, /type:\s*'model-3d-upload'[\s\S]*label:\s*'3D素材上传'[\s\S]*category:\s*'input'/);
  assert.match(registry, /type:\s*'model-3d-preview'[\s\S]*label:\s*'3D模型预览'[\s\S]*category:\s*'input'/);
  assert.match(registry, /fal:\s*\{\s*label:\s*'FAL工具箱'/);
  assert.match(ports, /'fal-toolbox':\s*\{\s*inputs:\s*\['text', 'image', 'video', 'audio'\],\s*outputs:\s*\['text', 'image', 'video', 'audio', 'model3d'\]\s*\}/);
  assert.match(ports, /'model-3d-preview':\s*\{\s*inputs:\s*\['model3d'\],\s*outputs:\s*\['image'\]\s*\}/);
  assert.match(ports, /'model-3d-upload':\s*\{\s*inputs:\s*\[\],\s*outputs:\s*\['model3d'\]\s*\}/);
  assert.match(ports, /if \(uploadType === 'model3d'\) return \['model3d'\]/);
  assert.match(types, /\|\s*'fal-toolbox'/);
  assert.match(types, /\|\s*'model-3d-preview'/);
  assert.match(types, /\|\s*'model-3d-upload'/);
  assert.match(types, /\|\s*'fal'/);
  assert.match(canvas, /const FalToolboxNode = lazyCanvasNode\(\(\) => import\('\.\/nodes\/FalToolboxNode'\), 'FalToolboxNode'\)/);
  assert.match(canvas, /const Model3DPreviewNode = lazyCanvasNode\(\(\) => import\('\.\/nodes\/Model3DPreviewNode'\), 'Model3DPreviewNode'\)/);
  assert.match(canvas, /'fal-toolbox': FalToolboxNode/);
  assert.match(canvas, /'model-3d-preview': Model3DPreviewNode/);
  assert.match(canvas, /'model-3d-upload': UploadNode/);
  assert.match(canvas, /'fal-toolbox':\s*\{/);
  assert.match(canvas, /'model-3d-preview':\s*\{/);
  assert.match(canvas, /'model-3d-upload':\s*\{\s*uploadType:\s*'model3d'/);
  assert.match(canvas, /'rh-tools', 'rh-toolbox', 'fal-toolbox', 'comfyui-store'/);
  assert.match(actionBar, /'rh-tools', 'rh-toolbox', 'fal-toolbox', 'comfyui-store'/);
  assert.match(loop, /'rh-tools', 'rh-toolbox', 'fal-toolbox', 'comfyui-store'/);
  assert.match(node, /const handleHorizontalWheel = \(event: WheelEvent<HTMLDivElement>\)/);
  assert.match(node, /el\.scrollLeft \+= delta/);
  assert.equal((node.match(/onWheel=\{handleHorizontalWheel\}/g) || []).length >= 2, true);
  assert.match(node, /Fal模型会先预扣3\.4币，生成完成后多退少补/);
  assert.match(node, /import MentionPromptInput from '\.\/MentionPromptInput'/);
  assert.match(node, /resolveMediaMentions/);
  assert.match(node, /Prompt 可本地输入或接上游文本/);
  assert.match(node, /本地为空时使用上游文本/);
  const falToolboxLabels = node.match(/<label\b[\s\S]*?<\/label>/g) || [];
  assert.equal(falToolboxLabels.some((label) => label.includes('MentionPromptInput')), false);
  assert.match(node, /falToolboxTextInputs/);
  assert.match(node, /falToolboxTextMentions/);
  assert.match(node, /falToolboxUserParamMentions/);
  assert.match(node, /inputValues:\s*resolvedTextInputs/);
  const service = readFileSync(new URL('../src/services/falToolbox.ts', import.meta.url), 'utf8');
  assert.match(service, /inputValues\?: Record<string, string \| string\[\]>/);
  assert.match(service, /stillMissing/);
});

test('Fal toolbox manifest normalizes configured tools and builds generic payloads', async () => {
  const { FAL_TOOLBOX_MANIFEST } = await loadFalToolboxManifest();
  const {
    buildFalToolboxRunPayload,
    filterFalToolboxTools,
    findFalToolboxToolById,
    listFalToolboxTools,
    normalizeFalToolboxManifest,
    pickFalToolboxInputs,
  } = await loadFalToolboxUtils();

  const manifest = normalizeFalToolboxManifest(FAL_TOOLBOX_MANIFEST);
  assert.equal(manifest.schema, 't8-fal-toolbox-manifest');
  assert.equal(manifest.categories.some((category) => category.id === 'video-generation'), true);
  assert.equal(manifest.categories.some((category) => category.id === 'model-3d'), true);
  assert.equal(listFalToolboxTools(manifest).length >= 43, true);
  assert.deepEqual(
    filterFalToolboxTools(manifest, { categoryId: 'video-generation', query: 'sora' }).map((tool) => tool.id),
    ['sora2-fal-text', 'sora2-fal-image'],
  );

  const tool = findFalToolboxToolById(manifest, 'gpt-image-2-fal-edit');
  assert.ok(tool);
  const picked = pickFalToolboxInputs(tool!, {
    texts: ['把人物改成赛博朋克风'],
    images: ['/files/input/ref.png'],
  });
  assert.deepEqual(picked.missing, []);
  const payload = buildFalToolboxRunPayload(tool!, {
    inputValues: picked.values,
    userParamValues: { image_size: 'square_hd', quality: 'high', num_images: 2 },
  });
  assert.equal(payload.endpoint, 'openai/gpt-image-2/edit');
  assert.equal(payload.payload.prompt, '把人物改成赛博朋克风');
  assert.deepEqual(payload.payload.image_urls, ['/files/input/ref.png']);
  assert.deepEqual(payload.mediaFields, [{ key: 'image_urls', kind: 'image', multiple: true, upload: true, mediaMode: 'base64' }]);

  const maiTool = findFalToolboxToolById(manifest, 'mai-image-2-5-fal');
  assert.ok(maiTool);
  const missingMai = pickFalToolboxInputs(maiTool!, {});
  assert.deepEqual(missingMai.missingKeys, ['prompt']);
  const directPromptPayload = buildFalToolboxRunPayload(maiTool!, {
    inputValues: { prompt: '一只发光的机械企鹅站在电影布光里' },
    userParamValues: { aspect_ratio: '16:9', num_images: 1 },
  });
  assert.equal(directPromptPayload.payload.prompt, '一只发光的机械企鹅站在电影布光里');

  const vtoTool = findFalToolboxToolById(manifest, 'flux-pro-vto-fal');
  assert.ok(vtoTool);
  const pickedVto = pickFalToolboxInputs(vtoTool!, {
    texts: ['把服装自然穿在模特身上'],
    images: ['/files/input/human.png', '/files/input/cloth.png'],
  });
  assert.deepEqual(pickedVto.missing, []);
  assert.equal(pickedVto.values.human_image_url, '/files/input/human.png');
  assert.equal(pickedVto.values.garment_image_url, '/files/input/cloth.png');
  const vtoPayload = buildFalToolboxRunPayload(vtoTool!, {
    inputValues: pickedVto.values,
    userParamValues: {},
  });
  assert.equal(vtoPayload.payload.human_image_url, '/files/input/human.png');
  assert.equal(vtoPayload.payload.garment_image_url, '/files/input/cloth.png');

  const modelTool = findFalToolboxToolById(manifest, 'hunyuan-3d-v3-1-pro-image-fal');
  assert.ok(modelTool);
  assert.equal(modelTool!.outputSchema.some((output) => output.kind === 'model3d'), true);

  const minimaxTool = findFalToolboxToolById(manifest, 'minimax-speech-2-8-turbo-fal');
  assert.ok(minimaxTool);
  const pickedSpeech = pickFalToolboxInputs(minimaxTool!, { texts: ['欢迎来到贞贞的无限画布'] });
  assert.deepEqual(pickedSpeech.missing, []);
  const speechPayload = buildFalToolboxRunPayload(minimaxTool!, {
    inputValues: pickedSpeech.values,
    userParamValues: {
      'voice_setting.emotion': 'happy',
      language_boost: 'Chinese',
    },
  });
  assert.equal(speechPayload.endpoint, 'fal-ai/minimax/speech-2.8-turbo');
  assert.equal(speechPayload.payload.prompt, '欢迎来到贞贞的无限画布');
  assert.deepEqual((speechPayload.payload as any).voice_setting, {
    voice_id: 'Wise_Woman',
    speed: 1,
    vol: 1,
    pitch: 0,
    emotion: 'happy',
    english_normalization: false,
  });
  assert.deepEqual((speechPayload.payload as any).audio_setting, {
    sample_rate: 32000,
    bitrate: 128000,
    format: 'mp3',
  });
  assert.equal((speechPayload.payload as any).language_boost, 'Chinese');

  const heygenTool = findFalToolboxToolById(manifest, 'heygen-avatar5-fal');
  assert.ok(heygenTool);
  const heygenPayload = buildFalToolboxRunPayload(heygenTool!, {
    inputValues: { prompt: '镜头前自然介绍产品' },
    userParamValues: {
      avatar: 'server_default',
      voice: 'server_default',
      custom_avatar: 'Ann Doctor Standing',
      custom_voice: 'Ivy',
      caption: true,
    },
  });
  assert.equal(heygenPayload.endpoint, 'fal-ai/heygen/avatar5/digital-twin');
  assert.equal((heygenPayload.payload as any).avatar, 'Ann Doctor Standing');
  assert.equal((heygenPayload.payload as any).voice, 'Ivy');
  assert.equal((heygenPayload.payload as any).custom_avatar, undefined);
  assert.equal((heygenPayload.payload as any).custom_voice, undefined);
  assert.equal((heygenPayload.payload as any).caption, true);
});

test('3D model preview supports common FAL model formats', () => {
  const preview = readFileSync(new URL('../src/components/nodes/Model3DPreviewNode.tsx', import.meta.url), 'utf8');
  const registry = readFileSync(new URL('../src/config/nodeRegistry.ts', import.meta.url), 'utf8');
  const output = readFileSync(new URL('../src/components/nodes/OutputNode.tsx', import.meta.url), 'utf8');
  const upload = readFileSync(new URL('../src/components/nodes/UploadNode.tsx', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');

  assert.match(preview, /FBXLoader/);
  assert.match(preview, /OBJLoader/);
  assert.match(preview, /STLLoader/);
  assert.match(preview, /USDLoader/);
  assert.match(preview, /glb\/gltf\/obj\/stl\/fbx\/usdz/);
  assert.match(preview, /toErrorMessage/);
  assert.match(preview, /下载地址/);
  assert.match(preview, /function clearThreeMount/);
  assert.match(preview, /canvas\.parentNode === mount/);
  assert.match(preview, /ref=\{mountRef\} className="absolute inset-0"/);
  assert.doesNotMatch(preview, /while \(mount\.firstChild\) mount\.removeChild\(mount\.firstChild\)/);
  assert.doesNotMatch(preview, /当前内置预览先支持 glb\/gltf/);
  assert.match(registry, /glb\/gltf\/obj\/stl\/fbx\/usdz 3D 模型/);
  assert.match(output, /const isModel3DUrl/);
  assert.match(output, /3D模型 \(\{collected\.models\.length\}\)/);
  assert.match(output, /splitOutputCollection\('model3d', collected\.models\)/);
  assert.match(upload, /MODEL_3D_EXT_RE/);
  assert.match(upload, /3D素材上传/);
  assert.match(canvas, /pushMod\(d\.modelUrl\)/);
  assert.match(canvas, /type:\s*'model-3d-preview'/);
  assert.match(canvas, /'model-3d-preview'/);
  assert.match(canvas, /const shouldCollectModelOutputs = t !== 'model-3d-preview'/);
  assert.match(canvas, /snapshot image still needs normal auto output/);
  assert.match(canvas, /if \(shouldCollectModelOutputs\) \{\s*pushMod\(d\.modelUrl\)/);
  assert.doesNotMatch(canvas, /SKIP_TYPES = new Set\(\[[^\]]*'model-3d-preview'/);
  assert.match(canvas, /Clean up bad chains created by older builds/);
  assert.match(canvas, /source\?\.type === 'model-3d-preview'/);
  assert.match(canvas, /target\.id\.startsWith\('model-3d-preview-auto-'\)/);
});

test('Fal toolbox backend is additive and keeps old FAL routes', () => {
  const proxy = readFileSync(new URL('../backend/src/routes/proxy.js', import.meta.url), 'utf8');
  assert.match(proxy, /router\.post\('\/image\/fal\/submit'/);
  assert.match(proxy, /router\.post\('\/video\/fal\/submit'/);
  assert.match(proxy, /router\.post\('\/fal-toolbox\/submit'/);
  assert.match(proxy, /router\.post\('\/fal-toolbox\/query'/);
  assert.match(proxy, /queue\.fal\.run/);
  assert.match(proxy, /ensureDefaultZhenzhenKey\(settings, res, 'Fal超市'\)/);
});

test('Fal toolbox maker is dev-only and guarded from packaged builds', () => {
  const registry = readFileSync(new URL('../src/config/nodeRegistry.ts', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../src/components/Canvas.tsx', import.meta.url), 'utf8');
  const ports = readFileSync(new URL('../src/config/portTypes.ts', import.meta.url), 'utf8');
  const postBuild = readFileSync(new URL('../electron/_post_build.cjs', import.meta.url), 'utf8');
  const publicCheck = readFileSync(new URL('../scripts/check-public-clean.cjs', import.meta.url), 'utf8');
  const node = readFileSync(new URL('../src/components/nodes/FalToolboxNode.tsx', import.meta.url), 'utf8');
  const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');

  assert.match(registry, /import\.meta\.env\?\.DEV[\s\S]*type:\s*'fal-toolbox-maker'[\s\S]*label:\s*'FAL应用制作工具'/);
  assert.match(canvas, /const FAL_TOOLBOX_MAKER_MODULE = '\.\/nodes\/FalToolboxMakerNode'/);
  assert.match(canvas, /lazyCanvasNode\(\(\) => import\(\/\* @vite-ignore \*\/ FAL_TOOLBOX_MAKER_MODULE\), 'FalToolboxMakerNode'\)/);
  assert.match(canvas, /import\.meta\.env\?\.DEV \? \{ 'fal-toolbox-maker': FalToolboxMakerNode \} : \{\}/);
  assert.match(ports, /import\.meta\.env\?\.DEV[\s\S]*'fal-toolbox-maker':\s*\{\s*inputs:\s*\[\],\s*outputs:\s*\['text'\]\s*\}/);
  assert.match(postBuild, /checkNoFalToolboxMaker/);
  assert.match(postBuild, /FalToolboxMakerNode/);
  assert.match(postBuild, /FAL应用制作工具/);
  assert.match(publicCheck, /src\/components\/nodes\/FalToolboxMakerNode\.tsx/);
  assert.match(publicCheck, /src\/utils\/falToolboxDeveloper\.ts/);
  assert.match(gitignore, /\/src\/components\/nodes\/FalToolboxMakerNode\.tsx/);
  assert.match(gitignore, /\/src\/utils\/falToolboxDeveloper\.ts/);
  assert.match(node, /const FAL_TOOLBOX_DEVELOPER_MODULE = '\.\.\/\.\.\/utils\/falToolboxDeveloper'/);
  assert.match(node, /import\(\/\* @vite-ignore \*\/ FAL_TOOLBOX_DEVELOPER_MODULE\)/);
});
