import { useMemo, useState } from 'react'
import { Picker, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { SHIFTS, roleOf, shiftOf, zoneOf } from '../../data/demo'
import { assignmentHours, buildSlots, summarize, timeText } from '../../services/scheduler'
import { parseRoster } from '../../services/roster'
import type { RosterParse } from '../../services/roster'
import { buildTemplateWorkbook, importWorkbook, writeWorkbook } from '../../services/excel'
import { useApp } from '../../store/app'
import {
  dayNum,
  fromKey,
  monthDay,
  toDateKey,
  todayKey,
  WEEK_LABELS,
  WEEK_SHORT,
  weekDates,
  weekdayIndex,
} from '../../utils/date'
import './schedule.scss'

const isH5 = process.env.TARO_ENV === 'h5'

// 把 Uint8Array 写成用户目录下的文件并调起「用其他应用打开」，用户可以转发/保存
async function saveAndOpen(bytes: Uint8Array, fileName: string) {
  const fs = Taro.getFileSystemManager()
  const path = `${Taro.env.USER_DATA_PATH}/${fileName}`
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  fs.writeFileSync(path, buf as ArrayBuffer)
  await Taro.openDocument({ filePath: path, fileType: 'xlsx', showMenu: true })
  return path
}

export default function Schedule() {
  const { assignments, planWeek, staffs, demands, importStaffs, importRoster } = useApp()
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  const [importNote, setImportNote] = useState('')
  const [preview, setPreview] = useState<RosterParse | null>(null)
  const [pickDate, setPickDate] = useState('')
  const [dayIdx, setDayIdx] = useState(() => {
    const idx = weekDates(0).indexOf(todayKey())
    return idx < 0 ? 0 : idx
  })

  const dates = useMemo(() => weekDates(offset), [offset])
  const slots = useMemo(() => buildSlots(dates, demands), [dates, demands])
  const weekList = useMemo(
    () => assignments.filter(a => dates.indexOf(a.date) >= 0),
    [assignments, dates],
  )
  const summary = useMemo(() => summarize(weekList, slots), [weekList, slots])
  const isCustom = weekList.some(a => a.source === 'custom')
  const staffCount = new Set(weekList.map(a => a.staffId)).size

  const today = todayKey()
  const activeIdx = Math.max(0, Math.min(dayIdx, 6))
  const activeDate = dates[activeIdx]
  const dayList = weekList.filter(a => a.date === activeDate)

  const handlePlan = () => {
    const result = planWeek(dates)
    Taro.showToast({
      title: `已排 ${result.filled}/${result.total} 项，覆盖 ${result.coverage}%`,
      icon: 'none',
    })
  }

  const weekLabel = offset === 0 ? '本周' : offset > 0 ? `+${offset} 周` : `${offset} 周`
  const rangeLabel = `${dates[0]} ~ ${dates[6]}`

  const clock = (min: number) =>
    `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`

  // 打开「自定义导入」：解析门店自己导出的班表，先预览再落库
  const openCustom = async () => {
    if (isH5) {
      Taro.showToast({ title: '自定义导入请在小程序端使用', icon: 'none' })
      return
    }
    try {
      setBusy(true)
      const picked = await Taro.chooseMessageFile({ count: 1, type: 'file', extension: ['xlsx', 'xls'] })
      const file = picked.tempFiles && picked.tempFiles[0]
      if (!file) return
      const fs = Taro.getFileSystemManager()
      const buffer = fs.readFileSync(file.path) as ArrayBuffer
      const parsed = parseRoster(new Uint8Array(buffer), todayKey())
      if (!parsed.rows.length) {
        await Taro.showModal({
          title: '没有读到班次',
          content:
            (parsed.errors[0] || '没找到「姓名 / 上班 / 下班」表头，请确认是门店导出的排班表') +
            `\n工作表：${parsed.sheets.join('、')}`,
          showCancel: false,
        })
        return
      }
      setPreview(parsed)
      setPickDate(parsed.date || todayKey())
    } catch (e) {
      Taro.showToast({ title: '解析失败，请确认文件为 .xlsx', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  // 导入后自动跳到该日期所在的周与当天
  const jumpTo = (date: string) => {
    const monday = (key: string) => {
      const d = fromKey(key)
      const dow = d.getDay() === 0 ? 7 : d.getDay()
      d.setDate(d.getDate() - (dow - 1))
      return toDateKey(d)
    }
    const weeks = Math.round(
      (fromKey(monday(date)).getTime() - fromKey(monday(dates[0])).getTime()) / (7 * 86400000),
    )
    const nextDates = weekDates(offset + weeks)
    setOffset(offset + weeks)
    setDayIdx(Math.max(0, nextDates.indexOf(date)))
  }

  const confirmCustom = () => {
    if (!preview) return
    const date = pickDate || preview.date || todayKey()
    const res = importRoster(date, preview.rows)
    setImportNote(`自定义导入：${monthDay(date)} · ${res.staffs} 人 · ${res.assignments} 个班次`)
    setPreview(null)
    jumpTo(date)
    Taro.showToast({ title: `已生成 ${monthDay(date)} 的排班计划`, icon: 'none' })
  }

  const downloadTemplate = async () => {
    if (isH5) {
      Taro.showToast({ title: '模版下载请在小程序端使用', icon: 'none' })
      return
    }
    try {
      setBusy(true)
      await saveAndOpen(buildTemplateWorkbook(), '1AIPlanner-排班模版.xlsx')
    } catch (e) {
      Taro.showToast({ title: '模版打开失败，请重试', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  const uploadExcel = async () => {
    if (isH5) {
      Taro.showToast({ title: 'Excel 上传请在小程序端使用', icon: 'none' })
      return
    }
    try {
      setBusy(true)
      const picked = await Taro.chooseMessageFile({ count: 1, type: 'file', extension: ['xlsx'] })
      const file = picked.tempFiles && picked.tempFiles[0]
      if (!file) return
      const fs = Taro.getFileSystemManager()
      const buffer = fs.readFileSync(file.path) as ArrayBuffer
      const result = importWorkbook(new Uint8Array(buffer))

      if (!result.staffs.length) {
        await Taro.showModal({
          title: '没有读到员工',
          content: (result.errors[0] || '请确认使用模版格式，且「员工」表有姓名与主岗两列') +
            `\n识别到的工作表：${result.sheets.join('、')}`,
          showCancel: false,
        })
        return
      }

      const parts = [`${result.staffs.length} 名员工`]
      if (result.demands) parts.push(`${result.demands.length} 条需求`)
      if (result.errors.length) parts.push(`${result.errors.length} 行已跳过`)
      const modal = await Taro.showModal({
        title: '导入预览',
        content: `解析到 ${parts.join('、')}。\n替换现有员工并重新排班？`,
        confirmText: '替换并排班',
        cancelText: '取消',
      })
      if (!modal.confirm) return

      const plan = importStaffs(result.staffs, result.demands, dates)
      setImportNote(`上次导入：${result.staffs.length} 人${result.demands ? ` · ${result.demands.length} 条需求` : ''} · 覆盖率 ${plan.coverage}%`)
      Taro.showToast({ title: `已排 ${plan.filled}/${plan.total}，覆盖 ${plan.coverage}%`, icon: 'none' })
    } catch (e) {
      Taro.showToast({ title: '导入失败，请确认文件为 .xlsx', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  const exportPlan = async () => {
    if (isH5) {
      Taro.showToast({ title: '导出请在小程序端使用', icon: 'none' })
      return
    }
    try {
      setBusy(true)
      const sorted = weekList
        .slice()
        .sort((a, b) =>
          a.date === b.date
            ? shiftOf(a.shiftId).start - shiftOf(b.shiftId).start || a.zoneId.localeCompare(b.zoneId)
            : a.date.localeCompare(b.date),
        )

      const detail: (string | number)[][] = [['日期', '星期', '班次', '时段', '区域', '角色', '员工', '工时']]
      sorted.forEach(a => {
        const shift = shiftOf(a.shiftId)
        const custom = a.source === 'custom'
        detail.push([
          a.date,
          WEEK_LABELS[weekdayIndex(a.date)],
          custom ? '自定义' : shift.label,
          custom ? timeText(a) : `${shift.start}:00-${shift.end}:00`,
          zoneOf(a.zoneId).name,
          roleOf(a.roleCode).name,
          a.staffName,
          assignmentHours(a),
        ])
      })

      const perStaff: (string | number)[][] = [['员工', '主岗', '排班次数', '周工时']]
      staffs.forEach(st => {
        const list = weekList.filter(a => a.staffId === st.id)
        if (!list.length) return
        perStaff.push([
          st.name,
          roleOf(st.role).name,
          list.length,
          Math.round(list.reduce((sum, a) => sum + assignmentHours(a), 0) * 10) / 10,
        ])
      })

      const gapRows: (string | number)[][] = [['日期', '星期', '区域', '角色', '班次', '缺口人数']]
      summary.gaps.forEach(g => {
        gapRows.push([
          g.date,
          WEEK_LABELS[weekdayIndex(g.date)],
          g.zoneName,
          g.roleName,
          g.shiftLabel,
          g.missing,
        ])
      })
      if (summary.gaps.length === 0) gapRows.push(['—', '—', '—', '—', '无缺口', 0])

      const overview: (string | number)[][] = [
        ['排班计划表'],
        ['生成时间', new Date().toLocaleString()],
        ['统计区间', rangeLabel],
        ['需求人数', summary.total],
        ['已排人数', summary.filled],
        ['覆盖率', `${summary.coverage}%`],
        ['缺口项数', summary.gaps.length],
        ['员工人数', staffs.length],
        ['需求规则数', demands.length],
      ]

      const bytes = writeWorkbook([
        { name: '排班明细', widths: [12, 8, 8, 12, 16, 8, 10, 8], rows: detail },
        { name: '按人汇总', widths: [12, 10, 12, 10], rows: perStaff },
        { name: '缺口清单', widths: [12, 8, 16, 8, 8, 10], rows: gapRows },
        { name: '汇总', widths: [14, 30], rows: overview },
      ])
      await saveAndOpen(bytes, `排班计划表-${dates[0]}.xlsx`)
      Taro.showToast({ title: '已生成排班计划表', icon: 'none' })
    } catch (e) {
      Taro.showToast({ title: '导出失败，请重试', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView scrollY className='page'>
      {/* 一键排班 */}
      <View className='hero'>
        <View className='hero-top'>
          <Text className='hero-eyebrow'>AUTO PLANNING</Text>
          <Text className='hero-title'>一键排班</Text>
          <View className='hero-line' />
        </View>
        <View className='hero-bottom'>
          {isCustom ? (
            <>
              <View className='hero-stat'>
                <Text className='hero-num'>{staffCount}</Text>
                <Text className='hero-label'>排班人数</Text>
              </View>
              <View className='hero-stat'>
                <Text className='hero-num'>{weekList.length}</Text>
                <Text className='hero-label'>班次条数</Text>
              </View>
            </>
          ) : (
            <>
              <View className='hero-stat'>
                <Text className='hero-num'>{summary.coverage}<Text className='hero-unit'>%</Text></Text>
                <Text className='hero-label'>覆盖率</Text>
              </View>
              <View className='hero-stat'>
                <Text className='hero-num'>{summary.filled}/{summary.total}</Text>
                <Text className='hero-label'>已排 / 需求</Text>
              </View>
            </>
          )}
          <View className='hero-btn' onClick={handlePlan}>
            <Text className='hero-btn-text'>生成本周</Text>
          </View>
        </View>
      </View>

      {/* 周切换 */}
      <View className='weekbar'>
        <View className='week-nav' onClick={() => setOffset(v => v - 1)}><Text>‹</Text></View>
        <View className='week-mid'>
          <Text className='week-range'>{monthDay(dates[0])} – {monthDay(dates[6])}</Text>
          <Text className='week-tag'>{weekLabel}</Text>
        </View>
        <View className='week-nav' onClick={() => setOffset(v => v + 1)}><Text>›</Text></View>
      </View>

      {/* 日期 */}
      <View className='days'>
        {dates.map((date, i) => (
          <View
            key={date}
            className={`day ${i === activeIdx ? 'on' : ''} ${date === today ? 'today' : ''}`}
            onClick={() => setDayIdx(i)}
          >
            <Text className='day-dow'>{WEEK_SHORT[i]}</Text>
            <Text className='day-num'>{dayNum(date)}</Text>
          </View>
        ))}
      </View>

      {/* Excel 导入 / 导出 */}
      <View className={`block xl ${busy ? 'busy' : ''}`}>
        <View className='block-head'>
          <Text className='block-title'>Excel 排班表</Text>
          <Text className='block-sub'>
            {staffs.length} 人 · {demands.length} 条需求
          </Text>
        </View>

        <View className='xl-row' onClick={downloadTemplate}>
          <View className='xl-icon'>
            <Text>⤓</Text>
          </View>
          <View className='xl-main'>
            <Text className='xl-title'>下载模版</Text>
            <Text className='xl-desc'>员工 / 需求两张表，Excel、WPS 均可编辑</Text>
          </View>
          <Text className='xl-arrow'>›</Text>
        </View>

        <View className='xl-row' onClick={uploadExcel}>
          <View className='xl-icon dark'>
            <Text>⇪</Text>
          </View>
          <View className='xl-main'>
            <Text className='xl-title'>一键上传 Excel</Text>
            <Text className='xl-desc'>从聊天记录选 .xlsx，解析后自动重排</Text>
          </View>
          <Text className='xl-arrow'>›</Text>
        </View>

        <View className='xl-row' onClick={exportPlan}>
          <View className='xl-icon'>
            <Text>⌸</Text>
          </View>
          <View className='xl-main'>
            <Text className='xl-title'>导出排班计划表</Text>
            <Text className='xl-desc'>明细 + 按人汇总 + 缺口清单</Text>
          </View>
          <Text className='xl-arrow'>›</Text>
        </View>

        <View className='xl-row' onClick={openCustom}>
          <View className='xl-icon dark'>
            <Text>⊕</Text>
          </View>
          <View className='xl-main'>
            <Text className='xl-title'>自定义导入班表</Text>
            <Text className='xl-desc'>门店系统导出的表（含姓名 / 上班 / 下班）也能直接生成计划</Text>
          </View>
          <Text className='xl-arrow'>›</Text>
        </View>

        <View className='xl-note'>
          <Text>{importNote || '先下载模版，填好后上传即可生成当周排班计划表'}</Text>
        </View>
      </View>

      {/* 缺口 */}
      <View className='block'>
        <View className='block-head'>
          <Text className='block-title'>{isCustom ? '导入班表' : '人力缺口'}</Text>
          <Text className='block-sub'>{isCustom ? '按真实班表统计' : `${summary.gaps.length} 项`}</Text>
        </View>
        {isCustom && (
          <View className='gap-row'>
            <View className='gap-dot' />
            <Text className='gap-text'>
              {staffCount} 人 · {weekList.length} 个班次 · 覆盖 {new Set(weekList.map(a => a.zoneId)).size} 个区域
            </Text>
          </View>
        )}
        {isCustom && (
          <View className='gap-more'>
            <Text>自定义班表来自门店系统，不与内置需求对比，因此不计算缺口</Text>
          </View>
        )}
        {!isCustom && summary.gaps.length === 0 && (
          <View className='empty'>本周需求已全部满足</View>
        )}
        {!isCustom && summary.gaps.slice(0, 6).map(gap => (
          <View key={`${gap.date}-${gap.zoneId}-${gap.roleCode}-${gap.shiftId}`} className='gap-row'>
            <View className='gap-dot' />
            <Text className='gap-text'>
              {WEEK_LABELS[weekdayIndex(gap.date)]} · {gap.zoneName} · {gap.roleName} · {gap.shiftLabel}
            </Text>
            <Text className='gap-num'>缺 {gap.missing}</Text>
          </View>
        ))}
        {!isCustom && summary.gaps.length > 6 && (
          <View className='gap-more'><Text>另有 {summary.gaps.length - 6} 项缺口</Text></View>
        )}
      </View>

      {/* 当日排班 */}
      <View className='block'>
        <View className='block-head'>
          <Text className='block-title'>当日排班</Text>
          <Text className='block-sub'>
            {monthDay(activeDate)} {WEEK_LABELS[dates.indexOf(activeDate)] || ''} · {dayList.length} 人
          </Text>
        </View>

        {isCustom &&
          dayList
            .slice()
            .sort((a, b) => (a.startMin || 0) - (b.startMin || 0))
            .map(a => {
              const role = roleOf(a.roleCode)
              return (
                <View key={a.id} className='shift-row'>
                  <View className='shift-avatar' style={{ background: role.color }}>
                    <Text className='shift-avatar-text'>{a.staffName.charAt(0)}</Text>
                  </View>
                  <View className='shift-main'>
                    <Text className='shift-staff'>{a.staffName}</Text>
                    <Text className='shift-meta'>{zoneOf(a.zoneId).name} · {role.name}</Text>
                  </View>
                  <Text className='shift-role'>{timeText(a)}</Text>
                </View>
              )
            })}

        {!isCustom && SHIFTS.map(shift => {
          const list = dayList
            .filter(a => a.shiftId === shift.id)
            .sort((a, b) => a.roleCode.localeCompare(b.roleCode))
          return (
            <View key={shift.id} className='shift'>
              <View className='shift-head'>
                <Text className='shift-name'>{shift.label}</Text>
                <Text className='shift-time'>{shift.start}:00 - {shift.end}:00</Text>
                <Text className='shift-count'>{list.length} 人</Text>
              </View>
              {list.length === 0 && <Text className='shift-empty'>暂无排班</Text>}
              {list.map(a => {
                const role = roleOf(a.roleCode)
                return (
                  <View key={a.id} className='shift-row'>
                    <View className='shift-avatar' style={{ background: role.color }}>
                      <Text className='shift-avatar-text'>{a.staffName.charAt(0)}</Text>
                    </View>
                    <View className='shift-main'>
                      <Text className='shift-staff'>{a.staffName}</Text>
                      <Text className='shift-meta'>{zoneOf(a.zoneId).name} · {shiftOf(a.shiftId).label}</Text>
                    </View>
                    <Text className='shift-role' style={{ color: role.color }}>{role.name}</Text>
                  </View>
                )
              })}
            </View>
          )
        })}
      </View>

      <View className='bottom-pad' />

      {/* 自定义导入预览 */}
      {preview && (
        <View className='sheet-mask' onClick={() => setPreview(null)}>
          <View className='sheet' onClick={e => e.stopPropagation()}>
            <View className='sheet-head'>
              <Text className='sheet-title'>自定义班表导入</Text>
              <Text className='sheet-close' onClick={() => setPreview(null)}>✕</Text>
            </View>
            <Text className='sheet-sub'>
              识别到 {preview.rows.length} 人 · {clock(preview.minStart)}–{clock(preview.maxEnd)}
              {preview.dateSource ? ` · 日期来自${preview.dateSource}` : ''}
            </Text>

            <View className='sheet-row'>
              <Text className='sheet-label'>排班日期</Text>
              <Picker mode='date' value={pickDate} onChange={e => setPickDate(String(e.detail.value))}>
                <Text className='sheet-value'>{pickDate || '请选择'}</Text>
              </Picker>
            </View>

            <View className='sheet-row'>
              <Text className='sheet-label'>岗位映射</Text>
              <Text className='sheet-value'>
                {preview.roleNames.length
                  ? preview.roleNames.slice(0, 3).join('、') + (preview.roleNames.length > 3 ? '…' : '')
                  : '未标注，统一按导购'}
              </Text>
            </View>

            <View className='sheet-row'>
              <Text className='sheet-label'>区域识别</Text>
              <Text className='sheet-value'>
                {preview.zoneTexts.length
                  ? `${preview.zoneTexts.length} 种（如 ${preview.zoneTexts.slice(0, 2).join('、')}）`
                  : '未标注，按一层零售区'}
              </Text>
            </View>

            {preview.notes.length > 0 && (
              <View className='sheet-notes'>
                {preview.notes.map(n => (
                  <Text key={n} className='sheet-note'>· {n}</Text>
                ))}
              </View>
            )}

            <View className='sheet-actions'>
              <View className='sheet-btn ghost' onClick={() => setPreview(null)}>
                <Text>取消</Text>
              </View>
              <View className='sheet-btn' onClick={confirmCustom}>
                <Text>导入并生成计划</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  )
}
