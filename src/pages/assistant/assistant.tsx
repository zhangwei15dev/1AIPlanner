import { useState } from 'react'
import { Input, ScrollView, Text, View } from '@tarojs/components'
import { ROLES, SHIFTS, roleOf, zoneOf } from '../../data/demo'
import { buildSlots, roleLoad, shiftHours, summarize } from '../../services/scheduler'
import { useApp } from '../../store/app'
import type { Assignment, Shift } from '../../types'
import { addDays, monthDay, todayKey, WEEK_LABELS, weekDates, weekdayIndex } from '../../utils/date'
import './assistant.scss'

interface Msg {
  id: number
  from: 'user' | 'ai'
  text: string
}

const CHIPS = ['一键排班', '本周缺口', '今天早班名单', '角色分配', '门店信息']

let seq = 1

// 解析「今天 / 明天 / 周三」这类日期词
function parseDate(q: string, dates: string[]): { date: string; label: string } | null {
  const today = todayKey()
  if (/今天|今日/.test(q)) return { date: today, label: '今天' }
  if (/明天|明日/.test(q)) return { date: addDays(today, 1), label: '明天' }
  for (let i = 0; i < 7; i++) {
    if (q.indexOf(WEEK_LABELS[i]) >= 0) return { date: dates[i], label: WEEK_LABELS[i] }
  }
  if (dates.indexOf(today) >= 0) return { date: today, label: '今天' }
  return null
}

function parseShift(q: string): Shift | null {
  if (/早/.test(q)) return SHIFTS[0]
  if (/中/.test(q)) return SHIFTS[1]
  if (/晚/.test(q)) return SHIFTS[2]
  return null
}

export default function Assistant() {
  const { store, staffs, assignments, planWeek } = useApp()
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      id: seq++,
      from: 'ai',
      text: '你好，我是 1AIPlanner 排班助手。\n可以问我：一键排班 / 本周缺口 / 今天早班名单 / 角色分配 / 门店信息。',
    },
  ])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)

  const dates = weekDates(0)
  const slots = buildSlots(dates)
  const weekList = assignments.filter(a => dates.indexOf(a.date) >= 0)
  const summary = summarize(weekList, slots)
  const loads = roleLoad(weekList, staffs)
  const totalHours = weekList.reduce((sum, a) => sum + shiftHours(a.shiftId), 0)

  const rosterText = (list: Assignment[], label: string, shift: Shift | null) => {
    const title = shift
      ? `${label}${shift.label}（${shift.start}:00-${shift.end}:00）`
      : `${label}（${monthDay(dates[0])} - ${monthDay(dates[6])}）`
    if (list.length === 0) return `${title}暂无排班，可以先「一键排班」。`
    const lines = [`${title}共 ${list.length} 人次：`]
    list.forEach(a => {
      lines.push(`· ${a.staffName}（${roleOf(a.roleCode).name} · ${zoneOf(a.zoneId).name}）`)
    })
    return lines.join('\n')
  }

  const answer = (q: string): string => {
    // 1. 一键排班
    if (/(一键|自动|智能).{0,4}排班|帮我排|生成排班|排一下/.test(q)) {
      const result = planWeek(dates)
      const lines = [
        `已完成本周排班：需求 ${result.total} 项，已排 ${result.filled} 项，覆盖率 ${result.coverage}%。`,
      ]
      if (result.gaps.length > 0) {
        const weekend = result.gaps.filter(g => {
          const dow = weekdayIndex(g.date)
          return dow >= 5
        }).length
        lines.push(`仍有 ${result.gaps.length} 项缺口${weekend > 0 ? `，其中 ${weekend} 项在周末` : ''}。`)
        const first = result.gaps[0]
        lines.push(`最紧的是 ${WEEK_LABELS[weekdayIndex(first.date)]}${first.zoneName}${first.roleName}（${first.shiftLabel}），缺 ${first.missing} 人。`)
      } else {
        lines.push('全部需求已满足，无需调整。')
      }
      lines.push('结果已同步到「总览」和「排班」页。')
      return lines.join('\n')
    }

    // 2. 缺口
    if (/缺口|缺人|不够|差人/.test(q)) {
      if (summary.gaps.length === 0) return '本周没有人力缺口。'
      const totalMissing = summary.gaps.reduce((sum, g) => sum + g.missing, 0)
      const lines = [`本周共 ${summary.gaps.length} 项缺口，合计 ${totalMissing} 人次：`]
      summary.gaps.slice(0, 5).forEach(g => {
        lines.push(`· ${WEEK_LABELS[weekdayIndex(g.date)]} ${g.zoneName} ${g.roleName}（${g.shiftLabel}）缺 ${g.missing}`)
      })
      if (summary.gaps.length > 5) lines.push(`…… 其余 ${summary.gaps.length - 5} 项见「排班」页`)
      return lines.join('\n')
    }

    // 3. 名单
    if (/名单|有谁|谁在|几个人|多少人|排班|安排/.test(q)) {
      const day = parseDate(q, dates)
      const date = day ? day.date : dates[0]
      const label = day ? day.label : WEEK_LABELS[weekdayIndex(date)]
      const shift = parseShift(q)
      let list = assignments.filter(a => a.date === date)
      if (shift) list = list.filter(a => a.shiftId === shift.id)
      return rosterText(list, label, shift)
    }

    // 4. 角色分配
    if (/角色|分配|工时|人力/.test(q)) {
      const lines = [`本周共 ${weekList.length} 人次，${totalHours} 工时，覆盖率 ${summary.coverage}%。`, '按角色：']
      loads.forEach(l => {
        lines.push(`· ${l.name}：${l.people} 人 · ${l.shifts} 人次 · ${l.hours}h`)
      })
      return lines.join('\n')
    }

    // 5. 门店
    if (/门店|地址|营业|面积|电话|楼层/.test(q)) {
      return [
        `${store.city} · ${store.name}`,
        `营业时间：${store.open} - ${store.close}`,
        `结构：${store.floors} 层 · ${store.area} ㎡`,
        `员工：${staffs.length} 人（在岗 ${staffs.filter(s => s.status === 'active').length} 人）`,
      ].join('\n')
    }

    // 6. 问候
    if (/^(你好|您好|hi|hello|嗨|在吗)/i.test(q)) {
      return `你好，这里是 ${store.name} 的排班助手。可以问我：一键排班 / 本周缺口 / 今天早班名单 / 角色分配。`
    }
    if (/谢谢|感谢/.test(q)) return '不客气，随时找我。'

    if (/角色有哪|有哪些角色|岗位/.test(q)) {
      return `门店共 ${ROLES.length} 个角色：${ROLES.map(r => r.name).join('、')}。`
    }

    return [
      '这个问题我暂时回答不了。可以试试：',
      '· 一键排班',
      '· 本周缺口',
      '· 今天早班名单',
      '· 角色分配',
    ].join('\n')
  }

  const send = (text?: string) => {
    const content = (typeof text === 'string' ? text : input).trim()
    if (!content) return
    if (typeof text !== 'string') setInput('')
    setMsgs(prev => prev.concat({ id: seq++, from: 'user', text: content }))
    setTyping(true)
    setTimeout(() => {
      const reply = answer(content)
      setTyping(false)
      setMsgs(prev => prev.concat({ id: seq++, from: 'ai', text: reply }))
    }, 320)
  }

  const anchor = typing ? 'msg-typing' : `msg-${msgs[msgs.length - 1].id}`

  return (
    <View className='chat'>
      <ScrollView scrollY className='chat-body' scrollIntoView={anchor} scrollWithAnimation>
        <View className='chat-head'>
          <Text className='chat-eyebrow'>ASSISTANT</Text>
          <Text className='chat-title'>排班助手</Text>
          <View className='chat-line' />
          <Text className='chat-sub'>{store.city} · {store.name}</Text>
        </View>

        <View className='chat-list'>
          {msgs.map(m => (
            <View key={m.id} id={`msg-${m.id}`} className={`msg ${m.from}`}>
              <View className='bubble'>
                <Text className='bubble-text'>{m.text}</Text>
              </View>
            </View>
          ))}
          {typing && (
            <View className='msg ai' id='msg-typing'>
              <View className='bubble'>
                <Text className='bubble-text dim'>正在计算…</Text>
              </View>
            </View>
          )}
        </View>

        <ScrollView scrollX className='chips'>
          <View className='chips-row'>
            {CHIPS.map(chip => (
              <View key={chip} className='chip' onClick={() => send(chip)}>
                <Text>{chip}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <View className='bottom-pad' />
      </ScrollView>

      <View className='chat-bar'>
        <Input
          className='chat-input'
          value={input}
          placeholder='输入问题，如：今天早班有谁？'
          confirmType='send'
          onInput={e => setInput(e.detail.value)}
          onConfirm={() => send()}
        />
        <View className='chat-send' onClick={() => send()}>
          <Text>发送</Text>
        </View>
      </View>
    </View>
  )
}
