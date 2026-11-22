/**
 * 用 miniprogram-ci 生成真机预览二维码（约 25 分钟有效）
 *
 * 用法：
 *   MP_KEY=~/keys/private.key node scripts/preview.js
 */
const fs = require('fs')
const path = require('path')

const ci = require(process.env.MINIPROGRAM_CI || 'miniprogram-ci')

const ROOT = path.resolve(__dirname, '..')
const APPID = process.env.MP_APPID || 'wx41dee268e14c67b3'
const PROJECT_PATH = process.env.MP_PROJECT || path.join(ROOT, 'dist')
const KEY_PATH = process.env.MP_KEY || path.join(ROOT, 'private.key')
const OUT = process.env.MP_QR || path.join(ROOT, 'preview', 'preview-qrcode.jpg')

const project = new ci.Project({
  appid: APPID,
  type: 'miniProgram',
  projectPath: PROJECT_PATH,
  privateKeyPath: KEY_PATH,
  ignores: ['node_modules/**/*'],
})

ci.preview({
  project,
  desc: '1AIPlanner 真机预览',
  setting: { es6: true, es7: true, minify: true, autoPrefixWXSS: true },
  robot: 1,
  qrcodeFormat: 'image',
  qrcodeOutputDest: OUT,
  onProgressUpdate: (t) => {
    const msg = typeof t === 'string' ? t : (t && t._msg)
    if (msg) console.log('[progress]', msg)
  },
})
  .then(() => console.log('PREVIEW_OK', OUT, fs.statSync(OUT).size + ' bytes'))
  .catch((e) => {
    console.error('PREVIEW_FAILED', e && e.errCode, e && e.message)
    process.exit(1)
  })
