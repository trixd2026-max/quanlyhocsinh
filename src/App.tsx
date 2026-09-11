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
function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
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
  const [modal, setModal] = useState<{ type: string; studentId?: string } | null>(null)
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
    }
  }, [])

  useEffect(() => {
    if (loggedIn) saveData({ classInfo, students, groups, transactions, lockedWeeks, lessons, auditLogs, role, loggedIn, demoLoaded })
  }, [classInfo, students, groups, transactions, lockedWeeks, lessons, auditLogs, role, loggedIn, demoLoaded])

  useEffect(() => {
    if (!loggedIn || !isFirebaseConfigured) return
    const u1 = watchCollection<Student>('students', (items) => { if (items.length) setStudents(items.map(s => ({ ...s, active: s.active !== false }))) })
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
    if (isFirebaseConfigured) writeAuditLog({ action, detail, by: ROLE_LABELS[role], role }).catch(console.error)
  }

  const loadDemo = () => {
    setStudents(SAMPLE_STUDENTS); setGroups(DEFAULT_GROUPS)
    setClassInfo({ schoolName: 'Trường tiểu học Phước Sơn', className: '3A3', homeroomTeacher: 'Đỗ Giang Vũ', schoolYear: '2026 – 2027', week1StartDate: '2026-08-17', totalWeeks: 35, periodsPerDay: 7, slogan: 'Chăm ngoan - Học giỏi' })
    setDemoLoaded(true); setLoggedIn(true); setRole('teacher')
    if (isFirebaseConfigured) {
      SAMPLE_STUDENTS.forEach(s => upsertDoc('students', s.id, s as unknown as Record<string, unknown>).catch(console.error))
      DEFAULT_GROUPS.forEach(g => upsertDoc('groups', g.id, g as unknown as Record<string, unknown>).catch(console.error))
      saveClassInfo({ schoolName: 'Trường tiểu học Phước Sơn', className: '3A3', homeroomTeacher: 'Đỗ Giang Vũ', schoolYear: '2026 – 2027', week1StartDate: '2026-08-17', totalWeeks: 35, periodsPerDay: 7, slogan: 'Chăm ngoan - Học giỏi' }).catch(console.error)
      showToast('Đã tải dữ liệu mẫu + đồng bộ Firebase')
    } else showToast('Đã tải dữ liệu minh họa')
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
    if (!canCreateScore(role, rule.group)) { showToast('Bạn không có quyền ghi nhận loại sự kiện này'); return }
    if (lockedWeeks[week]) { showToast(`Tuần ${week} đã khóa`); return }
    const student = students.find(s => s.id === studentId)
    const tx: Transaction = { id: uid(), studentId, weekNumber: week, date, ruleId, points: rule.points, note: '', createdBy: ROLE_LABELS[role], createdAt: new Date().toISOString() }
    try {
      if (isFirebaseConfigured) await createScoreTransactionAtomic(tx)
      setTransactions(prev => [...prev, tx])
      logAction('ghi_diem', `${student?.fullName || studentId}: ${rule.name} (${rule.points > 0 ? '+' : ''}${rule.points}) tuần ${week}`)
      showToast(`Đã ghi nhận: ${rule.name} (${rule.points > 0 ? '+' : ''}${rule.points})`)
      setModal(null)
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Lỗi ghi nhận điểm') }
  }

  const toggleWeekLock = async () => {
    if (!canLockWeek(role)) { showToast('Chỉ GVCN được khóa/mở tuần'); return }
    const isLocked = !!lockedWeeks[week]
    if (isLocked) {
      const pwd = prompt('Nhập mật khẩu GVCN để MỞ KHÓA tuần (hoặc gõ MOKHOA):')
      if (pwd === null) return
      if (pwd !== 'qlhs1234' && pwd.trim().toUpperCase() !== 'MOKHOA') {
        showToast('Sai mật khẩu – không mở khóa')
        logAction('mo_khoa_that_bai', `Tuần ${week}`)
        return
      }
    } else {
      if (!confirm(`Khóa tuần ${week}? Sau khi khóa không ghi/sửa/xóa điểm tuần này.`)) return
    }
    const next = !isLocked
    setLockedWeeks(prev => ({ ...prev, [week]: next }))
    if (isFirebaseConfigured) { try { await setWeekLocked(week, next, ROLE_LABELS[role]) } catch { showToast('Lỗi khóa tuần Firebase') } }
    logAction(next ? 'khoa_tuan' : 'mo_khoa_tuan', `Tuần ${week}`)
    showToast(next ? `Đã khóa tuần ${week}` : `Đã mở khóa tuần ${week}`)
  }

  const markAttendance = async (status: 'present' | 'late' | 'excused' | 'absent') => {
    if (!canAttendance(role)) { showToast('Không có quyền điểm danh'); return }
    if (lockedWeeks[week]) { showToast(`Tuần ${week} đã khóa`); return }
    const ruleMap: Record<string, string> = { present: 'r1', late: 'r8', excused: 'r6', absent: 'r7' }
    const ruleId = ruleMap[status]
    const rule = rules.find(r => r.id === ruleId)
    if (!rule) return
    let count = 0
    for (const s of students.filter(x => x.active)) {
      if (transactions.some(t => t.studentId === s.id && t.date === attendDate && ['r1','r6','r7','r8'].includes(t.ruleId))) continue
      const tx: Transaction = { id: uid(), studentId: s.id, weekNumber: week, date: attendDate, ruleId, points: rule.points, note: status, createdBy: ROLE_LABELS[role], createdAt: new Date().toISOString() }
      try { if (isFirebaseConfigured) await createScoreTransactionAtomic(tx); setTransactions(prev => [...prev, tx]); count++ } catch (e) { console.error(e) }
    }
    logAction('diem_danh', `${status} ${attendDate}: ${count} HS`)
    showToast(`Điểm danh ${status}: ${count} học sinh`)
  }

  const markOneAttendance = async (studentId: string, status: 'present' | 'late' | 'excused' | 'absent') => {
    if (!canAttendance(role)) { showToast('Không có quyền điểm danh'); return }
    if (lockedWeeks[week]) { showToast(`Tuần ${week} đã khóa`); return }
    const ruleMap: Record<string, string> = { present: 'r1', late: 'r8', excused: 'r6', absent: 'r7' }
    const ruleId = ruleMap[status]
    const rule = rules.find(r => r.id === ruleId)
    if (!rule) return
    const old = transactions.filter(t => t.studentId === studentId && t.date === attendDate && ['r1','r6','r7','r8'].includes(t.ruleId))
    for (const o of old) {
      setTransactions(prev => prev.filter(t => t.id !== o.id))
      if (isFirebaseConfigured) removeDoc('scoreTransactions', o.id).catch(console.error)
    }
    const student = students.find(s => s.id === studentId)
    const tx: Transaction = { id: uid(), studentId, weekNumber: week, date: attendDate, ruleId, points: rule.points, note: status, createdBy: ROLE_LABELS[role], createdAt: new Date().toISOString() }
    try {
      if (isFirebaseConfigured) await createScoreTransactionAtomic(tx)
      setTransactions(prev => [...prev, tx])
      logAction('diem_danh_tung_em', `${student?.fullName || studentId}: ${rule.name}`)
      showToast(`${student?.fullName}: ${rule.name}`)
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Lỗi điểm danh') }
  }

  const deleteTransaction = async (txId: string) => {
    if (!canDeleteTx(role)) { showToast('Không có quyền xóa'); return }
    const tx = transactions.find(t => t.id === txId)
    if (!tx) return
    if (lockedWeeks[tx.weekNumber]) { showToast('Tuần đã khóa'); return }
    if (!confirm('Xóa giao dịch điểm này?')) return
    const student = students.find(s => s.id === tx.studentId)
    const rule = rules.find(r => r.id === tx.ruleId)
    setTransactions(prev => prev.filter(t => t.id !== txId))
    if (isFirebaseConfigured) { try { await removeDoc('scoreTransactions', txId) } catch (e) { console.error(e) } }
    logAction('xoa_giao_dich', `${student?.fullName}: ${rule?.name} (${tx.points})`)
    showToast('Đã xóa giao dịch')
  }

  const downloadCsvTemplate = () => {
    downloadCSV('mau-import-hoc-sinh.csv', [
      ['STT', 'Họ và tên', 'Giới tính', 'Tổ', 'Chức vụ', 'SĐT PH', 'Ghi chú'],
      ['1', 'Nguyễn Văn A', 'Nam', 'Tổ 1', '', '0901234567', ''],
      ['2', 'Trần Thị B', 'Nữ', 'Tổ 2', 'Lớp trưởng', '0902345678', ''],
    ])
    showToast('Đã tải mẫu CSV')
  }

  const importStudentsCSV = (file: File) => {
    if (!canEditStudents(role)) { showToast('Chỉ GVCN được import'); return }
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const rows = parseCSV(String(reader.result || ''))
        if (rows.length < 2) { showToast('CSV trống'); return }
        const header = rows[0].map(h => h.toLowerCase())
        const nameIdx = header.findIndex(h => h.includes('tên') || h.includes('name') || h.includes('họ'))
        const sttIdx = header.findIndex(h => h.includes('stt'))
        const genderIdx = header.findIndex(h => h.includes('giới') || h.includes('gender'))
        const groupIdx = header.findIndex(h => h.includes('tổ') || h.includes('group'))
        const phoneIdx = header.findIndex(h => h.includes('sđt') || h.includes('phone') || h.includes('ph') || h.includes('liên'))
        const posIdx = header.findIndex(h => h.includes('chức') || h.includes('position'))
        const imported: Student[] = []
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i]
          const fullName = (nameIdx >= 0 ? row[nameIdx] : row[1] || row[0] || '').trim()
          if (!fullName) continue
          const stt = sttIdx >= 0 ? parseInt(row[sttIdx], 10) || i : i
          const gender = (genderIdx >= 0 && String(row[genderIdx] || '').includes('Nữ')) ? 'Nữ' as const : 'Nam' as const
          const gRaw = groupIdx >= 0 ? row[groupIdx] : ''
          const g = groups.find(x => x.name === gRaw || x.id === gRaw) || groups[(stt - 1) % Math.max(groups.length, 1)] || groups[0]
          imported.push({ id: uid(), stt, fullName, birthDate: '2017-01-01', gender, groupId: g?.id || 'g1', position: posIdx >= 0 ? row[posIdx] || '' : '', parentPhone: phoneIdx >= 0 ? (row[phoneIdx] || '').trim() : '', notes: '', active: true })
        }
        if (!imported.length) { showToast('Không đọc được học sinh'); return }
        setStudents(prev => { const merged = [...prev]; imported.forEach(ns => { if (!merged.find(x => x.fullName === ns.fullName && x.active)) merged.push(ns) }); return merged })
        if (isFirebaseConfigured) imported.forEach(s => upsertDoc('students', s.id, s as unknown as Record<string, unknown>).catch(console.error))
        logAction('import_csv', `${imported.length} học sinh`)
        showToast(`Đã import ${imported.length} học sinh`)
      } catch { showToast('Lỗi đọc CSV') }
    }
    reader.readAsText(file, 'UTF-8')
  }

  const filteredStudents = useMemo(() => students.filter(s => s.active).filter(s => filterGroup === 'all' || s.groupId === filterGroup).filter(s => !search || s.fullName.toLowerCase().includes(search.toLowerCase()) || String(s.stt).includes(search)).sort((a, b) => a.stt - b.stt), [students, filterGroup, search])
  const weekDays = classInfo.week1StartDate ? getWeekDates(classInfo.week1StartDate, week) : []

  const handleLogin = async (e?: { preventDefault?: () => void }) => {
    e?.preventDefault?.(); setLoginError('')
    const u = loginUser.trim().toLowerCase(); const p = loginPass
    if (u === 'quanlyhocsinh' && p === 'qlhs1234') {
      if (isFirebaseConfigured) {
        try {
          const email = 'quanlyhocsinh@qlcn.app'
          try { await firebaseLogin(email, p) } catch { await firebaseRegister(email, p); await firebaseLogin(email, p) }
          setSyncStatus('live'); setRole('teacher'); showToast('Đăng nhập Firebase thành công (GVCN)')
        } catch (err) { console.error(err); setSyncStatus('error'); showToast('Firebase lỗi – dùng chế độ local') }
      } else showToast('Đăng nhập thành công (GVCN – local)')
      setRole('teacher'); setLoggedIn(true); return
    }
    if (u === 'loptruong' && p === 'bcs1234') { setRole('classPresident'); setLoggedIn(true); showToast('Đăng nhập Lớp trưởng'); return }
    if (u === 'phohoctap' && p === 'bcs1234') { setRole('viceStudy'); setLoggedIn(true); showToast('Đăng nhập LP học tập'); return }
    if (u === 'phokyluat' && p === 'bcs1234') { setRole('viceDiscipline'); setLoggedIn(true); showToast('Đăng nhập LP kỷ luật'); return }
    if (u === 'phuhuynh' && p === 'view1234') { setRole('parent'); setLoggedIn(true); showToast('Đăng nhập Phụ huynh (chỉ xem)'); return }
    if (u === 'demo' && p === 'demo') { setRole('teacher'); loadDemo(); return }
    if (isFirebaseConfigured && u.includes('@')) {
      try { await firebaseLogin(u, p); setRole('teacher'); setLoggedIn(true); setSyncStatus('live'); showToast('Đăng nhập Firebase thành công'); return }
      catch { setLoginError('Sai email hoặc mật khẩu Firebase'); return }
    }
    setLoginError('Sai tài khoản hoặc mật khẩu')
  }

  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg,#ecfdf5,#f0fdfa,#fff)' }}>
        <div className="bg-white rounded-3xl shadow-xl border border-emerald-100 p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-white text-2xl font-bold">QL</div>
            <h1 className="text-2xl font-bold text-emerald-900">QUẢN LÝ LỚP CHỦ NHIỆM</h1>
            <p className="text-sm text-emerald-600 mt-1">Đăng nhập để tiếp tục</p>
          </div>
          <div className={`border rounded-xl p-3 mb-5 text-sm ${isFirebaseConfigured ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
            {isFirebaseConfigured ? <><strong>Firebase đã cấu hình.</strong> Đăng nhập để đồng bộ realtime.</> : <><strong>Chế độ Demo.</strong> Dữ liệu lưu trên trình duyệt.</>}
          </div>
          <form onSubmit={handleLogin} className="space-y-3 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tài khoản</label>
              <input type="text" autoComplete="username" value={loginUser} onChange={e => setLoginUser(e.target.value)} placeholder="quanlyhocsinh" className="w-full border border-emerald-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu</label>
              <input type="password" autoComplete="current-password" value={loginPass} onChange={e => setLoginPass(e.target.value)} placeholder="••••••••" className="w-full border border-emerald-200 rounded-xl px-3 py-2.5 text-sm" />
            </div>
            {loginError && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{loginError}</p>}
            <button type="submit" className="w-full bg-emerald-600 text-white py-3 rounded-xl font-medium hover:bg-emerald-700">Đăng nhập</button>
          </form>
          <div className="border-t border-gray-100 pt-4 space-y-2">
            <button type="button" onClick={loadDemo} className="w-full bg-teal-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-teal-700">Vào Demo nhanh + dữ liệu mẫu</button>
            <button type="button" onClick={() => { setRole('teacher'); setLoggedIn(true) }} className="w-full border border-emerald-600 text-emerald-700 py-2.5 rounded-xl text-sm font-medium hover:bg-emerald-50">Vào không dữ liệu mẫu</button>
          </div>
          <p className="text-xs text-gray-400 text-center mt-4 leading-relaxed">
            GVCN: quanlyhocsinh / qlhs1234<br />BCS: loptruong · phohoctap · phokyluat / bcs1234<br />PH: phuhuynh / view1234 · Lớp 3A3 – TH Phước Sơn
          </p>
        </div>
        {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-emerald-800 text-white px-5 py-2.5 rounded-full text-sm shadow-lg">{toast}</div>}
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
            <button className="lg:hidden p-2 rounded-lg hover:bg-emerald-50" onClick={() => setSidebarOpen(true)}><Menu className="w-6 h-6 text-emerald-700" /></button>
            <div className="flex items-center gap-2">
              {classInfo.logoUrl ? <img src={classInfo.logoUrl} alt="Logo" className="w-10 h-10 rounded-xl object-cover border border-emerald-100" onError={e => { (e.target as HTMLImageElement).style.display='none' }} /> : null}
              <div>
                <h1 className="text-lg font-bold text-emerald-800 leading-tight">{classInfo.className || 'QUẢN LÝ LỚP CHỦ NHIỆM'}</h1>
                <p className="text-xs text-emerald-600">{classInfo.schoolName ? `${classInfo.schoolName} • ${classInfo.schoolYear} • GVCN: ${classInfo.homeroomTeacher}` : 'Chưa thiết lập lớp'}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-full flex items-center gap-1"><Shield className="w-3 h-3" /> {ROLE_LABELS[role]}</span>
            {classInfo.slogan && <span className="hidden md:inline text-sm italic text-teal-600 max-w-xs truncate">“{classInfo.slogan}”</span>}
            <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${syncStatus === 'live' ? 'bg-emerald-50 text-emerald-700' : syncStatus === 'error' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
              {syncStatus === 'live' ? <><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /><span className="hidden sm:inline">Firebase realtime</span></> : <><WifiOff className="w-3.5 h-3.5" /><span className="hidden sm:inline">{syncStatus === 'error' ? 'Firebase lỗi' : 'Chưa cấu hình Firebase'}</span></>}
            </div>
            <button onClick={() => { setLoggedIn(false); localStorage.removeItem(STORAGE_KEY) }} className="p-2 rounded-lg hover:bg-red-50 text-red-500" title="Đăng xuất"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden lg:flex flex-col w-64 min-h-[calc(100vh-60px)] bg-white border-r border-emerald-100 sticky top-[60px] print:hidden">
          <nav className="flex-1 p-3 space-y-1">
            {visibleMenu.map(m => (
              <button key={m.id} onClick={() => setPage(m.id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${page === m.id ? 'bg-emerald-600 text-white shadow-md' : 'text-emerald-800 hover:bg-emerald-50'}`}>
                <m.icon className="w-5 h-5 shrink-0" />{m.label}
              </button>
            ))}
          </nav>
        </aside>

        {sidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden print:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
            <aside className="absolute left-0 top-0 bottom-0 w-72 bg-white shadow-xl flex flex-col">
              <div className="flex items-center justify-between p-4 border-b"><span className="font-bold text-emerald-800">Menu</span><button onClick={() => setSidebarOpen(false)}><X className="w-6 h-6" /></button></div>
              <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                {visibleMenu.map(m => (
                  <button key={m.id} onClick={() => { setPage(m.id); setSidebarOpen(false) }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${page === m.id ? 'bg-emerald-600 text-white' : 'text-emerald-800 hover:bg-emerald-50'}`}>
                    <m.icon className="w-5 h-5" />{m.label}
                  </button>
                ))}
              </nav>
            </aside>
          </div>
        )}

        <main className="flex-1 p-4 md:p-6 max-w-full overflow-x-hidden">
          {page === 'dashboard' && (
            <div className="space-y-6">
              <div><h2 className="text-2xl font-bold text-emerald-900">Tổng quan tháng</h2><p className="text-emerald-600 text-sm mt-1">Số liệu tính tự động từ giao dịch điểm</p></div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[{ label: 'Sĩ số', value: students.filter(s => s.active).length }, { label: 'Giao dịch điểm', value: transactions.length }, { label: 'Số tổ', value: groups.length }, { label: 'Quy định điểm', value: rules.filter(r => r.active).length }].map(c => (
                  <div key={c.label} className="bg-white rounded-2xl p-5 shadow-sm border border-emerald-100"><p className="text-2xl font-bold text-emerald-900">{c.value}</p><p className="text-xs text-emerald-600">{c.label}</p></div>
                ))}
              </div>
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-amber-200">
                <h3 className="font-semibold text-amber-800 mb-3">HS cần quan tâm (tuần {week})</h3>
                <ul className="space-y-1 text-sm">
                  {filteredStudents.map(s => {
                    const sc = weekScore(s.id, week)
                    const abs = transactions.filter(t => t.studentId === s.id && t.weekNumber === week && (t.ruleId === 'r6' || t.ruleId === 'r7')).length
                    return { s, sc, abs }
                  }).filter(x => x.sc < 0 || x.abs >= 2).sort((a,b)=>a.sc-b.sc).slice(0,8).map(({s,sc,abs})=>(
                    <li key={s.id} className="flex justify-between border-b border-gray-50 py-1.5">
                      <span>{s.stt}. {s.fullName}{abs>=2?` · vắng ${abs}`:''}</span>
                      <span className={sc<0?'text-red-600 font-semibold':'text-amber-600'}>{sc} điểm</span>
                    </li>
                  ))}
                  {filteredStudents.filter(s=>{ const sc=weekScore(s.id,week); const abs=transactions.filter(t=>t.studentId===s.id&&t.weekNumber===week&&(t.ruleId==='r6'||t.ruleId==='r7')).length; return sc<0||abs>=2 }).length===0 && <li className="text-gray-400">Không có HS cần quan tâm</li>}
                </ul>
              </div>
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-emerald-100">
                <h3 className="font-semibold text-emerald-900 mb-4 flex items-center gap-2"><Trophy className="w-5 h-5" /> Xếp hạng tổ (tuần {week})</h3>
                <ul className="space-y-2">
                  {[...groups].sort((a, b) => groupScore(b.id, week) - groupScore(a.id, week)).map((g, i) => (
                    <li key={g.id} className="flex items-center justify-between py-2 border-b border-gray-50">
                      <span className="flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>{g.name}</span>
                      <span className="font-semibold">{groupScore(g.id, week)} điểm</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {page === 'attendance' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div><h2 className="text-2xl font-bold text-emerald-900">Điểm danh nhanh</h2><p className="text-sm text-emerald-600">Cả lớp hoặc từng học sinh</p></div>
                <div className="flex flex-wrap gap-2 items-center">
                  <input type="date" value={attendDate} onChange={e => setAttendDate(e.target.value)} className="border border-emerald-200 rounded-lg px-3 py-2 text-sm bg-white" />
                  <select value={week} onChange={e => setWeek(Number(e.target.value))} className="border border-emerald-200 rounded-lg px-3 py-2 text-sm bg-white">
                    {Array.from({ length: classInfo.totalWeeks }, (_, i) => i + 1).map(w => <option key={w} value={w}>Tuần {w}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button disabled={!canAttendance(role) || !!lockedWeeks[week]} onClick={() => void markAttendance('present')} className="bg-emerald-600 text-white rounded-2xl p-4 font-medium hover:bg-emerald-700 disabled:opacity-40">✅ Có mặt cả lớp</button>
                <button disabled={!canAttendance(role) || !!lockedWeeks[week]} onClick={() => void markAttendance('late')} className="bg-amber-500 text-white rounded-2xl p-4 font-medium disabled:opacity-40">⏰ Đi trễ</button>
                <button disabled={!canAttendance(role) || !!lockedWeeks[week]} onClick={() => void markAttendance('excused')} className="bg-blue-500 text-white rounded-2xl p-4 font-medium disabled:opacity-40">📝 Vắng phép</button>
                <button disabled={!canAttendance(role) || !!lockedWeeks[week]} onClick={() => void markAttendance('absent')} className="bg-red-500 text-white rounded-2xl p-4 font-medium disabled:opacity-40">❌ Vắng KP</button>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-emerald-50"><tr><th className="px-3 py-2 text-left">STT</th><th className="px-3 py-2 text-left">Họ tên</th><th className="px-3 py-2 text-left">SĐT PH</th><th className="px-3 py-2 text-center">Trạng thái</th><th className="px-3 py-2 text-center">Từng em</th></tr></thead>
                  <tbody>
                    {filteredStudents.map(s => {
                      const dayTx = transactions.filter(t => t.studentId === s.id && t.date === attendDate && ['r1','r6','r7','r8'].includes(t.ruleId))
                      const r = dayTx[0] ? rules.find(x => x.id === dayTx[0].ruleId) : null
                      return (
                        <tr key={s.id} className="border-t border-gray-50">
                          <td className="px-3 py-2">{s.stt}</td>
                          <td className="px-3 py-2 font-medium">{s.fullName}</td>
                          <td className="px-3 py-2">{s.parentPhone ? <a href={`tel:${s.parentPhone}`} className="text-emerald-700 flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{s.parentPhone}</a> : '—'}</td>
                          <td className="px-3 py-2 text-center">{r ? `${r.icon} ${r.name}` : <span className="text-gray-400">Chưa</span>}</td>
                          <td className="px-3 py-2"><div className="flex flex-wrap gap-1 justify-center">
                            <button disabled={!canAttendance(role)||!!lockedWeeks[week]} onClick={()=>void markOneAttendance(s.id,'present')} className="text-xs px-1.5 py-1 rounded bg-emerald-100 disabled:opacity-40">✅</button>
                            <button disabled={!canAttendance(role)||!!lockedWeeks[week]} onClick={()=>void markOneAttendance(s.id,'late')} className="text-xs px-1.5 py-1 rounded bg-amber-100 disabled:opacity-40">⏰</button>
                            <button disabled={!canAttendance(role)||!!lockedWeeks[week]} onClick={()=>void markOneAttendance(s.id,'excused')} className="text-xs px-1.5 py-1 rounded bg-blue-100 disabled:opacity-40">📝</button>
                            <button disabled={!canAttendance(role)||!!lockedWeeks[week]} onClick={()=>void markOneAttendance(s.id,'absent')} className="text-xs px-1.5 py-1 rounded bg-red-100 disabled:opacity-40">❌</button>
                          </div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {page === 'weekly' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold text-emerald-900">Nhập điểm tuần</h2>
                  {weekDays.length > 0 && <p className="text-sm text-emerald-600">Tuần {week}: {formatDate(weekDays[0])} – {formatDate(weekDays[5])}{lockedWeeks[week] ? ' • Đã khóa' : ''}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setWeek(w => Math.max(1, w - 1))} className="p-2 rounded-lg border border-emerald-200 hover:bg-emerald-50"><ChevronLeft className="w-4 h-4" /></button>
                  <select value={week} onChange={e => setWeek(Number(e.target.value))} className="border border-emerald-200 rounded-lg px-3 py-2 text-sm bg-white">{Array.from({ length: classInfo.totalWeeks }, (_, i) => i + 1).map(w => <option key={w} value={w}>Tuần {w}</option>)}</select>
                  <button onClick={() => setWeek(w => Math.min(classInfo.totalWeeks, w + 1))} className="p-2 rounded-lg border border-emerald-200 hover:bg-emerald-50"><ChevronRight className="w-4 h-4" /></button>
                  {canLockWeek(role) && (
                    <button onClick={() => void toggleWeekLock()} className={`px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-1 ${lockedWeeks[week] ? 'bg-red-50 border-red-300 text-red-700' : 'border-emerald-200 text-emerald-700'}`}>
                      {lockedWeeks[week] ? <><Unlock className="w-3.5 h-3.5" /> Mở khóa</> : <><Lock className="w-3.5 h-3.5" /> Khóa tuần</>}
                    </button>
                  )}
                  <select value={filterGroup} onChange={e => setFilterGroup(e.target.value)} className="border border-emerald-200 rounded-lg px-3 py-2 text-sm bg-white"><option value="all">Tất cả tổ</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
                  <input type="text" placeholder="Tìm..." value={search} onChange={e => setSearch(e.target.value)} className="border border-emerald-200 rounded-lg px-3 py-2 text-sm bg-white w-36" />
                </div>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead className="bg-emerald-50"><tr><th className="px-3 py-3 text-left font-semibold text-emerald-800">STT</th><th className="px-3 py-3 text-left font-semibold text-emerald-800">Họ và tên</th><th className="px-3 py-3 text-left font-semibold text-emerald-800">Tổ</th><th className="px-3 py-3 text-center font-semibold text-emerald-800">Tổng tuần</th><th className="px-3 py-3 text-center font-semibold text-emerald-800">Thao tác</th></tr></thead>
                  <tbody>
                    {filteredStudents.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">Chưa có học sinh</td></tr> : filteredStudents.map(s => {
                      const sc = weekScore(s.id, week)
                      const gName = groups.find(g => g.id === s.groupId)?.name || '—'
                      return (
                        <tr key={s.id} className="border-t border-gray-50 hover:bg-emerald-50/50">
                          <td className="px-3 py-2.5">{s.stt}</td>
                          <td className="px-3 py-2.5 font-medium">{s.fullName}</td>
                          <td className="px-3 py-2.5">{gName}</td>
                          <td className={`px-3 py-2.5 text-center font-semibold ${sc > 0 ? 'text-green-600' : sc < 0 ? 'text-red-500' : ''}`}>{sc}</td>
                          <td className="px-3 py-2.5 text-center">
                            <button disabled={!!lockedWeeks[week] || role === 'parent' || role === 'viewer'} onClick={() => setModal({ type: 'score', studentId: s.id })} className="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-40">Ghi nhận</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 p-4">
                <h3 className="font-semibold text-emerald-900 mb-2 text-sm">Giao dịch tuần {week} (xóa nếu ghi nhầm)</h3>
                <ul className="space-y-1 max-h-48 overflow-y-auto text-sm">
                  {transactions.filter(t => t.weekNumber === week).slice().reverse().slice(0, 40).map(t => {
                    const st = students.find(s => s.id === t.studentId)
                    const ru = rules.find(r => r.id === t.ruleId)
                    return (
                      <li key={t.id} className="flex items-center justify-between gap-2 border-b border-gray-50 py-1.5">
                        <span className="truncate">{st?.fullName} · {ru?.name} · <strong className={t.points<0?'text-red-600':'text-green-600'}>{t.points>0?'+':''}{t.points}</strong></span>
                        {canDeleteTx(role) && !lockedWeeks[week] && <button onClick={() => void deleteTransaction(t.id)} className="text-xs text-red-600 hover:underline shrink-0">Xóa</button>}
                      </li>
                    )
                  })}
                  {transactions.filter(t => t.weekNumber === week).length === 0 && <li className="text-gray-400">Chưa có giao dịch</li>}
                </ul>
              </div>
            </div>
          )}

          {page === 'ranking' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold text-emerald-900">Thi đua theo tổ</h2>
              <select value={week} onChange={e => setWeek(Number(e.target.value))} className="border border-emerald-200 rounded-lg px-3 py-2 text-sm bg-white mb-4">{Array.from({ length: classInfo.totalWeeks }, (_, i) => i + 1).map(w => <option key={w} value={w}>Tuần {w}</option>)}</select>
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-emerald-50"><tr><th className="px-4 py-3 text-left">Hạng</th><th className="px-4 py-3 text-left">Tổ</th><th className="px-4 py-3 text-center">Sĩ số</th><th className="px-4 py-3 text-center">Tổng điểm</th></tr></thead>
                  <tbody>
                    {[...groups].sort((a, b) => groupScore(b.id, week) - groupScore(a.id, week)).map((g, i) => (
                      <tr key={g.id} className="border-t border-gray-50">
                        <td className="px-4 py-3 font-bold text-emerald-700">{i + 1}</td>
                        <td className="px-4 py-3 font-medium">{g.name}</td>
                        <td className="px-4 py-3 text-center">{students.filter(s => s.groupId === g.id && s.active).length}</td>
                        <td className="px-4 py-3 text-center font-bold">{groupScore(g.id, week)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {page === 'conduct' && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-emerald-900">Vi phạm rèn luyện</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {rules.filter(r => r.points < 0 && (r.group === 'conduct' || r.group === 'attendance') && r.active).map(r => (
                  <div key={r.id} className="bg-white rounded-xl p-4 border border-orange-100 shadow-sm"><div className="text-2xl mb-1">{r.icon}</div><p className="font-medium text-sm">{r.name}</p><p className="text-2xl font-bold text-orange-600">{transactions.filter(t => t.ruleId === r.id).length}</p></div>
                ))}
              </div>
            </div>
          )}

          {page === 'study' && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-emerald-900">Theo dõi học tập</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {rules.filter(r => r.group === 'study' && r.active).map(r => (
                  <div key={r.id} className="bg-white rounded-xl p-4 border border-blue-100 shadow-sm"><div className="text-2xl mb-1">{r.icon}</div><p className="font-medium text-sm">{r.name}</p><p className="text-2xl font-bold text-blue-600">{transactions.filter(t => t.ruleId === r.id).length}</p></div>
                ))}
              </div>
            </div>
          )}

          {page === 'timetable' && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-emerald-900">Báo bài & Thời khóa biểu</h2>
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-emerald-50">
                    <tr>
                      <th className="px-3 py-3 text-left font-semibold text-emerald-800">Tiết</th>
                      {DAYS.map((d, i) => (<th key={d} className="px-3 py-3 text-center font-semibold text-emerald-800"><div>{d}</div>{weekDays[i] && <div className="text-xs font-normal text-emerald-500">{formatDate(weekDays[i])}</div>}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: classInfo.periodsPerDay }, (_, p) => (
                      <tr key={p} className="border-t border-gray-50">
                        <td className="px-3 py-3 font-medium text-emerald-700">Tiết {p + 1}</td>
                        {DAYS.map((d, i) => (
                          <td key={d} className="px-3 py-3 text-center">
                            <input className="w-full min-h-[40px] border border-dashed border-gray-200 rounded-lg px-1 text-xs text-center bg-white" placeholder="Môn / bài" value={lessons[`${week}-${i}-${p}`] || ''} onChange={e => { const key = `${week}-${i}-${p}`; const val = e.target.value; setLessons(prev => ({ ...prev, [key]: val })); if (isFirebaseConfigured) upsertDoc('assignments', key, { week, day: i, period: p, content: val }).catch(console.error) }} disabled={role === 'parent' || role === 'viewer'} />
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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div><h2 className="text-2xl font-bold text-emerald-900">Học sinh / Liên hệ PH</h2></div>
                <div className="flex flex-wrap gap-2">
                  {canEditStudents(role) && (<>
                    <button onClick={downloadCsvTemplate} className="border border-teal-600 text-teal-700 px-3 py-2 rounded-xl text-sm font-medium">Mẫu CSV</button>
                    <button onClick={() => fileImportRef.current?.click()} className="border border-teal-600 text-teal-700 px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1"><Upload className="w-4 h-4" /> Import CSV</button>
                    <input ref={fileImportRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importStudentsCSV(f); e.target.value = '' }} />
                  </>)}
                  <button onClick={() => { const rows = [['STT', 'Họ tên', 'Giới tính', 'Tổ', 'Chức vụ', 'SĐT PH', `Điểm tuần ${week}`]]; filteredStudents.forEach(s => { const gName = groups.find(g => g.id === s.groupId)?.name || ''; rows.push([String(s.stt), s.fullName, s.gender, gName, s.position || '', s.parentPhone || '', String(weekScore(s.id, week))]) }); downloadCSV(`danh-sach-hs-tuan-${week}.csv`, rows); showToast('Đã xuất CSV') }} className="border border-emerald-600 text-emerald-700 px-3 py-2 rounded-xl text-sm font-medium">Xuất CSV</button>
                  {canEditStudents(role) && <button onClick={() => { const name = prompt('Họ và tên học sinh mới:'); if (!name) return; const stt = students.length ? Math.max(...students.map(s => s.stt), 0) + 1 : 1; const ns: Student = { id: uid(), stt, fullName: name, birthDate: '2017-01-01', gender: 'Nam', groupId: groups[0]?.id || 'g1', position: '', parentPhone: '', notes: '', active: true }; setStudents(prev => [...prev, ns]); if (isFirebaseConfigured) upsertDoc('students', ns.id, ns as unknown as Record<string, unknown>).catch(console.error); showToast('Đã thêm') }} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium"><Plus className="w-4 h-4" /> Thêm</button>}
                </div>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-x-auto">
                <table className="w-full text-sm min-w-[800px]">
                  <thead className="bg-emerald-50"><tr><th className="px-3 py-3 text-left font-semibold text-emerald-800">STT</th><th className="px-3 py-3 text-left font-semibold text-emerald-800">Họ và tên</th><th className="px-3 py-3 text-left font-semibold text-emerald-800">Tổ</th><th className="px-3 py-3 text-left font-semibold text-emerald-800">Chức vụ</th><th className="px-3 py-3 text-left font-semibold text-emerald-800">SĐT PH</th><th className="px-3 py-3 text-center font-semibold text-emerald-800">Điểm tuần {week}</th><th className="px-3 py-3 text-center font-semibold text-emerald-800">Thao tác</th></tr></thead>
                  <tbody>
                    {filteredStudents.map(s => {
                      const gName = groups.find(g => g.id === s.groupId)?.name || '—'
                      const sc = weekScore(s.id, week)
                      return (
                        <tr key={s.id} className="border-t border-gray-50">
                          <td className="px-3 py-2.5">{s.stt}</td>
                          <td className="px-3 py-2.5 font-medium">{s.fullName}</td>
                          <td className="px-3 py-2.5">{gName}</td>
                          <td className="px-3 py-2.5">{s.position || '—'}</td>
                          <td className="px-3 py-2.5">{s.parentPhone ? <a href={`tel:${s.parentPhone}`} className="text-emerald-700 text-xs flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{s.parentPhone}</a> : '—'}</td>
                          <td className={`px-3 py-2.5 text-center font-semibold ${sc > 0 ? 'text-green-600' : sc < 0 ? 'text-red-500' : ''}`}>{sc}</td>
                          <td className="px-3 py-2.5 text-center">
                            {role !== 'parent' && role !== 'viewer' && <button onClick={() => setModal({ type: 'score', studentId: s.id })} className="p-1.5 rounded-lg hover:bg-emerald-100 text-emerald-600"><Pencil className="w-4 h-4" /></button>}
                            {canEditStudents(role) && <button onClick={() => { if (!confirm(`Xóa ${s.fullName}?`)) return; setStudents(prev => prev.map(x => x.id === s.id ? { ...x, active: false } : x)); if (isFirebaseConfigured) upsertDoc('students', s.id, { active: false }).catch(console.error) }} className="p-1.5 rounded-lg hover:bg-red-100 text-red-500"><Trash2 className="w-4 h-4" /></button>}
                          </td>
                        </tr>
                      )
                    })}
                    {filteredStudents.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Chưa có học sinh</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {page === 'reports' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
                <div><h2 className="text-2xl font-bold text-emerald-900">Báo cáo phụ huynh · In A4</h2></div>
                <div className="flex gap-2">
                  <select value={week} onChange={e => setWeek(Number(e.target.value))} className="border border-emerald-200 rounded-lg px-3 py-2 text-sm bg-white">{Array.from({ length: classInfo.totalWeeks }, (_, i) => i + 1).map(w => <option key={w} value={w}>Tuần {w}</option>)}</select>
                  <button onClick={() => window.print()} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium"><Printer className="w-4 h-4" /> In A4</button>
                </div>
              </div>
              <div className="print-area">
                {filteredStudents.map(s => {
                  const sc = weekScore(s.id, week)
                  const txs = transactions.filter(t => t.studentId === s.id && t.weekNumber === week)
                  const gName = groups.find(g => g.id === s.groupId)?.name || '—'
                  return (
                    <div key={s.id} className="print-page bg-white border border-emerald-100 rounded-2xl p-6 mb-4 shadow-sm">
                      <div className="text-center border-b border-emerald-100 pb-3 mb-4">
                        <p className="text-xs text-emerald-600">{classInfo.schoolName}</p>
                        <h3 className="text-lg font-bold text-emerald-900">BÁO CÁO RÈN LUYỆN CÁ NHÂN</h3>
                        <p className="text-sm text-gray-600">Lớp {classInfo.className} · {classInfo.schoolYear} · Tuần {week}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                        <p><span className="text-gray-500">Họ tên:</span> <strong>{s.fullName}</strong></p>
                        <p><span className="text-gray-500">STT:</span> {s.stt}</p>
                        <p><span className="text-gray-500">Tổ:</span> {gName}</p>
                        <p><span className="text-gray-500">Tổng điểm tuần:</span> <strong>{sc}</strong></p>
                      </div>
                      <table className="w-full text-sm border border-gray-200">
                        <thead className="bg-gray-50"><tr><th className="border px-2 py-1 text-left">Ngày</th><th className="border px-2 py-1 text-left">Sự kiện</th><th className="border px-2 py-1 text-center">Điểm</th></tr></thead>
                        <tbody>
                          {txs.length === 0 ? <tr><td colSpan={3} className="border px-2 py-3 text-center text-gray-400">Không có sự kiện</td></tr> : txs.map(t => { const r = rules.find(x => x.id === t.ruleId); return (<tr key={t.id}><td className="border px-2 py-1">{formatDate(t.date)}</td><td className="border px-2 py-1">{r?.name || t.ruleId}</td><td className="border px-2 py-1 text-center font-semibold">{t.points}</td></tr>) })}
                        </tbody>
                      </table>
                      <p className="text-xs text-gray-400 mt-3 text-right">GVCN: {classInfo.homeroomTeacher}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {page === 'monthly' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
                <div><h2 className="text-2xl font-bold text-emerald-900">Báo cáo tháng</h2><p className="text-sm text-emerald-600">Tổng 4 tuần · xếp loại Tốt/Khá/TB</p></div>
                <button onClick={() => window.print()} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium"><Printer className="w-4 h-4" /> In</button>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead className="bg-emerald-50"><tr><th className="px-3 py-2 text-left">STT</th><th className="px-3 py-2 text-left">Họ tên</th><th className="px-3 py-2 text-left">Tổ</th><th className="px-3 py-2 text-center">T{Math.max(1, week - 3)}</th><th className="px-3 py-2 text-center">T{Math.max(1, week - 2)}</th><th className="px-3 py-2 text-center">T{Math.max(1, week - 1)}</th><th className="px-3 py-2 text-center">T{week}</th><th className="px-3 py-2 text-center">Tổng</th><th className="px-3 py-2 text-center">XL</th></tr></thead>
                  <tbody>
                    {filteredStudents.map(s => {
                      const weeks = [Math.max(1, week - 3), Math.max(1, week - 2), Math.max(1, week - 1), week]
                      const scores = weeks.map(w => weekScore(s.id, w))
                      const total = scores.reduce((a, b) => a + b, 0)
                      const gName = groups.find(g => g.id === s.groupId)?.name || '—'
                      const xl = classifyScore(total, { good: classInfo.gradeGood ?? 80, fair: classInfo.gradeFair ?? 50 })
                      return (
                        <tr key={s.id} className="border-t border-gray-50">
                          <td className="px-3 py-2">{s.stt}</td><td className="px-3 py-2 font-medium">{s.fullName}</td><td className="px-3 py-2">{gName}</td>
                          {scores.map((sc, i) => <td key={i} className={`px-3 py-2 text-center ${sc < 0 ? 'text-red-600' : sc > 0 ? 'text-green-600' : ''}`}>{sc}</td>)}
                          <td className={`px-3 py-2 text-center font-bold ${total < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{total}</td>
                          <td className="px-3 py-2 text-center"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${xl.bg} ${xl.color}`}>{xl.label}</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {page === 'settings' && canEditSettings(role) && (
            <div className="space-y-6 max-w-3xl">
              <h2 className="text-2xl font-bold text-emerald-900">Cài đặt lớp</h2>
              <div className={`border rounded-2xl p-5 ${isFirebaseConfigured ? 'bg-emerald-50 border-emerald-300' : 'bg-amber-50 border-amber-300'}`}>
                {isFirebaseConfigured ? <p className="font-semibold text-emerald-800">Firebase đã cấu hình · quanlyhocsinh-48840</p> : <p className="font-semibold text-amber-800">Chưa kết nối Firebase</p>}
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 p-6 space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  {([['schoolName', 'Tên trường *'], ['className', 'Tên lớp *'], ['homeroomTeacher', 'GVCN *'], ['schoolYear', 'Năm học'], ['week1StartDate', 'Ngày bắt đầu tuần 1'], ['slogan', 'Khẩu hiệu'], ['logoUrl', 'URL logo lớp']] as const).map(([key, label]) => (
                    <div key={key}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                      <input type={key === 'week1StartDate' ? 'date' : 'text'} value={(classInfo as unknown as Record<string, string>)[key] || ''} onChange={e => setClassInfo(prev => ({ ...prev, [key]: e.target.value }))} className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm" />
                    </div>
                  ))}
                </div>
                <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Ngưỡng XL Tốt (≥)</label>
                    <input type="number" value={classInfo.gradeGood ?? 80} onChange={e => setClassInfo(prev => ({ ...prev, gradeGood: Number(e.target.value) || 80 }))} className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Ngưỡng XL Khá (≥)</label>
                    <input type="number" value={classInfo.gradeFair ?? 50} onChange={e => setClassInfo(prev => ({ ...prev, gradeFair: Number(e.target.value) || 50 }))} className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm" /></div>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-sm">
                  <p className="font-medium text-emerald-900 mb-1">Link chỉ xem PH</p>
                  <p className="text-emerald-700 break-all text-xs">{typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}?view=parent` : '?view=parent'}</p>
                  <p className="text-xs text-gray-500 mt-1">PH: phuhuynh / view1234</p>
                </div>
                <button onClick={async () => { if (isFirebaseConfigured) { try { await saveClassInfo(classInfo as unknown as Record<string, unknown>); showToast('Đã lưu lên Firebase') } catch { showToast('Lưu local – Firebase lỗi') } } else showToast('Đã lưu local') }} className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium"><Save className="w-4 h-4" /> Lưu cài đặt</button>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 p-6 flex flex-wrap gap-3">
                <button onClick={() => { downloadJSON(`backup-qlcn-${classInfo.className}.json`, { version: 2, exportedAt: new Date().toISOString(), classInfo, students, groups, transactions, lockedWeeks, lessons }); showToast('Đã tải backup JSON') }} className="border border-teal-600 text-teal-700 px-4 py-2 rounded-xl text-sm font-medium">Backup JSON</button>
                <button onClick={downloadCsvTemplate} className="border border-teal-600 text-teal-700 px-4 py-2 rounded-xl text-sm font-medium">Mẫu CSV import</button>
                <button onClick={() => { const rows = [['ID','Học sinh','Tuần','Ngày','Sự kiện','Điểm','Người nhập']]; transactions.forEach(t => { const s = students.find(x => x.id === t.studentId); const r = rules.find(x => x.id === t.ruleId); rows.push([t.id, s?.fullName || '', String(t.weekNumber), t.date, r?.name || '', String(t.points), t.createdBy]) }); downloadCSV('giao-dich-diem.csv', rows); showToast('Đã xuất CSV điểm') }} className="border border-emerald-600 text-emerald-700 px-4 py-2 rounded-xl text-sm font-medium">Xuất điểm CSV</button>
                {!demoLoaded && <button onClick={loadDemo} className="bg-teal-600 text-white px-4 py-2 rounded-xl text-sm font-medium">Tải dữ liệu minh họa</button>}
                {demoLoaded && <button onClick={() => { if (confirm('Xóa dữ liệu minh họa?')) { setStudents([]); setTransactions([]); setDemoLoaded(false); showToast('Đã xóa') } }} className="bg-red-500 text-white px-4 py-2 rounded-xl text-sm font-medium">Xóa dữ liệu minh họa</button>}
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-emerald-100 p-6">
                <h3 className="font-semibold text-emerald-900 mb-3 flex items-center gap-2"><FileText className="w-4 h-4" /> Nhật ký thao tác</h3>
                <ul className="space-y-1 max-h-64 overflow-y-auto text-sm">
                  {auditLogs.length === 0 && <li className="text-gray-400">Chưa có nhật ký</li>}
                  {auditLogs.slice(0, 30).map(a => (
                    <li key={a.id} className="flex justify-between gap-2 border-b border-gray-50 py-1.5">
                      <span><strong>{a.action}</strong> — {a.detail}</span>
                      <span className="text-xs text-gray-400 whitespace-nowrap">{a.by} · {(a.clientAt || '').slice(0, 16).replace('T', ' ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </main>
      </div>

      {modal?.type === 'score' && modal.studentId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[80vh] overflow-y-auto p-6">
            <h3 className="text-lg font-bold text-emerald-900 mb-1">Ghi nhận sự kiện</h3>
            <p className="text-sm text-gray-500 mb-4">{students.find(s => s.id === modal.studentId)?.fullName} • Tuần {week}{lockedWeeks[week] ? ' • Đã khóa' : ''}</p>
            <div className="space-y-2">
              {rules.filter(r => r.active && canCreateScore(role, r.group)).map(r => (
                <button key={r.id} disabled={!!lockedWeeks[week]} onClick={() => { const date = weekDays[0] || new Date().toISOString().slice(0, 10); void addTransaction(modal.studentId!, r.id, date) }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-gray-100 hover:bg-emerald-50 text-left disabled:opacity-50">
                  <span className="text-xl">{r.icon}</span>
                  <span className="flex-1 text-sm font-medium">{r.name}</span>
                  <span className={`text-sm font-bold ${r.points > 0 ? 'text-green-600' : 'text-red-500'}`}>{r.points > 0 ? '+' : ''}{r.points}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setModal(null)} className="mt-4 w-full py-2 text-sm text-gray-500">Đóng</button>
          </div>
        </div>
      )}

      {toast && <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-emerald-800 text-white px-5 py-2.5 rounded-full text-sm shadow-lg z-50 print:hidden">{toast}</div>}
    </div>
  )
}
