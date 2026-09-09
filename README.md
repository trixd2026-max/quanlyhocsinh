# QUẢN LÝ LỚP CHỦ NHIỆM

Ứng dụng quản lý lớp chủ nhiệm – React + TypeScript + Vite.

## Tính năng (Demo)

- 8 phân hệ: Tổng quan, Nhập điểm tuần, Thi đua tổ, Vi phạm, Học tập, Báo bài/TKB, Rèn luyện cá nhân, Cài đặt lớp
- Ghi nhận điểm theo quy định (cộng/trừ)
- Xếp hạng tổ realtime
- Dữ liệu mẫu 12 học sinh, 4 tổ, 12 quy định điểm
- Lưu localStorage (chế độ Demo)
- Responsive (điện thoại → desktop)
- Giao diện tiếng Việt, tông xanh lá – xanh ngọc

## Chạy local

```bash
npm install
npm run dev
```

## Deploy Vercel

Kết nối repo GitHub → Framework: Vite → Build: `npm run build` → Output: `dist`

## Firebase (bước tiếp theo)

Tạo file `.env` với các biến VITE_FIREBASE_*. Xem `firestore.rules`.

## Kiến trúc đã chốt

- Mô hình: 1 lớp độc lập
- Xếp loại: GVCN tự cấu hình
- Phụ huynh: 1 tài khoản / học sinh
