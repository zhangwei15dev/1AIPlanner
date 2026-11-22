import { readWorkbook } from './excel'
import { ROLES } from '../data/demo'
import type { RoleCode } from '../types'

// ============================================================================
// 自定义班表导入
// 支持两类常见导出：
//   A. 表格型：表头含「姓名 / 上班 / 下班」（Dayforce 之类系统导出的排班网格）
//   B. 块状型：A 列「员工001」+ 下一行岗位与「9:00上 - 6:00下」时段（复制班表）
// 块状表只用来补岗位，表格型表提供真正的班次时间。
// ============================================================================

export interface RosterRow {
  name: string
  roleName: string
  roleCode: RoleCode
  startMin: number
  endMin: number
  zoneText: string
  zoneId: string
}

export interface RosterParse {
  date: string | null // YYYY-MM-DD，解析不到为 null
  dateSource: string // 日期来自哪里（工作表名 / 表格里的日期 / 文件名）
  rows: RosterRow[]
  errors: string[]
  notes: string[]
  sheets: string[]
  roleNames: string[]
  zoneTexts: string[]
  minStart: number
  maxEnd: number
}

const norm = (v: string) => (v || '').replace(/\s+/g, ' ').trim()

const isNoise = (v: string) => {
  const s = norm(v)
  if (!s || s === '#N/A' || s === 'N/A' || s === '-' || s === '—' || s === '0') return true
  return /^(break|off|休息|吃饭|lunch)$/i.test(s)
}

const pad2 = (n: number) => (n < 10 ? '0' + n : '' + n)

const dateKey = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`

// ---------------- 时间 ----------------
export function parseClock(v: string): number | null {
  const s = norm(v)
  if (!s) return null
  const hm = s.match(/^(\d{1,2})[:：](\d{2})(?:[:：]\d{2})?$/)
  if (hm) {
    const h = Number(hm[1])
    const m = Number(hm[2])
    if (h > 24 || m > 59) return null
    return h * 60 + m
  }
  // Excel 时间单元格（0~1 的小数）
  const num = Number(s)
  if (!isNaN(num) && num > 0 && num < 1) return Math.round(num * 24 * 60)
  return null
}

export function parseRange(v: string): { start: number; end: number } | null {
  const s = norm(v).replace(/\s+/g, '')
  const m = s.match(
    /(\d{1,2})[:：](\d{2})(上午|下午|上|下|am|pm|AM|PM)?[-~–—至到](\d{1,2})[:：](\d{2})(上午|下午|上|下|am|pm|AM|PM)?/,
  )
  if (!m) return null
  let sh = Number(m[1])
  const sm = Number(m[2])
  let eh = Number(m[4])
  const em = Number(m[5])
  const smark = (m[3] || '').toLowerCase()
  const emark = (m[6] || '').toLowerCase()
  const pm = (mark: string) => mark === '下' || mark === '下午' || mark === 'pm'
  if (pm(smark) && sh < 12) sh += 12
  if (pm(emark) && eh < 12) eh += 12
  if (sh > 24 || eh > 24 || sm > 59 || em > 59) return null
  let start = sh * 60 + sm
  let end = eh * 60 + em
  if (end <= start) end += 12 * 60
  if (end - start > 16 * 60) return null
  return { start, end }
}

// ---------------- 岗位 / 区域 映射 ----------------
const ROLE_RULES: { keys: string[]; code: RoleCode }[] = [
  { keys: ['店长', '经理', 'manager', 'store manager', 'sm'], code: 'manager' },
  { keys: ['副店', '副经理', '主管', 'supervisor', 'assistant', 'asm'], code: 'supervisor' },
  { keys: ['收银', 'cashier', 'cassa', '前台'], code: 'cashier' },
  { keys: ['仓', '库', 'stock', 'operation', 'ops', '理货', '后勤'], code: 'stock' },
  { keys: ['教练', 'coach', 'trainer', '培训', '讲师'], code: 'coach' },
  { keys: ['服务', 'service', '迎宾', '客服', 'greeter'], code: 'service' },
]

export function mapRole(roleName: string): RoleCode {
  const s = norm(roleName).toLowerCase()
  if (!s) return 'sales'
  // 先精确匹配内置角色名
  const exact = ROLES.find(r => r.name === norm(roleName))
  if (exact) return exact.code
  for (const rule of ROLE_RULES) {
    if (rule.keys.some(k => s.indexOf(k) >= 0)) return rule.code
  }
  return 'sales'
}

const ZONE_RULES: { keys: string[]; id: string }[] = [
  { keys: ['仓', '库', 'stock', 'boh', 'backroom', '后仓', '理货', '收货', 'admin', 'office'], id: 'z4' },
  { keys: ['服务', 'service', '客服', '前台', '收银', 'cashier', 'wecom', '线上', '电商'], id: 'z3' },
  { keys: ['体验', '试衣', 'fitting', 'fos', 'studio', '教室', '教练', 'coach', 'theater'], id: 'z2' },
]

export function mapZone(zoneText: string): string {
  const s = norm(zoneText).toLowerCase()
  if (!s) return 'z1'
  for (const rule of ZONE_RULES) {
    if (rule.keys.some(k => s.indexOf(k) >= 0)) return rule.id
  }
  return 'z1'
}

// ---------------- 表头识别 ----------------
const headerScore = (row: string[]) => {
  const text = row.map(norm)
  const has = (keys: string[]) => text.some(t => keys.some(k => t.indexOf(k) >= 0))
  let score = 0
  if (has(['姓名'])) score += 3
  if (has(['上班', '开始'])) score += 2
  if (has(['下班', '结束'])) score += 2
  return score
}

// 从数据区猜「区域 / 岗位安排」列：分类文本、取值 2~20 种、填充率高、且不是姓名列
const guessZoneCol = (rows: string[][], startRow: number, skip: number[]): number => {
  const head = rows[startRow - 1] || []
  // 时间网格（07:00:00 / 08:00 ... 逐半小时）左侧才是人员信息区
  let gridStart = head.length
  for (let c = 0; c < head.length; c++) {
    if (parseClock(head[c] || '') !== null) {
      gridStart = c
      break
    }
  }
  const width = Math.min(Math.max(...rows.slice(startRow).map(r => r.length), 0), gridStart)
  let best = -1
  let bestScore = 0
  for (let c = 0; c < width; c++) {
    if (skip.indexOf(c) >= 0) continue
    const values: string[] = []
    for (let r = startRow; r < rows.length; r++) {
      const v = norm((rows[r] || [])[c] || '')
      if (!v || isNoise(v)) continue
      if (/^[\d.]+$/.test(v)) continue // 纯数字列（工时、单数等）
      if (parseClock(v) !== null) continue
      values.push(v)
    }
    if (values.length < 5) continue
    const distinct = Array.from(new Set(values))
    if (distinct.length < 2 || distinct.length > 20) continue
    if (distinct.length === values.length) continue // 全都不重复，多半是姓名列
    const ratio = values.length / Math.max(1, rows.length - startRow)
    const score = distinct.length * ratio
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

const findCol = (row: string[], keys: string[]) => {
  for (let i = 0; i < row.length; i++) {
    const t = norm(row[i])
    if (t && keys.some(k => t.indexOf(k) >= 0)) return i
  }
  return -1
}

// ---------------- 主流程 ----------------
export function parseRoster(bytes: Uint8Array, fallbackDate?: string): RosterParse {
  const sheets = readWorkbook(bytes)
  const result: RosterParse = {
    date: null,
    dateSource: '',
    rows: [],
    errors: [],
    notes: [],
    sheets: sheets.map(s => s.name),
    roleNames: [],
    zoneTexts: [],
    minStart: 0,
    maxEnd: 0,
  }

  // 1) 全表里找日期（形如 2026/11/5、2026-11-05）
  //    「星期四 - 2026/11/5」这类带星期/排班语义的表头优先，其次是「运行日期」这类报表元信息
  let detectedDate = ''
  let detectedScore = -1
  for (const sh of sheets) {
    for (const row of sh.rows.slice(0, 15)) {
      for (const cell of row) {
        const text = norm(cell)
        const m = text.match(/(20\d{2})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/)
        if (!m) continue
        let score = 1
        if (/星期|周[一二三四五六日天]/.test(text)) score = 3
        else if (/日期|date/i.test(text)) score = 1
        if (score > detectedScore) {
          detectedScore = score
          detectedDate = dateKey(Number(m[1]), Number(m[2]), Number(m[3]))
        }
      }
    }
  }
  const year = detectedDate ? Number(detectedDate.slice(0, 4)) : new Date().getFullYear()

  // 2) 块状表：员工编号 → 岗位（复制班表这类）
  const roleByName: Record<string, string> = {}
  const blockRole = /员工|工号|employee/i
  for (const sh of sheets) {
    for (let r = 0; r < sh.rows.length - 1; r++) {
      const row = sh.rows[r]
      const nameCell = norm(row[0] || '')
      if (!nameCell || !blockRole.test(nameCell)) continue
      const next = sh.rows[r + 1] || []
      const roleCell = norm(next[0] || '')
      if (roleCell && !/^\d+$/.test(roleCell) && !blockRole.test(roleCell)) {
        roleByName[nameCell] = roleCell
      }
    }
  }

  // 3) 表格型工作表：表头含 姓名 + 上班/下班
  const rosterSheets = sheets.filter(sh => {
    const head = sh.rows.slice(0, 25).find(r => headerScore(r) >= 5)
    return !!head
  })

  const merged = new Map<string, RosterRow>()

  // 3.1) 没有表格型时，退回块状表：员工编号 + 岗位 + 「9:00上 - 6:00下」
  if (!rosterSheets.length) {
    for (const sh of sheets) {
      for (let r = 0; r < sh.rows.length - 1; r++) {
        const nameCell = norm((sh.rows[r] || [])[0] || '')
        if (!nameCell || !blockRole.test(nameCell)) continue
        const next = sh.rows[r + 1] || []
        let range: { start: number; end: number } | null = null
        for (let c = 1; c < Math.min(next.length, 4); c++) {
          const parsed = parseRange(next[c] || '')
          if (parsed) {
            range = parsed
            break
          }
        }
        if (!range) continue
        const roleCell = norm(next[0] || '')
        const roleName = roleCell && !/^\d+$/.test(roleCell) && !blockRole.test(roleCell) ? roleCell : ''
        if (roleName && result.roleNames.indexOf(roleName) < 0) result.roleNames.push(roleName)
        if (merged.has(nameCell)) continue
        merged.set(nameCell, {
          name: nameCell,
          roleName,
          roleCode: mapRole(roleName),
          startMin: range.start,
          endMin: range.end,
          zoneText: '',
          zoneId: 'z1',
        })
      }
      if (merged.size) {
        const m = sh.name.match(/^(\d{1,2})[.\-_/月]?(\d{1,2})日?$/)
        if (!result.date && detectedDate) {
          result.date = detectedDate
          result.dateSource = '工作表内日期'
        } else if (!result.date && m) {
          const mm = Number(m[1])
          const dd = Number(m[2])
          if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
            result.date = dateKey(year, mm, dd)
            result.dateSource = `工作表名「${sh.name}」`
          }
        }
        if (result.date) break
      }
    }
    if (!merged.size) {
      result.errors.push('没有找到含「姓名 + 上班 / 下班」表头的工作表')
      return result
    }
    result.notes.push('按「员工编号 + 岗位 + 时段」块状结构解析，未识别区域')
  }

  for (const sh of rosterSheets) {
    const headIdx = sh.rows.slice(0, 25).findIndex(r => headerScore(r) >= 5)
    const head = sh.rows[headIdx]
    const ci = {
      name: findCol(head, ['姓名', '姓名/工号', '员工']),
      start: findCol(head, ['上班', '开始']),
      end: findCol(head, ['下班', '结束']),
      range: findCol(head, ['复制班表', '班次', '时段']),
      role: findCol(head, ['岗位', '角色', '职位', 'role']),
      zone: findCol(head, ['区域', '岗位区域', 'focus', '岗位安排', 'duty']),
    }
    // 表头没有「区域」列时，按内容猜一列分类文本（如 admin / 1F FL / w floater）
    if (ci.zone < 0) {
      ci.zone = guessZoneCol(sh.rows, headIdx + 1, [ci.name, ci.start, ci.end, ci.range, ci.role])
      if (ci.zone >= 0) result.notes.push(`区域列按内容识别为第 ${ci.zone + 1} 列`)
    }

    for (let r = headIdx + 1; r < sh.rows.length; r++) {
      const row = sh.rows[r]
      const name = norm(row[ci.name] || '')
      if (!name || /^\d+(\.\d+)?$/.test(name)) continue
      if (name === '姓名') continue

      let start: number | null = ci.start >= 0 ? parseClock(row[ci.start] || '') : null
      let end: number | null = ci.end >= 0 ? parseClock(row[ci.end] || '') : null
      if ((start === null || end === null) && ci.range >= 0) {
        const range = parseRange(row[ci.range] || '')
        if (range) {
          start = range.start
          end = range.end
        }
      }
      if (start === null || end === null || end <= start) {
        if (norm(row[ci.name]) && (norm(row[ci.start] || '') || norm(row[ci.range] || ''))) {
          result.errors.push(`第 ${r + 1} 行「${name}」的上下班时间无法识别`)
        }
        continue
      }

      const roleName = ci.role >= 0 ? norm(row[ci.role] || '') : roleByName[name] || ''
      const zoneText = ci.zone >= 0 ? norm(row[ci.zone] || '') : ''

      if (roleName && result.roleNames.indexOf(roleName) < 0) result.roleNames.push(roleName)
      if (zoneText && !isNoise(zoneText) && result.zoneTexts.indexOf(zoneText) < 0) {
        result.zoneTexts.push(zoneText)
      }

      const prev = merged.get(name)
      if (prev) {
        // 一人多段（拆班）：合并成最早开始、最晚结束
        prev.startMin = Math.min(prev.startMin, start)
        prev.endMin = Math.max(prev.endMin, end)
        if (!prev.roleName && roleName) {
          prev.roleName = roleName
          prev.roleCode = mapRole(roleName)
        }
        continue
      }

      merged.set(name, {
        name,
        roleName,
        roleCode: mapRole(roleName),
        startMin: start,
        endMin: end,
        zoneText: isNoise(zoneText) ? '' : zoneText,
        zoneId: mapZone(isNoise(zoneText) ? '' : zoneText),
      })
    }

    // 日期：优先表内日期，其次工作表名（0901 / 09-01），最后用传入的兜底日期
    if (!result.date) {
      let date = detectedDate
      let source = date ? '工作表内日期' : ''
      if (!date) {
        const m = sh.name.match(/^(\d{1,2})[.\-_/月]?(\d{1,2})日?$/)
        if (m) {
          const mm = Number(m[1])
          const dd = Number(m[2])
          if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
            date = dateKey(year, mm, dd)
            source = `工作表名「${sh.name}」`
          }
        }
      }
      if (date) {
        result.date = date
        result.dateSource = source
      }
    }
  }

  result.rows = Array.from(merged.values()).sort((a, b) => a.startMin - b.startMin)
  result.errors = result.errors.slice(0, 5)
  if (result.rows.length) {
    result.minStart = Math.min(...result.rows.map(r => r.startMin))
    result.maxEnd = Math.max(...result.rows.map(r => r.endMin))
  }
  if (!result.date && fallbackDate) {
    result.date = fallbackDate
    result.dateSource = '文件名'
  }
  if (result.errors.length) {
    result.notes.push(`${result.errors.length} 行时间无法识别，已跳过`)
  }
  return result
}
