const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Friend = require('../models/Friend');
const { sendCallNotification, sendGroupCallNotification, sendCallEndNotification, sendPushNotification, sendFcmNotification, sendApnsNotification } = require('../utils/pushNotifications');
const { decryptMessageContent } = require('../utils/messageEncryption');

const recentCallEndPushes = new Map();
const CALL_END_PUSH_TTL_MS = 5000;

const shouldSendCallEndPush = (key) => {
  const now = Date.now();
  const lastSent = recentCallEndPushes.get(key);
  if (lastSent && now - lastSent < CALL_END_PUSH_TTL_MS) {
    return false;
  }
  recentCallEndPushes.set(key, now);
  // cleanup old keys
  for (const [k, ts] of recentCallEndPushes.entries()) {
    if (now - ts > CALL_END_PUSH_TTL_MS * 2) {
      recentCallEndPushes.delete(k);
    }
  }
  return true;
};

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

module.exports = (io) => {
  const pendingOffers = new Map();
  const OFFER_TTL_MS = 60 * 1000;

  const offerKey = (chatId, callerId, calleeId) =>
    `${chatId || ''}:${callerId || ''}:${calleeId || ''}`;

  const cleanupOffer = (chatId, callerId, calleeId) => {
    pendingOffers.delete(offerKey(chatId, callerId, calleeId));
  };

  const getFriendIds = async (userId) => {
    const friendships = await Friend.find({
      status: 'accepted',
      $or: [{ userId }, { friendId: userId }]
    }).select('userId friendId');

    const friendIds = new Set();
    friendships.forEach((f) => {
      if (String(f.userId) === String(userId)) {
        friendIds.add(String(f.friendId));
      } else {
        friendIds.add(String(f.userId));
      }
    });
    return Array.from(friendIds);
  };

  const emitPresenceToFriends = async (userId, isOnline, lastSeenAt = null) => {
    try {
      const friendIds = await getFriendIds(userId);
      friendIds.forEach((friendId) => {
        io.to(`user:${friendId}`).emit('presence-update', {
          userId,
          isOnline,
          lastSeenAt
        });
      });
    } catch (error) {
      console.error('Error emitting presence update:', error);
    }
  };

  // Authentication middleware for socket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret_key');
      const user = await User.findById(decoded.userId).select('-password');
      
      if (!user) {
        return next(new Error('Authentication error'));
      }

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.userId}`);

    // Join user's room
    socket.join(`user:${socket.userId}`);

    // Update online status and notify friends
    User.findByIdAndUpdate(socket.userId, {
      isOnline: true,
      lastSeenAt: null
    }).catch((error) => console.error('Error updating online status:', error));

    emitPresenceToFriends(socket.userId, true, null);

    // Send presence state of friends to current user
    (async () => {
      try {
        const friendIds = await getFriendIds(socket.userId);
        if (friendIds.length === 0) {
          socket.emit('presence-state', []);
          return;
        }
        const friends = await User.find({ _id: { $in: friendIds } })
          .select('_id isOnline lastSeenAt')
          .lean();
        socket.emit('presence-state', friends.map((f) => ({
          userId: String(f._id),
          isOnline: !!f.isOnline,
          lastSeenAt: f.lastSeenAt || null
        })));
      } catch (error) {
        console.error('Error sending presence state:', error);
      }
    })();

    // Join all chat rooms user is part of
    Chat.find({ participants: socket.userId }).then(chats => {
      chats.forEach(chat => {
        socket.join(`chat:${chat._id}`);
      });
    });

    // Handle join chat room
    socket.on('join-chat', async (chatId) => {
      try {
        const chat = await Chat.findById(chatId);
        if (chat && chat.participants.includes(socket.userId)) {
          socket.join(`chat:${chatId}`);
          socket.emit('joined-chat', chatId);
        }
      } catch (error) {
        socket.emit('error', { message: 'Failed to join chat' });
      }
    });

    // Handle new message
    socket.on('send-message', async (data, callback) => {
      try {
        const { chatId, content, type, file, encryption, previewText } = data;

        // Verify user is participant
        const chat = await Chat.findById(chatId);
        if (!chat) {
          socket.emit('error', { message: 'Chat not found' });
          return;
        }
        
        const isParticipant = chat.participants.some(p => p.toString() === socket.userId);
        if (!isParticipant) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Normalize file URL to relative path if file exists
        let normalizedFile = file;
        if (file && file.url) {
          normalizedFile = {
            ...file,
            url: normalizeFileUrl(file.url)
          };
        }

        // Create message
        const message = new Message({
          chat: chatId,
          sender: socket.userId,
          content,
          type: type || 'text',
          file: normalizedFile || undefined,
          encryption: encryption || undefined,
        });

        await message.save();
        await message.populate('sender', 'phoneNumber role fullName avatar');
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
        try {
          const sender = await User.findById(socket.userId).select('fullName phoneNumber').lean();
          const senderName = sender?.fullName || sender?.phoneNumber || 'Người dùng';
          const recipients = chat.participants.filter(p => p.toString() !== socket.userId.toString());

          await Promise.all(recipients.map(async (participantId) => {
            try {
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
                  senderId: String(socket.userId),
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
        } catch (pushError) {
          console.error('Error preparing push notification:', pushError);
        }
        if (typeof callback === 'function') {
          callback({ success: true, message: messageData });
        }
      } catch (error) {
        console.error('Error sending message via socket:', error);
        
        // Handle validation errors
        if (error.name === 'ValidationError') {
          const errors = Object.values(error.errors).map(e => e.message);
          console.error('Validation errors:', errors);
          const payload = { 
            message: 'Validation error',
            errors: errors,
            details: error.message
          };
          socket.emit('error', payload);
          if (typeof callback === 'function') {
            callback({ success: false, error: payload });
          }
        } else {
          const payload = { 
            message: 'Failed to send message',
            error: error.message || 'Unknown error'
          };
          socket.emit('error', payload);
          if (typeof callback === 'function') {
            callback({ success: false, error: payload });
          }
        }
      }
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
      const { chatId } = data;
      socket.to(`chat:${chatId}`).emit('user-typing', {
        userId: socket.userId,
        chatId
      });
    });

    // Handle stop typing
    socket.on('stop-typing', (data) => {
      const { chatId } = data;
      socket.to(`chat:${chatId}`).emit('user-stop-typing', {
        userId: socket.userId,
        chatId
      });
    });

    // Handle mark message as read
    socket.on('mark-message-read', async (data) => {
      try {
        const { chatId, messageId } = data;
        
        // Verify user is participant
        const chat = await Chat.findById(chatId);
        if (!chat) {
          socket.emit('error', { message: 'Chat not found' });
          return;
        }
        
        const isParticipant = chat.participants.some(p => p.toString() === socket.userId.toString());
        if (!isParticipant) {
          socket.emit('error', { message: 'Access denied' });
          return;
        }

        // Find message
        const message = await Message.findById(messageId);
        if (!message) {
          socket.emit('error', { message: 'Message not found' });
          return;
        }

        // Check if already read by this user
        const alreadyRead = message.readBy.some(r => r.user.toString() === socket.userId.toString());
        if (!alreadyRead) {
          message.readBy.push({
            user: socket.userId,
            readAt: new Date()
          });
          await message.save();
        }

        await message.populate('readBy.user', 'phoneNumber role');

        // Broadcast read status to all participants
        io.to(`chat:${chatId}`).emit('message-read', {
          chatId,
          messageId,
          readBy: message.readBy
        });
      } catch (error) {
        console.error('Error marking message as read:', error);
        socket.emit('error', { message: 'Failed to mark message as read' });
      }
    });

    // Handle call signaling (WebRTC + Socket.IO)
    const handleCallOffer = async (data) => {
      const { to, chatId, callType, channelName, offer, renegotiate } = data;
      console.log(`📞 [WebRTC] Call offer from ${socket.userId} to user:${to}, chatId: ${chatId}, type: ${callType || 'voice'}`);
      
      // Validate required fields
      if (!to || !chatId) {
        console.warn('⚠️  [CALL] call-offer missing required fields:', { to, chatId });
        socket.emit('error', { message: 'call-offer missing required fields' });
        return;
      }

      // Guard: prevent self-call offer (causes ghost incoming on caller)
      if (!to || String(to) === String(socket.userId)) {
        console.warn('⚠️  [CALL] Invalid call-offer target (self or missing). Skipping emit/push.', {
          from: socket.userId,
          to,
          chatId,
        });
        return;
      }
      
      // Check if receiver is online (has active socket connection)
      const receiverSockets = await io.in(`user:${to}`).fetchSockets();
      const isReceiverOnline = receiverSockets.length > 0;
      
      // Resolve caller name for socket payload and notifications
      let callerName = 'Người gọi';
      try {
        const caller = await User.findById(socket.userId).select('fullName phoneNumber');
        callerName = caller?.fullName || caller?.phoneNumber || callerName;
      } catch (error) {
        console.error('❌ [CALL] Error fetching caller info:', error);
      }

      // Always emit socket event (for real-time if online)
      const offerData = {
        from: socket.userId,
        chatId,
        callType: callType || 'voice',
        callerName,
        ...(channelName && { channelName }),
        ...(offer && { offer }), // WebRTC SDP offer
        ...(renegotiate && { renegotiate })
      };

      if (offer) {
        pendingOffers.set(offerKey(chatId, socket.userId, to), {
          offer: offerData.offer,
          callerName,
          callType: callType || 'voice',
          createdAt: Date.now(),
        });
      }
      
      io.to(`user:${to}`).emit('call-offer', offerData);
      
      // Skip push for renegotiation offers to avoid ghost calls.
      if (renegotiate) {
        console.log('ℹ️ [CALL] Renegotiation offer - skipping push');
        return;
      }

      // Meta-like:
      // - iOS (VoIP token present): send VoIP push ALWAYS (even if online) to ensure CallKit in background.
      // - Android: send push only when offline.
      try {
        const receiver = await User.findById(to).select('pushTokens fcmTokens apnsVoipTokens fullName phoneNumber');
        if (receiver) {
          const hasVoip = (receiver.apnsVoipTokens && receiver.apnsVoipTokens.length > 0);
          const hasFcmOrExpo = (receiver.pushTokens && receiver.pushTokens.length > 0) ||
            (receiver.fcmTokens && receiver.fcmTokens.length > 0);

          // IMPORTANT:
          // - iOS (VoIP): always push (CallKit needs wake-up in background)
          // - Android: also always push for calls because sockets can stay "online" when app is backgrounded,
          //   causing missed incoming calls if we only push on offline.
          // Dedupe/ignore duplicates should be handled client-side using chatId/callUuid.
          if (hasVoip || hasFcmOrExpo) {
            console.log(`📱 [CALL] Sending push to user ${to} (VoIP:${hasVoip}, online:${isReceiverOnline})`);
            await sendCallNotification(receiver, callerName, chatId, socket.userId, callType || 'voice');
            console.log(`✅ [CALL] Push notification sent for call to user ${to}`);
          } else if (!hasVoip && !hasFcmOrExpo) {
            console.log(`⚠️ [CALL] User ${to} has no push tokens registered - cannot send push notification`);
            console.log(`⚠️ [CALL] User needs to open app and register push token`);
          }
        } else {
          console.log(`⚠️ [CALL] User ${to} not found in database`);
        }
      } catch (error) {
        console.error('❌ [CALL] Error sending push notification for call:', error);
        console.error('❌ [CALL] Error details:', error.message);
      }
      
      if (isReceiverOnline) {
        console.log(`✅ Receiver ${to} is online, call also handled via socket`);
      } else {
        console.log(`📱 Receiver ${to} is offline, call handled via push notification only`);
      }
    };

    // Listen for call offers
    socket.on('call-offer', handleCallOffer);

    // Handle call answer (WebRTC)
    const handleCallAnswer = async (data) => {
      try {
        const { to, chatId, callType, channelName, answer, renegotiate } = data;
        console.log(`✅ [WebRTC] Call answer from ${socket.userId} to user:${to}, chatId: ${chatId}`);
        console.log(`✅ [WebRTC] Call answer data:`, JSON.stringify(data, null, 2));

        if (!to) {
          console.error('❌ [WebRTC] Call answer missing "to" field - cannot send answer');
          socket.emit('error', { message: 'Call answer missing recipient ID' });
          return;
        }

        const answerData = {
          from: socket.userId,
          chatId,
          callType: callType || 'voice',
          ...(channelName && { channelName }),
          ...(answer && { answer }), // WebRTC SDP answer
          ...(renegotiate && { renegotiate })
        };

        console.log(`🎯 [WebRTC] ========== EMITTING CALL-ANSWER ==========`);
        console.log(`📞 [WebRTC] Answer data:`, JSON.stringify(answerData, null, 2));
        console.log(`📞 [WebRTC] Sender (callee): ${socket.userId}`);
        console.log(`📞 [WebRTC] Recipient (caller): ${to}`);
        console.log(`📞 [WebRTC] Sending to room: user:${to}`);

        // CRITICAL: Check if sender and recipient are the same (should never happen)
        if (socket.userId === to) {
          console.error(`❌ [WebRTC] ERROR: Sender and recipient are the same! This should not happen.`);
          console.error(`❌ [WebRTC] Ignoring call-answer to prevent loop`);
          return;
        }

        // Check if recipient is online
        io.in(`user:${to}`).fetchSockets().then(sockets => {
          if (sockets.length > 0) {
            console.log(`✅ [WebRTC] Recipient ${to} is online (${sockets.length} socket(s))`);
            sockets.forEach((s, idx) => {
              console.log(`  Socket ${idx + 1}: ${s.id} | userId: ${s.userId} | connected: ${s.connected}`);
            });
          } else {
            console.log(`⚠️  [WebRTC] Recipient ${to} is offline (no sockets in room)`);
            // Also check if they're online but not in room
            io.fetchSockets().then(allSockets => {
              const recipientSockets = allSockets.filter(s => s.userId === to);
              if (recipientSockets.length > 0) {
                console.log(`⚠️  [WebRTC] Found ${recipientSockets.length} socket(s) for user ${to} but not in room!`);
              }
            });
          }
        }).catch(err => {
          console.error('❌ [WebRTC] Error checking recipient sockets:', err);
        });

        // Emit to recipient's room (NOT broadcast, to avoid sending to sender)
        io.to(`user:${to}`).emit('call-answer', answerData);
        console.log(`✅ [WebRTC] Call answer emitted to user:${to}`);
        console.log(`🎯 [WebRTC] ========================================`);
        cleanupOffer(chatId, to, socket.userId);
      } catch (error) {
        console.error('❌ [WebRTC] Error handling call answer:', error);
        socket.emit('error', { message: 'Failed to process call answer' });
      }
    };

    socket.on('call-answer', handleCallAnswer);

    socket.on('call-ice-candidate', (data) => {
      const { to, candidate, chatId } = data;
      io.to(`user:${to}`).emit('call-ice-candidate', {
        from: socket.userId,
        candidate,
        chatId
      });
    });

    socket.on('call-offer-request', (data) => {
      const { to, chatId } = data;
      if (!to || !chatId) {
        socket.emit('error', { message: 'call-offer-request missing required fields' });
        return;
      }
      if (String(to) === String(socket.userId)) {
        return;
      }
      const key = offerKey(chatId, to, socket.userId);
      const cached = pendingOffers.get(key);
      if (cached && Date.now() - cached.createdAt < OFFER_TTL_MS) {
        io.to(`user:${socket.userId}`).emit('call-offer', {
          from: to,
          chatId,
          callType: cached.callType,
          callerName: cached.callerName,
          offer: cached.offer,
        });
        return;
      }
      // Fallback: ask caller to re-send offer
      io.to(`user:${to}`).emit('call-offer-request', {
        from: socket.userId,
        chatId
      });
    });

    // Handle call end
    socket.on('call-end', async (data) => {
      const { to, chatId, callUuid } = data;
      console.log(`📴 [CALL] Call end from ${socket.userId} to user:${to}, chatId: ${chatId}`);
      
      // Validate required fields
      if (!to || !chatId) {
        console.warn('⚠️  [CALL] call-end missing required fields:', { to, chatId });
        socket.emit('error', { message: 'call-end missing required fields' });
        return;
      }

      // Guard: prevent self call-end (causes ghost notifications)
      if (!to || String(to) === String(socket.userId)) {
        console.warn('⚠️  [CALL] Invalid call-end target (self or missing). Skipping emit/push.', {
          from: socket.userId,
          to,
          chatId,
        });
        return;
      }
      cleanupOffer(chatId, socket.userId, to);
      io.to(`user:${to}`).emit('call-end', {
        from: socket.userId,
        chatId
      });
      
      // Meta-like: send call-end push only if receiver is offline
      try {
        const receiverSockets = await io.in(`user:${to}`).fetchSockets();
        const isReceiverOnline = receiverSockets.length > 0;
        if (!isReceiverOnline) {
          const dedupeKey = `${to}:${socket.userId}:${chatId || ''}:${callUuid || ''}`;
          if (!shouldSendCallEndPush(dedupeKey)) {
            console.log(`⚠️  [CALL] Skipping duplicate call-end push for key ${dedupeKey}`);
            return;
          }
          const receiver = await User.findById(to).select('pushTokens fcmTokens apnsVoipTokens fullName phoneNumber');
          if (receiver) {
            if ((receiver.pushTokens && receiver.pushTokens.length > 0) ||
                (receiver.fcmTokens && receiver.fcmTokens.length > 0) ||
                (receiver.apnsVoipTokens && receiver.apnsVoipTokens.length > 0)) {
              const caller = await User.findById(socket.userId).select('fullName phoneNumber');
              const callerName = caller?.fullName || caller?.phoneNumber || 'Người gọi';
              await sendCallEndNotification(receiver, callerName, chatId, socket.userId);
              console.log(`✅ [CALL] Push notification sent for call-end to user ${to}`);
            } else {
              console.log(`⚠️  [CALL] User ${to} has no push tokens registered`);
            }
          } else {
            console.log(`⚠️  [CALL] User ${to} not found for call-end`);
          }
        }
      } catch (error) {
        console.error('❌ [CALL] Error sending call-end push notification:', error);
      }
    });

    // Handle group call signaling
    socket.on('group-call-offer', async (data) => {
      const { to, chatId, callType, channelName, participants } = data;
      console.log(`📞 [GROUP-CALL] Group call offer from ${socket.userId} to ${to?.length || 0} users, chatId: ${chatId}, type: ${callType || 'voice'}`);
      
      // Emit to all participants except the caller
      if (Array.isArray(to)) {
        // Filter out the caller from the list of recipients
        const recipients = to.filter(userId => userId.toString() !== socket.userId.toString());
        console.log(`📞 [GROUP-CALL] Filtered recipients: ${recipients.length} users (removed caller ${socket.userId})`);
        
        // Get caller info for notification
        let callerName = 'Nhóm';
        try {
          const caller = await User.findById(socket.userId).select('fullName phoneNumber');
          if (caller) {
            callerName = caller.fullName || caller.phoneNumber || 'Nhóm';
          }
        } catch (error) {
          console.error('❌ [GROUP-CALL] Error fetching caller info:', error);
        }
        
        // Emit socket event AND send push notification to each recipient
        await Promise.all(recipients.map(async (userId) => {
          // Emit socket event (for real-time if online)
          io.to(`user:${userId}`).emit('group-call-offer', {
            from: socket.userId,
            chatId,
            callType: callType || 'voice',
            channelName,
            participants
          });
          console.log(`📞 [GROUP-CALL] Emitted group-call-offer to user:${userId}`);
          
          // Meta-like:
          // - iOS (VoIP token present): send VoIP push ALWAYS.
          // - Android: send push only when offline.
          try {
            const receiverSockets = await io.in(`user:${userId}`).fetchSockets();
            const isReceiverOnline = receiverSockets.length > 0;
            const receiver = await User.findById(userId).select('pushTokens fcmTokens apnsVoipTokens fullName phoneNumber');
            if (receiver) {
              const hasVoip = (receiver.apnsVoipTokens && receiver.apnsVoipTokens.length > 0);
              const hasFcmOrExpo = (receiver.pushTokens && receiver.pushTokens.length > 0) ||
                (receiver.fcmTokens && receiver.fcmTokens.length > 0);
              // Same reasoning as 1:1 calls: don't rely on socket "online" for Android background.
              if (hasVoip || hasFcmOrExpo) {
                const participantCount = participants?.length || 0;
                await sendGroupCallNotification(
                  receiver,
                  callerName,
                  chatId,
                  socket.userId,
                  callType || 'voice',
                  participantCount
                );
                console.log(`✅ [GROUP-CALL] Push notification sent for group call to user ${userId}`);
              } else if (!hasVoip && !hasFcmOrExpo) {
                console.log(`⚠️ [GROUP-CALL] User ${userId} has no push tokens registered - cannot send push notification`);
              }
            } else {
              console.log(`⚠️ [GROUP-CALL] User ${userId} not found in database`);
            }
          } catch (error) {
            console.error(`❌ [GROUP-CALL] Error sending push notification for group call to user ${userId}:`, error);
            console.error('❌ [GROUP-CALL] Error details:', error.message);
          }
        }));
      }
    });

    socket.on('group-call-answer', (data) => {
      const { chatId, channelName } = data;
      console.log(`✅ Group call answer from ${socket.userId}, chatId: ${chatId}`);
      
      // Broadcast to all users in the chat room (not just one user)
      // Get chat participants from database or use chat room
      io.to(`chat:${chatId}`).emit('group-call-user-joined', {
        userId: socket.userId,
        chatId,
        channelName,
        participant: {
          userId: socket.userId,
          name: socket.userId, // Will be updated by client
        }
      });
    });

    socket.on('group-call-end', (data) => {
      const { chatId } = data;
      console.log(`📴 [GROUP-CALL] Group call end from ${socket.userId}, chatId: ${chatId}`);
      
      // Broadcast to all users in the chat room
      io.to(`chat:${chatId}`).emit('group-call-user-left', {
        userId: socket.userId,
        chatId
      });
      
      // Also emit group-call-end to notify all participants
      io.to(`chat:${chatId}`).emit('group-call-end', {
        chatId
      });
    });

    // Handle group call audio streaming (FREE CALL)
    socket.on('group-call-audio', (data) => {
      const { chatId, channelName, audioData } = data;
      // Forward audio data to all participants in the group call
      io.to(`chat:${chatId}`).emit('group-call-audio', {
        from: socket.userId,
        chatId,
        channelName,
        audioData
      });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.userId}`);
      const lastSeenAt = new Date();
      // Leave relevant rooms to prevent leaks
      socket.rooms.forEach((room) => {
        if (room.startsWith('chat:') || room.startsWith('user:')) {
          socket.leave(room);
        }
      });
      User.findByIdAndUpdate(socket.userId, {
        isOnline: false,
        lastSeenAt
      }).catch((error) => console.error('Error updating offline status:', error));
      emitPresenceToFriends(socket.userId, false, lastSeenAt);
    });

    socket.on('presence-get', async () => {
      try {
        const friendIds = await getFriendIds(socket.userId);
        if (friendIds.length === 0) {
          socket.emit('presence-state', []);
          return;
        }
        const friends = await User.find({ _id: { $in: friendIds } })
          .select('_id isOnline lastSeenAt')
          .lean();
        socket.emit('presence-state', friends.map((f) => ({
          userId: String(f._id),
          isOnline: !!f.isOnline,
          lastSeenAt: f.lastSeenAt || null
        })));
      } catch (error) {
        console.error('Error responding to presence-get:', error);
      }
    });
  });
};

