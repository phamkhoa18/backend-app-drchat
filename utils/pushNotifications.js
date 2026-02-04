const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const apn = require('apn');

// Expo Push Notification API endpoint
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
let apnProvider = null;

const getFirebaseMessaging = () => {
  if (!admin.apps.length) {
    let serviceAccount = null;
    if (process.env.FCM_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
    } else {
      const keyPath = path.join(__dirname, '..', 'key', 'serviceAccountKey.json');
      if (fs.existsSync(keyPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      }
    }
    if (!serviceAccount) {
      return null;
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }
  return admin.messaging();
};

const getApnProvider = () => {
  if (apnProvider) return apnProvider;
  const key = process.env.APNS_VOIP_KEY;
  const keyId = process.env.APNS_VOIP_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  if (!key || !keyId || !teamId) {
    return null;
  }
  apnProvider = new apn.Provider({
    token: {
      key,
      keyId,
      teamId,
    },
    production: process.env.APNS_PRODUCTION === 'true',
  });
  return apnProvider;
};

const sendApnsNotification = async (tokens, payload) => {
  const provider = getApnProvider();
  const bundleId = process.env.APNS_BUNDLE_ID || process.env.APNS_VOIP_BUNDLE_ID;

  if (!provider) {
    console.error('❌ [APNS] APNs provider not configured');
    return [];
  }
  if (!tokens?.length) {
    console.warn('⚠️  [APNS] No tokens provided');
    return [];
  }
  if (!bundleId) {
    console.error('❌ [APNS] APNS_BUNDLE_ID not configured');
    return [];
  }

  try {
    const notification = new apn.Notification();
    notification.topic = bundleId;
    notification.pushType = 'alert';
    notification.priority = 10;
    notification.expiry = Math.floor(Date.now() / 1000) + 60;
    notification.alert = {
      title: payload.title,
      body: payload.body,
    };
    notification.sound = payload.sound || 'default';
    notification.payload = payload.data || {};

    console.log(`📱 [APNS] Sending alert push to ${tokens.length} device(s)`);
    const result = await provider.send(notification, tokens);
    const invalidTokens = [];

    if (result.sent && result.sent.length > 0) {
      console.log(`✅ [APNS] Sent to ${result.sent.length} device(s)`);
    }
    if (result.failed && result.failed.length > 0) {
      console.error(`❌ [APNS] Failed to send to ${result.failed.length} device(s)`);
      result.failed.forEach((failure) => {
        const reason = failure?.response?.reason || failure?.error?.reason || failure?.error || 'unknown';
        console.error(`❌ [APNS] Failed to ${failure.device}: ${reason}`);
        if (reason === 'BadDeviceToken' || reason === 'Unregistered') {
          invalidTokens.push(failure.device);
        }
      });
    }
    return invalidTokens;
  } catch (error) {
    console.error('❌ [APNS] Error sending APNs notification:', error);
    console.error('❌ [APNS] Error details:', error.message);
    return [];
  }
};

// Like sendApnsNotification but returns a structured report (for debugging/test endpoints).
const sendApnsNotificationWithReport = async (tokens, payload) => {
  const provider = getApnProvider();
  const bundleId = process.env.APNS_BUNDLE_ID || process.env.APNS_VOIP_BUNDLE_ID;

  const report = {
    configured: !!provider && !!bundleId,
    bundleId: bundleId || null,
    production: process.env.APNS_PRODUCTION === 'true',
    sent: 0,
    failed: 0,
    invalidTokens: [],
    failures: [],
  };

  if (!provider || !tokens?.length || !bundleId) {
    return report;
  }

  try {
    const notification = new apn.Notification();
    notification.topic = bundleId;
    notification.pushType = 'alert';
    notification.priority = 10;
    notification.expiry = Math.floor(Date.now() / 1000) + 60;
    notification.alert = {
      title: payload.title,
      body: payload.body,
    };
    notification.sound = payload.sound || 'default';
    notification.payload = payload.data || {};

    const result = await provider.send(notification, tokens);
    report.sent = result?.sent?.length || 0;
    report.failed = result?.failed?.length || 0;

    if (Array.isArray(result?.failed)) {
      result.failed.forEach((failure) => {
        const reason = failure?.response?.reason || failure?.error?.reason || failure?.error || 'unknown';
        report.failures.push({
          reason,
          status: failure?.status || failure?.response?.status || null,
        });
        if (reason === 'BadDeviceToken' || reason === 'Unregistered') {
          report.invalidTokens.push(failure.device);
        }
      });
    }

    return report;
  } catch (error) {
    report.failed = tokens?.length || 0;
    report.failures.push({ reason: error?.message || 'error', status: null });
    return report;
  }
};

const sendFcmNotification = async (tokens, payload) => {
  const messaging = getFirebaseMessaging();
  if (!messaging || !tokens?.length) return [];
  
  const isCallNotification = payload.data?.type === 'call' || payload.data?.action === 'incoming-call';
  const androidPriority = isCallNotification ? 'high' : 'high';
  
  try {
    const rawData = payload.data || {};
    const stringData = {};
    Object.entries(rawData).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      stringData[key] = String(value);
    });
    // Always include a notification payload so Android shows it in background/killed.
    // (Data-only pushes can be dropped or not displayed depending on app/background restrictions.)
    const notificationPayload =
      payload.title || payload.body
        ? {
            title: payload.title || undefined,
            body: payload.body || undefined,
          }
        : undefined;

    const message = {
      tokens,
      data: stringData,
      notification: notificationPayload,
      android: {
        priority: androidPriority,
        notification: {
          channelId: payload.channelId || (isCallNotification ? 'calls' : 'default'),
          sound: payload.sound || 'default',
          // Hint for heads-up style on some devices/ROMs
          priority: isCallNotification ? 'max' : 'high',
          visibility: 'public',
          ...(isCallNotification ? { tag: `call:${stringData.chatId || ''}` } : {}),
        },
      },
      apns: {
        headers: {
          'apns-priority': isCallNotification ? '10' : '5',
        },
        payload: {
          aps: {
            sound: payload.sound || 'default',
            ...(isCallNotification && {
              'interruption-level': 'critical',
              'relevance-score': 1.0,
            }),
          },
        },
      },
    };
    
    console.log(`📱 [FCM] Sending ${isCallNotification ? 'CALL' : 'regular'} notification to ${tokens.length} device(s)`);
    console.log(`📱 [FCM] Priority: ${isCallNotification ? 'HIGH (full-screen)' : 'normal'}`);
    
    const result = await messaging.sendEachForMulticast(message);
    const successCount = result?.successCount ?? 0;
    const failureCount = result?.failureCount ?? 0;
    console.log(`✅ [FCM] Notification sent: ${successCount} success, ${failureCount} failed`);
    const invalidTokens = [];
    if (failureCount > 0 && Array.isArray(result?.responses)) {
      result.responses.forEach((resp, idx) => {
        if (!resp?.success) {
          const err = resp?.error;
          console.error(`❌ [FCM] Token failed (${tokens[idx]}): ${err?.code || err?.message || err}`);
          if (
            err?.code === 'messaging/registration-token-not-registered' ||
            err?.code === 'messaging/invalid-registration-token'
          ) {
            invalidTokens.push(tokens[idx]);
          }
        }
      });
    }
    return invalidTokens;
  } catch (error) {
    console.error('❌ [FCM] Error sending FCM notification:', error);
    console.error('❌ [FCM] Error details:', error.message);
    return [];
  }
};

const sendApnsVoipNotification = async (tokens, payload) => {
  const provider = getApnProvider();
  const bundleId = process.env.APNS_VOIP_BUNDLE_ID;
  
  if (!provider) {
    console.error('❌ [VoIP] APNs provider not configured');
    return;
  }
  if (!tokens?.length) {
    console.warn('⚠️  [VoIP] No tokens provided');
    return;
  }
  if (!bundleId) {
    console.error('❌ [VoIP] APNS_VOIP_BUNDLE_ID not configured');
    return;
  }
  
  try {
    const notification = new apn.Notification();
    notification.topic = `${bundleId}.voip`;
    notification.pushType = 'voip';
    notification.priority = 10;
    notification.payload = payload.data || {};
    notification.expiry = Math.floor(Date.now() / 1000) + 60;
    
    console.log(`📱 [VoIP] Sending VoIP push to ${tokens.length} device(s)`);
    console.log(`📱 [VoIP] Topic: ${notification.topic}`);
    console.log(`📱 [VoIP] Payload:`, JSON.stringify(notification.payload, null, 2));
    
    const result = await provider.send(notification, tokens);
    
    if (result.sent && result.sent.length > 0) {
      console.log(`✅ [VoIP] APNs VoIP notification sent successfully to ${result.sent.length} device(s)`);
      result.sent.forEach((token) => {
        console.log(`✅ [VoIP] Sent to device: ${token}`);
      });
    }
    if (result.failed && result.failed.length > 0) {
      console.error(`❌ [VoIP] Failed to send to ${result.failed.length} device(s)`);
      result.failed.forEach((failure) => {
        console.error(`❌ [VoIP] Failed to ${failure.device}: ${failure.error}`);
      });
    }
  } catch (error) {
    console.error('❌ [VoIP] Error sending APNs VoIP notification:', error);
    console.error('❌ [VoIP] Error details:', error.message);
  }
};

/**
 * Send push notification via Expo Push Notification Service
 * @param {Array} pushTokens - Array of Expo push tokens
 * @param {Object} notification - Notification data
 * @param {string} notification.title - Notification title
 * @param {string} notification.body - Notification body
 * @param {Object} notification.data - Additional data (chatId, type, etc.)
 * @param {string} notification.sound - Sound file (default: 'default')
 * @param {number} notification.priority - Priority (default: 'high')
 */
async function sendPushNotification(pushTokens, notification) {
  if (!pushTokens || pushTokens.length === 0) {
    console.log('No push tokens to send notification');
    return;
  }

  console.log(`📱 Preparing to send push notification to ${pushTokens.length} device(s)`);
  console.log(`📱 Title: ${notification.title}`);
  console.log(`📱 Body: ${notification.body}`);
  console.log(`📱 Type: ${notification.data?.type || 'unknown'}`);
  console.log(`📱 Priority: ${notification.priority || 'high'}`);

  const messages = pushTokens.map(token => ({
    to: token,
    sound: notification.sound || 'default',
    title: notification.title,
    body: notification.body,
    data: notification.data || {},
    priority: notification.priority || 'high',
    channelId: notification.channelId || 'default',
    // CRITICAL: Ensure notification is displayed even when app is in background/killed
    _displayInForeground: true, // Show even when app is open
  }));

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(messages);
    
    const options = {
      hostname: 'exp.host',
      path: '/--/api/v2/push/send',
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          
          if (result.data) {
            const errors = result.data.filter(item => item.status === 'error');
            if (errors.length > 0) {
              console.error('❌ Some push notifications failed:', errors);
              errors.forEach(err => {
                console.error(`❌ Error: ${err.message || 'Unknown error'}`);
              });
            } else {
              console.log(`✅ Push notifications sent successfully to ${result.data.length} device(s)`);
              result.data.forEach((item, index) => {
                if (item.status === 'ok') {
                  console.log(`✅ Device ${index + 1}: Notification sent (ID: ${item.id})`);
                }
              });
            }
          } else {
            console.warn('⚠️ No data in push notification response');
          }
          
          resolve(result);
        } catch (error) {
          console.error('Error parsing push notification response:', error);
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error sending push notification:', error);
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Send call notification to user
 * @param {Object} user - User object with pushTokens
 * @param {string} callerName - Name of the caller
 * @param {string} chatId - Chat ID
 * @param {string} callerId - Caller user ID
 * @param {string} callType - 'voice' or 'video'
 */
async function sendCallNotification(user, callerName, chatId, callerId, callType) {
  if (!user) {
    console.error('❌ [CALL] Cannot send call notification - user is null');
    return;
  }
  
  const callTypeText = callType === 'video' ? 'Video' : 'Thoại';
  const expoTokens = (user.pushTokens || []).map(pt => pt.token);
  const fcmTokens = (user.fcmTokens || []).map(pt => pt.token);
  const apnsVoipTokens = (user.apnsVoipTokens || []).map(pt => pt.token);
  const apnsTokens = (user.apnsTokens || []).map(pt => pt.token);
  const callUuid = crypto.randomUUID();

  console.log(`📞 [CALL] Sending call push notification (Expo:${expoTokens.length}, FCM:${fcmTokens.length}, VoIP:${apnsVoipTokens.length}, APNs:${apnsTokens.length})`);
  console.log(`📞 [CALL] Caller: ${callerName}, Type: ${callTypeText}, ChatId: ${chatId}`);
  console.log(`📞 [CALL] VoIP tokens:`, apnsVoipTokens);

  const payload = {
    title: `Cuộc gọi ${callTypeText} đến`,
    body: `${callerName} đang gọi cho bạn`,
    sound: 'default',
    priority: 'high',
    channelId: 'calls',
    data: {
      type: 'call',
      chatId,
      callerId,
      callerName,
      callType: callType || 'voice',
      callUuid,
      action: 'incoming-call',
    },
  };

  // Meta-like routing:
  // - iOS: use VoIP push only (CallKit). Avoid FCM/Expo to prevent duplicate UI.
  // - Android: use FCM (or Expo if no native tokens).
  if (apnsVoipTokens.length) {
    console.log(`📱 [CALL] Sending VoIP push to ${apnsVoipTokens.length} device(s)`);
    console.log(`📱 [CALL] VoIP payload:`, JSON.stringify(payload.data, null, 2));
    await sendApnsVoipNotification(apnsVoipTokens, { data: payload.data });
    return;
  }
  // If iOS doesn't have VoIP tokens yet, fallback to regular APNs alert so user still sees something.
  // This WILL NOT wake CallKit when app is killed, but it prevents silent missed calls.
  if (apnsTokens.length) {
    console.log(`📱 [CALL] No VoIP token. Sending APNs alert fallback to ${apnsTokens.length} device(s)`);
    await sendApnsNotification(apnsTokens, payload);
    return;
  }
  if (fcmTokens.length) {
    console.log(`📱 [CALL] Sending FCM push to ${fcmTokens.length} device(s)`);
    await sendFcmNotification(fcmTokens, payload);
    return;
  }
  if (expoTokens.length) {
    console.log(`📱 [CALL] Sending Expo push to ${expoTokens.length} device(s)`);
    await sendPushNotification(expoTokens, payload);
    return;
  }
  console.warn('⚠️  [CALL] No push tokens found - cannot send call notification');
}

async function sendGroupCallNotification(user, callerName, chatId, callerId, callType, participantCount = 0) {
  if (!user) return;
  const callTypeText = callType === 'video' ? 'Video' : 'Thoại';
  const expoTokens = (user.pushTokens || []).map(pt => pt.token);
  const fcmTokens = (user.fcmTokens || []).map(pt => pt.token);
  const apnsVoipTokens = (user.apnsVoipTokens || []).map(pt => pt.token);
  const callUuid = crypto.randomUUID();

  const payload = {
    title: `Cuộc gọi nhóm ${callTypeText}`,
    body: `${callerName} đang bắt đầu cuộc gọi nhóm${participantCount > 0 ? ` (${participantCount} người)` : ''}`,
    sound: 'default',
    priority: 'high',
    channelId: 'calls',
    data: {
      type: 'group-call',
      chatId,
      callerId,
      callerName,
      callType: callType || 'voice',
      callUuid,
      action: 'incoming-group-call',
    },
  };

  if (apnsVoipTokens.length) {
    await sendApnsVoipNotification(apnsVoipTokens, { data: payload.data });
    return;
  }
  if (fcmTokens.length) {
    await sendFcmNotification(fcmTokens, payload);
    return;
  }
  if (expoTokens.length) {
    await sendPushNotification(expoTokens, payload);
  }
}

async function sendCallEndNotification(user, callerName, chatId, callerId) {
  if (!user) return;
  const expoTokens = (user.pushTokens || []).map(pt => pt.token);
  const fcmTokens = (user.fcmTokens || []).map(pt => pt.token);
  const apnsVoipTokens = (user.apnsVoipTokens || []).map(pt => pt.token);

  const payload = {
    title: 'Cuộc gọi đã kết thúc',
    body: `${callerName} đã kết thúc cuộc gọi`,
    sound: 'default',
    priority: 'high',
    channelId: 'calls',
    data: {
      type: 'call-end',
      chatId,
      callerId,
      callerName,
      action: 'call-ended',
    },
  };

  // Meta-like: avoid VoIP for call-end (prevents ghost calls on iOS).
  if (apnsVoipTokens.length) {
    console.log('⚠️  [CALL] Skipping call-end push for iOS VoIP tokens');
    return;
  }
  if (fcmTokens.length) {
    await sendFcmNotification(fcmTokens, payload);
    return;
  }
  if (expoTokens.length) {
    await sendPushNotification(expoTokens, payload);
  }
}

module.exports = {
  sendPushNotification,
  sendCallNotification,
  sendGroupCallNotification,
  sendCallEndNotification,
  sendApnsNotification,
  sendApnsNotificationWithReport,
  sendApnsVoipNotification,
  sendFcmNotification,
  getApnProvider,
  getFirebaseMessaging,
};
