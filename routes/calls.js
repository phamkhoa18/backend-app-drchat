const express = require('express');
const CallHistory = require('../models/CallHistory');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Create call history record
router.post('/history', auth, async (req, res) => {
  try {
    const { chatId, callType, status, duration, startedAt, endedAt, callerId, receiverId } = req.body;
    const userId = req.user._id;

    // Prevent duplicate call history - check if similar call history exists in last 5 seconds
    const fiveSecondsAgo = new Date(Date.now() - 5000);
    const existingCall = await CallHistory.findOne({
      chat: chatId,
      createdAt: { $gte: fiveSecondsAgo },
      status: status,
    }).sort({ createdAt: -1 });

    if (existingCall) {
      console.log('⚠️ Duplicate call history prevented for chat:', chatId);
      // Return existing call history without creating new message
      return res.json({
        success: true,
        data: {
          callHistory: existingCall,
          message: null
        }
      });
    }

    // Get chat to find participants
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Find the other participant
    const otherParticipantId = chat.participants.find(
      (p) => p.toString() !== userId.toString()
    );

    if (!otherParticipantId) {
      return res.status(400).json({ message: 'Invalid chat participants' });
    }

    // Determine caller and receiver - CRITICAL LOGIC
    // Telegram/Zalo style: Caller is always the person who initiated the call
    // - If receiverId provided: current user (from auth) is caller, receiverId is receiver (OUTGOING call)
    // - If callerId provided: callerId is caller, current user (from auth) is receiver (INCOMING call)
    // - If both provided: use them directly (shouldn't happen normally)
    // - Otherwise: infer from status (fallback)
    let caller, receiver;
    
    if (callerId && receiverId) {
      // Both explicitly provided - use them directly (shouldn't happen in normal flow)
      console.log('⚠️ [CALL] Both callerId and receiverId provided - using directly');
      caller = callerId;
      receiver = receiverId;
    } else if (receiverId) {
      // Only receiverId provided - OUTGOING call
      // Current user (from auth) initiated the call, so they are the caller
      console.log('📞 [CALL] OUTGOING call - userId is caller, receiverId is receiver');
      caller = userId; // Current user is caller
      receiver = receiverId; // Provided receiverId is receiver
    } else if (callerId) {
      // Only callerId provided - INCOMING call
      // Other user initiated the call, so they are the caller
      console.log('📞 [CALL] INCOMING call - callerId is caller, userId is receiver');
      caller = callerId; // Provided callerId is caller
      receiver = userId; // Current user is receiver
    } else if (status === 'missed') {
      // Current user missed the call (they are receiver)
      console.log('📞 [CALL] MISSED call - otherParticipant is caller, userId is receiver');
      caller = otherParticipantId;
      receiver = userId;
    } else if (status === 'declined') {
      // Current user declined (they are receiver)
      console.log('📞 [CALL] DECLINED call - otherParticipant is caller, userId is receiver');
      caller = otherParticipantId;
      receiver = userId;
    } else {
      // For answered/cancelled without IDs, assume current user is caller (they initiated)
      console.log('📞 [CALL] FALLBACK - userId is caller, otherParticipant is receiver');
      caller = userId;
      receiver = otherParticipantId;
    }
    
    console.log('📞 [CALL] Final caller/receiver:', { caller, receiver, status, userId });

    const callHistory = new CallHistory({
      chat: chatId,
      caller,
      receiver,
      callType: callType || 'voice',
      status,
      duration: duration || 0,
      startedAt: startedAt || new Date(),
      endedAt: endedAt || new Date(),
    });

    await callHistory.save();
    await callHistory.populate('caller receiver', 'phoneNumber fullName avatar');

    // Create a message for the call history (like Zalo/Messenger)
    // Caller is always the sender of the call message
    const callMessage = new Message({
      chat: chatId,
      sender: caller, // Caller is the sender of the message
      content: getCallMessageText(callHistory.status, callHistory.callType, callHistory.duration),
      type: 'call',
      createdAt: callHistory.startedAt || new Date(),
    });

    await callMessage.save();
    await callMessage.populate('sender', 'phoneNumber fullName avatar');
    await callMessage.populate({
      path: 'chat',
      populate: {
        path: 'groupId',
        select: 'name code'
      }
    });

    // Update chat updatedAt
    chat.updatedAt = new Date();
    await chat.save();

    // Emit new message event via socket
    const io = req.app.get('io');
    if (io) {
      const messageData = {
        ...callMessage.toObject(),
        chat: {
          _id: chat._id,
          isGroup: chat.isGroup,
          groupId: chat.groupId ? {
            _id: chat.groupId._id,
            name: chat.groupId.name,
            code: chat.groupId.code
          } : null
        },
        callHistory: {
          _id: callHistory._id,
          callType: callHistory.callType,
          status: callHistory.status,
          duration: callHistory.duration,
          startedAt: callHistory.startedAt,
        }
      };

      io.to(`chat:${chatId}`).emit('new-message', messageData);

      // Update chat list for all participants
      chat.participants.forEach(participantId => {
        io.to(`user:${participantId}`).emit('chat-updated', {
          chatId: chat._id,
          lastMessage: callMessage
        });
      });
    }

    res.json({
      success: true,
      data: {
        callHistory,
        message: callMessage
      }
    });
  } catch (error) {
    console.error('Error creating call history:', error);
    res.status(500).json({ message: 'Error creating call history', error: error.message });
  }
});

// Get call history for a chat
router.get('/history/:chatId', auth, async (req, res) => {
  try {
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

    const calls = await CallHistory.find({ chat: chatId })
      .populate('caller receiver', 'phoneNumber fullName avatar')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ success: true, data: calls });
  } catch (error) {
    console.error('Error getting call history:', error);
    res.status(500).json({ message: 'Error getting call history', error: error.message });
  }
});

// Get missed calls count for user
router.get('/missed-count', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    const missedCount = await CallHistory.countDocuments({
      receiver: userId,
      status: 'missed',
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
    });

    res.json({ success: true, data: { count: missedCount } });
  } catch (error) {
    console.error('Error getting missed calls count:', error);
    res.status(500).json({ message: 'Error getting missed calls count', error: error.message });
  }
});

// Helper function to generate call message text
function getCallMessageText(status, callType, duration) {
  const callTypeText = callType === 'video' ? 'video' : 'thoại';
  
  switch (status) {
    case 'missed':
      return `Cuộc gọi ${callTypeText} nhỡ`;
    case 'answered':
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;
      if (minutes > 0) {
        return `Cuộc gọi ${callTypeText} ${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
      return `Cuộc gọi ${callTypeText} ${seconds}s`;
    case 'declined':
      return `Cuộc gọi ${callTypeText} đã từ chối`;
    case 'cancelled':
      return `Cuộc gọi ${callTypeText} đã hủy`;
    default:
      return `Cuộc gọi ${callTypeText}`;
  }
}

module.exports = router;

