# Migration Scripts

## migrate-file-urls.js

Script này chuyển đổi tất cả các URL đầy đủ trong database thành đường dẫn tương đối.

### Mục đích
- Chuyển đổi các URL đầy đủ như `http://172.20.10.3:3000/uploads/file.jpg` 
- Thành đường dẫn tương đối như `/uploads/file.jpg`

### Cách chạy

```bash
# Từ thư mục chat-server
npm run migrate:file-urls

# Hoặc chạy trực tiếp
node scripts/migrate-file-urls.js
```

### Lưu ý
- Script sẽ tự động bỏ qua các URL đã là đường dẫn tương đối
- Script an toàn, chỉ cập nhật các URL cần thiết
- Đảm bảo MongoDB đang chạy và file `.env` đã được cấu hình đúng

