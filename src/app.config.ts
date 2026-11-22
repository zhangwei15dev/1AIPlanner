export default defineAppConfig({
  pages: [
    'pages/overview/overview',
    'pages/schedule/schedule',
    'pages/staff/staff',
    'pages/assistant/assistant',
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: '1AIPlanner',
    navigationBarTextStyle: 'black',
    backgroundColor: '#F7F7F4',
  },
  tabBar: {
    color: '#9CA3AF',
    selectedColor: '#111418',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      { pagePath: 'pages/overview/overview', text: '总览' },
      { pagePath: 'pages/schedule/schedule', text: '排班' },
      { pagePath: 'pages/staff/staff', text: '员工' },
      { pagePath: 'pages/assistant/assistant', text: '助手' },
    ],
  },
})
