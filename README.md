# QUẢN LÝ LỚP CHỦ NHIỆM

Ứng dụng quản lý lớp chủ nhiệm – React + TypeScript + Vite.

**Live:** https://quanlyhocsinhtieuhocps.vercel.app

## Đăng nhập Demo

| Vai trò | Tài khoản | Mật khẩu |
|---------|-----------|----------|
| GVCN | `quanlyhocsinh` | `qlhs1234` |
| Demo nhanh | `demo` | `demo` |

Hoặc bấm **Vào Demo nhanh + dữ liệu mẫu** trên màn hình đăng nhập.

## Tính năng

- 8 phân hệ: Tổng quan, Nhập điểm tuần, Thi đua tổ, Vi phạm, Học tập, Báo bài/TKB, Rèn luyện cá nhân, Cài đặt lớp
- Ghi nhận điểm theo quy định (cộng/trừ)
- Xếp hạng tổ theo tuần
- Xuất CSV danh sách học sinh & lịch sử điểm
- Dữ liệu mẫu 12 học sinh, 4 tổ, 12 quy định điểm
- Lưu localStorage (chế độ Demo)
- Responsive (điện thoại → desktop)

## Chạy local

```bash
npm install
npm run dev
```

## Deploy Vercel

Repo đã kết nối. Mỗi push lên `main` sẽ tự build lại.

- Framework: Vite
- Build: `npm run build`
- Output: `dist`

## Firebase (bước tiếp theo)

Tạo file `.env` với các biến `VITE_FIREBASE_*`. Xem `firestore.rules` và `.env.example`.

## Kiến trúc đã chốt

- Mô hình: 1 lớp độc lập
- Xếp loại: GVCN tự cấu hình
- Phụ huynh: 1 tài khoản / học sinh
