const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');

// Register push token
router.post('/register', auth, async (req, res) => {
  try {
    const { expoPushToken } = req.body;
    const userId = req.user._id;

    if (!expoPushToken) {
      return res.status(400).json({ message: 'Expo push token is required' });
    }

    // Update user with push token
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Store push token (add to array to support multiple devices)
    if (!user.pushTokens) {
      user.pushTokens = [];
    }

    // Check if token already exists
    const tokenExists = user.pushTokens.some(token => token.token === expoPushToken);
    if (!tokenExists) {
      user.pushTokens.push({
        token: expoPushToken,
        createdAt: new Date(),
        lastUsed: new Date()
      });
      await user.save();
      console.log(`✅ Push token registered for user ${userId}: ${expoPushToken}`);
    } else {
      // Update lastUsed timestamp
      const tokenIndex = user.pushTokens.findIndex(t => t.token === expoPushToken);
      if (tokenIndex !== -1) {
        user.pushTokens[tokenIndex].lastUsed = new Date();
        await user.save();
      }
    }

    res.json({ 
      message: 'Push token registered successfully',
      token: expoPushToken
    });
  } catch (error) {
    console.error('Error registering push token:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Register native push tokens (FCM/VoIP)
router.post('/register-native', auth, async (req, res) => {
  try {
    const { fcmToken, apnsVoipToken, apnsToken } = req.body;
    const userId = req.user._id;

    if (!fcmToken && !apnsVoipToken && !apnsToken) {
      return res.status(400).json({ message: 'FCM or APNs token is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (fcmToken) {
      if (!user.fcmTokens) {
        user.fcmTokens = [];
      }
      const tokenExists = user.fcmTokens.some(token => token.token === fcmToken);
      if (!tokenExists) {
        user.fcmTokens.push({
          token: fcmToken,
          createdAt: new Date(),
          lastUsed: new Date()
        });
      } else {
        const tokenIndex = user.fcmTokens.findIndex(t => t.token === fcmToken);
        if (tokenIndex !== -1) {
          user.fcmTokens[tokenIndex].lastUsed = new Date();
        }
      }
    }

    if (apnsVoipToken) {
      if (!user.apnsVoipTokens) {
        user.apnsVoipTokens = [];
      }
      const tokenExists = user.apnsVoipTokens.some(token => token.token === apnsVoipToken);
      if (!tokenExists) {
        user.apnsVoipTokens.push({
          token: apnsVoipToken,
          createdAt: new Date(),
          lastUsed: new Date()
        });
      } else {
        const tokenIndex = user.apnsVoipTokens.findIndex(t => t.token === apnsVoipToken);
        if (tokenIndex !== -1) {
          user.apnsVoipTokens[tokenIndex].lastUsed = new Date();
        }
      }
    }

    if (apnsToken) {
      if (!user.apnsTokens) {
        user.apnsTokens = [];
      }
      const tokenExists = user.apnsTokens.some(token => token.token === apnsToken);
      if (!tokenExists) {
        user.apnsTokens.push({
          token: apnsToken,
          createdAt: new Date(),
          lastUsed: new Date()
        });
      } else {
        const tokenIndex = user.apnsTokens.findIndex(t => t.token === apnsToken);
        if (tokenIndex !== -1) {
          user.apnsTokens[tokenIndex].lastUsed = new Date();
        }
      }
    }

    await user.save();

    res.json({
      message: 'Native push tokens registered successfully',
      fcmToken: fcmToken || null,
      apnsVoipToken: apnsVoipToken || null,
      apnsToken: apnsToken || null
    });
  } catch (error) {
    console.error('Error registering native push tokens:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Unregister native push tokens (FCM/VoIP)
router.post('/unregister-native', auth, async (req, res) => {
  try {
    const { fcmToken, apnsVoipToken, apnsToken } = req.body;
    const userId = req.user._id;

    if (!fcmToken && !apnsVoipToken && !apnsToken) {
      return res.status(400).json({ message: 'FCM or APNs token is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (fcmToken && user.fcmTokens?.length) {
      user.fcmTokens = user.fcmTokens.filter(token => token.token !== fcmToken);
    }

    if (apnsVoipToken && user.apnsVoipTokens?.length) {
      user.apnsVoipTokens = user.apnsVoipTokens.filter(token => token.token !== apnsVoipToken);
    }

    if (apnsToken && user.apnsTokens?.length) {
      user.apnsTokens = user.apnsTokens.filter(token => token.token !== apnsToken);
    }

    await user.save();

    res.json({ message: 'Native push tokens unregistered successfully' });
  } catch (error) {
    console.error('Error unregistering native push tokens:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Unregister push token
router.post('/unregister', auth, async (req, res) => {
  try {
    const { expoPushToken } = req.body;
    const userId = req.user._id;

    if (!expoPushToken) {
      return res.status(400).json({ message: 'Expo push token is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Remove push token
    if (user.pushTokens && user.pushTokens.length > 0) {
      user.pushTokens = user.pushTokens.filter(token => token.token !== expoPushToken);
      await user.save();
      console.log(`✅ Push token unregistered for user ${userId}: ${expoPushToken}`);
    }

    res.json({ message: 'Push token unregistered successfully' });
  } catch (error) {
    console.error('Error unregistering push token:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all push tokens for a user (for testing)
router.get('/tokens', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('pushTokens fcmTokens apnsVoipTokens apnsTokens');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ 
      tokens: user.pushTokens || [],
      fcmTokens: user.fcmTokens || [],
      apnsVoipTokens: user.apnsVoipTokens || [],
      apnsTokens: user.apnsTokens || [],
      count: user.pushTokens?.length || 0,
      fcmCount: user.fcmTokens?.length || 0,
      apnsVoipCount: user.apnsVoipTokens?.length || 0,
      apnsCount: user.apnsTokens?.length || 0
    });
  } catch (error) {
    console.error('Error getting push tokens:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Test push notification (send test push - NO AUTH REQUIRED)
// Can pass userId or token in body
router.post('/test', async (req, res) => {
  try {
    const { type = 'call', callType = 'voice', userId, token } = req.body;
    
    let user;
    
    // If userId provided, use it directly
    if (userId) {
      user = await User.findById(userId);
    } 
    // If token provided, verify and get user
    else if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
        user = await User.findById(decoded.userId).select('-password');
      } catch (error) {
        return res.status(401).json({ message: 'Invalid token', error: error.message });
      }
    }
    // If no auth provided, try to get from header (optional)
    else {
      const authHeader = req.header('Authorization')?.replace('Bearer ', '');
      if (authHeader) {
        try {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(authHeader, process.env.JWT_SECRET || 'secret_key');
          user = await User.findById(decoded.userId).select('-password');
        } catch (error) {
          // Continue without auth if token invalid
        }
      }
    }
    
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found. Provide userId or token in body, or Authorization header.' 
      });
    }
    
    const actualUserId = user._id;

    const { sendPushNotification, sendCallNotification, sendApnsVoipNotification, sendFcmNotification, sendApnsNotification } = require('../utils/pushNotifications');
    const crypto = require('crypto');
    const callUuid = crypto.randomUUID();

    console.log(`🧪 [TEST] Sending test ${type} push notification to user ${actualUserId}`);

    if (type === 'call' || type === 'voip') {
      // Test VoIP push notification
      const expoTokens = (user.pushTokens || []).map(pt => pt.token);
      const fcmTokens = (user.fcmTokens || []).map(pt => pt.token);
      const apnsVoipTokens = (user.apnsVoipTokens || []).map(pt => pt.token);

      const payload = {
        title: `🧪 Test ${callType === 'video' ? 'Video' : 'Voice'} Call`,
        body: 'Đây là test push notification từ server',
        sound: 'default',
        priority: 'high',
        channelId: 'calls',
        data: {
          type: 'call',
          chatId: 'test-chat-id',
          callerId: actualUserId.toString(),
          callerName: 'Test Caller',
          callType: callType || 'voice',
          callUuid,
          action: 'incoming-call',
          isTest: true,
        },
      };

      const results = {
        expo: { sent: 0, tokens: expoTokens.length },
        fcm: { sent: 0, tokens: fcmTokens.length },
        voip: { sent: 0, tokens: apnsVoipTokens.length },
      };

      if (expoTokens.length > 0) {
        try {
          await sendPushNotification(expoTokens, payload);
          results.expo.sent = expoTokens.length;
        } catch (error) {
          console.error('Error sending Expo push:', error);
        }
      }

      if (fcmTokens.length > 0) {
        try {
          await sendFcmNotification(fcmTokens, payload);
          results.fcm.sent = fcmTokens.length;
        } catch (error) {
          console.error('Error sending FCM push:', error);
        }
      }

      if (apnsVoipTokens.length > 0) {
        try {
          await sendApnsVoipNotification(apnsVoipTokens, { data: payload.data });
          results.voip.sent = apnsVoipTokens.length;
        } catch (error) {
          console.error('Error sending VoIP push:', error);
        }
      }

      res.json({
        success: true,
        message: 'Test push notification sent',
        type: 'call',
        callType,
        callUuid,
        results,
      });
    } else {
      // Test regular push notification
      const expoTokens = (user.pushTokens || []).map(pt => pt.token);
      const fcmTokens = (user.fcmTokens || []).map(pt => pt.token);
      const apnsTokens = (user.apnsTokens || []).map(pt => pt.token);
      const payload = {
        title: '🧪 Test Push Notification',
        body: 'Đây là test push notification từ server',
        sound: 'default',
        priority: 'high',
        data: {
          type: 'test',
          message: 'Test notification',
        },
      };

      const results = {
        expo: { sent: 0, tokens: expoTokens.length },
        fcm: { sent: 0, tokens: fcmTokens.length },
        apns: { sent: 0, tokens: apnsTokens.length },
      };
      if (expoTokens.length > 0) {
        try {
          await sendPushNotification(expoTokens, payload);
          results.expo.sent = expoTokens.length;
        } catch (error) {
          console.error('Error sending test push:', error);
        }
      }
      if (fcmTokens.length > 0) {
        try {
          await sendFcmNotification(fcmTokens, payload);
          results.fcm.sent = fcmTokens.length;
        } catch (error) {
          console.error('Error sending FCM test push:', error);
        }
      }
      if (apnsTokens.length > 0) {
        try {
          await sendApnsNotification(apnsTokens, payload);
          results.apns.sent = apnsTokens.length;
        } catch (error) {
          console.error('Error sending APNs test push:', error);
        }
      }

      res.json({
        success: true,
        message: 'Test push notification sent',
        type: 'regular',
        results,
      });
    }
  } catch (error) {
    console.error('Error sending test push notification:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Test MESSAGE push notification (NO AUTH REQUIRED)
// Body: { userId: "...", title?: string, body?: string }
router.post('/test-message', async (req, res) => {
  try {
    const { userId, title, body } = req.body || {};
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const {
      sendPushNotification,
      sendFcmNotification,
      sendApnsNotificationWithReport,
    } = require('../utils/pushNotifications');

    const expoTokens = (user.pushTokens || []).map(pt => pt.token);
    const fcmTokens = (user.fcmTokens || []).map(pt => pt.token);
    const apnsTokens = (user.apnsTokens || []).map(pt => pt.token);

    const payload = {
      title: title || '🧪 Test Message',
      body: body || 'Test message notification (kill app)',
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      data: {
        type: 'message',
        chatId: 'test-chat-id',
        messageId: 'test-message-id',
        senderId: userId,
        senderName: 'Test Sender',
        isGroup: false,
        isTest: true,
      },
    };

    const results = {
      expo: { sent: 0, tokens: expoTokens.length },
      fcm: { sent: 0, tokens: fcmTokens.length },
      apns: { sent: 0, tokens: apnsTokens.length, report: null },
    };

    // IMPORTANT:
    // - If APNs device tokens exist, prefer APNs over Expo for iOS reliability
    // - Expo push for iOS requires Expo project APNs credentials; if missing it will always fail.
    if (fcmTokens.length > 0) {
      try {
        await sendFcmNotification(fcmTokens, payload);
        results.fcm.sent = fcmTokens.length;
      } catch (error) {
        console.error('Error sending FCM test message push:', error);
      }
    }
    if (apnsTokens.length > 0) {
      try {
        const report = await sendApnsNotificationWithReport(apnsTokens, payload);
        results.apns.sent = report?.sent || 0;
        results.apns.report = {
          configured: report?.configured,
          bundleId: report?.bundleId,
          production: report?.production,
          sent: report?.sent,
          failed: report?.failed,
          // Return only distinct reasons (no device tokens)
          failureReasons: Array.from(new Set((report?.failures || []).map((f) => String(f?.reason || 'unknown')))),
        };
      } catch (error) {
        console.error('Error sending APNs test message push:', error);
      }
    }
    if (apnsTokens.length === 0 && expoTokens.length > 0) {
      try {
        await sendPushNotification(expoTokens, payload);
        results.expo.sent = expoTokens.length;
      } catch (error) {
        console.error('Error sending Expo test message push:', error);
      }
    }

    return res.json({
      success: true,
      message: 'Test message notification sent',
      results,
    });
  } catch (error) {
    console.error('Error sending test message notification:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
});

const sendAndroidMessageTest = async (params, res) => {
  try {
    const { userId, title, body } = params || {};
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { sendFcmNotification } = require('../utils/pushNotifications');
    const fcmTokens = (user.fcmTokens || []).map(pt => pt.token).filter(Boolean);
    if (fcmTokens.length === 0) {
      return res.status(400).json({ message: 'No FCM tokens for user' });
    }

    const payload = {
      title: title || '🧪 Test Android Message',
      body: body || 'Android message notification (background/kill)',
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      data: {
        type: 'message',
        chatId: 'test-chat-id',
        messageId: 'test-message-id',
        senderId: userId,
        senderName: 'Test Sender',
        isGroup: false,
        isTest: true,
      },
    };

    const invalidTokens = await sendFcmNotification(fcmTokens, payload);
    if (invalidTokens && invalidTokens.length > 0) {
      await User.updateOne(
        { _id: userId },
        { $pull: { fcmTokens: { token: { $in: invalidTokens } } } }
      );
    }

    return res.json({
      success: true,
      message: 'Android message push sent (FCM)',
      tokens: fcmTokens.length,
      invalidTokens: invalidTokens?.length || 0,
    });
  } catch (error) {
    console.error('Error sending android message push:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// Test ANDROID message push via FCM only (NO AUTH REQUIRED)
// Body: { userId: "...", title?: string, body?: string }
router.post('/test-android-message', async (req, res) => {
  return sendAndroidMessageTest(req.body, res);
});
// Query: ?userId=...&title=...&body=...
router.get('/test-android-message', async (req, res) => {
  return sendAndroidMessageTest(req.query, res);
});

const sendAndroidCallTest = async (params, res) => {
  try {
    const { userId, callType = 'voice' } = params || {};
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { sendFcmNotification } = require('../utils/pushNotifications');
    const crypto = require('crypto');
    const callUuid = crypto.randomUUID();

    const fcmTokens = (user.fcmTokens || []).map(pt => pt.token).filter(Boolean);
    if (fcmTokens.length === 0) {
      return res.status(400).json({ message: 'No FCM tokens for user' });
    }

    const payload = {
      title: `🧪 Test Android ${callType === 'video' ? 'Video' : 'Voice'} Call`,
      body: 'Android call notification (background/kill)',
      sound: 'default',
      priority: 'high',
      channelId: 'calls',
      data: {
        type: 'call',
        chatId: 'test-chat-id',
        callerId: userId,
        callerName: 'Test Caller',
        callType: callType || 'voice',
        callUuid,
        action: 'incoming-call',
        isTest: true,
      },
    };

    const invalidTokens = await sendFcmNotification(fcmTokens, payload);
    if (invalidTokens && invalidTokens.length > 0) {
      await User.updateOne(
        { _id: userId },
        { $pull: { fcmTokens: { token: { $in: invalidTokens } } } }
      );
    }

    return res.json({
      success: true,
      message: 'Android call push sent (FCM)',
      callUuid,
      tokens: fcmTokens.length,
      invalidTokens: invalidTokens?.length || 0,
    });
  } catch (error) {
    console.error('Error sending android call push:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

// Test ANDROID call push via FCM only (NO AUTH REQUIRED)
// Body: { userId: "...", callType?: "voice"|"video" }
router.post('/test-android-call', async (req, res) => {
  return sendAndroidCallTest(req.body, res);
});
// Query: ?userId=...&callType=voice|video
router.get('/test-android-call', async (req, res) => {
  return sendAndroidCallTest(req.query, res);
});

// Test APNs keys configuration (check if keys are valid, don't send keys to client) - NO AUTH REQUIRED
router.get('/test-keys', async (req, res) => {
  try {
    const { getApnProvider } = require('../utils/pushNotifications');
    const provider = getApnProvider();
    
    const keyId = process.env.APNS_VOIP_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const bundleId = process.env.APNS_VOIP_BUNDLE_ID;
    const production = process.env.APNS_PRODUCTION === 'true';
    const hasKey = !!process.env.APNS_VOIP_KEY;

    res.json({
      success: true,
      apns: {
        configured: !!provider,
        keyId: keyId || null,
        teamId: teamId || null,
        bundleId: bundleId || null,
        production,
        hasKey: hasKey,
        // Don't send actual key content for security
      },
      message: provider 
        ? 'APNs keys are configured' 
        : 'APNs keys are missing or invalid',
    });
  } catch (error) {
    console.error('Error checking APNs keys:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error', 
      error: error.message 
    });
  }
});

module.exports = router;

