# Chat Server Backend

Backend server cho ứng dụng chat sử dụng Express.js và MongoDB.

## Cài đặt

1. Cài đặt dependencies:
```bash
npm install
```

2. Tạo file `.env` từ `.env.example`:
```bash
PORT=3000
MONGODB_URI=mongodb://localhost:27017/chatlocal
JWT_SECRET=your_secret_key_here
UPLOAD_PATH=./uploads
```

3. Chạy server:
```bash
npm start
# hoặc để development với auto-reload
npm run dev
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Đăng ký tài khoản mới
- `POST /api/auth/login` - Đăng nhập
- `GET /api/auth/me` - Lấy thông tin user hiện tại

### Users
- `GET /api/users/admin` - Lấy danh sách admin (để chat 1:1)
- `GET /api/users/clients` - Lấy danh sách clients (admin only)

### Chats
- `POST /api/chats/admin-chat` - Tạo hoặc lấy chat 1:1 với admin
- `GET /api/chats/my-chats` - Lấy tất cả chats của user
- `GET /api/chats/:chatId/messages` - Lấy messages của một chat
- `POST /api/chats/:chatId/messages` - Gửi message

### Groups
- `POST /api/groups/create` - Tạo group mới (admin only)
- `POST /api/groups/join` - Tham gia group bằng code (admin only)
- `GET /api/groups` - Lấy tất cả groups (admin only)
- `GET /api/groups/my-groups` - Lấy groups user đang tham gia
- `POST /api/groups/:groupId/add-member` - Thêm member vào group (admin only)

### Files
- `POST /api/files/upload` - Upload file
- `GET /api/files/:fileId` - Download file

## Socket.IO Events

### Client -> Server
- `join-chat` - Tham gia chat room
- `send-message` - Gửi message
- `typing` - Bắt đầu typing
- `stop-typing` - Dừng typing
- `call-offer` - Gửi call offer (WebRTC)
- `call-answer` - Gửi call answer (WebRTC)
- `call-ice-candidate` - Gửi ICE candidate (WebRTC)
- `call-end` - Kết thúc call

### Server -> Client
- `new-message` - Nhận message mới
- `chat-updated` - Chat được cập nhật
- `user-typing` - User đang typing
- `user-stop-typing` - User dừng typing
- `call-offer` - Nhận call offer
- `call-answer` - Nhận call answer
- `call-ice-candidate` - Nhận ICE candidate
- `call-end` - Nhận call end
