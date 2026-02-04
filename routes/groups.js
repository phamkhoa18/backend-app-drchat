const express = require('express');
const Group = require('../models/Group');
const Chat = require('../models/Chat');
const { auth, isAdmin } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');

const router = express.Router();

// Generate unique group code
const generateGroupCode = () => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};

// Create group (all authenticated users)
router.post('/create', auth, [
  body('name').trim().notEmpty().withMessage('Group name is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name } = req.body;
    let code = generateGroupCode();

    // Ensure code is unique
    while (await Group.findOne({ code })) {
      code = generateGroupCode();
    }

    const group = new Group({
      name,
      code,
      createdBy: req.user._id,
      members: [req.user._id]
    });

    await group.save();

    // Create chat for the group
    const chat = new Chat({
      participants: [req.user._id],
      isGroup: true,
      groupId: group._id
    });
    await chat.save();

    await group.populate('createdBy', 'phoneNumber');
    await group.populate('members', 'phoneNumber role');
    res.status(201).json(group);
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Join group by code (all users - clients can join with code)
router.post('/join', auth, [
  body('code').trim().notEmpty().withMessage('Group code is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { code } = req.body;
    const userId = req.user._id;

    const group = await Group.findOne({ code });
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check if already a member
    const isMember = group.members.some(m => m.toString() === userId.toString());
    if (isMember) {
      return res.status(400).json({ message: 'Already a member of this group' });
    }

    // Add user to group
    group.members.push(userId);
    await group.save();

    // Find or create chat for this group
    let chat = await Chat.findOne({ groupId: group._id });
    if (chat) {
      const isParticipant = chat.participants.some(p => p.toString() === userId.toString());
      if (!isParticipant) {
        chat.participants.push(userId);
        await chat.save();
      }
    } else {
      chat = new Chat({
        participants: group.members,
        isGroup: true,
        groupId: group._id
      });
      await chat.save();
    }

    await group.populate('createdBy', 'phoneNumber');
    await group.populate('members', 'phoneNumber role');
    res.json(group);
  } catch (error) {
    console.error('Error joining group:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get groups user is member of (MUST BE BEFORE /:groupId route)
router.get('/my-groups', auth, async (req, res) => {
  try {
    const userId = req.user._id;

    const groups = await Group.find({ members: userId })
      .populate('createdBy', 'phoneNumber')
      .populate('members', 'phoneNumber role')
      .select('name code avatar createdBy members createdAt')
      .sort({ createdAt: -1 });

    res.json(groups);
  } catch (error) {
    console.error('Error loading my-groups:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all groups (admin only)
router.get('/', auth, isAdmin, async (req, res) => {
  try {
    const groups = await Group.find()
      .populate('createdBy', 'phoneNumber')
      .populate('members', 'phoneNumber role')
      .sort({ createdAt: -1 });

    res.json(groups);
  } catch (error) {
    console.error('Error loading groups:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add member to group (all authenticated users) - MUST BE BEFORE /:groupId route
router.post('/:groupId/add-member', auth, [
  body('userId').notEmpty().withMessage('User ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { groupId } = req.params;
    const { userId } = req.body;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const isMember = group.members.some(m => m.toString() === userId.toString());
    if (isMember) {
      return res.status(400).json({ message: 'User already in group' });
    }

    group.members.push(userId);
    await group.save();

    // Update chat participants
    const chat = await Chat.findOne({ groupId });
    if (chat) {
      const isParticipant = chat.participants.some(p => p.toString() === userId.toString());
      if (!isParticipant) {
        chat.participants.push(userId);
        await chat.save();
      }
    }

    await group.populate('createdBy', 'phoneNumber');
    await group.populate('members', 'phoneNumber role');
    res.json(group);
  } catch (error) {
    console.error('Error adding member:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get base URL for group links (public endpoint)
router.get('/config', (req, res) => {
  const baseUrl = process.env.BASE_URL || `http://${req.get('host')}`;
  res.json({ baseUrl });
});

// Get group info by chat ID
router.get('/chat/:chatId', auth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    // Find chat and verify user is participant
    const chat = await Chat.findOne({ _id: chatId, participants: userId });
    if (!chat || !chat.isGroup || !chat.groupId) {
      return res.status(404).json({ message: 'Group chat not found' });
    }

    const group = await Group.findById(chat.groupId)
      .populate('createdBy', 'phoneNumber fullName avatar')
      .populate('members', 'phoneNumber role fullName avatar');

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    res.json(group);
  } catch (error) {
    console.error('Error loading group info:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update group (name, avatar) - admin or member
router.put('/:groupId', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user._id;
    const { name, avatar } = req.body;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check if user is member or admin
    const isMember = group.members.some(m => m.toString() === userId.toString());
    const isAdmin = req.user.role === 'admin';
    
    if (!isMember && !isAdmin) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Update fields
    if (name !== undefined) {
      group.name = name;
    }
    if (avatar !== undefined) {
      // Normalize avatar URL to relative path only
      let normalizedAvatar = avatar;
      if (normalizedAvatar && normalizedAvatar.startsWith('http')) {
        try {
          const urlObj = new URL(normalizedAvatar);
          normalizedAvatar = urlObj.pathname;
        } catch (e) {
          // If URL parsing fails, try to extract path manually
          const match = normalizedAvatar.match(/\/uploads\/[^?#]+/);
          if (match) {
            normalizedAvatar = match[0];
          }
        }
      }
      // Ensure it starts with /
      if (normalizedAvatar && !normalizedAvatar.startsWith('/')) {
        normalizedAvatar = `/${normalizedAvatar}`;
      }
      group.avatar = normalizedAvatar;
    }

    await group.save();
    await group.populate('createdBy', 'phoneNumber fullName avatar');
    await group.populate('members', 'phoneNumber role fullName avatar');

    res.json(group);
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Remove member from group - admin or creator only
router.delete('/:groupId/members/:memberId', auth, async (req, res) => {
  try {
    const { groupId, memberId } = req.params;
    const userId = req.user._id;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Only admin or creator can remove members
    const isAdmin = req.user.role === 'admin';
    const isCreator = group.createdBy.toString() === userId.toString();
    
    if (!isAdmin && !isCreator) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Remove member
    group.members = group.members.filter(m => m.toString() !== memberId);
    await group.save();

    // Update chat participants
    const chat = await Chat.findOne({ groupId });
    if (chat) {
      chat.participants = chat.participants.filter(p => p.toString() !== memberId);
      await chat.save();
    }

    await group.populate('createdBy', 'phoneNumber fullName avatar');
    await group.populate('members', 'phoneNumber role fullName avatar');

    res.json(group);
  } catch (error) {
    console.error('Error removing member:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get group by ID (MUST BE LAST to avoid conflicts)
router.get('/:groupId', auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user._id;

    const group = await Group.findById(groupId)
      .populate('createdBy', 'phoneNumber fullName avatar')
      .populate('members', 'phoneNumber role fullName avatar');

    if (!group) {
      return res.status(404).json({ message: 'Group not found' });
    }

    // Check if user is member
    const isMember = group.members.some(m => m._id.toString() === userId.toString());
    if (!isMember && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(group);
  } catch (error) {
    console.error('Error loading group:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
