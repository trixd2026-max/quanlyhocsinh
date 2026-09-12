import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, type Auth, type User,
} from 'firebase/auth'
import {
  getFirestore, doc, getDoc, setDoc, collection, onSnapshot,
  query, addDoc, deleteDoc, serverTimestamp, runTransaction,
  type Firestore, type Unsubscribe,
} from 'firebase/firestore'

const HARDCODED = {
  apiKey: 'AIzaSyBexBGMuOkms37gNikIaxe-UyzMo2iTgQU',
  authDomain: 'quanlyhocsinh-48840.firebaseapp.com',
  projectId: 'quanlyhocsinh-48840',
  storageBucket: 'quanlyhocsinh-48840.firebasestorage.app',
  messagingSenderId: '407261790730',
  appId: '1:407261790730:web:31728a762f0b8bab0f55f3',
}

const cfg = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) || HARDCODED.apiKey,
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || HARDCODED.authDomain,
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || HARDCODED.projectId,
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) || HARDCODED.storageBucket,
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) || HARDCODED.messagingSenderId,
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) || HARDCODED.appId,
}

export const isFirebaseConfigured = Boolean(
  cfg.apiKey && cfg.projectId && cfg.apiKey !== 'YOUR_API_KEY' && String(cfg.apiKey).length > 10
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
  return (await signInWithEmailAndPassword(auth, email, password)).user
}

export async function firebaseRegister(email: string, password: string): Promise<User> {
  if (!auth) throw new Error('Firebase chưa cấu hình')
  return (await createUserWithEmailAndPassword(auth, email, password)).user
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
  points: number
  note: string
  createdBy: string
  createdAt?: string
}): Promise<void> {
  if (!db) return
  const txRef = doc(db, 'scoreTransactions', tx.id)
  const lockRef = doc(db, 'weeklyLocks', `week_${tx.weekNumber}`)
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
    console.warn('[QLCN] atomic fail, fallback setDoc', msg)
    await setDoc(txRef, {
      ...tx,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true })
  }
}

export async function setWeekLocked(weekNumber: number, locked: boolean, by: string): Promise<void> {
  if (!db) return
  await setDoc(doc(db, 'weeklyLocks', `week_${weekNumber}`), {
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
