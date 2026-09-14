import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  setPersistence, browserSessionPersistence, type Auth, type User,
} from 'firebase/auth'
import {
  getFirestore, doc, getDoc, setDoc, collection, onSnapshot,
  query, where, addDoc, deleteDoc, serverTimestamp, runTransaction,
  type Firestore, type Unsubscribe,
} from 'firebase/firestore'

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

export const isFirebaseConfigured = Boolean(
  cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId &&
  cfg.apiKey !== 'YOUR_API_KEY' && String(cfg.apiKey).length > 10
)

if (typeof window !== 'undefined') {
  console.info('[QLCN Firebase]', { configured: isFirebaseConfigured, projectId: cfg.projectId })
}

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null

if (isFirebaseConfigured) {
  app = initializeApp(cfg)
  auth = getAuth(app)
  db = getFirestore(app)
}

export { app, auth, db }
export const CLASS_ID = 'main'

export function isFirebaseAuthed(): boolean {
  return Boolean(auth?.currentUser)
}

export async function firebaseLogin(email: string, password: string): Promise<User> {
  if (!auth) throw new Error('Firebase chưa cấu hình')
  await setPersistence(auth, browserSessionPersistence)
  return (await signInWithEmailAndPassword(auth, email, password)).user
}

export async function firebaseLogout(): Promise<void> {
  if (auth) await signOut(auth)
}

export function watchAuth(cb: (user: User | null) => void): Unsubscribe {
  if (!auth) { cb(null); return () => {} }
  return onAuthStateChanged(auth, cb)
}

export async function saveClassInfo(data: Record<string, unknown>): Promise<void> {
  if (!db) return
  await setDoc(doc(db, 'classes', CLASS_ID), { ...data, updatedAt: serverTimestamp() }, { merge: true })
}

export async function loadClassInfo(): Promise<Record<string, unknown> | null> {
  if (!db) return null
  const snap = await getDoc(doc(db, 'classes', CLASS_ID))
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null
}

export interface UserAccess {
  role: 'teacher' | 'classPresident' | 'viceStudy' | 'viceDiscipline' | 'parent' | 'viewer'
  studentId?: string
  active?: boolean
  displayName?: string
}

export async function loadUserAccess(user: User): Promise<UserAccess> {
  if (user.email?.toLowerCase() === 'quanlyhocsinh@qlcn.app') {
    return { role: 'teacher', active: true, displayName: 'GVCN' }
  }
  if (!db) throw new Error('Firebase chưa cấu hình')
  const snap = await getDoc(doc(db, 'users', user.uid))
  if (!snap.exists()) throw new Error('Tài khoản chưa được cấp quyền')
  const profile = snap.data() as UserAccess
  if (profile.active === false) throw new Error('Tài khoản đã bị khóa')
  if (!profile.role) throw new Error('Hồ sơ tài khoản thiếu vai trò')
  if (profile.role === 'parent' && !profile.studentId) {
    throw new Error('Tài khoản phụ huynh chưa liên kết học sinh')
  }
  return profile
}

export function watchCollection<T>(
  col: string,
  cb: (items: (T & { id: string })[]) => void,
): Unsubscribe {
  if (!db) { cb([]); return () => {} }
  const q = query(collection(db, col))
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as T) }))
      cb(items)
    },
    (err) => {
      console.warn('[QLCN] watch', col, err.message)
    },
  )
}

export function watchCollectionWhere<T>(
  col: string,
  field: string,
  value: string | number | boolean,
  cb: (items: (T & { id: string })[]) => void,
): Unsubscribe {
  if (!db) { cb([]); return () => {} }
  const q = query(collection(db, col), where(field, '==', value))
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map(d => ({ id: d.id, ...(d.data() as T) }))),
    (err) => console.warn('[QLCN] watch filtered', col, err.message),
  )
}

export function watchDocument<T>(
  col: string,
  id: string,
  cb: (item: (T & { id: string }) | null) => void,
): Unsubscribe {
  if (!db) { cb(null); return () => {} }
  return onSnapshot(
    doc(db, col, id),
    (snap) => cb(snap.exists() ? ({ id: snap.id, ...(snap.data() as T) }) : null),
    (err) => console.warn('[QLCN] watch document', col, err.message),
  )
}

export async function upsertDoc(col: string, id: string, data: Record<string, unknown>): Promise<void> {
  if (!db) return
  await setDoc(doc(db, col, id), { ...data, updatedAt: serverTimestamp() }, { merge: true })
}

export async function addDocAuto(col: string, data: Record<string, unknown>): Promise<string> {
  if (!db) return ''
  const ref = await addDoc(collection(db, col), { ...data, createdAt: serverTimestamp() })
  return ref.id
}

export async function removeDoc(col: string, id: string): Promise<void> {
  if (!db) return
  await deleteDoc(doc(db, col, id))
}

/** Ghi điểm: transaction; lỗi thì fallback setDoc */
export async function createScoreTransactionAtomic(tx: {
  id: string
  studentId: string
  weekNumber: number
  date: string
  ruleId: string
  category: string
  points: number
  note: string
  createdBy: string
  createdAt?: string
}): Promise<void> {
  if (!db) return
  const txRef = doc(db, 'scoreTransactions', tx.id)
  const lockRef = doc(db, 'weeklyLocks', String(tx.weekNumber))
  try {
    await runTransaction(db, async (transaction) => {
      const lockSnap = await transaction.get(lockRef)
      if (lockSnap.exists() && lockSnap.data()?.locked === true) {
        throw new Error(`Tuần ${tx.weekNumber} đã khóa – không thể ghi nhận`)
      }
      transaction.set(txRef, {
        ...tx,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('đã khóa')) throw e
    console.warn('[QLCN] atomic transaction failed', msg)
    throw e
  }
}

export async function setWeekLocked(weekNumber: number, locked: boolean, by: string): Promise<void> {
  if (!db) return
  await setDoc(doc(db, 'weeklyLocks', String(weekNumber)), {
    weekNumber, locked, by, updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function writeAuditLog(entry: {
  action: string
  detail: string
  by: string
  role?: string
}): Promise<void> {
  if (!db) return
  try {
    await addDoc(collection(db, 'auditLogs'), {
      ...entry,
      at: serverTimestamp(),
      clientAt: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('[QLCN] audit', e)
  }
}

export async function ensureUserProfile(uid: string, profile: Record<string, unknown>): Promise<void> {
  if (!db) return
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, { ...profile, createdAt: serverTimestamp() })
  }
}
