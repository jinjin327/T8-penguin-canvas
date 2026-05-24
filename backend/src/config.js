const path = require('path');

// T8-penguin-canvas 后端配置
// 可通过 T8PC_BASE_DIR 环境变量覆盖项目根路径(打包后指向 userData)
const PROJECT_DIR = process.env.T8PC_BASE_DIR || path.resolve(__dirname, '..', '..');

const config = {
  // 服务器
  HOST: process.env.HOST || '127.0.0.1',
  PORT: process.env.PORT || 18766, // 注意:与主项目 18765 错开
  NODE_ENV: process.env.NODE_ENV || 'development',

  // 数据 / 资源目录(全部位于 T8-penguin-canvas/data 下)
  BASE_DIR: PROJECT_DIR,
  DATA_DIR: path.join(PROJECT_DIR, 'data'),
  INPUT_DIR: path.join(PROJECT_DIR, 'input'),
  OUTPUT_DIR: path.join(PROJECT_DIR, 'output'),
  THUMBNAILS_DIR: path.join(PROJECT_DIR, 'thumbnails'),

  // 数据文件
  CANVAS_FILE: path.join(PROJECT_DIR, 'data', 'canvas_list.json'),
  SETTINGS_FILE: path.join(PROJECT_DIR, 'data', 'settings.json'),
  RH_APPS_FILE: path.join(PROJECT_DIR, 'data', 'rh_apps.json'),

  // 缩略图配置
  THUMBNAIL_SIZE: 160,
  THUMBNAIL_QUALITY: 80,

  // 业务配置
  MAX_FILE_SIZE: 10 * 1024 * 1024,

  // 三套 API Key 默认值(均可在 settings 中覆盖)
  // 贞贞工坊 / LLM 独立 Key 强制走 https://ai.t8star.org
  ZHENZHEN_BASE_URL: 'https://ai.t8star.org',
  RH_BASE_URL: 'https://www.runninghub.cn',
};

module.exports = config;
