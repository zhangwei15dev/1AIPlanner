/**
 * 小程序产物冒烟测试（无需微信开发者工具）
 *
 * 用最小化的 wx / App / Page / Component 桩件在 Node 里加载 dist 的 weapp 产物，
 * 跑通 app.onLaunch 与每个页面的 onLoad/onShow，检查 setData 是否真的产出内容。
 * 用于确认「能编译」之外，产物在真机运行时也不会白屏。
 *
 * 用法：npm run build:weapp && node scripts/smoke-weapp.js
 */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const DIST = path.resolve(__dirname, '..', 'dist')

let currentDir = DIST
function resolveReq(req, fromDir) {
  let p = path.resolve(fromDir, req)
  if (!fs.existsSync(p)) {
    if (fs.existsSync(p + '.js')) p = p + '.js'
    else if (fs.existsSync(path.join(p, 'index.js'))) p = path.join(p, 'index.js')
  }
  return p
}

const moduleCache = new Map()
const store = new Map()
const logs = []
const errors = []

function noop() {}
function chainable() {
  const o = {}
  const ret = () => o
  ;['select', 'selectAll', 'selectViewport', 'boundingClientRect', 'scrollOffset', 'fields',
    'exec', 'in', 'node', 'context', 'ref', 'size', 'createSelectorQuery'].forEach(k => { o[k] = ret })
  return o
}

const sysInfo = {
  platform: 'devtools', system: 'macOS 14.0', model: 'iPhone 12', brand: 'devtools',
  windowWidth: 390, windowHeight: 844, screenWidth: 390, screenHeight: 844,
  pixelRatio: 3, statusBarHeight: 47, safetyAreaBottom: 34,
  safeArea: { left: 0, right: 390, top: 47, bottom: 810, width: 390, height: 763 },
  language: 'zh_CN', version: '8.0.50', SDKVersion: '3.5.0', fontSizeSetting: 16,
  enableDebug: false, host: { appId: 'wx41dee268e14c67b3' },
}

const wxBase = {
  getSystemInfoSync: () => sysInfo,
  getSystemInfo: (o) => { o && o.success && o.success(sysInfo) },
  getWindowInfo: () => sysInfo,
  getDeviceInfo: () => sysInfo,
  getAppBaseInfo: () => ({ SDKVersion: '3.5.0', language: 'zh_CN', version: '8.0.50', theme: 'light' }),
  getSystemSetting: () => ({ bluetoothEnabled: false, locationEnabled: false, wifiEnabled: true }),
  getAppAuthorizeSetting: () => ({}),
  getLaunchOptionsSync: () => ({ path: 'pages/overview/overview', scene: 1001, query: {} }),
  getEnterOptionsSync: () => ({ path: 'pages/overview/overview', scene: 1001, query: {} }),
  getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k, v) => { store.set(k, v) },
  removeStorageSync: (k) => { store.delete(k) },
  clearStorageSync: () => store.clear(),
  getStorageInfoSync: () => ({ keys: [...store.keys()], currentSize: 0, limitSize: 10240 }),
  nextTick: (fn) => setTimeout(fn, 0),
  canIUse: () => true,
  onAppRoute: noop, onAppRouteDone: noop, onError: noop, onUnhandledRejection: noop,
  onWindowResize: noop, offWindowResize: noop, onThemeChange: noop,
  getMenuButtonBoundingClientRect: () => ({ top: 51, bottom: 83, left: 296, right: 383, width: 87, height: 32 }),
  getUpdateManager: () => ({ onCheckForUpdate: noop, onUpdateReady: noop, onUpdateFailed: noop, applyUpdate: noop }),
  createSelectorQuery: () => chainable(),
  createIntersectionObserver: () => ({ relativeToViewport: () => ({ observe: noop, disconnect: noop }), observe: noop, disconnect: noop }),
  createVideoContext: () => ({}), createCanvasContext: () => ({}),
  showToast: (o) => { logs.push(['showToast', o && o.title]); o && o.success && o.success() },
  showModal: (o) => { logs.push(['showModal', o && o.title]); o && o.success && o.success({ confirm: true, cancel: false }) },
  showLoading: noop, hideLoading: noop, showActionSheet: noop,
  setNavigationBarTitle: noop, setNavigationBarColor: noop, setTabBarBadge: noop, setTabBarStyle: noop,
  navigateTo: (o) => { o && o.success && o.success() }, redirectTo: noop, switchTab: noop, navigateBack: noop,
  reportEvent: noop, reportAnalytics: noop, reportMonitor: noop,
  getAccountInfoSync: () => ({ miniProgram: { appId: 'wx41dee268e14c67b3', envVersion: 'develop', version: '' } }),
  getRealtimeLogManager: () => ({ info: noop, warn: noop, error: noop, setFilterMsg: noop, addFilterMsg: noop }),
  getLogManager: () => ({ log: noop, info: noop, warn: noop, debug: noop }),
  getPerformance: () => ({ createObserver: () => ({ start: noop, stop: noop }), now: () => Date.now() }),
}

const DATA_KEYS = new Set(['webpackJsonp', '__wxConfig', 'env', 'globalData'])

const wx = new Proxy(wxBase, {
  set(t, prop, v) { t[prop] = v; return true },
  get(t, prop) {
    if (prop in t) return t[prop]
    if (typeof prop === 'symbol') return undefined
    if (DATA_KEYS.has(prop)) return undefined
    return (...args) => {
      const o = args[0]
      if (o && typeof o === 'object') {
        if (typeof o.success === 'function') setTimeout(() => o.success({}), 0)
        if (typeof o.complete === 'function') setTimeout(() => o.complete({}), 0)
      }
      return chainable()
    }
  },
  has: () => true,
})

const pages = []
const apps = []
const components = []

const sandbox = {
  console: { log: (...a) => logs.push(['log', a.join(' ')]), warn: noop, error: (...a) => errors.push(a.join(' ')), info: noop, debug: noop, group: noop, groupEnd: noop, time: noop, timeEnd: noop },
  wx,
  App: (cfg) => apps.push(cfg),
  Page: (cfg) => pages.push(cfg),
  Component: (cfg) => components.push(cfg),
  Behavior: (b) => b,
  getApp: () => apps[0] || {},
  getCurrentPages: () => [],
  requirePlugin: noop,
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: clearTimeout,
  queueMicrotask,
  Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, TypeError,
  Symbol, Map, Set, WeakMap, WeakSet, Proxy, Reflect, Intl, ArrayBuffer, Uint8Array, Float64Array,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, escape, unescape,
  TextEncoder: global.TextEncoder, TextDecoder: global.TextDecoder,
  process: { env: { NODE_ENV: 'production' } },
  navigator: { userAgent: 'wechat-miniprogram' },
  __wxConfig: { pages: [], envVersion: 'develop', platform: 'devtools', appLaunchInfo: {}, global: {} },
  __wxAppCode__: {},
}
sandbox.global = sandbox
sandbox.globalThis = sandbox
sandbox.self = sandbox

const ctx = vm.createContext(sandbox)

ctx.require = function (req) {
  const from = currentDir
  if (req.startsWith('.') || req.startsWith('/')) {
    const file = resolveReq(req, from)
    if (moduleCache.has(file)) return moduleCache.get(file).exports
    return runFile(file)
  }
  // 兜底：给不认识的内置模块返回空对象
  return {}
}

function runFile(file) {
  const src = fs.readFileSync(file, 'utf8')
  const mod = { exports: {} }
  moduleCache.set(file, mod)
  const prev = currentDir
  currentDir = path.dirname(file)
  try {
    const fn = vm.runInContext(
      '(function (require, module, exports, __filename, __dirname) {' + src + '\n})',
      ctx,
      { filename: file }
    )
    fn(ctx.require, mod, mod.exports, file, path.dirname(file))
  } finally {
    currentDir = prev
  }
  return mod.exports
}

const order = ['runtime.js', 'vendors.js', 'taro.js', 'common.js', 'app.js']
for (const f of order) {
  runFile(path.join(DIST, f))
}
console.log('[smoke] modules loaded ok; App() called:', apps.length, '| Page() before nav:', pages.length)

const app = apps[0]
if (!app) throw new Error('App() not called — bundle did not register app')
app.onLaunch && app.onLaunch({ path: 'pages/overview/overview', scene: 1001, query: {} })
app.onShow && app.onShow({ path: 'pages/overview/overview', scene: 1001, query: {} })

const CASES = [
  { file: 'pages/overview/overview.js', expect: ['96', '店长', '排班'] },
  { file: 'pages/schedule/schedule.js', expect: ['96', '缺', '早班'] },
  { file: 'pages/staff/staff.js', expect: ['18', '陈可', '导购'] },
  { file: 'pages/assistant/assistant.js', expect: ['一键排班', '助手'] },
]

async function runPage(c) {
  pages.length = 0
  runFile(path.join(DIST, c.file))
  const cfg = pages[pages.length - 1]
  if (!cfg) return { file: c.file, ok: false, reason: 'Page() 未注册' }
  const setDataCalls = []
  const inst = Object.assign({}, cfg, {
    data: {},
    setData(patch, cb) { setDataCalls.push(patch); Object.assign(this.data, patch); cb && cb() },
    selectComponent: () => null,
    selectAllComponents: () => [],
    createSelectorQuery: () => chainable(),
    triggerEvent: noop,
    route: c.file.replace('.js', '').replace('/pages/', 'pages/'),
  })
  try {
    inst.onLoad && inst.onLoad({})
    inst.onShow && inst.onShow()
  } catch (e) {
    return { file: c.file, ok: false, reason: 'onLoad/onShow 抛错: ' + e.message }
  }
  await new Promise((r) => setTimeout(r, 700))
  const flat = setDataCalls.map((x) => JSON.stringify(x)).join('')
  const missing = c.expect.filter((k) => !flat.includes(k))
  return { file: c.file, ok: setDataCalls.length > 0 && missing.length === 0, setData: setDataCalls.length, bytes: flat.length, missing }
}

;(async () => {
  const results = []
  for (const c of CASES) results.push(await runPage(c))
  for (const r of results) console.log('[smoke]', JSON.stringify(r))
  const fail = results.filter((r) => !r.ok)
  console.log('[smoke] errors:', errors.length ? errors.slice(0, 3) : 'none')
  console.log('[smoke] RESULT', fail.length === 0 ? 'PASS' : 'FAIL ' + JSON.stringify(fail))
  if (fail.length) process.exitCode = 1
})()
