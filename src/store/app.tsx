import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { PropsWithChildren } from 'react'
import Taro from '@tarojs/taro'
import { DEMAND, STAFFS, STORES } from '../data/demo'
import type { RosterRow } from '../services/roster'
import { nearestShift } from '../services/scheduler'
import { generatePlan } from '../services/scheduler'
import type { PlanResult } from '../services/scheduler'
import type { Assignment, DemandRule, Staff, Store } from '../types'
import { weekDates } from '../utils/date'

// ============================================================================
// 全局唯一数据源：员工 + 排班 + 当前门店
// - 所有页面都从这里读写，杜绝「一处改、另一处看不到」
// - 落盘到本地存储，重启小程序后自动恢复
// ============================================================================

const STORAGE_KEY = 'aiplanner.v1'

interface Snapshot {
  staffs: Staff[]
  assignments: Assignment[]
  storeId: string
  demands?: DemandRule[]
}

function readSnapshot(): Snapshot {
  try {
    // h5 端 Taro 会把值包一层 { data } 并可能以字符串返回，这里统一拆包
    let raw: unknown = Taro.getStorageSync(STORAGE_KEY)
    if (typeof raw === 'string') raw = JSON.parse(raw)
    const boxed = raw as { data?: unknown } | null
    if (boxed && typeof boxed === 'object' && boxed.data && typeof boxed.data === 'object') {
      raw = boxed.data
    }
    const snap = raw as Snapshot | null
    if (snap && Array.isArray(snap.staffs) && Array.isArray(snap.assignments)) {
      return snap
    }
  } catch (e) {
    // 读取失败则退回演示数据
  }
  // 首次启动：自动生成本周排班，保证进来就有内容可看
  return {
    staffs: STAFFS,
    assignments: generatePlan(STAFFS, weekDates(0)).assignments,
    storeId: STORES[0].id,
    demands: DEMAND,
  }
}

interface AppState {
  store: Store
  stores: Store[]
  staffs: Staff[]
  assignments: Assignment[]
  demands: DemandRule[]
  setStore: (id: string) => void
  planWeek: (dates: string[]) => PlanResult
  // Excel 导入：一次性替换员工 + 需求，并按新数据重排指定区间
  importStaffs: (staffs: Staff[], demands: DemandRule[] | null, dates: string[]) => PlanResult
  // 自定义班表导入：把真实班表按人写成当天的排班
  importRoster: (date: string, rows: RosterRow[]) => { staffs: number; assignments: number }
  addStaff: (data: Omit<Staff, 'id'>) => void
  updateStaff: (id: string, patch: Partial<Staff>) => void
  removeStaff: (id: string) => void
  reset: () => void
}

const AppContext = createContext<AppState | null>(null)

export function AppProvider({ children }: PropsWithChildren) {
  const [snapshot, setSnapshot] = useState<Snapshot>(readSnapshot)

  useEffect(() => {
    try {
      Taro.setStorageSync(STORAGE_KEY, snapshot)
    } catch (e) {
      // 存储写入失败不阻塞交互
    }
  }, [snapshot])

  const store = useMemo(
    () => STORES.find(s => s.id === snapshot.storeId) || STORES[0],
    [snapshot.storeId],
  )

  const setStore = useCallback((id: string) => {
    setSnapshot(prev => ({ ...prev, storeId: id }))
  }, [])

  // 生成指定区间的排班，替换这些日期上的旧排班
  const planWeek = useCallback(
    (dates: string[]) => {
      const result = generatePlan(snapshot.staffs, dates, snapshot.demands || DEMAND)
      const keep = snapshot.assignments.filter(a => dates.indexOf(a.date) < 0)
      setSnapshot(prev => ({ ...prev, assignments: keep.concat(result.assignments) }))
      return result
    },
    [snapshot.staffs, snapshot.assignments],
  )

  const importStaffs = useCallback(
    (staffs: Staff[], demands: DemandRule[] | null, dates: string[]) => {
      const rules = demands && demands.length ? demands : DEMAND
      const result = generatePlan(staffs, dates, rules)
      const keep = snapshot.assignments.filter(a => dates.indexOf(a.date) < 0)
      setSnapshot({
        staffs,
        demands: rules,
        assignments: keep.concat(result.assignments),
        storeId: snapshot.storeId,
      })
      return result
    },
    [snapshot],
  )

  const importRoster = useCallback(
    (date: string, rows: RosterRow[]) => {
      // 员工按姓名去重合并，避免把其它日期的排班打散
      const byName: Record<string, Staff> = {}
      snapshot.staffs.forEach(s => {
        byName[s.name] = s
      })
      rows.forEach((r, i) => {
        if (!byName[r.name]) {
          byName[r.name] = {
            id: `r${i}-${r.name}`,
            name: r.name,
            role: r.roleCode,
            backup: [],
            skill: 3,
            maxHours: 40,
            minHours: 0,
            status: 'active',
          }
        }
      })
      const staffs = Object.keys(byName).map(k => byName[k])
      const staffOf = (name: string) => byName[name]

      const assignments: Assignment[] = rows.map((r, i) => ({
        id: `${date}-r${i}`,
        staffId: staffOf(r.name).id,
        staffName: r.name,
        roleCode: r.roleCode,
        zoneId: r.zoneId,
        date,
        shiftId: nearestShift(r.startMin),
        startMin: r.startMin,
        endMin: r.endMin,
        source: 'custom' as const,
      }))

      const keep = snapshot.assignments.filter(a => a.date !== date)
      setSnapshot({
        staffs,
        demands: snapshot.demands || DEMAND,
        assignments: keep.concat(assignments),
        storeId: snapshot.storeId,
      })
      return { staffs: rows.length, assignments: assignments.length }
    },
    [snapshot],
  )

  const addStaff = useCallback((data: Omit<Staff, 'id'>) => {
    const id = `e${Date.now().toString(36)}`
    setSnapshot(prev => ({ ...prev, staffs: prev.staffs.concat({ ...data, id }) }))
  }, [])

  const updateStaff = useCallback((id: string, patch: Partial<Staff>) => {
    setSnapshot(prev => ({
      ...prev,
      staffs: prev.staffs.map(s => (s.id === id ? { ...s, ...patch } : s)),
    }))
  }, [])

  const removeStaff = useCallback((id: string) => {
    setSnapshot(prev => ({
      staffs: prev.staffs.filter(s => s.id !== id),
      // 删人同时清掉他未来的排班，避免幽灵班次
      assignments: prev.assignments.filter(a => a.staffId !== id),
      storeId: prev.storeId,
      demands: prev.demands,
    }))
  }, [])

  const reset = useCallback(() => {
    const staffs = STAFFS
    setSnapshot({
      staffs,
      assignments: generatePlan(staffs, weekDates(0)).assignments,
      storeId: STORES[0].id,
      demands: DEMAND,
    })
  }, [])

  const value: AppState = {
    store,
    stores: STORES,
    staffs: snapshot.staffs,
    assignments: snapshot.assignments,
    demands: snapshot.demands || DEMAND,
    setStore,
    planWeek,
    importStaffs,
    importRoster,
    addStaff,
    updateStaff,
    removeStaff,
    reset,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用')
  return ctx
}
