import { useState, useEffect, useMemo, useRef } from 'react'
import {
  LayoutDashboard, ClipboardList, Trophy, AlertTriangle, BookOpen,
  Calendar, Users, Settings, Menu, X, LogOut, WifiOff,
  Plus, Save, Trash2, Pencil, ChevronLeft, ChevronRight,
  Download, Upload, Printer, Shield, UserCheck, Lock, Unlock, Phone, FileText
} from 'lucide-react'
import {
  isFirebaseConfigured, firebaseLogin, firebaseRegister,
  saveClassInfo, watchCollection, upsertDoc,
  createScoreTransactionAtomic, setWeekLocked, writeAuditLog, removeDoc,
} from './services/firebase'

type Role = 'teacher' | 'classPresident' | 'viceStudy' | 'viceDiscipline' | 'parent' | 'viewer'
const ROLE_LABELS: Record<Role, string> = {
  teacher: 'GVCN', classPresident: 'Lớp trưởng', viceStudy: 'LP học tập',
  viceDiscipline: 'LP kỷ luật', parent: 'Phụ huynh', viewer: 'Chỉ xem',
}
function canCreateScore(role: Role, group: string) {
  if (role === 'teacher' || role === 'classPresident') return true
  if (role === 'viceStudy') return group === 'study' || group === 'bonus'
  if (role === 'viceDiscipline') return group === 'conduct' || group === 'attendance'
  return false
}
function canLockWeek(role: Role) { return role === 'teacher' }
function canEditStudents(role: Role) { return role === 'teacher' }
function canEditSettings(role: Role) { return role === 'teacher' }
function canAttendance(role: Role) {
  return role === 'teacher' || role === 'classPresident' || role === 'viceDiscipline'
}
function canDeleteTx(role: Role) {
  return role === 'teacher' || role === 'classPresident'
}
function classifyScore(total: number, thresholds = { good: 80, fair: 50 }) {
  if (total >= thresholds.good) return { label: 'Tốt', color: 'text-green-600', bg: 'bg-green-50' }
  if (total >= thresholds.fair) return { label: 'Khá', color: 'text-blue-600', bg: 'bg-blue-50' }
  return { label: 'TB', color: 'text-amber-600', bg: 'bg-amber-50' }
}
function parentPasswordFromPhone(phone: string): string {
  const tail = (phone || '').replace(/\D/g, '').slice(-4)
  return tail.length === 4 ? `view${tail}` : ''
}

interface ClassInfo {
  schoolName: string; className: string; homeroomTeacher: string
  schoolYear: string; week1StartDate: string; totalWeeks: number
  periodsPerDay: number; slogan: string
  logoUrl?: string; gradeGood?: number; gradeFair?: number
}
interface Student {
  id: string; stt: number; fullName: string; birthDate: string
  gender: 'Nam' | 'Nữ'; groupId: string; position: string
  parentPhone: string; notes: string; active: boolean
  parentCode?: string
}
interface Group { id: string; name: string; order: number }
interface ScoreRule {
  id: string; name: string; group: string; points: number
  icon: string; active: boolean; usableByOfficers: boolean
}
interface Transaction {
  id: string; studentId: string; weekNumber: number; date: string
  ruleId: string; points: number; note: string; createdBy: string; createdAt: string
}

const DEFAULT_RULES: ScoreRule[] = [
  { id: 'r1', name: 'Đi học chuyên cần', group: 'attendance', points: 10, icon: '✅', active: true, usableByOfficers: true },
  { id: 'r2', name: 'Giơ tay phát biểu', group: 'bonus', points: 2, icon: '✋', active: true, usableByOfficers: true },
  { id: 'r3', name: 'Trả lời tốt', group: 'bonus', points: 3, icon: '⭐', active: true, usableByOfficers: true },
  { id: 'r4', name: 'Làm việc tốt', group: 'bonus', points: 2, icon: '👍', active: true, usableByOfficers: true },
  { id: 'r5', name: 'Tham gia phong trào', group: 'bonus', points: 5, icon: '🎉', active: true, usableByOfficers: true },
  { id: 'r6', name: 'Vắng có phép', group: 'attendance', points: -5, icon: '📝', active: true, usableByOfficers: true },
  { id: 'r7', name: 'Vắng không phép', group: 'attendance', points: -10, icon: '❌', active: true, usableByOfficers: true },
  { id: 'r8', name: 'Đi trễ', group: 'conduct', points: -3, icon: '⏰', active: true, usableByOfficers: true },
  { id: 'r9', name: 'Ngủ trong giờ', group: 'conduct', points: -5, icon: '😴', active: true, usableByOfficers: true },
  { id: 'r10', name: 'Mất trật tự', group: 'conduct', points: -3, icon: '📢', active: true, usableByOfficers: true },
  { id: 'r11', name: 'Không thuộc bài', group: 'study', points: -3, icon: '📖', active: true, usableByOfficers: true },
  { id: 'r12', name: 'Không mang tài liệu', group: 'study', points: -2, icon: '📚', active: true, usableByOfficers: true },
]

const SAMPLE_STUDENTS: Student[] = [
  { id: 's1', stt: 1, fullName: 'Nguyễn Văn An', birthDate: '2017-03-15', gender: 'Nam', groupId: 'g1', position: 'Lớp trưởng', parentPhone: '0901234567', notes: '', active: true },
  { id: 's2', stt: 2, fullName: 'Trần Thị Bình', birthDate: '2017-05-20', gender: 'Nữ', groupId: 'g1', position: 'Lớp phó học tập', parentPhone: '0902345678', notes: '', active: true },
  { id: 's3', stt: 3, fullName: 'Lê Văn Cường', birthDate: '2017-01-10', gender: 'Nam', groupId: 'g1', position: '', parentPhone: '0903456789', notes: '', active: true },
  { id: 's4', stt: 4, fullName: 'Phạm Thị Dung', birthDate: '2017-07-22', gender: 'Nữ', groupId: 'g2', position: 'Lớp phó kỷ luật', parentPhone: '0904567890', notes: '', active: true },
  { id: 's5', stt: 5, fullName: 'Hoàng Văn Em', birthDate: '2017-09-05', gender: 'Nam', groupId: 'g2', position: '', parentPhone: '0905678901', notes: '', active: true },
  { id: 's6', stt: 6, fullName: 'Vũ Thị Phương', birthDate: '2017-11-18', gender: 'Nữ', groupId: 'g2', position: '', parentPhone: '0906789012', notes: '', active: true },
  { id: 's7', stt: 7, fullName: 'Đặng Văn Giang', birthDate: '2017-02-28', gender: 'Nam', groupId: 'g3', position: 'Bí thư', parentPhone: '0907890123', notes: '', active: true },
  { id: 's8', stt: 8, fullName: 'Bùi Thị Hoa', birthDate: '2017-04-12', gender: 'Nữ', groupId: 'g3', position: '', parentPhone: '0908901234', notes: '', active: true },
  { id: 's9', stt: 9, fullName: 'Ngô Văn Ích', birthDate: '2017-06-30', gender: 'Nam', groupId: 'g3', position: '', parentPhone: '0909012345', notes: '', active: true },
  { id: 's10', stt: 10, fullName: 'Dương Thị Kim', birthDate: '2017-08-08', gender: 'Nữ', groupId: 'g4', position: 'Tổ trưởng', parentPhone: '0910123456', notes: '', active: true },
  { id: 's11', stt: 11, fullName: 'Lý Văn Long', birthDate: '2017-10-25', gender: 'Nam', groupId: 'g4', position: '', parentPhone: '0911234567', notes: '', active: true },
  { id: 's12', stt: 12, fullName: 'Mai Thị Nga', birthDate: '2017-12-03', gender: 'Nữ', groupId: 'g4', position: '', parentPhone: '0912345678', notes: '', active: true },
]

const DEFAULT_GROUPS: Group[] = [
  { id: 'g1', name: 'Tổ 1', order: 1 }, { id: 'g2', name: 'Tổ 2', order: 2 },
  { id: 'g3', name: 'Tổ 3', order: 3 }, { id: 'g4', name: 'Tổ 4', order: 4 },
]

const MENU = [
  { id: 'dashboard', label: 'Tổng quan tháng', icon: LayoutDashboard },
  { id: 'attendance', label: 'Điểm danh nhanh', icon: UserCheck },
  { id: 'weekly', label: 'Nhập điểm tuần', icon: ClipboardList },
  { id: 'ranking', label: 'Thi đua theo tổ', icon: Trophy },
  { id: 'conduct', label: 'Vi phạm rèn luyện', icon: AlertTriangle },
  { id: 'study', label: 'Theo dõi học tập', icon: BookOpen },
  { id: 'timetable', label: 'Báo bài', icon: Calendar },
  { id: 'students', label: 'Học sinh / PH', icon: Users },
  { id: 'reports', label: 'Báo cáo PH / In', icon: Printer },
  { id: 'monthly', label: 'Báo cáo tháng', icon: FileText },
  { id: 'settings', label: 'Cài đặt lớp', icon: Settings },
]

const DAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
const STORAGE_KEY = 'qlcn_data_v2'

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4) }
function loadData() {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw) } catch {}
  return null
}
function saveData(data: unknown) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) }
function formatDate(d: string) {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}
function getWeekDates(start: string, week: number) {
  const base = new Date(start + 'T00:00:00')
  const s = new Date(base)
  s.setDate(base.getDate() + (week - 1) * 7)
  const days: string[] = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(s); d.setDate(s.getDate() + i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}
function downloadCSV(filename: string, rows: string[][]) {
  const bom = '\uFEFF'
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
function parseCSV(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim())
  return lines.map(line => {
    const cells: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === ',' && !inQ) { cells.push(cur); cur = '' }
      else cur += ch
    }
    cells.push(cur)
    return cells
  })
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [role, setRole] = useState<Role>('teacher')
  const [page, setPage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [week, setWeek] = useState(1)
  const [search, setSearch] = useState('')
  const [filterGroup, setFilterGroup] = useState('all')
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState<{ type: string; studentId?: string; txId?: string } | null>(null)
  const [linkedStudentId, setLinkedStudentId] = useState<string | null>(null)
  const [printWeekFrom, setPrintWeekFrom] = useState(1)
  const [printWeekTo, setPrintWeekTo] = useState(1)
  const [editForm, setEditForm] = useState({ ruleId: '', note: '', fullName: '', groupId: '', parentPhone: '', parentCode: '', position: '' })
  const [classInfo, setClassInfo] = useState<ClassInfo>({
    schoolName: 'Trường tiểu học Phước Sơn', className: '3A3', homeroomTeacher: 'Đỗ Giang Vũ',
    schoolYear: '2026 – 2027', week1StartDate: '2026-08-17',
    totalWeeks: 35, periodsPerDay: 7, slogan: 'Chăm ngoan - Học giỏi',
  })
  const [students, setStudents] = useState<Student[]>([])
  const [groups, setGroups] = useState<Group[]>(DEFAULT_GROUPS)
  const [rules] = useState<ScoreRule[]>(DEFAULT_RULES)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [lockedWeeks, setLockedWeeks] = useState<Record<number, boolean>>({})
  const [auditLogs, setAuditLogs] = useState<{ id: string; action: string; detail: string; by: string; clientAt: string }[]>([])
  const [attendDate, setAttendDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [lessons, setLessons] = useState<Record<string, string>>({})
  const [demoLoaded, setDemoLoaded] = useState(false)
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginError, setLoginError] = useState('')
  const [syncStatus, setSyncStatus] = useState<'off' | 'live' | 'error'>(isFirebaseConfigured ? 'live' : 'off')
  const fileImportRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      if (q.get('view') === 'parent') { setRole('parent'); setLoginUser('phuhuynh') }
    } catch {}
  }, [])

  useEffect(() => {
    const d = loadData()
    if (d) {
      if (d.classInfo) setClassInfo(d.classInfo)
      if (d.students) setStudents(d.students)
      if (d.groups) setGroups(d.groups)
      if (d.transactions) setTransactions(d.transactions)
      if (d.lockedWeeks) setLockedWeeks(d.lockedWeeks)
      if (d.lessons) setLessons(d.lessons)
      if (d.auditLogs) setAuditLogs(d.auditLogs)
      if (d.role) setRole(d.role)
      if (d.loggedIn) setLoggedIn(true)
      if (d.demoLoaded) setDemoLoaded(true)
      if (d.linkedStudentId) setLinkedStudentId(d.linkedStudentId)
    }
  }, [])

  useEffect(() => {
    if (loggedIn) saveData({ classInfo, students, groups, transactions, lockedWeeks, lessons, auditLogs, role, loggedIn, demoLoaded, linkedStudentId })
  }, [classInfo, students, groups, transactions, lockedWeeks, lessons, auditLogs, role, loggedIn, demoLoaded, linkedStudentId])

  useEffect(() => {
    if (!loggedIn || !isFirebaseConfigured) return
    const u1 = watchCollection<Student>('students', (items) => {
      if (!items.length) return
      const mapped = items.map(s => ({ ...s, active: s.active !== false }))
      const byKey = new Map<string, Student>()
      for (const s of mapped) {
        const key = `${(s.fullName || '').trim().toLowerCase()}|${(s.parentPhone || '').replace(/\D/g, '')}`
        const prev = byKey.get(key)
        if (!prev) byKey.set(key, s)
        else if (s.active && !prev.active) byKey.set(key, s)
      }
      const list = Array.from(byKey.values()).filter(s => s.active).sort((a, b) => (a.stt || 0) - (b.stt || 0))
      setStudents(list.map((s, i) => ({ ...s, stt: i + 1 })))
    })
    const u2 = watchCollection<Transaction>('scoreTransactions', (items) => { if (items.length) setTransactions(items) })
    const u3 = watchCollection<Group>('groups', (items) => { if (items.length) setGroups(items.sort((a, b) => a.order - b.order)) })
    const u4 = watchCollection<{ weekNumber: number; locked: boolean }>('weeklyLocks', (items) => {
      const map: Record<number, boolean> = {}; items.forEach(i => { map[i.weekNumber] = !!i.locked }); setLockedWeeks(map)
    })
    const u5 = watchCollection<{ action: string; detail: string; by: string; clientAt: string }>('auditLogs', (items) => {
      setAuditLogs([...items].sort((a, b) => (b.clientAt || '').localeCompare(a.clientAt || '')).slice(0, 100))
    })
    return () => { u1(); u2(); u3(); u4(); u5() }
  }, [loggedIn])

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2800) }
  const logAction = (action: string, detail: string) => {
    const entry = { id: uid(), action, detail, by: ROLE_LABELS[role], clientAt: new Date().toISOString() }
    setAuditLogs(prev => [entry, ...prev].slice(0, 100))
    if (isFirebaseConfigured) writeAuditLog({ action, detail, by: ROLE_LABELS[role], role }).catch(console.warn)
  }

  const loadDemo = () => {
    setStudents(SAMPLE_STUDENTS); setGroups(DEFAULT_GROUPS)
    setClassInfo({ schoolName: 'Trường tiểu học Phước Sơn', className: '3A3', homeroomTeacher: 'Đỗ Giang Vũ', schoolYear: '2026 – 2027', week1StartDate: '2026-08-17', totalWeeks: 35, periodsPerDay: 7, slogan: 'Chăm ngoan - Học giỏi' })
    setDemoLoaded(true); setLoggedIn(true); setRole('teacher'); setLinkedStudentId(null)
    if (isFirebaseConfigured) {
      SAMPLE_STUDENTS.forEach(s => upsertDoc('students', s.id, s as unknown as Record<string, unknown>).catch(console.warn))
      DEFAULT_GROUPS.forEach(g => upsertDoc('groups', g.id, g as unknown as Record<string, unknown>).catch(console.warn))
      saveClassInfo({ schoolName: 'Trường tiểu học Phước Sơn', className: '3A3', homeroomTeacher: 'Đỗ Giang Vũ', schoolYear: '2026 – 2027', week1StartDate: '2026-08-17', totalWeeks: 35, periodsPerDay: 7, slogan: 'Chăm ngoan - Học giỏi' }).catch(console.warn)
    }
    showToast('Đã tải dữ liệu mẫu')
  }

  const weekScore = (studentId: string, w: number) =>
    transactions.filter(t => t.studentId === studentId && t.weekNumber === w).reduce((s, t) => s + t.points, 0)
  const groupScore = (groupId: string, w: number) => {
    const ids = students.filter(s => s.groupId === groupId && s.active).map(s => s.id)
    return transactions.filter(t => ids.includes(t.studentId) && t.weekNumber === w).reduce((s, t) => s + t.points, 0)
  }

  const addTransaction = async (studentId: string, ruleId: string, date: string) => {
    const rule = rules.find(r => r.id === ruleId)
    if (!rule) return
    if (!canCreateScore(role, rule.group)) { showToast('Không có quyền ghi nhận'); return }
    if (lockedWeeks[week]) { showToast(`Tuần ${week} đã khóa`); return }
    const student = students.find(s => s.id === studentId)
    const tx: Transaction = { id: uid(), studentId, weekNumber: week, date, ruleId, points: rule.points, note: '', createdBy: ROLE_LABELS[role], createdAt: new Date().toISOString() }
    setTransactions(prev => [...prev, tx])
    setModal(null)
    showToast(`Đã ghi nhận: ${rule.name} (${rule.points > 0 ? '+' : ''}${rule.points})`)
    logAction('ghi_diem', `${student?.fullName}: ${rule.name}`)
    if (isFirebaseConfigured) {
      try { await createScoreTransactionAtomic(tx) }
      catch (e: unknown) {
        const msg = e instanceof Error ? e.message : ''
        if (msg.includes('đã khóa')) {
          setTransactions(prev => prev.filter(t => t.id !== tx.id))
          showToast(msg)
        } else console.warn(msg)
      }
    }
  }

  const toggleWeekLock = async () => {
    if (!canLockWeek(role)) { showToast('Chỉ GVCN'); return }
    const isLocked = !!lockedWeeks[week]
    if (isLocked) {
      const pwd = prompt('MK mở khóa (qlhs1234 hoặc MOKHOA):')
      if (pwd === null) return
      if (pwd !== 'qlhs1234' && pwd.trim().toUpperCase() !== 'MOKHOA') { showToast('Sai MK'); return }
    } else if (!confirm(`Khóa tuần ${week}?`)) return
    const next = !isLocked
    setLockedWeeks(prev => ({ ...prev, [week]: next }))
    if (isFirebaseConfigured) setWeekLocked(week, next, ROLE_LABELS[role]).catch(console.warn)
    showToast(next ? `Đã khóa tuần ${week}` : `Đã mở khóa tuần ${week}`)
  }

  const markAttendance = async (status: 'present' | 'late' | 'excused' | 'absent') => {
    if (!canAttendance(role)) { showToast('Không có quyền'); return }
    if (lockedWeeks[week]) { showToast('Tuần đã khóa'); return }
    const ruleMap: Record<string, string> = { present: 'r1', late: 'r8', excused: 'r6', absent: 'r7' }
    const rule = rules.find(r => r.id === ruleMap[status])
    if (!rule) return
    const batch: Transaction[] = []
    for (const s of students.filter(x => x.active)) {
      if (transactions.some(t => t.studentId === s.id && t.date === attendDate && ['r1','r6','r7','r8'].includes(t.ruleId))) continue
      batch.push({ id: uid(), studentId: s.id, weekNumber: week, date: attendDate, ruleId: rule.id, points: rule.points, note: status, createdBy: ROLE_LABELS[role], createdAt: new Date().toISOString() })
    }
    if (batch.length) setTransactions(prev => [...prev, ...batch])
    showToast(`Điểm danh: ${batch.length} HS`)
    if (isFirebaseConfigured) for (const tx of batch) createScoreTransactionAtomic(tx).catch(console.warn)
  }

  const markOneAttendance = async (studentId: string, status: 'present' | 'late' | 'excused' | 'absent') => {
    if (!canAttendance(role)) { showToast('Không có quyền'); return }
    if (lockedWeeks[week]) { showToast('Tuần đã khóa'); return }
    const ruleMap: Record<string, string> = { present: 'r1', late: 'r8', excused: 'r6', absent: 'r7' }
    const rule = rules.find(r => r.id === ruleMap[status])
    if (!rule) return
    const oldIds = transactions.filter(t => t.studentId === studentId && t.date === attendDate && ['r1','r6','r7','r8'].includes(t.ruleId)).map(t => t.id)
    const student = students.find(s => s.id === studentId)
    const tx: Transaction = { id: uid(), studentId, weekNumber: week, date: attendDate, ruleId: rule.id, points: rule.points, note: status, createdBy: ROLE_LABELS[role], createdAt: new Date().toISOString() }
    setTransactions(prev => [...prev.filter(t => !oldIds.includes(t.id)), tx])
    showToast(`${student?.fullName}: ${rule.name}`)
    if (isFirebaseConfigured) {
      oldIds.forEach(id => removeDoc('scoreTransactions', id).catch(console.warn))
      createScoreTransactionAtomic(tx).catch(console.warn)
    }
  }

  const deleteTransaction = async (txId: string) => {
    if (!canDeleteTx(role)) return
    const tx = transactions.find(t => t.id === txId)
    if (!tx || lockedWeeks[tx.weekNumber]) { showToast('Không xóa được'); return }
    if (!confirm('Xóa giao dịch?')) return
    setTransactions(prev => prev.filter(t => t.id !== txId))
    if (isFirebaseConfigured) removeDoc('scoreTransactions', txId).catch(console.warn)
    showToast('Đã xóa')
  }

  const editTransaction = async (txId: string, newRuleId: string, note: string) => {
    if (!canDeleteTx(role)) return
    const tx = transactions.find(t => t.id === txId)
    if (!tx || lockedWeeks[tx.weekNumber]) { showToast('Không sửa được'); return }
    const rule = rules.find(r => r.id === newRuleId)
    if (!rule) return
    const updated = { ...tx, ruleId: newRuleId, points: rule.points, note: note || tx.note }
    setTransactions(prev => prev.map(t => t.id === txId ? updated : t))
    if (isFirebaseConfigured) upsertDoc('scoreTransactions', txId, { ruleId: newRuleId, points: rule.points, note: updated.note }).catch(console.warn)
    showToast('Đã sửa')
    setModal(null)
  }

  const updateStudent = async (studentId: string, patch: Partial<Student>) => {
    if (!canEditStudents(role)) return
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, ...patch } : s))
    if (isFirebaseConfigured) upsertDoc('students', studentId, { ...patch }).catch(console.warn)
    showToast('Đã cập nhật HS')
    setModal(null)
  }

  const downloadCsvTemplate = () => {
    downloadCSV('mau-import-hoc-sinh.csv', [['STT', 'Họ và tên', 'Giới tính', 'Tổ', 'Chức vụ', 'SĐT PH', 'Ghi chú'], ['1', 'Nguyễn Văn A', 'Nam', 'Tổ 1', '', '0901234567', '']])
    showToast('Đã tải mẫu CSV')
  }

  const importStudentsCSV = (file: File) => {
    if (!canEditStudents(role)) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const rows = parseCSV(String(reader.result || ''))
        if (rows.length < 2) return
        const header = rows[0].map(h => h.toLowerCase())
        const nameIdx = header.findIndex(h => h.includes('tên') || h.includes('name') || h.includes('họ'))
        const phoneIdx = header.findIndex(h => h.includes('sđt') || h.includes('phone') || h.includes('ph'))
        const groupIdx = header.findIndex(h => h.includes('tổ') || h.includes('group'))
        const imported: Student[] = []
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          const fullName = (nameIdx >= 0 ? row[nameIdx] : row[1] || '').trim()
          if (!fullName) continue
          const gRaw = groupIdx >= 0 ? row[groupIdx] : ''
          const g = groups.find(x => x.name === gRaw) || groups[(i - 1) % groups.length]
          const phone = phoneIdx >= 0 ? (row[phoneIdx] || '').trim() : ''
          imported.push({ id: uid(), stt: i, fullName, birthDate: '2017-01-01', gender: 'Nam', groupId: g?.id || 'g1', position: '', parentPhone: phone, parentCode: phone, notes: '', active: true })
        }
        setStudents(prev => {
          const m = [...prev]
          imported.forEach(ns => {
            const key = ns.fullName.toLowerCase()
            if (!m.find(x => x.fullName.toLowerCase() === key && x.active)) m.push(ns)
          })
          return m.map((s, i) => ({ ...s, stt: i + 1 }))
        })
        if (isFirebaseConfigured) imported.forEach(s => upsertDoc('students', s.id, s as unknown as Record<string, unknown>).catch(console.warn))
        showToast(`Import ${imported.length} HS`)
      } catch { showToast('Lỗi CSV') }
    }
    reader.readAsText(file, 'UTF-8')
  }

  const filteredStudents = useMemo(() => {
    let list = students.filter(s => s.active)
    if (role === 'parent' && linkedStudentId) list = list.filter(s => s.id === linkedStudentId)
    return list.filter(s => filterGroup === 'all' || s.groupId === filterGroup)
      .filter(s => !search || s.fullName.toLowerCase().includes(search.toLowerCase()) || String(s.stt).includes(search))
      .sort((a, b) => a.stt - b.stt)
  }, [students, filterGroup, search, role, linkedStudentId])

  const weekDays = classInfo.week1StartDate ? getWeekDates(classInfo.week1StartDate, week) : []

  const handleLogin = async (e?: { preventDefault?: () => void }) => {
    e?.preventDefault?.(); setLoginError('')
    const u = loginUser.trim().toLowerCase(); const p = loginPass
    if (u === 'quanlyhocsinh' && p === 'qlhs1234') {
      if (isFirebaseConfigured) {
        try {
          const email = 'quanlyhocsinh@qlcn.app'
          try { await firebaseLogin(email, p) } catch { await firebaseRegister(email, p); await firebaseLogin(email, p) }
          setSyncStatus('live')
        } catch { setSyncStatus('error') }
      }
      setRole('teacher'); setLinkedStudentId(null); setLoggedIn(true); return
    }
    if (u === 'loptruong' && p === 'bcs1234') { setRole('classPresident'); setLinkedStudentId(null); setLoggedIn(true); return }
    if (u === 'phohoctap' && p === 'bcs1234') { setRole('viceStudy'); setLinkedStudentId(null); setLoggedIn(true); return }
    if (u === 'phokyluat' && p === 'bcs1234') { setRole('viceDiscipline'); setLinkedStudentId(null); setLoggedIn(true); return }
    {
      const pool = (students.length ? students : SAMPLE_STUDENTS).filter(s => s.active)
      const child = pool.find(s =>
        (s.parentPhone && (s.parentPhone.replace(/\s/g, '') === u || s.parentPhone === u)) ||
        (s.parentCode && s.parentCode.toLowerCase() === u)
      )
      if (child) {
        const expectedPass = parentPasswordFromPhone(child.parentPhone)
        if ((expectedPass && p === expectedPass) || (child.parentCode && p === child.parentCode && String(child.parentCode).startsWith('view'))) {
          setRole('parent'); setLinkedStudentId(child.id); setLoggedIn(true)
          if (!students.length) setStudents(SAMPLE_STUDENTS)
          showToast(`PH xem: ${child.fullName}`); return
        }
      }
    }
    if (u === 'phuhuynh' && p === 'view1234') { setRole('parent'); setLinkedStudentId(null); setLoggedIn(true); return }
    if (u === 'demo' && p === 'demo') { setRole('teacher'); loadDemo(); return }
    setLoginError('Sai tài khoản hoặc mật khẩu')
  }

  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg,#ecfdf5,#f0fdfa,#fff)' }}>
        <div className="bg-white rounded-3xl shadow-xl border border-emerald-100 p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white text-2xl font-bold">QL</div>
            <h1 className="text-2xl font-bold text-emerald-900">QUẢN LÝ LỚP CHỦ NHIỆM</h1>
          </div>
          <form onSubmit={handleLogin} className="space-y-3 mb-4">
            <input type="text" value={loginUser} onChange={e => setLoginUser(e.target.value)} placeholder="Tài khoản / SĐT PH" className="w-full border border-emerald-200 rounded-xl px-3 py-2.5 text-sm" />
            <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="Mật khẩu" className="w-full border border-emerald-200 rounded-xl px-3 py-2.5 text-sm" />
            {loginError && <p className="text-sm text-red-600">{loginError}</p>}
            <button type="submit" className="w-full bg-emerald-600 text-white py-3 rounded-xl font-medium">Đăng nhập</button>
          </form>
          <button type="button" onClick={loadDemo} className="w-full bg-teal-600 text-white py-2.5 rounded-xl text-sm font-medium mb-2">Demo + dữ liệu mẫu</button>
          <p className="text-xs text-gray-400 text-center leading-relaxed">
            GVCN: quanlyhocsinh<br />
            PH từng HS: SĐT (vd 0901234567)<br />
            PH cả lớp: phuhuynh
          </p>
        </div>
        {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-emerald-800 text-white px-5 py-2.5 rounded-full text-sm">{toast}</div>}
      </div>
    )
  }

  const visibleMenu = MENU.filter(m => {
    if (role === 'parent' || role === 'viewer') return ['dashboard', 'ranking', 'reports', 'monthly'].includes(m.id)
    if (role === 'viceStudy' || role === 'viceDiscipline') return m.id !== 'settings'
    return true
  })

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg,#ecfdf5,#f0fdfa,#fff)' }}>
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-emerald-100 shadow-sm print:hidden">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2" onClick={() => setSidebarOpen(true)}><Menu className="w-6 h-6 text-emerald-700" /></button>
            <div>
              <h1 className="text-lg font-bold text-emerald-800">{classInfo.className}</h1>
              <p className="text-xs text-emerald-600">{classInfo.schoolName} · {classInfo.homeroomTeacher}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full"><Shield className="w-3 h-3 inline" /> {ROLE_LABELS[role]}</span>
            <button onClick={() => { setLoggedIn(false); setLinkedStudentId(null); localStorage.removeItem(STORAGE_KEY) }} className="p-2 text-red-500"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden lg:flex flex-col w-64 min-h-[calc(100vh-60px)] bg-white border-r border-emerald-100 sticky top-[60px] print:hidden">
          <nav className="p-3 space-y-1">
            {visibleMenu.map(m => (
              <button key={m.id} onClick={() => setPage(m.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${page === m.id ? 'bg-emerald-600 text-white' : 'text-emerald-800 hover:bg-emerald-50'}`}>
                <m.icon className="w-5 h-5" />{m.label}
              </button>
            ))}
          </nav>
        </aside>

        {sidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden print:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
            <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white p-3">
              {visibleMenu.map(m => (
                <button key={m.id} onClick={() => { setPage(m.id); setSidebarOpen(false) }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm mb-1 ${page === m.id ? 'bg-emerald-600 text-white' : 'text-emerald-800'}`}>
                  <m.icon className="w-5 h-5" />{m.label}
                </button>
              ))}
            </aside>
          </div>
        )}

        <main className="flex-1 p-4 md:p-6 overflow-x-hidden">
          {page === 'dashboard' && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-emerald-900">Tổng quan</h2>
              {role === 'parent' && linkedStudentId && (
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 text-sm text-teal-800">
                  Đang xem: <strong>{students.find(s => s.id === linkedStudentId)?.fullName}</strong>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[{ l: 'Sĩ số', v: students.filter(s => s.active).length }, { l: 'Giao dịch', v: transactions.length }, { l: 'Tổ', v: groups.length }, { l: 'Quy định', v: rules.length }].map(c => (
                  <div key={c.l} className="bg-white rounded-2xl p-4 border border-emerald-100"><p className="text-2xl font-bold text-emerald-900">{c.v}</p><p className="text-xs text-emerald-600">{c.l}</p></div>
                ))}
              </div>
            </div>
          )}

          {page === 'attendance' && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-emerald-900">Điểm danh</h2>
              <div className="flex flex-wrap gap-2">
                <input type="date" value={attendDate} onChange={e => setAttendDate(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
                <button disabled={!canAttendance(role)||!!lockedWeeks[week]} onClick={() => void markAttendance('present')} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm disabled:opacity-40">✅ Cả lớp</button>
              </div>
              <div className="bg-white rounded-2xl border overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="bg-emerald-50"><tr><th className="px-3 py-2 text-left">STT</th><th className="px-3 py-2 text-left">Họ tên</th><th className="px-3 py-2 text-center">Từng em</th></tr></thead>
                  <tbody>
                    {filteredStudents.map(s => (
                      <tr key={s.id} className="border-t">
                        <td className="px-3 py-2">{s.stt}</td>
                        <td className="px-3 py-2 font-medium">{s.fullName}</td>
                        <td className="px-3 py-2"><div className="flex gap-1 justify-center">
                          <button type="button" disabled={!canAttendance(role)||!!lockedWeeks[week]} onClick={() => void markOneAttendance(s.id, 'present')} className="text-xs px-2 py-1 rounded bg-emerald-100">✅</button>
                          <button type="button" disabled={!canAttendance(role)||!!lockedWeeks[week]} onClick={() => void markOneAttendance(s.id, 'late')} className="text-xs px-2 py-1 rounded bg-amber-100">⏰</button>
                          <button type="button" disabled={!canAttendance(role)||!!lockedWeeks[week]} onClick={() => void markOneAttendance(s.id, 'excused')} className="text-xs px-2 py-1 rounded bg-blue-100">📝</button>
                          <button type="button" disabled={!canAttendance(role)||!!lockedWeeks[week]} onClick={() => void markOneAttendance(s.id, 'absent')} className="text-xs px-2 py-1 rounded bg-red-100">❌</button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {page === 'weekly' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 items-center justify-between">
                <h2 className="text-2xl font-bold text-emerald-900">Nhập điểm tuần {week}{lockedWeeks[week] ? ' · Đã khóa' : ''}</h2>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setWeek(w => Math.max(1, w - 1))} className="p-2 border rounded-lg"><ChevronLeft className="w-4 h-4" /></button>
                  <select value={week} onChange={e => setWeek(Number(e.target.value))} className="border rounded-lg px-2 py-1 text-sm">{Array.from({ length: classInfo.totalWeeks }, (_, i) => i + 1).map(w => <option key={w} value={w}>Tuần {w}</option>)}</select>
                  <button onClick={() => setWeek(w => Math.min(classInfo.totalWeeks, w + 1))} className="p-2 border rounded-lg"><ChevronRight className="w-4 h-4" /></button>
                  {canLockWeek(role) && <button onClick={() => void toggleWeekLock()} className="px-3 py-2 border rounded-lg text-sm">{lockedWeeks[week] ? 'Mở khóa' : 'Khóa tuần'}</button>}
                </div>
              </div>
              <div className="bg-white rounded-2xl border overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead className="bg-emerald-50"><tr><th className="px-3 py-2 text-left">STT</th><th className="px-3 py-2 text-left">Họ tên</th><th className="px-3 py-2 text-center">Điểm</th><th className="px-3 py-2 text-center">Thao tác</th></tr></thead>
                  <tbody>
                    {filteredStudents.map(s => {
                      const sc = weekScore(s.id, week)
                      return (
                        <tr key={s.id} className="border-t">
                          <td className="px-3 py-2">{s.stt}</td>
                          <td className="px-3 py-2 font-medium">{s.fullName}</td>
                          <td className={`px-3 py-2 text-center font-semibold ${sc < 0 ? 'text-red-600' : ''}`}>{sc}</td>
                          <td className="px-3 py-2 text-center">
                            <button type="button" disabled={!!lockedWeeks[week] || role === 'parent'} onClick={() => setModal({ type: 'score', studentId: s.id })} className="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-lg disabled:opacity-40">Ghi nhận</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="bg-white rounded-2xl border p-4">
                <h3 className="font-semibold text-sm mb-2">Giao dịch tuần {week}</h3>
                <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
                  {transactions.filter(t => t.weekNumber === week).slice().reverse().slice(0, 40).map(t => {
                    const st = students.find(s => s.id === t.studentId)
                    const ru = rules.find(r => r.id === t.ruleId)
                    return (
                      <li key={t.id} className="flex justify-between gap-2 border-b py-1">
                        <span className="truncate">{st?.fullName} · {ru?.name} · <strong>{t.points > 0 ? '+' : ''}{t.points}</strong></span>
                        {canDeleteTx(role) && !lockedWeeks[week] && (
                          <span className="flex gap-2 shrink-0">
                            <button type="button" className="text-xs text-emerald-700" onClick={() => { setEditForm(f => ({ ...f, ruleId: t.ruleId, note: t.note || '' })); setModal({ type: 'editTx', txId: t.id, studentId: t.studentId }) }}>Sửa</button>
                            <button type="button" className="text-xs text-red-600" onClick={() => void deleteTransaction(t.id)}>Xóa</button>
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>
          )}

          {page === 'ranking' && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-emerald-900">Thi đua tổ</h2>
              <div className="bg-white rounded-2xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-emerald-50"><tr><th className="px-4 py-2 text-left">Hạng</th><th className="px-4 py-2 text-left">Tổ</th><th className="px-4 py-2 text-center">Điểm</th></tr></thead>
                  <tbody>
                    {[...groups].sort((a, b) => groupScore(b.id, week) - groupScore(a.id, week)).map((g, i) => (
                      <tr key={g.id} className="border-t"><td className="px-4 py-2">{i + 1}</td><td className="px-4 py-2">{g.name}</td><td className="px-4 py-2 text-center font-bold">{groupScore(g.id, week)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {page === 'conduct' && <div><h2 className="text-2xl font-bold text-emerald-900 mb-4">Vi phạm</h2><div className="grid grid-cols-2 md:grid-cols-3 gap-3">{rules.filter(r => r.points < 0 && (r.group === 'conduct' || r.group === 'attendance')).map(r => <div key={r.id} className="bg-white p-4 rounded-xl border"><div className="text-2xl">{r.icon}</div><p className="text-sm">{r.name}</p><p className="text-xl font-bold text-orange-600">{transactions.filter(t => t.ruleId === r.id).length}</p></div>)}</div></div>}
          {page === 'study' && <div><h2 className="text-2xl font-bold text-emerald-900 mb-4">Học tập</h2><div className="grid grid-cols-2 md:grid-cols-3 gap-3">{rules.filter(r => r.group === 'study').map(r => <div key={r.id} className="bg-white p-4 rounded-xl border"><div className="text-2xl">{r.icon}</div><p className="text-sm">{r.name}</p><p className="text-xl font-bold text-blue-600">{transactions.filter(t => t.ruleId === r.id).length}</p></div>)}</div></div>}

          {page === 'timetable' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 items-center justify-between print:hidden">
                <h2 className="text-2xl font-bold text-emerald-900">Báo bài</h2>
                <div className="flex flex-wrap gap-2 items-center">
                  <select value={week} onChange={e => setWeek(Number(e.target.value))} className="border rounded-lg px-2 py-1 text-sm">{Array.from({ length: classInfo.totalWeeks }, (_, i) => i + 1).map(w => <option key={w} value={w}>Tuần {w}</option>)}</select>
                  <button type="button" onClick={() => window.print()} className="bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm flex items-center gap-1"><Printer className="w-4 h-4" /> In</button>
                </div>
              </div>
              <div className="bg-white rounded-2xl border overflow-x-auto print:hidden">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-emerald-50"><tr><th className="px-2 py-2">Tiết</th>{DAYS.map((d, i) => <th key={d} className="px-2 py-2 text-center">{d}<div className="text-xs font-normal">{weekDays[i] ? formatDate(weekDays[i]) : ''}</div></th>)}</tr></thead>
                  <tbody>
                    {Array.from({ length: classInfo.periodsPerDay }, (_, p) => (
                      <tr key={p} className="border-t">
                        <td className="px-2 py-2">Tiết {p + 1}</td>
                        {DAYS.map((d, i) => (
                          <td key={d} className="px-1 py-1">
                            <input
                              className="w-full border border-dashed rounded px-1 py-2 text-xs text-center"
                              value={lessons[`${week}-${i}-${p}`] || ''}
                              onChange={e => {
                                const k = `${week}-${i}-${p}`
                                const val = e.target.value
                                setLessons(prev => {
                                  const next = { ...prev, [k]: val }
                                  try {
                                    const raw = localStorage.getItem(STORAGE_KEY)
                                    const base = raw ? JSON.parse(raw) : {}
                                    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...base, lessons: next }))
                                  } catch {}
                                  return next
                                })
                                if (isFirebaseConfigured) upsertDoc('assignments', k, { id: k, week, day: i, period: p, content: val }).catch(console.warn)
                              }}
                              disabled={role === 'parent'}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {page === 'students' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 justify-between">
                <h2 className="text-2xl font-bold text-emerald-900">Học sinh / PH</h2>
                {canEditStudents(role) && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => {
                      const name = prompt('Họ và tên học sinh mới:')
                      if (!name?.trim()) return
                      const phone = prompt('SĐT phụ huynh:') || ''
                      const stt = students.filter(s => s.active).length + 1
                      const ns: Student = { id: uid(), stt, fullName: name.trim(), birthDate: '2017-01-01', gender: 'Nam', groupId: groups[0]?.id || 'g1', position: '', parentPhone: phone.trim(), parentCode: phone.trim(), notes: '', active: true }
                      setStudents(prev => [...prev, ns])
                      if (isFirebaseConfigured) upsertDoc('students', ns.id, ns as unknown as Record<string, unknown>).catch(console.warn)
                      showToast('Đã thêm HS')
                    }} className="bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm">+ Thêm HS</button>
                    <button type="button" onClick={downloadCsvTemplate} className="border px-3 py-2 rounded-xl text-sm">Mẫu CSV</button>
                    <button type="button" onClick={() => fileImportRef.current?.click()} className="border px-3 py-2 rounded-xl text-sm">Import</button>
                    <button type="button" onClick={() => {
                      const byKey = new Map<string, Student>()
                      for (const s of students.filter(x => x.active)) {
                        const key = `${s.fullName.trim().toLowerCase()}|${(s.parentPhone || '').replace(/\D/g, '')}`
                        if (!byKey.has(key)) byKey.set(key, s)
                      }
                      const list = Array.from(byKey.values()).map((s, i) => ({ ...s, stt: i + 1 }))
                      const removed = students.filter(s => s.active).length - list.length
                      setStudents(list)
                      showToast(removed > 0 ? `Đã gỡ ${removed} bản trùng` : 'Không có bản trùng')
                    }} className="border px-3 py-2 rounded-xl text-sm text-amber-700">Gỡ trùng</button>
                    <input ref={fileImportRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importStudentsCSV(f) }} />
                  </div>
                )}
              </div>
              <div className="bg-white rounded-2xl border overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead className="bg-emerald-50"><tr><th className="px-3 py-2 text-left">STT</th><th className="px-3 py-2 text-left">Họ tên</th><th className="px-3 py-2 text-left">Tổ</th><th className="px-3 py-2 text-left">SĐT PH</th><th className="px-3 py-2 text-center">Điểm</th><th className="px-3 py-2 text-center">Sửa</th></tr></thead>
                  <tbody>
                    {filteredStudents.map(s => (
                      <tr key={s.id} className="border-t">
                        <td className="px-3 py-2">{s.stt}</td>
                        <td className="px-3 py-2 font-medium">{s.fullName}</td>
                        <td className="px-3 py-2">{groups.find(g => g.id === s.groupId)?.name}</td>
                        <td className="px-3 py-2">{s.parentPhone || '—'}</td>
                        <td className="px-3 py-2 text-center">{weekScore(s.id, week)}</td>
                        <td className="px-3 py-2 text-center">
                          {canEditStudents(role) && <button type="button" className="text-xs text-teal-700 font-medium" onClick={() => { setEditForm({ ruleId: '', note: '', fullName: s.fullName, groupId: s.groupId, parentPhone: s.parentPhone || '', parentCode: s.parentCode || s.parentPhone || '', position: s.position || '' }); setModal({ type: 'editStudent', studentId: s.id }) }}>Sửa</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {page === 'reports' && (
            <div className="space-y-4">
              <div className="flex justify-between print:hidden"><h2 className="text-2xl font-bold text-emerald-900">Báo cáo PH</h2><button type="button" onClick={() => window.print()} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm">In A4</button></div>
              {filteredStudents.map(s => {
                const sc = weekScore(s.id, week)
                const txs = transactions.filter(t => t.studentId === s.id && t.weekNumber === week)
                return (
                  <div key={s.id} className="print-page bg-white border rounded-2xl p-6 mb-4">
                    <h3 className="font-bold text-center">BÁO CÁO – {s.fullName}</h3>
                    <p className="text-sm text-center text-gray-600">Tuần {week} · Tổng {sc}</p>
                    <ul className="text-sm mt-3">{txs.map(t => { const r = rules.find(x => x.id === t.ruleId); return <li key={t.id}>{r?.name}: {t.points}</li> })}</ul>
                  </div>
                )
              })}
            </div>
          )}

          {page === 'monthly' && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-emerald-900">Báo cáo tháng</h2>
              <div className="bg-white rounded-2xl border overflow-x-auto">
                <table className="w-full text-sm min-w-[500px]">
                  <thead className="bg-emerald-50"><tr><th className="px-2 py-2 text-left">Họ tên</th><th className="px-2 py-2 text-center">Tổng 4 tuần</th><th className="px-2 py-2 text-center">XL</th></tr></thead>
                  <tbody>
                    {filteredStudents.map(s => {
                      const total = [0, 1, 2, 3].map(i => weekScore(s.id, Math.max(1, week - i))).reduce((a, b) => a + b, 0)
                      const xl = classifyScore(total, { good: classInfo.gradeGood ?? 80, fair: classInfo.gradeFair ?? 50 })
                      return <tr key={s.id} className="border-t"><td className="px-2 py-2">{s.fullName}</td><td className="px-2 py-2 text-center font-bold">{total}</td><td className="px-2 py-2 text-center"><span className={`text-xs px-2 py-0.5 rounded-full ${xl.bg} ${xl.color}`}>{xl.label}</span></td></tr>
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {page === 'settings' && canEditSettings(role) && (
            <div className="space-y-4 max-w-xl">
              <h2 className="text-2xl font-bold text-emerald-900">Cài đặt</h2>
              <div className="bg-white rounded-2xl border p-5 space-y-3">
                {([['schoolName', 'Trường'], ['className', 'Lớp'], ['homeroomTeacher', 'GVCN'], ['slogan', 'Khẩu hiệu']] as const).map(([k, l]) => (
                  <div key={k}><label className="text-sm">{l}</label><input className="w-full border rounded-lg px-3 py-2 text-sm" value={(classInfo as unknown as Record<string, string>)[k] || ''} onChange={e => setClassInfo(prev => ({ ...prev, [k]: e.target.value }))} /></div>
                ))}
                <button type="button" onClick={async () => { if (isFirebaseConfigured) await saveClassInfo(classInfo as unknown as Record<string, unknown>).catch(console.warn); showToast('Đã lưu') }} className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm">Lưu</button>
              </div>
            </div>
          )}
        </main>
      </div>

      {modal?.type === 'score' && modal.studentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal(null)} />
          <div className="relative bg-white rounded-2xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto">
            <h3 className="font-bold mb-3">Ghi nhận – {students.find(s => s.id === modal.studentId)?.fullName}</h3>
            {rules.filter(r => r.active && canCreateScore(role, r.group)).map(r => (
              <button key={r.id} type="button" disabled={!!lockedWeeks[week]} onClick={() => void addTransaction(modal.studentId!, r.id, weekDays[0] || attendDate || new Date().toISOString().slice(0, 10))} className="w-full flex justify-between px-3 py-2 border rounded-xl mb-1 text-sm hover:bg-emerald-50">
                <span>{r.icon} {r.name}</span><span className={r.points < 0 ? 'text-red-600' : 'text-green-600'}>{r.points > 0 ? '+' : ''}{r.points}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {modal?.type === 'editTx' && modal.txId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal(null)} />
          <div className="relative bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="font-bold mb-3">Sửa giao dịch</h3>
            <select value={editForm.ruleId} onChange={e => setEditForm(f => ({ ...f, ruleId: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm mb-3">
              {rules.filter(r => r.active).map(r => <option key={r.id} value={r.id}>{r.name} ({r.points > 0 ? '+' : ''}{r.points})</option>)}
            </select>
            <input value={editForm.note} onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))} placeholder="Ghi chú" className="w-full border rounded-lg px-3 py-2 text-sm mb-3" />
            <button type="button" onClick={() => void editTransaction(modal.txId!, editForm.ruleId, editForm.note)} className="w-full bg-emerald-600 text-white py-2 rounded-xl">Lưu</button>
          </div>
        </div>
      )}

      {modal?.type === 'editStudent' && modal.studentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal(null)} />
          <div className="relative bg-white rounded-2xl p-6 w-full max-w-md space-y-3">
            <h3 className="font-bold">Sửa học sinh / PH</h3>
            <input value={editForm.fullName} onChange={e => setEditForm(f => ({ ...f, fullName: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Họ tên" />
            <select value={editForm.groupId} onChange={e => setEditForm(f => ({ ...f, groupId: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm">{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            <input value={editForm.parentPhone} onChange={e => setEditForm(f => ({ ...f, parentPhone: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="SĐT PH" />
            <p className="text-xs text-gray-500">PH: SĐT · mật khẩu = view + 4 số cuối (vd …4567 → view4567)</p>
            <button type="button" onClick={() => void updateStudent(modal.studentId!, { fullName: editForm.fullName.trim(), groupId: editForm.groupId, parentPhone: editForm.parentPhone.trim(), parentCode: editForm.parentCode.trim() || editForm.parentPhone.trim(), position: editForm.position })} className="w-full bg-emerald-600 text-white py-2 rounded-xl">Lưu</button>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-emerald-800 text-white px-5 py-2.5 rounded-full text-sm z-50 print:hidden">{toast}</div>}
    </div>
  )
}
