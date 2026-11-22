// 所有日期一律用本地时区拼装，避免 toISOString 带来的跨时区偏移
export const WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
export const WEEK_SHORT = ['一', '二', '三', '四', '五', '六', '日']

export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(key: string, delta: number): string {
  const d = fromKey(key)
  d.setDate(d.getDate() + delta)
  return toDateKey(d)
}

export function todayKey(): string {
  return toDateKey(new Date())
}

// weekOffset = 0 表示本周（周一为一周起点）
export function weekDates(weekOffset = 0): string[] {
  const now = new Date()
  const dow = now.getDay() === 0 ? 7 : now.getDay()
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dow - 1) + weekOffset * 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return toDateKey(d)
  })
}

export function isWeekend(key: string): boolean {
  const dow = fromKey(key).getDay()
  return dow === 0 || dow === 6
}

export function dayNum(key: string): string {
  return `${fromKey(key).getDate()}`
}

export function monthDay(key: string): string {
  const d = fromKey(key)
  return `${d.getMonth() + 1}.${d.getDate()}`
}

export function weekdayIndex(key: string): number {
  const dow = fromKey(key).getDay()
  return dow === 0 ? 6 : dow - 1
}

// 当前时间在 0-24 之间的小数表示，用于时间轴上的「此刻」红线
export function nowHourFloat(): number {
  const n = new Date()
  return n.getHours() + n.getMinutes() / 60
}
