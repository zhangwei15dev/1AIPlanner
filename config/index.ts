import { defineConfig } from '@tarojs/cli'

// 极简构建配置：只保留编译所需项，小程序 / H5 双端可跑
export default defineConfig<'webpack5'>(async () => ({
  projectName: '1AIPlanner',
  date: '2026-11-16',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    375: 2,
    828: 1.81 / 2,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: [],
  defineConstants: {},
  copy: {
    patterns: [{ from: 'src/assets', to: 'dist/assets' }],
    options: {},
  },
  framework: 'react',
  // 关闭依赖预编译：新版 Node 下 prebundle 会因 webpack-virtual-modules 不兼容而崩溃
  compiler: {
    type: 'webpack5',
    prebundle: { enable: false },
  },
  mini: {
    postcss: {
      pxtransform: { enable: true, config: {} },
      cssModules: { enable: false, config: { namingPattern: 'module' } },
    },
  },
  h5: {
    publicPath: '/',
    staticDirectory: 'static',
    postcss: {
      autoprefixer: { enable: true, config: {} },
      cssModules: { enable: false, config: { namingPattern: 'module' } },
    },
  },
}))
