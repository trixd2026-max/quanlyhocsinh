/** Helpers QLCN */
export type Role = 'teacher' | 'classPresident' | 'viceStudy' | 'viceDiscipline' | 'parent' | 'viewer'

export const ROLE_LABELS: Record<Role, string> = {
  teacher: 'GVCN', classPresident: 'Lớp trưởng', viceStudy: 'LP học tập',
  viceDiscipline: 'LP kỷ luật', parent: 'Phụ huynh', viewer: 'Chỉ xem',
}

export function canCreateScore(role: Role, group: string) {
  if (role === 'teacher' || role === 'classPresident') return true
  if (role === 'viceStudy') return group === 'study' || group === 'bonus'
  if (role === 'viceDiscipline') return group === 'conduct' || group === 'attendance'
  return false
}
export function canLockWeek(role: Role) { return role === 'teacher' }
export function canEditStudents(role: Role) { return role === 'teacher' }
export function canEditSettings(role: Role) { return role === 'teacher' }
export function canAttendance(role: Role) {
  return role === 'teacher' || role === 'classPresident' || role === 'viceDiscipline'
}
export function canDeleteTx(role: Role) {
  return role === 'teacher' || role === 'classPresident'
}
export function classifyScore(total: number, thresholds = { good: 80, fair: 50 }) {
  if (total >= thresholds.good) return { label: 'Tốt', color: 'text-green-600', bg: 'bg-green-50' }
  if (total >= thresholds.fair) return { label: 'Khá', color: 'text-blue-600', bg: 'bg-blue-50' }
  return { label: 'TB', color: 'text-amber-600', bg: 'bg-amber-50' }
}
