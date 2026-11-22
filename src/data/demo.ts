import type { DemandRule, Role, Shift, Staff, Store, Zone } from '../types'

// ---------------- 角色 ----------------
// 颜色克制（近黑 + 低饱和），保证 7 角色在小色块里仍可区分
export const ROLES: Role[] = [
  { code: 'manager', name: '店长', short: '店', color: '#111418' },
  { code: 'supervisor', name: '副店', short: '副', color: '#4B5563' },
  { code: 'sales', name: '导购', short: '导', color: '#2F6F62' },
  { code: 'cashier', name: '收银', short: '收', color: '#8A6D3B' },
  { code: 'stock', name: '仓配', short: '仓', color: '#3F5B8B' },
  { code: 'coach', name: '教练', short: '教', color: '#8A4C5E' },
  { code: 'service', name: '服务', short: '服', color: '#9AA5B1' },
]

export const roleOf = (code: string): Role =>
  ROLES.find(r => r.code === code) || ROLES[0]

// ---------------- 区域 ----------------
export const ZONES: Zone[] = [
  { id: 'z1', name: '一层零售区', level: 1 },
  { id: 'z2', name: '二层体验区', level: 2 },
  { id: 'z3', name: '三层服务区', level: 3 },
  { id: 'z4', name: '后勤仓配', level: 4 },
]

export const zoneOf = (id: string): Zone => ZONES.find(z => z.id === id) || ZONES[0]

// ---------------- 班次 ----------------
// 8 小时三班倒，班次之间重叠 2-3 小时 → 时间轴视图里会自然出现并行道
export const SHIFTS: Shift[] = [
  { id: 's1', label: '早班', start: 9, end: 17 },
  { id: 's2', label: '中班', start: 12, end: 20 },
  { id: 's3', label: '晚班', start: 14, end: 22 },
]

export const shiftOf = (id: string): Shift => SHIFTS.find(s => s.id === id) || SHIFTS[0]

// ---------------- 需求规则 ----------------
export const DEMAND: DemandRule[] = [
  { zoneId: 'z1', roleCode: 'manager', shiftId: 's1' },
  { zoneId: 'z1', roleCode: 'sales', shiftId: 's1' },
  { zoneId: 'z1', roleCode: 'sales', shiftId: 's2' },
  { zoneId: 'z1', roleCode: 'cashier', shiftId: 's2' },
  { zoneId: 'z2', roleCode: 'supervisor', shiftId: 's1' },
  { zoneId: 'z2', roleCode: 'sales', shiftId: 's2' },
  { zoneId: 'z2', roleCode: 'coach', shiftId: 's2' },
  { zoneId: 'z3', roleCode: 'coach', shiftId: 's1' },
  { zoneId: 'z3', roleCode: 'service', shiftId: 's1' },
  { zoneId: 'z4', roleCode: 'stock', shiftId: 's1' },
  // 周末加班次
  { zoneId: 'z1', roleCode: 'sales', shiftId: 's3', weekendOnly: true },
  { zoneId: 'z1', roleCode: 'cashier', shiftId: 's3', weekendOnly: true },
  { zoneId: 'z2', roleCode: 'coach', shiftId: 's3', weekendOnly: true },
  { zoneId: 'z3', roleCode: 'service', shiftId: 's3', weekendOnly: true },
  { zoneId: 'z1', roleCode: 'cashier', shiftId: 's1', weekendOnly: true },
  { zoneId: 'z2', roleCode: 'coach', shiftId: 's1', weekendOnly: true },
]

// ---------------- 门店 ----------------
export const STORES: Store[] = [
  { id: 'st-a', name: '云港中心店', city: '上海', district: '浦东新区', address: '世纪大道 88 号', lat: 31.235, lng: 121.505, area: 420, floors: 3, open: '09:00', close: '22:00' },
  { id: 'st-b', name: '星环广场店', city: '上海', district: '静安区', address: '南京西路 1266 号', lat: 31.229, lng: 121.448, area: 380, floors: 2, open: '10:00', close: '22:00' },
  { id: 'st-c', name: '湾畔天地店', city: '上海', district: '黄浦区', address: '中山东二路 600 号', lat: 31.232, lng: 121.49, area: 360, floors: 2, open: '10:00', close: '22:30' },
  { id: 'st-d', name: '锦城里店', city: '上海', district: '徐汇区', address: '淮海中路 999 号', lat: 31.21, lng: 121.45, area: 400, floors: 3, open: '10:00', close: '22:00' },
  { id: 'st-e', name: '湖畔汇店', city: '上海', district: '长宁区', address: '仙霞路 345 号', lat: 31.21, lng: 121.39, area: 320, floors: 2, open: '10:00', close: '21:30' },
  { id: 'st-f', name: '江岸天地店', city: '上海', district: '虹口区', address: '四川北路 1688 号', lat: 31.26, lng: 121.48, area: 340, floors: 2, open: '10:00', close: '22:00' },
]

// ---------------- 员工 ----------------
export const STAFFS: Staff[] = [
  { id: 'e01', name: '陈可', role: 'manager', backup: ['supervisor'], skill: 5, maxHours: 48, minHours: 40, status: 'active' },
  { id: 'e02', name: '李哲', role: 'supervisor', backup: ['manager', 'sales'], skill: 4, maxHours: 44, minHours: 30, status: 'active' },
  { id: 'e03', name: '王琳', role: 'supervisor', backup: ['cashier'], skill: 4, maxHours: 40, minHours: 32, status: 'active' },
  { id: 'e04', name: '张漾', role: 'sales', backup: ['cashier'], skill: 3, maxHours: 40, minHours: 30, status: 'active' },
  { id: 'e05', name: '刘一', role: 'sales', backup: ['stock'], skill: 3, maxHours: 40, minHours: 30, status: 'active' },
  { id: 'e06', name: '周澄', role: 'sales', backup: ['coach'], skill: 2, maxHours: 40, minHours: 28, status: 'active' },
  { id: 'e07', name: '孙悦', role: 'sales', backup: [], skill: 3, maxHours: 40, minHours: 30, status: 'active' },
  { id: 'e08', name: '吴桐', role: 'sales', backup: ['cashier'], skill: 2, maxHours: 40, minHours: 28, status: 'active' },
  { id: 'e09', name: '郑楠', role: 'cashier', backup: ['sales'], skill: 2, maxHours: 40, minHours: 30, status: 'active' },
  { id: 'e10', name: '何雨', role: 'cashier', backup: [], skill: 2, maxHours: 36, minHours: 28, status: 'active' },
  { id: 'e11', name: '徐岚', role: 'coach', backup: ['sales'], skill: 4, maxHours: 44, minHours: 34, status: 'active' },
  { id: 'e12', name: '马骁', role: 'coach', backup: ['service'], skill: 4, maxHours: 40, minHours: 32, status: 'active' },
  { id: 'e13', name: '高远', role: 'coach', backup: [], skill: 3, maxHours: 40, minHours: 30, status: 'active' },
  { id: 'e14', name: '罗晴', role: 'service', backup: ['sales'], skill: 2, maxHours: 40, minHours: 30, status: 'active' },
  { id: 'e15', name: '谢宁', role: 'service', backup: [], skill: 2, maxHours: 40, minHours: 28, status: 'active' },
  { id: 'e16', name: '韩雪', role: 'stock', backup: ['sales'], skill: 3, maxHours: 44, minHours: 30, status: 'active' },
  { id: 'e17', name: '梁舟', role: 'stock', backup: [], skill: 2, maxHours: 40, minHours: 24, status: 'active' },
  { id: 'e18', name: '顾言', role: 'coach', backup: ['service'], skill: 3, maxHours: 40, minHours: 30, status: 'leave' },
]
