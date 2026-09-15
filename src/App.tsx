import { useState, useEffect, useMemo, useRef } from 'react'
import {
  LayoutDashboard, ClipboardList, Trophy, AlertTriangle, BookOpen,
  Calendar, Users, Settings, Menu, X, LogOut, WifiOff,
  Plus, Save, Trash2, Pencil, ChevronLeft, ChevronRight,
  Download, Upload, Printer, Shield, UserCheck, Lock, Unlock, Phone, FileText
} from 'lucide-react'
import {
  isFirebaseConfigured, firebaseLogin, firebaseLogout, loadUserAccess,
  saveClassInfo, watchCollection, watchCollectionWhere, watchDocument, upsertDoc,
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
function canEditAssignments(role: Role) {
  return role === 'teacher' || role === 'classPresident' || role === 'viceStudy' || role === 'viceDiscipline'
}
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
const LOGIN_EMAILS: Record<string, string> = {
  quanlyhocsinh: 'quanlyhocsinh@qlcn.app',
  loptruong: 'loptruong@qlcn.app',
  phohoctap: 'phohoctap@qlcn.app',
  phokyluat: 'phokyluat@qlcn.app',
}
function loginEmailFromUsername(username: string): string {
  const normalized = username.trim().toLowerCase()
  if (normalized.includes('@')) return normalized
  if (LOGIN_EMAILS[normalized]) return LOGIN_EMAILS[normalized]
  const phone = normalized.replace(/\D/g, '')
  if (phone.length >= 8) return `parent.${phone}@qlcn.app`
  return `${normalized.replace(/[^a-z0-9._-]/g, '')}@qlcn.app`
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
  ruleId: string; category: string; points: number; note: string; createdBy: string; createdAt: string
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
  const csv = rows.map(r => r.map(c => `\"${String(c).replace(/\"/g, '\"\"')}\"`).join(',')).join('\n')
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
      if (ch === '\"') {
        if (inQ && line[i + 1] === '\"') { cur += '\"'; i++ }
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
  const [cloudSync, setCloudSync] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'off' | 'live' | 'error'>('off')
  const fileImportRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      if (q.get('view') === 'parent') setLoginUser('')
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
      if (d.demoLoaded) {
        setDemoLoaded(true)
        setRole('teacher')
        setLoggedIn(true)
      }
    }
  }, [])

  useEffect(() => {
    if (loggedIn && demoLoaded && !cloudSync) {
      saveData({ classInfo, students, groups, transactions, lockedWeeks, lessons, auditLogs, demoLoaded })
    }
  }, [classInfo, students, groups, transactions, lockedWeeks, lessons, auditLogs, loggedIn, demoLoaded, cloudSync])

  // NOTE: This is a truncated restore - full file will be fixed properly
  return null
}
