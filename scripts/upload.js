/**
 * 用 miniprogram-ci 上传代码（生成「开发版」）
 *
 * 前置：
 *   npm i -D miniprogram-ci         # 或在任意目录装好后用 MINIPROGRAM_CI 指定
 *   mp.weixin.qq.com → 开发管理 → 开发设置 → 小程序代码上传密钥：下载密钥、按需关闭 IP 白名单
 *
 * 用法：
 *   MP_KEY=~/keys/private.key node scripts/upload.js "1.0.1" "修复:xx"
 *   可选环境变量：MP_APPID / MP_PROJECT / MP_KEY / MINIPROGRAM_CI
 */
const fs = require('fs')
const path = require('path')

const ci = require(process.env.MINIPROGRAM_CI || 'miniprogram-ci')

const ROOT = path.resolve(__dirname, '..')
const APPID = process.env.MP_APPID || 'wx41dee268e14c67b3'
const PROJECT_PATH = process.env.MP_PROJECT || path.join(ROOT, 'dist')
const KEY_PATH = process.env.MP_KEY || path.join(ROOT, 'private.key')

const version = process.argv[2] || '1.0.0'
const desc = process.argv[3] || '1AIPlanner 自动上传'

if (!fs.existsSync(PROJECT_PATH)) {
  console.error(`[1aiplanner] 找不到构建产物：${PROJECT_PATH}\n先执行 npm run build:weapp`)
  process.exit(1)
}
if (!fs.existsSync(KEY_PATH)) {
  console.error(`[1aiplanner] 找不到上传密钥：${KEY_PATH}\n用 MP_KEY=/abs/path/private.key 指定`)
  process.exit(1)
}

const project = new ci.Project({
  appid: APPID,
  type: 'miniProgram',
  projectPath: PROJECT_PATH,
  privateKeyPath: KEY_PATH,
  ignores: ['node_modules/**/*'],
})

console.log(`[1aiplanner] appid=${APPID}\n[1aiplanner] project=${PROJECT_PATH}\n[1aiplanner] version=${version}`)

ci.upload({
  project,
  version,
  desc,
  robot: 1,
  setting: {
    es6: true,
    es7: true,
    minify: true,
    minifyJS: true,
    minifyWXML: true,
    minifyWXSS: true,
    autoPrefixWXSS: true,
    codeProtect: false,
  },
  onProgressUpdate: (t) => {
    const msg = typeof t === 'string' ? t : (t && t._msg)
    if (msg) console.log('[progress]', msg)
  },
})
  .then((res) => {
    console.log('UPLOAD_OK', JSON.stringify(res))
    console.log('[1aiplanner] 下一步：mp.weixin.qq.com → 管理 → 版本管理 → 开发版本 → 设为体验版 / 提交审核')
  })
  .catch((e) => {
    console.error('UPLOAD_FAILED', e && e.errCode, e && e.message)
    process.exit(1)
  })
