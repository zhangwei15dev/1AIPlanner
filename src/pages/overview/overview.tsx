import { useMemo, useState } from 'react'
import { Map, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { ROLES, SHIFTS, roleOf, shiftOf, zoneOf } from '../../data/demo'
import { assignmentHours, assignmentSpan, buildSlots, roleLoad, summarize } from '../../services/scheduler'
import { useApp } from '../../store/app'
import type { Assignment, RoleCode, Store } from '../../types'
import {
  dayNum,
  monthDay,
  nowHourFloat,
  todayKey,
  WEEK_LABELS,
  WEEK_SHORT,
  weekDates,
  weekdayIndex,
} from '../../utils/date'
import './overview.scss'

// 时间轴默认 09:00 - 23:00（与班次范围一致），自定义班表会自动扩展
const START = 9
const END = 23

const fmtHour = (h: number) => {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return `${hh}:${mm < 10 ? '0' + mm : mm}`
}

// 直线距离（km）：地图上点选时用来找最近门店
const distKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

const isH5 = process.env.TARO_ENV === 'h5'

interface RoleBlock {
  key: string
  shiftId: string
  start: number
  end: number
  lane: number
  staff: Assignment[]
}

// 单角色在一天内的班次色块 + 重叠并行道（类似 Outlook 日历里的重叠事件）
function layoutRole(list: Assignment[], roleCode: RoleCode): { blocks: RoleBlock[]; lanes: number } {
  const groups: Record<string, RoleBlock> = {}
  list.forEach(a => {
    if (a.roleCode !== roleCode) return
    // 自定义班表按真实时间分块，否则按班次分块
    const span = assignmentSpan(a)
    const key = a.source === 'custom' ? `c${a.startMin}-${a.endMin}` : a.shiftId
    if (!groups[key]) {
      groups[key] = {
        key: `${roleCode}-${key}`,
        shiftId: a.shiftId,
        start: span.start,
        end: span.end,
        lane: 0,
        staff: [],
      }
    }
    groups[key].staff.push(a)
  })

  const blocks = Object.keys(groups)
    .map(k => groups[k])
    .sort((x, y) => x.start - y.start || x.end - y.end)

  const laneEnds: number[] = []
  blocks.forEach(b => {
    let lane = -1
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= b.start) {
        lane = i
        break
      }
    }
    if (lane < 0) {
      lane = laneEnds.length
      laneEnds.push(b.end)
    } else {
      laneEnds[lane] = b.end
    }
    b.lane = lane
  })

  return { blocks, lanes: Math.max(laneEnds.length, 1) }
}

interface Detail {
  title: string
  sub: string
  rows: { id: string; name: string; zone: string; shift: string }[]
}

export default function Overview() {
  const { store, stores, setStore, staffs, assignments, planWeek } = useApp()
  const [weekOffset, setWeekOffset] = useState(0)
  const [focusDate, setFocusDate] = useState(todayKey())
  const [showStore, setShowStore] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [pickMode, setPickMode] = useState<'list' | 'map'>('list')
  const [pickId, setPickId] = useState(store.id)
  const [mapCenter, setMapCenter] = useState({ lat: store.lat, lng: store.lng })

  const dates = useMemo(() => weekDates(weekOffset), [weekOffset])
  const slots = useMemo(() => buildSlots(dates), [dates])
  const weekList = useMemo(
    () => assignments.filter(a => dates.indexOf(a.date) >= 0),
    [assignments, dates],
  )
  const summary = useMemo(() => summarize(weekList, slots), [weekList, slots])
  const loads = useMemo(() => roleLoad(weekList, staffs), [weekList, staffs])
  const totalHours = Math.round(weekList.reduce((sum, a) => sum + assignmentHours(a), 0))

  const today = todayKey()
  const focused = dates.indexOf(focusDate) >= 0 ? focusDate : dates[0]
  const focusList = weekList.filter(a => a.date === focused)
  const now = nowHourFloat()
  const showNow = focused === today && now >= START && now <= END

  // 时间轴随当天真实班次扩展（导入 07:00-22:00 的班表也能完整显示）
  const focusSpans = focusList.map(assignmentSpan)
  const axisStart = Math.min(START, ...focusSpans.map(x => Math.floor(x.start)))
  const axisEnd = Math.max(END, ...focusSpans.map(x => Math.ceil(x.end)))
  const axisSpan = Math.max(axisEnd - axisStart, 1)
  const hours = Array.from({ length: axisSpan }, (_, i) => axisStart + i)
  const leftPct = (h: number) => ((h - axisStart) / axisSpan) * 100

  // 自定义班表不参与内置需求对比，指标换成中性口径
  const customCount = weekList.filter(a => a.source === 'custom').length
  const isCustom = customCount > 0
  const staffCount = new Set(weekList.map(a => a.staffId)).size
  const zoneCount = new Set(weekList.map(a => a.zoneId)).size

  // 周排班矩阵：日期 × 班次 → 人数
  const matrix = dates.map(date =>
    SHIFTS.map(shift => weekList.filter(a => a.date === date && a.shiftId === shift.id).length),
  )

  const handleGenerate = () => {
    const result = planWeek(dates)
    Taro.showToast({ title: `已生成 ${result.filled} 条排班`, icon: 'none' })
  }

  const openBlock = (block: RoleBlock, roleCode: RoleCode) => {
    const shift = shiftOf(block.shiftId)
    const timeText = `${fmtHour(block.start)} - ${fmtHour(block.end)}`
    setDetail({
      title: `${roleOf(roleCode).name} · ${block.staff.some(a => a.source === 'custom') ? '自定义班次' : shift.label}`,
      sub: `${monthDay(focused)} ${WEEK_LABELS[weekdayIndex(focused)]} ${timeText}`,
      rows: block.staff.map(a => ({
        id: a.id,
        name: a.staffName,
        zone: zoneOf(a.zoneId).name,
        shift: timeText,
      })),
    })
  }

  const weekLabel = weekOffset === 0 ? '本周' : weekOffset > 0 ? `+${weekOffset} 周` : `${weekOffset} 周`

  // 门店选择：列表 / 地图两种方式共用一份「候选门店」
  const picked: Store = stores.find(s => s.id === pickId) || store
  const pickKm = distKm({ lat: store.lat, lng: store.lng }, { lat: picked.lat, lng: picked.lng })

  const markers = useMemo(
    () =>
      stores.map((s, i) => ({
        id: i,
        latitude: s.lat,
        longitude: s.lng,
        width: 28,
        height: 35,
        iconPath: s.id === pickId ? '/assets/pin-active.png' : '/assets/pin.png',
        callout: {
          content: s.name,
          display: 'ALWAYS' as const,
          anchorX: 0,
          anchorY: 0,
          color: '#111418',
          fontSize: 11,
          padding: 5,
          borderRadius: 4,
          borderWidth: 1,
          borderColor: '#E7E7E2',
          bgColor: '#FFFFFF',
          textAlign: 'center' as const,
        },
      })),
    [stores, pickId],
  )

  const openPicker = (mode: 'list' | 'map') => {
    setPickId(store.id)
    setMapCenter({ lat: store.lat, lng: store.lng })
    setPickMode(mode)
    setShowStore(true)
  }

  const focusStore = (id: string) => {
    const s = stores.find(x => x.id === id)
    if (!s) return
    setPickId(s.id)
    setMapCenter({ lat: s.lat, lng: s.lng })
  }

  const applyPick = () => {
    setStore(pickId)
    setShowStore(false)
  }

  // 点地图空白处 → 吸附到最近的门店
  const onMapTap = (e: any) => {
    const d = (e && e.detail) || {}
    if (typeof d.latitude !== 'number' || typeof d.longitude !== 'number') return
    let best = stores[0]
    let bestD = Infinity
    stores.forEach(s => {
      const km = distKm({ lat: d.latitude, lng: d.longitude }, { lat: s.lat, lng: s.lng })
      if (km < bestD) {
        bestD = km
        best = s
      }
    })
    focusStore(best.id)
  }

  const onMarkerTap = (e: any) => {
    const idx = e && e.detail ? e.detail.markerId : undefined
    const s = stores[idx]
    if (s) focusStore(s.id)
  }

  return (
    <ScrollView scrollY className='page'>
      {/* 门店 */}
      <View className='topbar' onClick={() => openPicker('list')}>
        <View>
          <Text className='topbar-label'>STORE</Text>
          <Text className='topbar-name'>{store.name}</Text>
        </View>
        <View className='topbar-right'>
          <Text className='topbar-city'>{store.city} · {store.floors}F</Text>
          <Text className='topbar-arrow'>▾</Text>
        </View>
      </View>

      {/* 周切换 */}
      <View className='weekbar'>
        <View className='week-nav' onClick={() => setWeekOffset(v => v - 1)}><Text>‹</Text></View>
        <View className='week-mid'>
          <Text className='week-range'>{monthDay(dates[0])} – {monthDay(dates[6])}</Text>
          <Text className='week-tag'>{weekLabel}</Text>
        </View>
        <View className='week-nav' onClick={() => setWeekOffset(v => v + 1)}><Text>›</Text></View>
        <View className='week-today' onClick={() => setWeekOffset(0)}><Text>今天</Text></View>
      </View>

      {/* 指标：内置计划看覆盖率，导入的自定义班表看人效口径 */}
      <View className='metrics'>
        {isCustom ? (
          <>
            <View className='metric'>
              <Text className='metric-num'>{staffCount}</Text>
              <Text className='metric-label'>排班人数</Text>
            </View>
            <View className='metric'>
              <Text className='metric-num'>{weekList.length}</Text>
              <Text className='metric-label'>班次条数</Text>
            </View>
            <View className='metric'>
              <Text className='metric-num'>{zoneCount}</Text>
              <Text className='metric-label'>覆盖区域</Text>
            </View>
            <View className='metric'>
              <Text className='metric-num'>{totalHours}</Text>
              <Text className='metric-label'>总工时</Text>
            </View>
          </>
        ) : (
          <>
            <View className='metric'>
              <Text className='metric-num'>{summary.coverage}<Text className='metric-unit'>%</Text></Text>
              <Text className='metric-label'>覆盖率</Text>
            </View>
            <View className='metric'>
              <Text className='metric-num'>{summary.filled}/{summary.total}</Text>
              <Text className='metric-label'>已排/需求</Text>
            </View>
            <View className='metric'>
              <Text className='metric-num'>{summary.gaps.length}</Text>
              <Text className='metric-label'>缺口项</Text>
            </View>
            <View className='metric'>
              <Text className='metric-num'>{totalHours}</Text>
              <Text className='metric-label'>总工时</Text>
            </View>
          </>
        )}
      </View>

      {/* 周排班矩阵 */}
      <View className='section-head'>
        <Text className='section-title'>周排班</Text>
        <Text className='section-sub'>班次 × 日期 · 人数</Text>
      </View>
      <View className='matrix'>
        <View className='matrix-row matrix-top'>
          <View className='matrix-shift' />
          {dates.map((date, i) => (
            <View
              key={date}
              className={`matrix-day ${date === today ? 'today' : ''}`}
              onClick={() => setFocusDate(date)}
            >
              <Text className='matrix-dow'>{WEEK_SHORT[i]}</Text>
              <Text className='matrix-date'>{dayNum(date)}</Text>
            </View>
          ))}
        </View>
        {SHIFTS.map((shift, si) => (
          <View key={shift.id} className='matrix-row'>
            <View className='matrix-shift'>
              <Text className='matrix-shift-name'>{shift.label}</Text>
              <Text className='matrix-shift-time'>{shift.start}-{shift.end}</Text>
            </View>
            {dates.map((date, di) => {
              const count = matrix[di][si]
              const need = isCustom ? 0 : slots.filter(s => s.date === date && s.shiftId === shift.id).length
              const missing = need - count
              return (
                <View
                  key={date}
                  className={`matrix-cell ${date === focused ? 'focus' : ''} ${missing > 0 ? 'lack' : ''}`}
                  onClick={() => setFocusDate(date)}
                >
                  <Text className={`matrix-num ${count === 0 ? 'zero' : ''}`}>{count}</Text>
                  {missing > 0 && <Text className='matrix-lack'>缺{missing}</Text>}
                </View>
              )
            })}
          </View>
        ))}
      </View>

      {/* 角色 × 时间 分配视图 */}
      <View className='section-head'>
        <Text className='section-title'>角色分配</Text>
        <Text className='section-sub'>{monthDay(focused)} · 按角色查看时段占用</Text>
      </View>

      <View className='daytabs'>
        {dates.map((date, i) => (
          <View
            key={date}
            className={`daytab ${date === focused ? 'on' : ''} ${date === today ? 'today' : ''}`}
            onClick={() => setFocusDate(date)}
          >
            <Text className='daytab-dow'>{WEEK_SHORT[i]}</Text>
            <Text className='daytab-num'>{dayNum(date)}</Text>
          </View>
        ))}
      </View>

      <View className='rt'>
        <View className='rt-head'>
          <View className='rt-label' />
          <View className='rt-ticks'>
            {hours.map(h => (
              <View key={h} className='rt-tick'>
                <Text className='rt-tick-text'>{(h - axisStart) % 3 === 0 ? h : ''}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className='rt-body'>
          {ROLES.map(role => {
            const { blocks, lanes } = layoutRole(focusList, role.code)
            const laneHeight = 100 / lanes
            return (
              <View key={role.code} className='rt-row'>
                <View className='rt-label'>
                  <View className='rt-dot' style={{ background: role.color }} />
                  <Text className='rt-label-text'>{role.name}</Text>
                </View>
                <View className='rt-track'>
                  <View className='rt-grid'>
                    {hours.map(h => <View key={h} className='rt-cell' />)}
                  </View>
                  {blocks.map(b => {
                    const label = b.staff.length === 1
                      ? b.staff[0].staffName
                      : `${b.staff[0].staffName} 等${b.staff.length}人`
                    return (
                      <View
                        key={b.key}
                        className='rt-block'
                        style={{
                          left: `${leftPct(b.start)}%`,
                          width: `${leftPct(b.end) - leftPct(b.start)}%`,
                          top: `${b.lane * laneHeight}%`,
                          height: `${laneHeight}%`,
                          background: role.color,
                        }}
                        onClick={() => openBlock(b, role.code)}
                      >
                        <Text className='rt-block-text'>{label}</Text>
                      </View>
                    )
                  })}
                  {blocks.length === 0 && <Text className='rt-empty'>—</Text>}
                  {showNow && <View className='rt-now' style={{ left: `${leftPct(now)}%` }} />}
                </View>
              </View>
            )
          })}
        </View>

        {focusList.length === 0 && (
          <View className='rt-blank'>
            <Text className='rt-blank-text'>当天没有排班</Text>
            <View className='rt-blank-btn' onClick={handleGenerate}><Text>生成本周排班</Text></View>
          </View>
        )}
      </View>

      {/* 角色工时汇总 */}
      <View className='section-head'>
        <Text className='section-title'>角色工时</Text>
        <Text className='section-sub'>本周累计</Text>
      </View>
      <View className='role-list'>
        {loads.map(load => {
          const max = Math.max(1, ...loads.map(l => l.hours))
          return (
            <View key={load.roleCode} className='role-row'>
              <View className='role-dot' style={{ background: load.color }} />
              <Text className='role-name'>{load.name}</Text>
              <Text className='role-people'>{load.people} 人</Text>
              <View className='role-bar'>
                <View
                  className='role-bar-fill'
                  style={{ width: `${(load.hours / max) * 100}%`, background: load.color }}
                />
              </View>
              <Text className='role-hours'>{load.hours}h</Text>
            </View>
          )
        })}
      </View>

      <View className='bottom-pad' />

      {/* 门店选择：列表 / 地图 */}
      {showStore && (
        <View className='sheet-mask' onClick={() => setShowStore(false)}>
          <View className='sheet' onClick={e => e.stopPropagation()}>
            <View className='sheet-head'>
              <Text className='sheet-title'>选择门店</Text>
              <Text className='sheet-close' onClick={() => setShowStore(false)}>
                ✕
              </Text>
            </View>

            <View className='pick-tabs'>
              <View
                className={`pick-tab ${pickMode === 'list' ? 'on' : ''}`}
                onClick={() => setPickMode('list')}
              >
                <Text>列表</Text>
              </View>
              <View
                className={`pick-tab ${pickMode === 'map' ? 'on' : ''}`}
                onClick={() => setPickMode('map')}
              >
                <Text>地图</Text>
              </View>
            </View>

            {pickMode === 'list' ? (
              <ScrollView scrollY className='sheet-body'>
                {stores.map(s => (
                  <View
                    key={s.id}
                    className={`store-row ${s.id === store.id ? 'on' : ''}`}
                    onClick={() => {
                      setStore(s.id)
                      setShowStore(false)
                    }}
                  >
                    <View className='store-info'>
                      <Text className='store-name'>{s.name}</Text>
                      <Text className='store-meta'>
                        {s.district} · {s.address}
                      </Text>
                      <Text className='store-meta'>
                        {s.area}㎡ · {s.floors} 层 · {s.open}-{s.close}
                      </Text>
                    </View>
                    {s.id === store.id && <Text className='store-check'>✓</Text>}
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View className='map-body'>
                <Map
                  id='store-map'
                  className='map-canvas'
                  latitude={mapCenter.lat}
                  longitude={mapCenter.lng}
                  scale={12}
                  markers={markers}
                  showLocation={false}
                  enableScroll
                  enableZoom
                  onMarkerTap={onMarkerTap}
                  onTap={onMapTap}
                  onError={() => {}}
                />
                {isH5 && (
                  <View className='map-fallback'>
                    <Text>地图选点在小程序端可用</Text>
                  </View>
                )}
                <View className='map-card'>
                  <View className='map-card-main'>
                    <Text className='map-card-name'>{picked.name}</Text>
                    <Text className='map-card-meta'>
                      {picked.district} · {picked.address}
                    </Text>
                    <Text className='map-card-sub'>
                      {picked.id === store.id
                        ? '当前门店'
                        : `距当前门店 ${pickKm.toFixed(1)} km`}
                      {' · '}
                      {picked.area}㎡ · {picked.floors} 层
                    </Text>
                  </View>
                  <View
                    className={`map-card-btn ${picked.id === store.id ? 'dim' : ''}`}
                    onClick={applyPick}
                  >
                    <Text>{picked.id === store.id ? '已是当前' : '设为此门店'}</Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      )}

      {/* 色块详情 */}
      {detail && (
        <View className='sheet-mask' onClick={() => setDetail(null)}>
          <View className='sheet' onClick={e => e.stopPropagation()}>
            <View className='sheet-head'>
              <View>
                <Text className='sheet-title'>{detail.title}</Text>
                <Text className='sheet-sub'>{detail.sub}</Text>
              </View>
              <Text className='sheet-close' onClick={() => setDetail(null)}>✕</Text>
            </View>
            <ScrollView scrollY className='sheet-body'>
              {detail.rows.map(row => (
                <View key={row.id} className='detail-row'>
                  <Text className='detail-name'>{row.name}</Text>
                  <Text className='detail-meta'>{row.zone} · {row.shift}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      )}
    </ScrollView>
  )
}
