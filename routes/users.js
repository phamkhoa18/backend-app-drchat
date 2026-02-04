const express = require('express');
const User = require('../models/User');
const Friend = require('../models/Friend');
const { auth, isAdmin } = require('../middleware/auth');

const router = express.Router();

// Helper to get io instance
const getIO = (req) => {
  return req.app.get('io');
};

// Get all users (admin only, for selecting admin for 1:1 chat)
router.get('/admin', auth, async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin' }).select('-password');
    res.json(admins);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all clients (admin only)
router.get('/clients', auth, isAdmin, async (req, res) => {
  try {
    const clients = await User.find({ role: 'client' }).select('-password');
    res.json(clients);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get friend requests (sent and received) - MUST be before /:userId route
router.get('/friend-requests', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get received requests (pending, where current user is friendId)
    const receivedRequests = await Friend.find({
      friendId: userId,
      status: 'pending'
    })
    .populate({
      path: 'userId',
      select: 'phoneNumber fullName avatar role',
      model: 'User'
    })
    .lean(); // Use lean() to get plain objects

    // Get sent requests (pending, where current user is userId)
    const sentRequests = await Friend.find({
      userId: userId,
      status: 'pending'
    })
    .populate({
      path: 'friendId',
      select: 'phoneNumber fullName avatar role',
      model: 'User'
    })
    .lean(); // Use lean() to get plain objects

    // Filter and map received requests
    const received = [];
    for (const r of receivedRequests) {
      if (r.userId && r.userId._id) {
        received.push({
          _id: r._id,
          user: {
            _id: r.userId._id.toString(),
            phoneNumber: r.userId.phoneNumber || '',
            fullName: r.userId.fullName || '',
            avatar: r.userId.avatar || null,
            role: r.userId.role || 'user'
          },
          createdAt: r.createdAt
        });
      }
    }

    // Filter and map sent requests
    const sent = [];
    for (const r of sentRequests) {
      if (r.friendId && r.friendId._id) {
        sent.push({
          _id: r._id,
          user: {
            _id: r.friendId._id.toString(),
            phoneNumber: r.friendId.phoneNumber || '',
            fullName: r.friendId.fullName || '',
            avatar: r.friendId.avatar || null,
            role: r.friendId.role || 'user'
          },
          createdAt: r.createdAt
        });
      }
    }

    res.json({
      received,
      sent
    });
  } catch (error) {
    console.error('Error in friend-requests endpoint:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Find user by phone number (exact match) - MUST be before /:userId route
router.get('/by-phone/:phoneNumber', auth, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const currentUserId = req.user._id;

    if (!phoneNumber || !phoneNumber.trim()) {
      return res.status(400).json({ message: 'Phone number is required' });
    }

    const user = await User.findOne({ phoneNumber: phoneNumber.trim() }).select(
      '_id phoneNumber fullName avatar role'
    );
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user._id.toString() === currentUserId.toString()) {
      return res.status(400).json({ message: 'Cannot search yourself' });
    }

    return res.json(user);
  } catch (error) {
    console.error('Error in /users/by-phone endpoint:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user by ID (for QR code scanning and viewing friend profiles) - MUST be after specific routes
router.get('/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;

    // Validate userId is a valid ObjectId
    if (!userId || !require('mongoose').Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }

    // Don't allow getting own profile via this endpoint (use /auth/me instead)
    if (userId === currentUserId.toString()) {
      return res.status(400).json({ message: 'Cannot get own profile' });
    }

    // Find user
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Allow getting any user's profile (for friends, admins, etc.)
    // No additional restrictions - any authenticated user can view any other user's profile
    res.json(user);
  } catch (error) {
    console.error('Error in /users/:userId endpoint:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Send friend request
router.post('/send-friend-request', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { friendId } = req.body;

    if (!friendId) {
      return res.status(400).json({ message: 'Friend ID is required' });
    }

    if (userId.toString() === friendId) {
      return res.status(400).json({ message: 'Cannot add yourself as friend' });
    }

    // Check if friend exists
    const friend = await User.findById(friendId);
    if (!friend) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if friendship already exists
    const existingFriendship = await Friend.findOne({
      $or: [
        { userId, friendId },
        { userId: friendId, friendId: userId }
      ]
    });

    if (existingFriendship) {
      if (existingFriendship.status === 'accepted') {
        return res.status(400).json({ message: 'Already friends' });
      }
      if (existingFriendship.status === 'pending') {
        return res.status(400).json({ message: 'Friend request already sent' });
      }
    }

    // Create friend request (only one direction - pending)
    const friendRequest = new Friend({
      userId,
      friendId,
      status: 'pending'
    });

    await friendRequest.save();
    await friendRequest.populate('userId', 'phoneNumber fullName avatar role');

    // Emit socket event to notify the receiver
    const io = getIO(req);
    if (io) {
      const sender = await User.findById(userId).select('phoneNumber fullName avatar');
      io.to(`user:${friendId}`).emit('friend-request-received', {
        requestId: friendRequest._id,
        sender: {
          _id: sender._id,
          phoneNumber: sender.phoneNumber,
          fullName: sender.fullName,
          avatar: sender.avatar,
          role: sender.role
        },
        createdAt: friendRequest.createdAt
      });
    }

    res.json({ 
      message: 'Friend request sent successfully',
      request: friendRequest
    });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Friend request already sent' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Accept friend request
router.post('/accept-friend-request', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { requestId } = req.body;

    if (!requestId) {
      return res.status(400).json({ message: 'Request ID is required' });
    }

    // Find the friend request (where current user is the receiver)
    const friendRequest = await Friend.findById(requestId).populate('userId', 'phoneNumber fullName avatar role');
    
    if (!friendRequest) {
      return res.status(404).json({ message: 'Friend request not found' });
    }

    // Verify this request is for the current user
    if (friendRequest.friendId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Not authorized to accept this request' });
    }

    if (friendRequest.status !== 'pending') {
      return res.status(400).json({ message: 'Request is not pending' });
    }

    // Update request to accepted
    friendRequest.status = 'accepted';
    await friendRequest.save();

    // Create reverse friendship (bidirectional)
    const reverseFriendship = await Friend.findOne({
      userId: friendRequest.friendId,
      friendId: friendRequest.userId
    });

    if (reverseFriendship) {
      reverseFriendship.status = 'accepted';
      await reverseFriendship.save();
    } else {
      const newFriendship = new Friend({
        userId: friendRequest.friendId,
        friendId: friendRequest.userId,
        status: 'accepted'
      });
      await newFriendship.save();
    }

    // Emit socket event to notify the sender that request was accepted
    const io = getIO(req);
    if (io) {
      const accepter = await User.findById(userId).select('phoneNumber fullName avatar');
      io.to(`user:${friendRequest.userId}`).emit('friend-request-accepted', {
        friend: {
          _id: accepter._id,
          phoneNumber: accepter.phoneNumber,
          fullName: accepter.fullName,
          avatar: accepter.avatar,
          role: accepter.role
        }
      });
    }

    res.json({ 
      message: 'Friend request accepted',
      friend: {
        _id: friendRequest.userId._id,
        phoneNumber: friendRequest.userId.phoneNumber,
        fullName: friendRequest.userId.fullName,
        avatar: friendRequest.userId.avatar,
        role: friendRequest.userId.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Decline friend request
router.post('/decline-friend-request', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { requestId } = req.body;

    if (!requestId) {
      return res.status(400).json({ message: 'Request ID is required' });
    }

    const friendRequest = await Friend.findById(requestId);
    
    if (!friendRequest) {
      return res.status(404).json({ message: 'Friend request not found' });
    }

    if (friendRequest.friendId.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Not authorized to decline this request' });
    }

    // Delete the request
    await Friend.findByIdAndDelete(requestId);

    res.json({ message: 'Friend request declined' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});


// Check friendship status
router.get('/friendship-status/:friendId', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { friendId } = req.params;

    const friendship = await Friend.findOne({
      $or: [
        { userId, friendId },
        { userId: friendId, friendId: userId }
      ]
    });

    if (!friendship) {
      return res.json({ status: 'none' });
    }

    // If current user is the sender, return status as is
    if (friendship.userId.toString() === userId.toString()) {
      return res.json({ 
        status: friendship.status,
        requestId: friendship._id,
        isSender: true
      });
    } else {
      // If current user is the receiver, return status
      return res.json({ 
        status: friendship.status,
        requestId: friendship._id,
        isSender: false
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get friends list
router.get('/friends/list', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get friends from both directions (where user is sender or receiver)
    const friendships = await Friend.find({
      $or: [
        { userId, status: 'accepted' },
        { friendId: userId, status: 'accepted' }
      ]
    })
    .populate('userId', 'phoneNumber fullName avatar role isOnline lastSeenAt')
    .populate('friendId', 'phoneNumber fullName avatar role isOnline lastSeenAt')
    .lean();

    // Map to get the friend (the other user, not current user) and remove duplicates
    const friendsMap = new Map();
    
    for (const f of friendships) {
      let friend;
      if (f.userId && f.userId._id && f.userId._id.toString() === userId.toString()) {
        // Current user is the sender, friend is the receiver
        friend = f.friendId;
      } else if (f.friendId && f.friendId._id && f.friendId._id.toString() === userId.toString()) {
        // Current user is the receiver, friend is the sender
        friend = f.userId;
      }
      
      // Only add if friend exists and not already in map (avoid duplicates)
      if (friend && friend._id && !friendsMap.has(friend._id.toString())) {
        friendsMap.set(friend._id.toString(), {
          _id: friend._id.toString(),
          phoneNumber: friend.phoneNumber || '',
          fullName: friend.fullName || '',
          avatar: friend.avatar || null,
          role: friend.role || 'user',
          isOnline: !!friend.isOnline,
          lastSeenAt: friend.lastSeenAt || null
        });
      }
    }

    // Convert map to array
    const friends = Array.from(friendsMap.values());

    res.json(friends);
  } catch (error) {
    console.error('Error in friends/list endpoint:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

