#!/usr/bin/env node

/**
 * Script để kiểm tra APNs Keys trong file .env
 * 
 * Usage:
 *   node scripts/check-apple-keys.js
 *   hoặc
 *   npm run check:apple-keys
 */

const fs = require('fs');
const path = require('path');

// Màu cho terminal
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkAppleKeys() {
  log('\n🔍 KIỂM TRA APNs KEYS TRONG .ENV\n', 'cyan');
  
  const envPath = path.join(__dirname, '..', '.env');
  
  // Kiểm tra file .env có tồn tại không
  if (!fs.existsSync(envPath)) {
    log('❌ File .env không tồn tại!', 'red');
    log(`   Đường dẫn: ${envPath}`, 'yellow');
    log('\n💡 Tạo file .env từ VOIP_ENV_SETUP.txt:', 'blue');
    log('   cp VOIP_ENV_SETUP.txt .env', 'yellow');
    return false;
  }
  
  // Đọc file .env
  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split('\n');
  
  // Parse .env (đơn giản)
  const env = {};
  let currentKey = null;
  let currentValue = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip comments và empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Check nếu là key=value (single line)
    if (trimmed.includes('=') && !trimmed.startsWith('"') && !trimmed.startsWith("'")) {
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        
        // Remove quotes nếu có
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        env[key] = value;
        currentKey = null;
        currentValue = '';
      }
    }
    // Check nếu là multi-line value (bắt đầu với key=")
    else if (trimmed.match(/^([^=]+)=["']/)) {
      const match = trimmed.match(/^([^=]+)=["'](.*)$/);
      if (match) {
        currentKey = match[1].trim();
        currentValue = match[2];
        
        // Nếu đã đóng quote trên cùng dòng
        if (currentValue.endsWith('"') || currentValue.endsWith("'")) {
          env[currentKey] = currentValue.slice(0, -1);
          currentKey = null;
          currentValue = '';
        }
      }
    }
    // Tiếp tục multi-line value
    else if (currentKey) {
      currentValue += '\n' + trimmed;
      
      // Nếu đóng quote
      if (trimmed.endsWith('"') || trimmed.endsWith("'")) {
        env[currentKey] = currentValue.slice(0, -1);
        currentKey = null;
        currentValue = '';
      }
    }
  }
  
  // Kiểm tra các keys cần thiết
  const requiredKeys = [
    'APNS_VOIP_KEY',
    'APNS_VOIP_KEY_ID',
    'APNS_TEAM_ID',
    'APNS_VOIP_BUNDLE_ID',
    'APNS_PRODUCTION',
  ];
  
  let allValid = true;
  const results = {};
  
  log('📋 KẾT QUẢ KIỂM TRA:\n', 'cyan');
  
  // Check từng key
  for (const key of requiredKeys) {
    const value = env[key];
    const exists = !!value;
    let valid = false;
    let message = '';
    
    if (!exists) {
      message = '❌ THIẾU';
      allValid = false;
    } else {
      switch (key) {
        case 'APNS_VOIP_KEY':
          // Kiểm tra format: phải có BEGIN PRIVATE KEY và END PRIVATE KEY
          if (value.includes('-----BEGIN PRIVATE KEY-----') && 
              value.includes('-----END PRIVATE KEY-----')) {
            valid = true;
            message = '✅ HỢP LỆ';
            const keyLength = value.length;
            log(`   ${key}:`, 'blue');
            log(`      Status: ${message}`, valid ? 'green' : 'red');
            log(`      Length: ${keyLength} characters`, 'yellow');
            log(`      Format: Private Key (.p8)`, 'yellow');
          } else {
            message = '❌ SAI FORMAT (thiếu BEGIN/END PRIVATE KEY)';
            allValid = false;
          }
          break;
          
        case 'APNS_VOIP_KEY_ID':
          // Key ID thường là 10 ký tự alphanumeric
          if (/^[A-Z0-9]{10}$/.test(value)) {
            valid = true;
            message = '✅ HỢP LỆ';
          } else {
            message = '⚠️  CÓ THỂ SAI (Key ID thường là 10 ký tự)';
          }
          log(`   ${key}: ${value}`, valid ? 'green' : 'yellow');
          log(`      Status: ${message}`, valid ? 'green' : 'yellow');
          break;
          
        case 'APNS_TEAM_ID':
          // Team ID thường là 10 ký tự alphanumeric
          if (/^[A-Z0-9]{10}$/.test(value)) {
            valid = true;
            message = '✅ HỢP LỆ';
          } else {
            message = '⚠️  CÓ THỂ SAI (Team ID thường là 10 ký tự)';
          }
          log(`   ${key}: ${value}`, valid ? 'green' : 'yellow');
          log(`      Status: ${message}`, valid ? 'green' : 'yellow');
          break;
          
        case 'APNS_VOIP_BUNDLE_ID':
          valid = true;
          message = '✅ HỢP LỆ';
          log(`   ${key}: ${value}`, 'green');
          log(`      Status: ${message}`, 'green');
          break;
          
        case 'APNS_PRODUCTION':
          if (value === 'true' || value === 'false') {
            valid = true;
            message = '✅ HỢP LỆ';
          } else {
            message = '⚠️  PHẢI LÀ "true" HOẶC "false"';
          }
          log(`   ${key}: ${value}`, valid ? 'green' : 'yellow');
          log(`      Status: ${message}`, valid ? 'green' : 'yellow');
          log(`      Mode: ${value === 'true' ? 'PRODUCTION' : 'SANDBOX'}`, 'blue');
          break;
      }
    }
    
    results[key] = { exists, valid, message };
    
    if (key !== 'APNS_VOIP_KEY') {
      // Đã log ở trên
    }
  }
  
  // Tóm tắt
  log('\n📊 TÓM TẮT:\n', 'cyan');
  
  const missing = requiredKeys.filter(k => !results[k].exists);
  const invalid = requiredKeys.filter(k => results[k].exists && !results[k].valid);
  
  if (missing.length > 0) {
    log('❌ Keys bị thiếu:', 'red');
    missing.forEach(k => log(`   - ${k}`, 'red'));
  }
  
  if (invalid.length > 0) {
    log('⚠️  Keys có vấn đề:', 'yellow');
    invalid.forEach(k => log(`   - ${k}: ${results[k].message}`, 'yellow'));
  }
  
  if (missing.length === 0 && invalid.length === 0) {
    log('✅ TẤT CẢ KEYS ĐỀU HỢP LỆ!', 'green');
    log('\n💡 Tiếp theo:', 'blue');
    log('   1. Restart backend server', 'yellow');
    log('   2. Test VoIP push notification', 'yellow');
  } else {
    log('\n🔧 CẦN LÀM:', 'yellow');
    log('   1. Vào Apple Developer Portal:', 'blue');
    log('      https://developer.apple.com/account/resources/authkeys/list', 'cyan');
    log('   2. Tạo APNs Auth Key mới', 'yellow');
    log('   3. Download file .p8 và copy nội dung vào APNS_VOIP_KEY', 'yellow');
    log('   4. Copy Key ID vào APNS_VOIP_KEY_ID', 'yellow');
    log('   5. Copy Team ID vào APNS_TEAM_ID', 'yellow');
    log('\n📖 Xem hướng dẫn chi tiết:', 'blue');
    log('   cat HOW_TO_GET_APPLE_KEYS.md', 'cyan');
  }
  
  log('\n', 'reset');
  
  return allValid && missing.length === 0;
}

// Chạy script
if (require.main === module) {
  const isValid = checkAppleKeys();
  process.exit(isValid ? 0 : 1);
}

module.exports = { checkAppleKeys };
