const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());

// Morgan HTTP request logger - log all API calls
app.use(morgan('dev', {
  skip: (req, res) => {
    // Skip logging static files (uploads)
    return req.path.startsWith('/uploads') || req.path.startsWith('/g/');
  }
}));

app.use(express.json({ limit: '210mb' })); // Slightly larger than file limit
app.use(express.urlencoded({ extended: true, limit: '210mb' }));

// Serve uploads with AGGRESSIVE caching for images
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '365d', // Cache for 1 year (like production apps: Zalo, Messenger, WhatsApp)
  etag: true, // Enable ETag for cache validation
  lastModified: true, // Enable Last-Modified header
  immutable: true, // Tell browsers file will never change
  setHeaders: (res, filePath) => {
    // Add additional cache headers for better performance
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    console.log(`📦 [CACHE] Serving cached file: ${path.basename(filePath)}`);
  }
}));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatlocal', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Make io available to routes
app.set('io', io);

// Health check endpoint - API status check
app.get('/api/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: {
      status: mongoStatus,
      readyState: mongoose.connection.readyState
    },
    server: {
      nodeVersion: process.version,
      platform: process.platform
    }
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/calls', require('./routes/calls'));
app.use('/api/chats', require('./routes/chats'));
app.use('/api/groups', require('./routes/groups'));
app.use('/api/files', require('./routes/files'));
app.use('/api/push', require('./routes/push'));
app.use('/api/stream', require('./routes/stream'));
app.use('/api/webrtc', require('./routes/webrtc'));

// Public route for group join links (redirect to app)
app.get('/g/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const Group = require('./models/Group');
    
    // Verify group exists
    const group = await Group.findOne({ code: code.toUpperCase() });
    if (!group) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Nhóm không tồn tại</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
          <div style="text-align: center;">
            <h1>Nhóm không tồn tại</h1>
            <p>Mã nhóm không hợp lệ hoặc đã bị xóa.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Deep link scheme (from app.json) - use expo-router format
    const appScheme = 'chatappuxui://';
    const deepLink = `${appScheme}join-group?code=${encodeURIComponent(code.toUpperCase())}`;
    
    // Get user agent to detect platform
    const userAgent = req.get('user-agent') || '';
    const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
    const isAndroid = /Android/i.test(userAgent);
    const isMobile = isIOS || isAndroid;
    
    // App download links (cần cập nhật khi có link thực tế)
    const appStoreLink = process.env.APP_STORE_LINK || 'https://apps.apple.com/app/drchat';
    const playStoreLink = process.env.PLAY_STORE_LINK || 'https://play.google.com/store/apps/details?id=com.asiapasificvisa.drchat';
    
    // Redirect to app with fallback HTML page
    const html = `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <title>Tham gia ${group.name} | DrChat</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          :root {
            --primary: #1a1a1a;
            --accent: #2563eb;
            --text-main: #1f2937;
            --text-muted: #6b7280;
            --bg: #f8fafc;
          }
          * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg);
            color: var(--text-main);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            line-height: 1.5;
          }

          .card {
            background: #ffffff;
            width: 100%;
            max-width: 400px;
            padding: 40px 32px;
            border-radius: 32px;
            text-align: center;
            box-shadow: 0 20px 50px rgba(0,0,0,0.05);
            margin: 20px;
          }

          .brand-icon {
            width: 72px;
            height: 72px;
            background: var(--primary);
            color: white;
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 32px;
            margin: 0 auto 24px;
            box-shadow: 0 10px 20px rgba(0,0,0,0.1);
          }

          h1 {
            font-size: 24px;
            font-weight: 700;
            letter-spacing: -0.5px;
            margin-bottom: 8px;
            color: var(--primary);
          }

          .group-name {
            font-size: 18px;
            color: var(--accent);
            font-weight: 600;
            margin-bottom: 32px;
          }

          /* Loading State */
          .status-box { margin-bottom: 24px; }
          .spinner {
            width: 28px;
            height: 28px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid var(--accent);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
          }
          @keyframes spin { to { transform: rotate(360deg); } }

          /* Code Section */
          .code-container {
            background: #f1f5f9;
            padding: 16px;
            border-radius: 16px;
            margin: 24px 0;
            border: 1px dashed #cbd5e1;
          }
          .code-label { font-size: 12px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 1px; margin-bottom: 8px; }
          .code-value { font-family: 'SF Mono', SFMono-Regular, Consolas, monospace; font-size: 24px; font-weight: 700; color: var(--primary); letter-spacing: 4px; }

          /* Buttons */
          .btn-stack { display: flex; flex-direction: column; gap: 12px; }
          .btn {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px 24px;
            border-radius: 16px;
            font-size: 16px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .btn-primary {
            background: var(--primary);
            color: white;
          }
          .btn-primary:active { transform: scale(0.98); opacity: 0.9; }
          
          .btn-outline {
            background: white;
            color: var(--primary);
            border: 1.5px solid #e5e7eb;
          }
          .btn-outline:active { background: #f9fafb; }

          #download-section { display: none; animation: fadeIn 0.5s ease; }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

          .footer-text { font-size: 13px; color: var(--text-muted); margin-top: 24px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="brand-icon">Dr</div>
          <h1>Tham gia nhóm</h1>
          <div class="group-name">${group.name}</div>

          <div id="loading" class="status-box">
            <div class="spinner"></div>
            <p style="color: var(--text-muted); font-size: 14px;">Đang kết nối tới ứng dụng...</p>
          </div>

          <div id="download-section">
            <p style="font-size: 15px; color: var(--text-muted);">Vui lòng tải ứng dụng để tham gia</p>
            
            <div class="code-container">
              <div class="code-label">Mã tham gia của bạn</div>
              <div class="code-value">${code.toUpperCase()}</div>
            </div>

            <div class="btn-stack">
              <a href="${isIOS ? appStoreLink : (isAndroid ? playStoreLink : appStoreLink)}" 
                 id="download-btn" class="btn btn-primary">
                Tải ứng dụng DrChat
              </a>
              
              ${isMobile ? `
              <a href="${deepLink}" id="open-app-btn" class="btn btn-outline">
                Tôi đã cài đặt ứng dụng
              </a>` : ''}
            </div>
            <p class="footer-text">Mã sẽ được tự động áp dụng sau khi cài đặt.</p>
          </div>
        </div>

        <script>
          (function() {
            const deepLink = '${deepLink}';
            const isMobile = ${isMobile ? 'true' : 'false'};
            
            function showDownload() {
              document.getElementById('loading').style.display = 'none';
              document.getElementById('download-section').style.display = 'block';
            }

            function tryOpen() {
              if (!isMobile) { showDownload(); return; }
              
              const start = Date.now();
              window.location.href = deepLink;
              
              setTimeout(() => {
                if (Date.now() - start < 2500) showDownload();
              }, 2000);
            }

            document.getElementById('open-app-btn')?.addEventListener('click', (e) => {
               window.location.href = deepLink;
            });

            tryOpen();
          })();
        </script>
      </body>
      </html>
    `;
    
    
    res.send(html);
  } catch (error) {
    console.error('Error handling group link:', error);
    res.status(500).send('Lỗi server');
  }
});

// Public route for user profile share links (open app to add friend)
app.get('/u/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const User = require('./models/User');
    const mongoose = require('mongoose');

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).send('Invalid user');
    }

    const user = await User.findById(userId).select('fullName phoneNumber avatar role');
    if (!user) {
      return res.status(404).send('User not found');
    }

    const displayName = user.fullName || user.phoneNumber || 'Người dùng';
    const appScheme = 'chatappuxui://';
    const deepLink = `${appScheme}profile/${encodeURIComponent(userId)}`;

    const userAgent = req.get('user-agent') || '';
    const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
    const isAndroid = /Android/i.test(userAgent);
    const isMobile = isIOS || isAndroid;

    const appStoreLink = process.env.APP_STORE_LINK || 'https://apps.apple.com/app/drchat';
    const playStoreLink =
      process.env.PLAY_STORE_LINK ||
      'https://play.google.com/store/apps/details?id=com.asiapasificvisa.drchat';

    const baseUrl = process.env.BASE_URL || `http://${req.get('host')}`;
    const avatarPath = (user.avatar && typeof user.avatar === 'string') ? user.avatar : null;
    const avatarUrl = avatarPath
      ? (avatarPath.startsWith('http') ? avatarPath : `${baseUrl}${avatarPath.startsWith('/') ? '' : '/'}${avatarPath}`)
      : null;

      const html = `
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <title>Kết bạn với ${displayName} | DrChat</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          :root {
            --primary-dark: #0f172a;
            --accent-blue: #2563eb;
            --bg-soft: #f8fafc;
            --text-main: #1e293b;
            --text-muted: #64748b;
          }

          * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: var(--bg-soft);
            color: var(--text-main);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
          }

          .profile-card {
            background: #ffffff;
            width: 100%;
            max-width: 380px;
            padding: 40px 24px;
            border-radius: 32px;
            text-align: center;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.08);
            position: relative;
          }

          .avatar-container {
            position: relative;
            width: 110px;
            height: 110px;
            margin: 0 auto 20px;
          }

          .avatar {
            width: 100%;
            height: 100%;
            border-radius: 35px;
            object-fit: cover;
            background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 42px;
            font-weight: 700;
            color: white;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            border: 4px solid #fff;
          }

          .status-badge {
            position: absolute;
            bottom: 5px;
            right: 5px;
            width: 20px;
            height: 20px;
            background: #22c55e;
            border: 3px solid #fff;
            border-radius: 50%;
          }

          h1 {
            font-size: 22px;
            font-weight: 800;
            color: var(--primary-dark);
            letter-spacing: -0.5px;
            margin-bottom: 4px;
          }

          .display-name {
            font-size: 17px;
            font-weight: 500;
            color: var(--accent-blue);
            margin-bottom: 24px;
          }

          .description {
            font-size: 15px;
            color: var(--text-muted);
            line-height: 1.5;
            margin-bottom: 32px;
            padding: 0 10px;
          }

          /* Loading Animation */
          .loader-box {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
          }
          .spinner {
            width: 24px;
            height: 24px;
            border: 2.5px solid #f1f5f9;
            border-top: 2.5px solid var(--accent-blue);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }

          /* Action Buttons */
          .action-area { display: none; animation: slideUp 0.6s cubic-bezier(0.23, 1, 0.32, 1); }
          @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

          .btn-group { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; }
          
          .btn {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            border-radius: 18px;
            font-size: 16px;
            font-weight: 600;
            text-decoration: none;
            transition: all 0.2s ease;
          }

          .btn-main { background: var(--primary-dark); color: white; }
          .btn-main:active { transform: scale(0.97); }

          .btn-sub { 
            background: #fff; 
            color: var(--primary-dark); 
            border: 1.5px solid #e2e8f0; 
          }
          .btn-sub:active { background: #f8fafc; }

          .footer-note {
            margin-top: 24px;
            font-size: 12px;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
        </style>
      </head>
      <body>
        <div class="profile-card">
          <div class="avatar-container">
            <div class="avatar">
               ${avatarUrl ? `<img src="${avatarUrl}" class="avatar" alt="avatar" />` : String(displayName).charAt(0).toUpperCase()}
            </div>
            <div class="status-badge"></div>
          </div>

          <h1>Kết bạn trên DrChat</h1>
          <div class="display-name">@${displayName}</div>
          <p class="description">Tham gia cộng đồng DrChat để kết nối và trò chuyện cùng bạn bè.</p>

          <div id="loading" class="loader-box">
            <div class="spinner"></div>
            <span style="font-size: 14px; color: var(--text-muted)">Đang tìm ứng dụng...</span>
          </div>

          <div id="download-section" class="action-area">
            <div class="btn-group">
              <a href="${isIOS ? appStoreLink : (isAndroid ? playStoreLink : appStoreLink)}" 
                 id="download-btn" class="btn btn-main">
                Tải ứng dụng miễn phí
              </a>
              ${isMobile ? `<a href="${deepLink}" id="open-app-btn" class="btn btn-sub">Tôi đã có DrChat</a>` : ''}
            </div>
            <div class="footer-note">An toàn • Bảo mật • Miễn phí</div>
          </div>
        </div>

        <script>
          (function() {
            const deepLink = '${deepLink}';
            const isMobile = ${isMobile ? 'true' : 'false'};

            function handleTransition() {
              document.getElementById('loading').style.display = 'none';
              document.getElementById('download-section').style.display = 'block';
            }

            function initRedirect() {
              if (!isMobile) { handleTransition(); return; }
              
              const start = Date.now();
              window.location.href = deepLink;
              
              setTimeout(() => {
                if (Date.now() - start < 2500) handleTransition();
              }, 2000);
            }

            window.addEventListener('load', () => {
              document.getElementById('open-app-btn')?.addEventListener('click', (e) => {
                window.location.href = deepLink;
              });
              initRedirect();
            });
          })();
        </script>
      </body>
      </html>
    `;

    res.send(html);
  } catch (error) {
    console.error('Error handling user share link:', error);
    res.status(500).send('Lỗi server');
  }
});

// Socket.io for real-time chat
require('./socket/socket')(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
