import { DEMAND, ROLES, roleOf, shiftOf, zoneOf } from '../data/demo'
import type { Assignment, DemandRule, RoleCode, Staff } from '../types'
import { isWeekend } from '../utils/date'

// ============================================================================
// 排班算法（单遍贪心，纯函数，可单测）
// 约束：一人一天只上一个班次；周工时不超过上限；只排主岗或通岗
// 目标：优先主岗 → 技能高 → 负荷均衡 → 优先补足最低工时
// ============================================================================

export interface Slot {
  date: string
  zoneId: string
  roleCode: RoleCode
  shiftId: string
}

export interface Gap {
  date: string
  zoneId: string
  zoneName: string
  roleCode: RoleCode
  roleName: string
  shiftId: string
  shiftLabel: string
  missing: number
}

export interface Summary {
  total: number
  filled: number
  coverage: number
  gaps: Gap[]
  hoursByStaff: Record<string, number>
}

export interface PlanResult extends Summary {
  assignments: Assignment[]
}

export const shiftHours = (shiftId: string): number => {
  const s = shiftOf(shiftId)
  return Math.max(s.end - s.start, 0)
}

// 自定义导入的班次用真实时间，其余沿用班次时长
export const assignmentHours = (a: Assignment): number => {
  if (a.startMin != null && a.endMin != null && a.endMin > a.startMin) {
    return Math.round(((a.endMin - a.startMin) / 60) * 100) / 100
  }
  return shiftHours(a.shiftId)
}

export const assignmentSpan = (a: Assignment): { start: number; end: number } => {
  if (a.startMin != null && a.endMin != null && a.endMin > a.startMin) {
    return { start: a.startMin / 60, end: a.endMin / 60 }
  }
  const s = shiftOf(a.shiftId)
  return { start: s.start, end: s.end }
}

export const timeText = (a: Assignment): string => {
  const span = assignmentSpan(a)
  const fmt = (v: number) => {
    const h = Math.floor(v)
    const m = Math.round((v - h) * 60)
    return `${h}:${m < 10 ? '0' + m : m}`
  }
  return `${fmt(span.start)}-${fmt(span.end)}`
}

// 把真实上班时间归到最近的班次桶，兼容按班次统计的视图
export const nearestShift = (startMin: number): string => {
  const hour = startMin / 60
  if (hour < 11) return 's1'
  if (hour < 14.5) return 's2'
  return 's3'
}

const slotKey = (s: { date: string; zoneId: string; roleCode: string; shiftId: string }) =>
  `${s.date}|${s.zoneId}|${s.roleCode}|${s.shiftId}`

// 把日期展开成「人力需求槽位」（规则可由 Excel 导入覆盖）
export function buildSlots(dates: string[], rules: DemandRule[] = DEMAND): Slot[] {
  const slots: Slot[] = []
  dates.forEach(date => {
    const weekend = isWeekend(date)
    rules.forEach(rule => {
      if (rule.weekendOnly && !weekend) return
      slots.push({ date, zoneId: rule.zoneId, roleCode: rule.roleCode, shiftId: rule.shiftId })
    })
  })
  return slots
}

// 为一个槽位挑选最合适的员工；返回 null 表示无人可用（形成缺口）
function pickStaff(
  roleCode: RoleCode,
  need: number,
  busy: Set<string>,
  hours: Record<string, number>,
  staffs: Staff[],
): Staff | null {
  let best: Staff | null = null
  let bestScore = Infinity

  for (const s of staffs) {
    if (s.status === 'leave') continue
    if (busy.has(s.id)) continue

    const primary = s.role === roleCode
    const backup = s.backup.indexOf(roleCode) >= 0
    if (!primary && !backup) continue

    const used = hours[s.id] || 0
    if (used + need > s.maxHours) continue

    let score = primary ? 0 : 8
    if (s.status === 'training') score += 4
    score += used / 10 // 负荷越轻越优先
    score -= s.skill * 0.4 // 技能越高越优先
    if (used < s.minHours) score -= 4 // 优先把最低工时补足

    if (score < bestScore) {
      bestScore = score
      best = s
    }
  }
  return best
}

// 一致性统计：需求 vs 实排
export function summarize(assignments: Assignment[], slots: Slot[]): Summary {
  const demand: Record<string, number> = {}
  slots.forEach(s => {
    const k = slotKey(s)
    demand[k] = (demand[k] || 0) + 1
  })

  const used: Record<string, number> = {}
  const hoursByStaff: Record<string, number> = {}
  assignments.forEach(a => {
    const k = slotKey(a)
    if (demand[k]) used[k] = (used[k] || 0) + 1
    hoursByStaff[a.staffId] = (hoursByStaff[a.staffId] || 0) + assignmentHours(a)
  })

  let filled = 0
  const gaps: Gap[] = []
  Object.keys(demand).forEach(k => {
    const need = demand[k]
    const got = Math.min(used[k] || 0, need)
    filled += got
    if (got < need) {
      const [date, zoneId, roleCode, shiftId] = k.split('|')
      gaps.push({
        date,
        zoneId,
        zoneName: zoneOf(zoneId).name,
        roleCode: roleCode as RoleCode,
        roleName: roleOf(roleCode).name,
        shiftId,
        shiftLabel: shiftOf(shiftId).label,
        missing: need - got,
      })
    }
  })

  const total = slots.length
  return {
    total,
    filled,
    coverage: total ? Math.round((filled / total) * 100) : 0,
    gaps,
    hoursByStaff,
  }
}

// 生成排班（覆盖传入的日期，可替换这些日期的旧排班）
export function generatePlan(
  staffs: Staff[],
  dates: string[],
  rules: DemandRule[] = DEMAND,
): PlanResult {
  const slots = buildSlots(dates, rules)
  const assignments: Assignment[] = []
  const hours: Record<string, number> = {}

  dates.forEach(date => {
    const busy = new Set<string>()
    slots
      .filter(s => s.date === date)
      .forEach((slot, i) => {
        const need = shiftHours(slot.shiftId)
        const staff = pickStaff(slot.roleCode, need, busy, hours, staffs)
        if (!staff) return
        busy.add(staff.id)
        hours[staff.id] = (hours[staff.id] || 0) + need
        assignments.push({
          id: `${date}-${slot.zoneId}-${slot.roleCode}-${slot.shiftId}-${i}`,
          staffId: staff.id,
          staffName: staff.name,
          roleCode: slot.roleCode,
          zoneId: slot.zoneId,
          date,
          shiftId: slot.shiftId,
        })
      })
  })

  return { assignments, ...summarize(assignments, slots) }
}

// 角色维度的分配汇总（供总览页「角色分配」使用）
export interface RoleLoad {
  roleCode: RoleCode
  name: string
  short: string
  color: string
  people: number // 本周参与人数
  shifts: number // 本周人次
  hours: number
}

export function roleLoad(assignments: Assignment[], staffs: Staff[]): RoleLoad[] {
  return ROLES.map(role => {
    const list = assignments.filter(a => a.roleCode === role.code)
    const working = new Set(list.map(a => a.staffId)).size
    const roster = staffs.filter(s => s.role === role.code && s.status !== 'leave').length
    return {
      roleCode: role.code,
      name: role.name,
      short: role.short,
      color: role.color,
      people: working || roster,
      shifts: list.length,
      hours: list.reduce((sum, a) => sum + shiftHours(a.shiftId), 0),
    }
  })
}
