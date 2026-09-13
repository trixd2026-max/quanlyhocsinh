# QUẢN LÝ LỚP CHỦ NHIỆM

Ứng dụng quản lý lớp chủ nhiệm sử dụng React, TypeScript, Vite, Firebase Authentication và Cloud Firestore.

**Live:** https://quanlyhocsinhphuocson.vercel.app

## Chạy cục bộ

```bash
npm install
copy .env.example .env.local
npm run dev
```

Điền đầy đủ cấu hình Firebase của dự án vào `.env.local`. Cấu hình Firebase không còn được nhúng trực tiếp trong mã nguồn.

## Xác thực và phân quyền

Mọi tài khoản sử dụng dữ liệu thật phải được tạo trong **Firebase Authentication → Users**. Ứng dụng không tự đăng ký tài khoản để tránh việc người lạ chiếm quyền.

Các tên đăng nhập ngắn sau được ánh xạ sang email Firebase:

| Tên đăng nhập | Email Firebase |
|---|---|
| `quanlyhocsinh` | `quanlyhocsinh@qlcn.app` |
| `loptruong` | `loptruong@qlcn.app` |
| `phohoctap` | `phohoctap@qlcn.app` |
| `phokyluat` | `phokyluat@qlcn.app` |

Phụ huynh đăng nhập bằng số điện thoại. Ví dụ `0901234567` được ánh xạ thành `parent.0901234567@qlcn.app`.

Tài khoản `demo` / `demo` chỉ dùng dữ liệu mẫu trong trình duyệt và không được phép đọc hoặc ghi Firebase.

### Hồ sơ người dùng

Ngoại trừ tài khoản GVCN `quanlyhocsinh@qlcn.app`, mỗi Firebase UID cần một document tại `users/{uid}`:

```json
{
  "role": "viceStudy",
  "active": true,
  "displayName": "Lớp phó học tập"
}
```

Các giá trị `role` hợp lệ:

- `classPresident`
- `viceStudy`
- `viceDiscipline`
- `parent`
- `viewer`

Hồ sơ phụ huynh phải có `studentId`:

```json
{
  "role": "parent",
  "active": true,
  "studentId": "FIRESTORE_STUDENT_DOCUMENT_ID"
}
```

GVCN có thể đọc và quản lý hồ sơ người dùng. Phụ huynh chỉ được đọc học sinh và giao dịch điểm gắn với `studentId` của mình.

## Firebase

1. Bật phương thức **Email/Password** trong Firebase Authentication.
2. Thêm domain triển khai vào **Authentication → Settings → Authorized domains**.
3. Tạo các tài khoản và document `users/{uid}` như hướng dẫn trên.
4. Triển khai rules trong `firestore.rules`.

```bash
firebase deploy --only firestore:rules --project quanlyhocsinh-48840
```

Firestore rules giới hạn:

- Chỉ GVCN được sửa học sinh, nhóm, cấu hình lớp và khóa tuần.
- Lớp trưởng được ghi điểm và sửa/xóa giao dịch chưa khóa.
- Lớp phó học tập chỉ ghi nhóm `study` và `bonus`.
- Lớp phó kỷ luật chỉ ghi nhóm `conduct` và `attendance`.
- Phụ huynh chỉ đọc dữ liệu của học sinh được liên kết.
- Người chưa xác thực không được đọc hoặc ghi dữ liệu.

## Kiểm tra

```bash
npm run build
npm audit
```

Repository có `package-lock.json` để cài đặt và kiểm tra dependency có thể tái lập.

## Deploy

- GitHub: https://github.com/trixd2026-max/quanlyhocsinh
- Vercel: mỗi push lên `main` sẽ build tự động.
- Framework: Vite
- Build command: `npm run build`
- Output: `dist`
- Cần khai báo toàn bộ biến `VITE_FIREBASE_*` từ `.env.example` trong Vercel.
