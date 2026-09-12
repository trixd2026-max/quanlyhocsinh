# QUẢN LÝ LỚP CHỦ NHIỆM

Ứng dụng quản lý lớp chủ nhiệm – React + TypeScript + Vite + Firebase.

**Live:** https://quanlyhocsinhphuocson.vercel.app

## Đăng nhập

| Vai trò | Tài khoản | Mật khẩu |
|---------|-----------|----------|
| GVCN | `quanlyhocsinh` | `qlhs1234` |
| Lớp trưởng | `loptruong` | `bcs1234` |
| LP học tập | `phohoctap` | `bcs1234` |
| LP kỷ luật | `phokyluat` | `bcs1234` |
| PH từng HS | SĐT PH (vd `0901234567`) | `view1234` hoặc 4 số cuối SĐT |
| PH cả lớp | `phuhuynh` | `view1234` |
| Demo | `demo` | `demo` |

## Tính năng chính

- Điểm danh cả lớp / từng em
- Ghi nhận · **sửa** · xóa giao dịch điểm (+ audit)
- Khóa/mở khóa tuần (MK `qlhs1234` hoặc `MOKHOA`)
- Thi đua tổ, vi phạm, học tập
- Báo bài – in nhiều tuần A4
- Học sinh: sửa SĐT / tổ / mã PH trên UI
- PH gắn từng HS (chỉ xem điểm con)
- Báo cáo PH in A4, báo cáo tháng + xếp loại
- CSV import/export, backup local
- Firebase realtime (khi đăng nhập GVCN)

## Firebase

- Project: `quanlyhocsinh-48840`
- Config nằm trong `src/services/firebase.ts`
- Cần thêm domain production vào **Authentication → Settings → Authorized domains**

## Deploy

- GitHub: https://github.com/trixd2026-max/quanlyhocsinh
- Vercel: mỗi push `main` → build tự động
- Framework: Vite · Build: `npm run build` · Output: `dist`
