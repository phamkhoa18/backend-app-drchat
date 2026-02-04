const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const CallHistory = require('../models/CallHistory');
const { auth } = require('../middleware/auth');
const { sendPushNotification, sendFcmNotification, sendApnsNotification } = require('../utils/pushNotifications');
const { decryptMessageContent } = require('../utils/messageEncryption');

const router = express.Router();

// Log when routes are loaded (for debugging)
console.log('✅ [ROUTES] Chats routes loaded - Media routes should be available');

// Helper function to normalize file URL to relative path
// Converts full URLs like http://172.20.10.3:3000/uploads/file.jpg to /uploads/file.jpg
function normalizeFileUrl(url) {
  if (!url) return url;
  
  // If it's already a relative path, return as is
  if (url.startsWith('/')) {
    return url;
  }
  
  // If it's a full URL, extract the path
  try {
    const urlObj = new URL(url);
    return urlObj.pathname;
  } catch (e) {
    // If URL parsing fails, try to extract path manually
    const match = url.match(/\/uploads\/[^?#]+/);
    if (match) {
      return match[0];
    }
    // Fallback: return as is if we can't parse it
    return url;
  }
}

async function ensureChatEncryptionKey(chat) {
  if (!chat.encryptionKey) {
    chat.encryptionKey = crypto.randomBytes(32).toString('base64');
    await chat.save();
  }
  return chat;
}

// Get or create 1:1 chat with admin
router.post('/admin-chat', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Find admin (first admin found)
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      return res.status(404).json({ message: 'No admin found' });
    }

    // Check if chat already exists - use $all and $size for exact match
    let chat = await Chat.findOne({
      isGroup: false,
      participants: { $all: [userId, admin._id], $size: 2 }
    }).populate('participants', 'phoneNumber role');

    if (!chat) {
      // Create new chat
      chat = new Chat({
        participants: [userId, admin._id],
        isGroup: false
      });
      await chat.save();
      await chat.populate('participants', 'phoneNumber role');
    }
    await ensureChatEncryptionKey(chat);

    res.json(chat);
  } catch (error) {
    console.error('Error in admin-chat:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get or create 1:1 chat with a specific user
router.post('/chat-with-user', auth, [
  body('userId').notEmpty().withMessage('User ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const currentUserId = req.user._id;
    const { userId: targetUserId } = req.body;

    if (currentUserId.toString() === targetUserId.toString()) {
      return res.status(400).json({ message: 'Cannot chat with yourself' });
    }

    // Check if target user exists
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if chat already exists - use $all and $size for exact match
    let chat = await Chat.findOne({
      isGroup: false,
      participants: { $all: [currentUserId, targetUserId], $size: 2 }
    }).populate('participants', 'phoneNumber role fullName avatar');

    if (!chat) {
      // Create new chat
      chat = new Chat({
        participants: [currentUserId, targetUserId],
        isGroup: false
      });
      await chat.save();
      await chat.populate('participants', 'phoneNumber role fullName avatar');
    }
    await ensureChatEncryptionKey(chat);

    res.json(chat);
  } catch (error) {
    console.error('Error in chat-with-user:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all chats for current user
router.get('/my-chats', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    const chats = await Chat.find({
      participants: userId
    })
    .populate('participants', 'phoneNumber role fullName avatar')
    .populate('groupId', 'name code avatar')
    .sort({ updatedAt: -1 });

    const chatsWithKeys = await Promise.all(
      chats.map((chat) => ensureChatEncryptionKey(chat))
    );

    // Get last message and unread count for each chat
    const chatsWithDetails = await Promise.all(chatsWithKeys.map(async (chat) => {
      // Get last message
        const lastMessage = await Message.findOne({ chat: chat._id })
          .populate('sender', 'phoneNumber role fullName avatar')
          .sort({ createdAt: -1 })
          .lean();

      // Count unread messages (messages not read by current user)
      const unreadCount = await Message.countDocuments({
        chat: chat._id,
        sender: { $ne: userId },
        readBy: { $not: { $elemMatch: { user: userId } } }
      });

      // Count missed calls (calls where user is receiver and status is missed, last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const missedCallsCount = await CallHistory.countDocuments({
        chat: chat._id,
        receiver: userId,
        status: 'missed',
        createdAt: { $gte: sevenDaysAgo }
      });

      return {
        ...chat.toObject(),
        lastMessage: lastMessage || null,
        unreadCount,
        missedCallsCount
      };
    }));

    res.json(chatsWithDetails);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get media count (images + videos) for a chat
// IMPORTANT: This route must be defined BEFORE /:chatId/messages to avoid route conflicts
router.get('/:chatId/media/count', auth, async (req, res) => {
  try {
    console.log('📊 [MEDIA COUNT] Request received for chatId:', req.params.chatId);
    const { chatId } = req.params;
    const userId = req.user._id;

    // Verify user is participant
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    
    const isParticipant = chat.participants.some(p => p.toString() === userId.toString());
    if (!isParticipant) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Count images and videos
    const totalMedia = await Message.countDocuments({
      chat: chatId,
      type: { $in: ['image', 'video'] },
      'file.url': { $exists: true, $ne: null }
    });

    console.log('📊 [MEDIA COUNT] Total media found:', totalMedia, 'for chatId:', chatId);

    res.json({
      success: true,
      data: {
        total: totalMedia
      }
    });
  } catch (error) {
    console.error('Error getting media count:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get media (images + videos) for a chat with pagination
// IMPORTANT: This route must be defined BEFORE /:chatId/messages to avoid route conflicts
router.get('/:chatId/media', auth, async (req, res) => {
  try {
    console.log('📸 [MEDIA] Request received for chatId:', req.params.chatId, 'limit:', req.query.limit);
    const { chatId } = req.params;
    const { limit = 30, beforeMessageId } = req.query;
    const userId = req.user._id;

    // Verify user is participant
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    
    const isParticipant = chat.participants.some(p => p.toString() === userId.toString());
    if (!isParticipant) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const limitNum = parseInt(limit, 10);
    const query = {
      chat: chatId,
      type: { $in: ['image', 'video'] },
      'file.url': { $exists: true, $ne: null }
    };

    // Get total count first
    const totalMedia = await Message.countDocuments(query);

    // If beforeMessageId is provided, load media before that message
    if (beforeMessageId) {
      const beforeMessage = await Message.findById(beforeMessageId);
      if (beforeMessage) {
        query.createdAt = { $lt: beforeMessage.createdAt };
        query._id = { $ne: beforeMessageId };
      } else {
        return res.json({
          success: true,
          data: {
            media: [],
            hasMore: false,
            total: totalMedia
          }
        });
      }
    }

    // Get media messages (newest first)
    const messages = await Message.find(query)
      .populate('sender', 'phoneNumber role fullName avatar')
      .sort({ createdAt: -1 })
      .limit(limitNum + 1)
      .lean();

    const hasMore = messages.length > limitNum;
    const result = hasMore ? messages.slice(0, limitNum) : messages;

    // Format media items
    const mediaItems = result.map((msg) => ({
      _id: msg._id,
      url: msg.file.url.startsWith('http') 
        ? msg.file.url 
        : msg.file.url.startsWith('/') 
          ? msg.file.url 
          : `/${msg.file.url}`,
      type: msg.type,
      thumbnailUrl: msg.file.thumbnailUrl 
        ? (msg.file.thumbnailUrl.startsWith('http') 
            ? msg.file.thumbnailUrl 
            : msg.file.thumbnailUrl.startsWith('/')
              ? msg.file.thumbnailUrl
              : `/${msg.file.thumbnailUrl}`)
        : undefined,
      createdAt: msg.createdAt,
      sender: msg.sender
    }));

    console.log('📸 [MEDIA] Returning', mediaItems.length, 'media items, hasMore:', hasMore, 'total:', totalMedia);

    res.json({
      success: true,
      data: {
        media: mediaItems,
        hasMore,
        total: totalMedia
      }
    });
  } catch (error) {
    console.error('❌ [MEDIA] Error loading media:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get messages for a chat with pagination
router.get('/:chatId/messages', auth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 30, beforeMessageId } = req.query; // Default 30 messages
    const userId = req.user._id;

    // Verify user is participant
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    
    const isParticipant = chat.participants.some(p => p.toString() === userId.toString());
    if (!isParticipant) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const limitNum = parseInt(limit, 10);
    const query = { chat: chatId };

    // If beforeMessageId is provided, load messages before that message (for pagination)
    if (beforeMessageId) {
      const beforeMessage = await Message.findById(beforeMessageId);
      if (beforeMessage) {
        // CRITICAL: Use $lt (less than) to get messages BEFORE the beforeMessage
        // Also exclude the beforeMessage itself to prevent duplicates
        query.createdAt = { $lt: beforeMessage.createdAt };
        query._id = { $ne: beforeMessageId }; // Exclude the beforeMessage itself
      } else {
        // If beforeMessage not found, return empty to prevent errors
        return res.json({
          messages: [],
          hasMore: false,
          total: await Message.countDocuments({ chat: chatId }),
        });
      }
    }

    // CRITICAL: Initial load must get NEWEST messages
    // - Initial load (no beforeMessageId): Get NEWEST messages → sort newest first → reverse to oldest first
    // - Load earlier (with beforeMessageId): Get OLDER messages → sort oldest first
    if (!beforeMessageId) {
      // Initial load: Get NEWEST messages using aggregation for better control
      const totalCount = await Message.countDocuments({ chat: chatId });
      
      // Get the newest messages - use simple find with sort
      // CRITICAL: Sort by createdAt: -1 (DESCENDING) to get NEWEST first
      const messages = await Message.find(query)
        .populate('sender', 'phoneNumber role fullName avatar')
        .populate({
          path: 'callHistory',
          select: 'callType status duration startedAt',
          options: { strictPopulate: false },
        })
        .sort({ createdAt: -1 }) // CRITICAL: -1 = DESCENDING = NEWEST first
        .limit(limitNum + 1)
        .lean();

      const hasMore = messages.length > limitNum;
      let result = hasMore ? messages.slice(0, limitNum) : messages;
      
      // Log BEFORE sort to verify we have newest messages
      if (result.length > 0) {
        const newestMsg = result[0]; // After sort -1, this should be newest
        const oldestInBatch = result[result.length - 1]; // This should be oldest in the 30 newest
        console.log('📥 BEFORE sort - After query with sort -1:');
        console.log('  - Index 0 (should be NEWEST):', new Date(newestMsg.createdAt).toISOString(), 'ID:', String(newestMsg._id));
        console.log('  - Last index (should be OLDEST in batch):', new Date(oldestInBatch.createdAt).toISOString(), 'ID:', String(oldestInBatch._id));
        console.log('  - Total in DB:', totalCount, 'Returned:', result.length);
        
        // Check if all messages have same createdAt (this would be a problem)
        const uniqueDates = new Set(result.map(m => new Date(m.createdAt).toISOString()));
        if (uniqueDates.size === 1) {
          console.error('❌ CRITICAL: All messages have the SAME createdAt!');
          console.error('❌ This means we cannot determine which is newest/oldest!');
          console.error('❌ All messages createdAt:', Array.from(uniqueDates)[0]);
        }
        
        // Verify we actually got NEWEST messages
        if (totalCount > limitNum) {
          // We should have the 30 newest messages
          // The first one (index 0) should be the newest in the entire chat
          console.log('  - ✅ We have', totalCount, 'total messages, returning', result.length, 'newest ones');
        }
      }
      
      // At this point: result = [newest, msg2, msg3, ..., oldest in batch]
      // Example: [msg100, msg99, msg98, ..., msg71] (30 newest messages)
      
      // Step 2: Sort to oldest first (ASCENDING) instead of reverse
      // This is more reliable - sort directly by createdAt ASCENDING
      // If createdAt is same, use _id as secondary sort
      result.sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        if (timeA !== timeB) {
          return timeA - timeB; // ASCENDING = oldest first
        }
        // If createdAt is same, use _id for consistent ordering
        return String(a._id).localeCompare(String(b._id));
      });
      
      // Verify after sort
      if (result.length > 0) {
        const firstAfterSort = new Date(result[0].createdAt);
        const lastAfterSort = new Date(result[result.length - 1].createdAt);
        console.log('📥 AFTER sort - First (should be oldest):', firstAfterSort.toISOString());
        console.log('📥 AFTER sort - Last (should be newest):', lastAfterSort.toISOString());
        console.log('📥 AFTER sort - First ID:', String(result[0]._id));
        console.log('📥 AFTER sort - Last ID:', String(result[result.length - 1]._id));
        
        if (lastAfterSort.getTime() < firstAfterSort.getTime()) {
          console.error('❌ CRITICAL: After sort, last is OLDER than first!');
          console.error('❌ This should never happen if sort worked correctly!');
        } else if (lastAfterSort.getTime() === firstAfterSort.getTime()) {
          console.warn('⚠️ WARNING: All messages have the SAME createdAt!');
          console.warn('⚠️ This might indicate a problem with message creation or database');
        } else {
          console.log('✅ VERIFIED: After sort, order is correct (oldest first, newest last)');
        }
      }

      // Remove duplicates
      const uniqueMessages = [];
      const seenIds = new Set();
      for (const msg of result) {
        const msgId = String(msg._id);
        if (!seenIds.has(msgId)) {
          seenIds.add(msgId);
          uniqueMessages.push(msg);
        }
      }

      // Final log and verification
      if (uniqueMessages.length > 0) {
        const firstDate = new Date(uniqueMessages[0].createdAt);
        const lastDate = new Date(uniqueMessages[uniqueMessages.length - 1].createdAt);
        console.log('📥 FINAL - Total messages in DB:', totalCount);
        console.log('📥 FINAL - Returned count:', uniqueMessages.length);
        console.log('📥 FINAL - First message (index 0, should be OLDEST):', firstDate.toISOString());
        console.log('📥 FINAL - Last message (last index, should be NEWEST):', lastDate.toISOString());
        console.log('📥 FINAL - Has more:', hasMore);
        
        // CRITICAL VERIFICATION: Last message MUST be newer than first message
        if (lastDate.getTime() <= firstDate.getTime()) {
          console.error('❌ CRITICAL ERROR: Last message is NOT newer than first message!');
          console.error('❌ This means we loaded OLD messages instead of NEW messages!');
          console.error('❌ First:', firstDate.toISOString());
          console.error('❌ Last:', lastDate.toISOString());
        } else {
          console.log('✅ VERIFIED: Last message is newer than first - CORRECT!');
          console.log('✅ Messages will be displayed: oldest at top, newest at bottom');
        }
      }

      return res.json({
        messages: uniqueMessages,
        hasMore,
        total: totalCount,
      });
    }

    // Load earlier: Get OLDER messages (sort by oldest first)
    console.log('📤 Loading earlier messages - beforeMessageId:', beforeMessageId);
    console.log('📤 Query:', JSON.stringify(query, null, 2));
    
    const messages = await Message.find(query)
      .populate('sender', 'phoneNumber role fullName avatar')
      .populate({
        path: 'callHistory',
        select: 'callType status duration startedAt',
        options: { strictPopulate: false },
      })
      .sort({ createdAt: 1 }) // Oldest first
      .limit(limitNum + 1)
      .lean();

    console.log('📤 Found', messages.length, 'messages older than beforeMessage');
    
    const hasMore = messages.length > limitNum;
    let result = hasMore ? messages.slice(0, limitNum) : messages;
    // No reverse needed - already oldest first
    
    // Log the result
    if (result.length > 0) {
      const firstMsg = result[0];
      const lastMsg = result[result.length - 1];
      console.log('📤 Load earlier result:');
      console.log('  - First (oldest):', new Date(firstMsg.createdAt).toISOString(), 'ID:', String(firstMsg._id));
      console.log('  - Last (newest in batch):', new Date(lastMsg.createdAt).toISOString(), 'ID:', String(lastMsg._id));
      console.log('  - Total returned:', result.length);
      console.log('  - Has more:', hasMore);
    } else {
      console.log('📤 No older messages found');
    }
    
    // Remove duplicates
    const uniqueMessages = [];
    const seenIds = new Set();
    for (const msg of result) {
      const msgId = String(msg._id);
      if (!seenIds.has(msgId)) {
        seenIds.add(msgId);
        uniqueMessages.push(msg);
      }
    }

    res.json({
      messages: uniqueMessages,
      hasMore,
      total: await Message.countDocuments({ chat: chatId }),
    });
  } catch (error) {
    console.error('Error loading messages:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Send message
router.post('/:chatId/messages', auth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;
    const { content, type, file, encryption, previewText } = req.body;

    // Verify user is participant
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const isParticipant = chat.participants.some(p => p.toString() === userId.toString());
    if (!isParticipant) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Normalize file URL to relative path if file exists
    let normalizedFile = file;
    if (file) {
      normalizedFile = {
        ...file,
        ...(file.url ? { url: normalizeFileUrl(file.url) } : {}),
        ...(file.thumbnailUrl ? { thumbnailUrl: normalizeFileUrl(file.thumbnailUrl) } : {})
      };
    }

    const message = new Message({
      chat: chatId,
      sender: userId,
      content,
      type: type || 'text',
      file: normalizedFile || undefined,
      encryption: encryption || undefined,
    });

    await message.save();
    await message.populate('sender', 'phoneNumber role fullName avatar');
    await message.populate('readBy.user', 'phoneNumber role fullName avatar');
    await message.populate({
      path: 'chat',
      populate: {
        path: 'groupId',
        select: 'name code'
      }
    });

    // Update chat updatedAt
    chat.updatedAt = new Date();
    await chat.save();

    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      // Prepare message data with chat info
      const messageData = {
        ...message.toObject(),
        chat: {
          _id: chat._id,
          isGroup: chat.isGroup,
          groupId: chat.groupId ? {
            _id: chat.groupId._id,
            name: chat.groupId.name,
            code: chat.groupId.code
          } : null
        },
        createdAt: message.createdAt
      };

      // Broadcast to all participants in the chat
      io.to(`chat:${chatId}`).emit('new-message', messageData);

      // Update chat list for all participants
      chat.participants.forEach(participantId => {
        io.to(`user:${participantId}`).emit('chat-updated', {
          chatId: chat._id,
          lastMessage: message
        });
      });

      // Push notification to offline participants
      const sender = await User.findById(userId).select('fullName phoneNumber').lean();
      const senderName = sender?.fullName || sender?.phoneNumber || 'Người dùng';
      const recipients = chat.participants.filter(p => p.toString() !== userId.toString());

      await Promise.all(recipients.map(async (participantId) => {
        try {
          // Always send push notification for messages.
          // Rationale: mobile apps may keep sockets connected in background,
          // which would otherwise suppress notifications.

          const recipient = await User.findById(participantId)
            .select('pushTokens fcmTokens apnsTokens')
            .lean();
          if (!recipient) return;

          const expoTokens = (recipient.pushTokens || []).map((t) => t.token).filter(Boolean);
          const fcmTokens = (recipient.fcmTokens || []).map((t) => t.token).filter(Boolean);
          const apnsTokens = (recipient.apnsTokens || []).map((t) => t.token).filter(Boolean);
          if (expoTokens.length === 0 && fcmTokens.length === 0 && apnsTokens.length === 0) return;

          const safePreview = typeof previewText === 'string' && previewText.trim()
            ? previewText.trim().slice(0, 120)
            : null;
          const decryptedPreview = !safePreview && encryption?.alg
            ? decryptMessageContent(content || '', encryption, chat.encryptionKey)
            : null;
          const contentLooksEncrypted = typeof content === 'string' && content.length > 24 && /^[A-Za-z0-9+/=]+$/.test(content);
          const body =
            safePreview ||
            (decryptedPreview ? decryptedPreview.slice(0, 120) : null) ||
            ((encryption?.alg || contentLooksEncrypted) ? '🔐 Tin nhắn mới' :
            type === 'image' ? '📷 Hình ảnh' :
            type === 'video' ? '🎥 Video' :
            type === 'audio' ? '🎤 Tin nhắn thoại' :
            type === 'file' ? '📎 Tệp đính kèm' :
            content || 'Tin nhắn mới');

          const payload = {
            title: chat.isGroup ? (chat.groupId?.name || 'Nhóm') : senderName,
            body,
            sound: 'default',
            priority: 'high',
            channelId: 'default',
            data: {
              type: 'message',
              chatId: String(chat._id),
              messageId: String(message._id),
              senderId: String(userId),
              senderName,
              isGroup: !!chat.isGroup,
            },
          };

          if (expoTokens.length) {
            await sendPushNotification(expoTokens, payload);
          }
          if (fcmTokens.length) {
            const invalidTokens = await sendFcmNotification(fcmTokens, payload);
            if (invalidTokens && invalidTokens.length > 0) {
              await User.updateOne(
                { _id: participantId },
                { $pull: { fcmTokens: { token: { $in: invalidTokens } } } }
              );
            }
          }
          if (apnsTokens.length) {
            const invalidTokens = await sendApnsNotification(apnsTokens, payload);
            if (invalidTokens && invalidTokens.length > 0) {
              await User.updateOne(
                { _id: participantId },
                { $pull: { apnsTokens: { token: { $in: invalidTokens } } } }
              );
            }
          }
        } catch (pushError) {
          console.error('Error sending push notification:', pushError);
        }
      }));
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Error sending message:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ 
        message: 'Validation error',
        errors: errors,
        details: error.message
      });
    }
    
    res.status(500).json({ 
      message: 'Server error',
      error: error.message || 'Unknown error'
    });
  }
});

// Mark message as read
router.post('/:chatId/messages/:messageId/read', auth, async (req, res) => {
  try {
    const { chatId, messageId } = req.params;
    const userId = req.user._id;

    // Verify user is participant
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    const isParticipant = chat.participants.some(p => p.toString() === userId.toString());
    if (!isParticipant) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Find message
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Check if already read by this user
    const alreadyRead = message.readBy.some(r => r.user.toString() === userId.toString());
    if (!alreadyRead) {
      message.readBy.push({
        user: userId,
        readAt: new Date()
      });
      await message.save();
    }

    await message.populate('readBy.user', 'phoneNumber role fullName avatar');

    res.json({ message: 'Message marked as read', readBy: message.readBy });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

