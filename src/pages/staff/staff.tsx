import { useMemo, useState } from 'react'
import { Input, ScrollView, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { ROLES, roleOf } from '../../data/demo'
import { shiftHours } from '../../services/scheduler'
import { useApp } from '../../store/app'
import type { RoleCode, Staff } from '../../types'
import './staff.scss'

type Status = Staff['status']

const STATUS_LABEL: Record<Status, string> = {
  active: '在岗',
  leave: '请假',
  training: '培训',
}

interface FormProps {
  initial: Staff | null
  onClose: () => void
  onSubmit: (data: Omit<Staff, 'id'>, id?: string) => void
  onDelete?: () => void
}

function StaffForm({ initial, onClose, onSubmit, onDelete }: FormProps) {
  const [name, setName] = useState(initial ? initial.name : '')
  const [role, setRole] = useState<RoleCode>(initial ? initial.role : 'sales')
  const [backup, setBackup] = useState<RoleCode[]>(initial ? initial.backup : [])
  const [skill, setSkill] = useState<number>(initial ? initial.skill : 3)
  const [maxHours, setMaxHours] = useState(initial ? initial.maxHours : 40)
  const [minHours, setMinHours] = useState(initial ? initial.minHours : 30)
  const [status, setStatus] = useState<Status>(initial ? initial.status : 'active')

  const toggleBackup = (code: RoleCode) => {
    setBackup(prev => (prev.indexOf(code) >= 0 ? prev.filter(c => c !== code) : prev.concat(code)))
  }

  const save = () => {
    if (!name.trim()) {
      Taro.showToast({ title: '请填写姓名', icon: 'none' })
      return
    }
    if (minHours > maxHours) {
      Taro.showToast({ title: '最低工时不能高于最高', icon: 'none' })
      return
    }
    onSubmit(
      {
        name: name.trim(),
        role,
        backup,
        skill: skill as Staff['skill'],
        maxHours,
        minHours,
        status,
      },
      initial ? initial.id : undefined,
    )
  }

  return (
    <View className='mask' onClick={onClose}>
      <View className='modal' onClick={e => e.stopPropagation()}>
        <View className='modal-head'>
          <Text className='modal-title'>{initial ? '编辑员工' : '新增员工'}</Text>
          <Text className='modal-close' onClick={onClose}>✕</Text>
        </View>

        <ScrollView scrollY className='modal-body'>
          <Text className='field-label'>姓名</Text>
          <Input
            className='field-input'
            value={name}
            placeholder='请输入姓名'
            onInput={e => setName(e.detail.value)}
          />

          <Text className='field-label'>主岗</Text>
          <View className='chip-wrap'>
            {ROLES.map(r => (
              <View
                key={r.code}
                className={`pick ${role === r.code ? 'on' : ''}`}
                onClick={() => {
                  setRole(r.code)
                  setBackup(prev => prev.filter(c => c !== r.code))
                }}
              >
                <View className='pick-dot' style={{ background: r.color }} />
                <Text>{r.name}</Text>
              </View>
            ))}
          </View>

          <Text className='field-label'>可通岗（多选）</Text>
          <View className='chip-wrap'>
            {ROLES.filter(r => r.code !== role).map(r => (
              <View
                key={r.code}
                className={`pick ${backup.indexOf(r.code) >= 0 ? 'on' : ''}`}
                onClick={() => toggleBackup(r.code)}
              >
                <Text>{r.name}</Text>
              </View>
            ))}
          </View>

          <Text className='field-label'>技能等级</Text>
          <View className='stars'>
            {[1, 2, 3, 4, 5].map(n => (
              <Text
                key={n}
                className={`star ${n <= skill ? 'on' : ''}`}
                onClick={() => setSkill(n)}
              >
                ★
              </Text>
            ))}
          </View>

          <View className='pair'>
            <View className='pair-item'>
              <Text className='field-label'>最低周工时</Text>
              <View className='stepper'>
                <Text className='stepper-btn' onClick={() => setMinHours(v => Math.max(0, v - 2))}>−</Text>
                <Text className='stepper-num'>{minHours}</Text>
                <Text className='stepper-btn' onClick={() => setMinHours(v => Math.min(maxHours, v + 2))}>+</Text>
              </View>
            </View>
            <View className='pair-item'>
              <Text className='field-label'>最高周工时</Text>
              <View className='stepper'>
                <Text className='stepper-btn' onClick={() => setMaxHours(v => Math.max(minHours, v - 2))}>−</Text>
                <Text className='stepper-num'>{maxHours}</Text>
                <Text className='stepper-btn' onClick={() => setMaxHours(v => Math.min(60, v + 2))}>+</Text>
              </View>
            </View>
          </View>

          <Text className='field-label'>状态</Text>
          <View className='chip-wrap'>
            {(Object.keys(STATUS_LABEL) as Status[]).map(key => (
              <View
                key={key}
                className={`pick ${status === key ? 'on' : ''}`}
                onClick={() => setStatus(key)}
              >
                <Text>{STATUS_LABEL[key]}</Text>
              </View>
            ))}
          </View>

          {initial && (
            <View className='danger-btn' onClick={onDelete}>
              <Text>删除员工</Text>
            </View>
          )}
          <View className='modal-pad' />
        </ScrollView>

        <View className='modal-foot'>
          <View className='foot-btn' onClick={onClose}><Text>取消</Text></View>
          <View className='foot-btn primary' onClick={save}><Text>保存</Text></View>
        </View>
      </View>
    </View>
  )
}

export default function StaffPage() {
  const { staffs, assignments, addStaff, updateStaff, removeStaff } = useApp()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleCode | 'all'>('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Staff | null>(null)

  const hoursOf = (id: string) =>
    assignments.filter(a => a.staffId === id).reduce((sum, a) => sum + shiftHours(a.shiftId), 0)

  const list = useMemo(
    () =>
      staffs.filter(s => {
        if (search && s.name.indexOf(search) < 0) return false
        if (roleFilter !== 'all' && s.role !== roleFilter) return false
        return true
      }),
    [staffs, search, roleFilter],
  )

  const activeCount = staffs.filter(s => s.status === 'active').length
  const totalHours = assignments.reduce((sum, a) => sum + shiftHours(a.shiftId), 0)

  const openCreate = () => {
    setEditing(null)
    setOpen(true)
  }

  const openEdit = (s: Staff) => {
    setEditing(s)
    setOpen(true)
  }

  const handleSubmit = (data: Omit<Staff, 'id'>, id?: string) => {
    if (id) {
      updateStaff(id, data)
      Taro.showToast({ title: '已更新', icon: 'none' })
    } else {
      addStaff(data)
      Taro.showToast({ title: '已新增', icon: 'none' })
    }
    setOpen(false)
  }

  const handleDelete = () => {
    if (!editing) return
    const target = editing
    Taro.showModal({
      title: '删除员工',
      content: `确定删除「${target.name}」？其排班将一并清除。`,
      confirmColor: '#B4453A',
      success: res => {
        if (!res.confirm) return
        removeStaff(target.id)
        setOpen(false)
        Taro.showToast({ title: '已删除', icon: 'none' })
      },
    })
  }

  return (
    <ScrollView scrollY className='page'>
      {/* 概览 */}
      <View className='head'>
        <Text className='head-eyebrow'>ROSTER</Text>
        <Text className='head-title'>员工</Text>
        <View className='head-stats'>
          <View className='head-stat'>
            <Text className='head-num'>{staffs.length}</Text>
            <Text className='head-label'>总人数</Text>
          </View>
          <View className='head-stat'>
            <Text className='head-num'>{activeCount}</Text>
            <Text className='head-label'>在岗</Text>
          </View>
          <View className='head-stat'>
            <Text className='head-num'>{totalHours}</Text>
            <Text className='head-label'>本周工时</Text>
          </View>
        </View>
      </View>

      {/* 搜索与筛选 */}
      <View className='tools'>
        <Input
          className='search'
          value={search}
          placeholder='搜索姓名'
          onInput={e => setSearch(e.detail.value)}
        />
        <ScrollView scrollX className='filter'>
          <View className='filter-row'>
            <View
              className={`filter-chip ${roleFilter === 'all' ? 'on' : ''}`}
              onClick={() => setRoleFilter('all')}
            >
              <Text>全部</Text>
            </View>
            {ROLES.map(r => (
              <View
                key={r.code}
                className={`filter-chip ${roleFilter === r.code ? 'on' : ''}`}
                onClick={() => setRoleFilter(r.code)}
              >
                <View className='filter-dot' style={{ background: r.color }} />
                <Text>{r.name}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {/* 列表 */}
      <View className='list'>
        {list.length === 0 && <View className='empty'>没有匹配的员工</View>}
        {list.map(s => {
          const role = roleOf(s.role)
          const hours = hoursOf(s.id)
          const percent = Math.min((hours / s.maxHours) * 100, 100)
          return (
            <View key={s.id} className='card' onClick={() => openEdit(s)}>
              <View className='card-avatar' style={{ background: role.color }}>
                <Text className='card-avatar-text'>{s.name.charAt(0)}</Text>
              </View>
              <View className='card-main'>
                <View className='card-top'>
                  <Text className='card-name'>{s.name}</Text>
                  <Text className={`card-status ${s.status}`}>{STATUS_LABEL[s.status]}</Text>
                </View>
                <Text className='card-role' style={{ color: role.color }}>
                  {role.name}
                  {s.backup.length > 0 && ` ｜ 通岗 ${s.backup.map(c => roleOf(c).name).join('/')}`}
                </Text>
                <View className='card-hours'>
                  <View className='hours-bar'>
                    <View
                      className={`hours-fill ${percent > 90 ? 'high' : ''}`}
                      style={{ width: `${percent}%` }}
                    />
                  </View>
                  <Text className='hours-text'>{hours}/{s.maxHours}h</Text>
                </View>
              </View>
              <Text className='card-skill'>{'★'.repeat(s.skill)}</Text>
            </View>
          )
        })}
      </View>

      <View className='bottom-pad' />
      <View className='fab' onClick={openCreate}><Text>+</Text></View>

      {open && (
        <StaffForm
          initial={editing}
          onClose={() => setOpen(false)}
          onSubmit={handleSubmit}
          onDelete={handleDelete}
        />
      )}
    </ScrollView>
  )
}
