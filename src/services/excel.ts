import { strFromU8, strToU8, unzipSync, zipSync } from '../libs/fflate'
import { DEMAND, ROLES, SHIFTS, STAFFS, ZONES } from '../data/demo'
import type { DemandRule, RoleCode, Staff } from '../types'

// ============================================================================
// 极简 xlsx 读写（基于 fflate 的 zip 能力，不依赖 SheetJS）
// - 读：unzip + 正则解析 sharedStrings / sheet xml，够用且体积只有 ~30KB
// - 写：inlineStr 单元格，Excel / WPS / Numbers 均可直接打开
// ============================================================================

export interface Sheet {
  name: string
  rows: string[][]
}

export interface OutSheet {
  name: string
  widths?: number[]
  rows: (string | number)[][]
}

// ---------------- XML 小工具 ----------------
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const unesc = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // openpyxl / 部分导出工具把中文写成 &#38376; 这种数字实体
    .replace(/&#(\d+);/g, (_, d: string) => {
      const code = Number(d)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => {
      const code = parseInt(h, 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    })
    // Excel 会把控制字符写成 _x000D_ 形式
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')

const attr = (tag: string, name: string): string => {
  const m = tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'))
  return m ? unesc(m[1]) : ''
}

const colIndex = (ref: string): number => {
  let n = 0
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i)
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64)
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96)
    else break
  }
  return n - 1
}

const colName = (i: number): string => {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// ---------------- 读 ----------------
const parseSharedStrings = (xml: string): string[] => {
  const out: string[] = []
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const texts: string[] = []
    const tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g
    let tm: RegExpExecArray | null
    while ((tm = tre.exec(m[1]))) texts.push(unesc(tm[1]))
    out.push(texts.join(''))
  }
  return out
}

const parseSheetXml = (xml: string, shared: string[]): string[][] => {
  const rows: string[][] = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(xml))) {
    const row: string[] = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm: RegExpExecArray | null
    while ((cm = cellRe.exec(rm[1]))) {
      const head = cm[1] || ''
      const body = cm[2] || ''
      const ref = attr(head, 'r')
      const type = attr(head, 't')
      let val = ''
      if (type === 's') {
        const v = body.match(/<v>([\s\S]*?)<\/v>/)
        val = v ? shared[Number(v[1])] || '' : ''
      } else if (type === 'inlineStr') {
        const tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g
        let tm: RegExpExecArray | null
        while ((tm = tre.exec(body))) val += unesc(tm[1])
      } else if (type === 'b') {
        const v = body.match(/<v>([\s\S]*?)<\/v>/)
        val = v && v[1] === '1' ? '是' : '否'
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/)
        val = v ? unesc(v[1]) : ''
      }
      const idx = ref ? colIndex(ref) : row.length
      while (row.length < idx) row.push('')
      row[idx] = val.trim()
    }
    // 去掉整行为空的行
    if (row.some(c => c !== '')) rows.push(row)
  }
  return rows
}

export function readWorkbook(bytes: Uint8Array): Sheet[] {
  const files = unzipSync(bytes)
  const read = (p: string) => (files[p] ? strFromU8(files[p]) : '')

  const shared = parseSharedStrings(read('xl/sharedStrings.xml'))
  const rels = read('xl/_rels/workbook.xml.rels')
  const relMap: Record<string, string> = {}
  const relRe = /<Relationship\b[^>]*?\/?>/g
  let rel: RegExpExecArray | null
  while ((rel = relRe.exec(rels))) {
    const id = attr(rel[0], 'Id')
    const target = attr(rel[0], 'Target')
    if (id && target) relMap[id] = target
  }

  const sheets: Sheet[] = []
  const wb = read('xl/workbook.xml')
  const sheetRe = /<sheet\b[^>]*?\/?>/g
  let sm: RegExpExecArray | null
  while ((sm = sheetRe.exec(wb))) {
    const name = attr(sm[0], 'name')
    const rid = attr(sm[0], 'r:id')
    let target = relMap[rid] || ''
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '')
    sheets.push({
      name: name || `Sheet${sheets.length + 1}`,
      rows: parseSheetXml(read('xl/' + target), shared),
    })
  }
  if (!sheets.length) {
    sheets.push({ name: 'Sheet1', rows: parseSheetXml(read('xl/worksheets/sheet1.xml'), shared) })
  }
  return sheets
}

// ---------------- 写 ----------------
export function writeWorkbook(sheets: OutSheet[]): Uint8Array {
  const sheetXml = (s: OutSheet) => {
    const cols =
      s.widths && s.widths.length
        ? '<cols>' +
          s.widths
            .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
            .join('') +
          '</cols>'
        : ''
    const rows = s.rows
      .map((row, ri) => {
        const cells = row
          .map((v, ci) => {
            const ref = colName(ci) + (ri + 1)
            if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`
            const text = String(v == null ? '' : v)
            if (!text) return ''
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`
          })
          .join('')
        return `<row r="${ri + 1}">${cells}</row>`
      })
      .join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`
  }

  const files: Record<string, Uint8Array> = {}
  const overrides = sheets
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')

  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`)

  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)

  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`)

  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)

  files['xl/styles.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)

  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))
  })

  return zipSync(files, { level: 6 })
}

// ---------------- 业务映射 ----------------
const ROLE_BY_NAME: Record<string, RoleCode> = {}
ROLES.forEach(r => {
  ROLE_BY_NAME[r.name] = r.code
})

const ZONE_BY_NAME: Record<string, string> = {}
ZONES.forEach(z => {
  ZONE_BY_NAME[z.name] = z.id
})

const SHIFT_BY_LABEL: Record<string, string> = {}
SHIFTS.forEach(s => {
  SHIFT_BY_LABEL[s.label] = s.id
})

const STATUS_BY_TEXT: Record<string, Staff['status']> = {
  在岗: 'active',
  正常: 'active',
  active: 'active',
  请假: 'leave',
  leave: 'leave',
  培训: 'training',
  training: 'training',
}

const headerIndex = (row: string[], names: string[]): number => {
  for (let i = 0; i < row.length; i++) {
    if (names.some(n => (row[i] || '').trim() === n)) return i
  }
  return -1
}

export interface ImportResult {
  staffs: Staff[]
  demands: DemandRule[] | null
  errors: string[]
  sheets: string[]
}

export function importWorkbook(bytes: Uint8Array): ImportResult {
  const sheets = readWorkbook(bytes)
  const errors: string[] = []
  const names = sheets.map(s => s.name)

  const staffSheet =
    sheets.find(s => s.name.indexOf('员工') >= 0) ||
    sheets.find(s => s.rows.some(r => headerIndex(r, ['姓名']) >= 0)) ||
    sheets[0]

  const dataSheet =
    sheets.find(s => s.name.indexOf('需求') >= 0) ||
    sheets.find(s => s !== staffSheet && s.rows.some(r => headerIndex(r, ['区域']) >= 0))

  // ---- 员工 ----
  const staffs: Staff[] = []
  if (!staffSheet || !staffSheet.rows.length) {
    return { staffs, demands: null, errors: ['没有可读的工作表'], sheets: names }
  }
  const headerRowIdx = staffSheet.rows.findIndex(r => headerIndex(r, ['姓名']) >= 0)
  const header = staffSheet.rows[headerRowIdx >= 0 ? headerRowIdx : 0] || []
  const ci = {
    name: headerIndex(header, ['姓名', '员工', '员工姓名']),
    role: headerIndex(header, ['主岗', '岗位', '角色']),
    backup: headerIndex(header, ['可通岗', '通岗', '兼任岗位']),
    skill: headerIndex(header, ['技能', '技能等级']),
    max: headerIndex(header, ['周工时上限', '工时上限', '最高周工时']),
    min: headerIndex(header, ['周工时下限', '工时下限', '最低周工时']),
    status: headerIndex(header, ['状态', '在职状态']),
  }
  if (ci.name < 0 || ci.role < 0) {
    return { staffs, demands: null, errors: ['表头缺少「姓名」或「主岗」列'], sheets: names }
  }

  const startRow = (headerRowIdx >= 0 ? headerRowIdx : 0) + 1
  for (let r = startRow; r < staffSheet.rows.length; r++) {
    const row = staffSheet.rows[r]
    const name = (row[ci.name] || '').trim()
    if (!name) continue
    const roleName = (row[ci.role] || '').trim()
    const role = ROLE_BY_NAME[roleName]
    if (!role) {
      errors.push(`第 ${r + 1} 行「${name}」的主岗「${roleName}」无法识别（可用：${ROLES.map(x => x.name).join('/')}）`)
      continue
    }
    const backupText = ci.backup >= 0 ? (row[ci.backup] || '') : ''
    const backup = backupText
      .split(/[,，、/\s]+/)
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => ROLE_BY_NAME[x])
      .filter((x): x is RoleCode => !!x)

    const skillRaw = ci.skill >= 0 ? Number(row[ci.skill]) : NaN
    const maxRaw = ci.max >= 0 ? Number(row[ci.max]) : NaN
    const minRaw = ci.min >= 0 ? Number(row[ci.min]) : NaN

    staffs.push({
      id: `x${r + 1}-${staffs.length}`,
      name,
      role,
      backup,
      skill: (isNaN(skillRaw) ? 3 : Math.min(5, Math.max(1, Math.round(skillRaw)))) as Staff['skill'],
      maxHours: isNaN(maxRaw) || maxRaw <= 0 ? 40 : Math.round(maxRaw),
      minHours: isNaN(minRaw) ? 0 : Math.max(0, Math.round(minRaw)),
      status: (ci.status >= 0 && STATUS_BY_TEXT[(row[ci.status] || '').trim()]) || 'active',
    })
  }

  // ---- 需求（可选） ----
  let demands: DemandRule[] | null = null
  if (dataSheet && dataSheet.rows.length) {
    const dh = dataSheet.rows[0]
    const zi = headerIndex(dh, ['区域'])
    const ri = headerIndex(dh, ['角色'])
    const si = headerIndex(dh, ['班次'])
    const wi = headerIndex(dh, ['仅周末', '周末', '是否仅周末'])
    if (zi >= 0 && ri >= 0 && si >= 0) {
      const rules: DemandRule[] = []
      dataSheet.rows.slice(1).forEach((row, i) => {
        const zoneName = (row[zi] || '').trim()
        const roleName = (row[ri] || '').trim()
        const shiftName = (row[si] || '').trim()
        if (!zoneName && !roleName && !shiftName) return
        const zoneId = ZONE_BY_NAME[zoneName]
        const roleCode = ROLE_BY_NAME[roleName]
        const shiftId = SHIFT_BY_LABEL[shiftName] || (SHIFTS.some(s => s.id === shiftName) ? shiftName : '')
        if (!zoneId || !roleCode || !shiftId) {
          errors.push(
            `需求第 ${i + 2} 行无法识别（区域「${zoneName}」/ 角色「${roleName}」/ 班次「${shiftName}」）`,
          )
          return
        }
        const weekendText = wi >= 0 ? (row[wi] || '').trim() : ''
        rules.push({
          zoneId,
          roleCode,
          shiftId,
          weekendOnly: ['是', 'TRUE', 'true', '1', '仅周末'].indexOf(weekendText) >= 0,
        })
      })
      if (rules.length) demands = rules
    }
  }

  return { staffs, demands, errors, sheets: names }
}

// ---------------- 内置模版 ----------------
const roleName = (code: string) => {
  const r = ROLES.find(x => x.code === code)
  return r ? r.name : ''
}

const zoneName = (id: string) => {
  const z = ZONES.find(x => x.id === id)
  return z ? z.name : ''
}

// 模版默认用内置演示数据预填，导入后即可得到与首页一致的排班结果
export function buildTemplateWorkbook(): Uint8Array {
  const staffRows: (string | number)[][] = [
    ['姓名', '主岗', '可通岗', '技能等级', '周工时上限', '周工时下限', '状态'],
  ]
  STAFFS.forEach(s => {
    staffRows.push([
      s.name,
      roleName(s.role),
      s.backup.map(roleName).filter(Boolean).join('、'),
      s.skill,
      s.maxHours,
      s.minHours,
      s.status === 'leave' ? '请假' : s.status === 'training' ? '培训' : '在岗',
    ])
  })

  const demandRows: (string | number)[][] = [['区域', '角色', '班次', '仅周末']]
  DEMAND.forEach(d => {
    const shift = SHIFTS.find(x => x.id === d.shiftId)
    demandRows.push([zoneName(d.zoneId), roleName(d.roleCode), shift ? shift.label : '', d.weekendOnly ? '是' : '否'])
  })

  const noteRows: (string | number)[][] = [
    ['1AIPlanner 排班模版 · 填写说明'],
    ['1. 「员工」表：姓名与主岗必填；可通岗用顿号/逗号分隔，可留空。'],
    [`2. 主岗可选：${ROLES.map(r => r.name).join(' / ')}。`],
    ['3. 技能等级 1-5；周工时上下限为小时数，上限默认 40，超上限不再排班。'],
    ['4. 状态填「在岗」「请假」「培训」；请假的人不会被排班，培训中的人优先级降低。'],
    [`5. 「需求」表：区域可选 ${ZONES.map(z => z.name).join(' / ')}。`],
    [`6. 班次可选 ${SHIFTS.map(s => `${s.label}（${s.start}:00-${s.end}:00）`).join(' / ')}。`],
    ['7. 「仅周末」填「是」时，该需求只在周六周日生效。'],
    ['8. 「需求」表可以整表删除，删除后使用小程序内置的默认需求。'],
    ['9. 一行一人、一行一条需求；空行会被自动忽略。'],
  ]

  return writeWorkbook([
    { name: '员工', widths: [12, 10, 22, 10, 12, 12, 10], rows: staffRows },
    { name: '需求', widths: [18, 10, 10, 10], rows: demandRows },
    { name: '填写说明', widths: [80], rows: noteRows },
  ])
}
