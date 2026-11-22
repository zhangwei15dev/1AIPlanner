// 角色：门店最小可运转岗位集合
export type RoleCode =
  | 'manager' // 店长
  | 'supervisor' // 副店 / 值班主管
  | 'sales' // 导购
  | 'cashier' // 收银
  | 'stock' // 仓配
  | 'coach' // 教练 / 体验师
  | 'service' // 服务 / 保洁

export interface Role {
  code: RoleCode
  name: string
  short: string // 排班格子里的一字标签
  color: string
}

// 营业区域：一层 / 二层 / 三层 / 后勤
export interface Zone {
  id: string
  name: string
  level: number
}

// 班次：用整点数字表示，便于时间轴几何计算
export interface Shift {
  id: string
  label: string
  start: number
  end: number
}

export interface Staff {
  id: string
  name: string
  role: RoleCode
  backup: RoleCode[] // 可通岗的角色
  skill: 1 | 2 | 3 | 4 | 5
  maxHours: number // 每周工时上限
  minHours: number // 每周工时下限
  status: 'active' | 'leave' | 'training'
}

// 一条排班 = 某人 + 某天 + 某班次 + 某区域 + 某角色
export interface Assignment {
  id: string
  staffId: string
  staffName: string
  roleCode: RoleCode
  zoneId: string
  date: string // YYYY-MM-DD
  shiftId: string
  // 自定义导入的班表保留真实上下班时间（分钟），没有则用班次默认时间
  startMin?: number
  endMin?: number
  source?: 'auto' | 'custom'
}

// 人力需求规则：命中即生成一个需求槽位
export interface DemandRule {
  zoneId: string
  roleCode: RoleCode
  shiftId: string
  weekendOnly?: boolean
}

export interface Store {
  id: string
  name: string
  city: string
  district: string
  address: string
  lat: number
  lng: number
  area: number
  floors: number
  open: string
  close: string
}
