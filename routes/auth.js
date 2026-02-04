const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'secret_key', { expiresIn: '7d' });
};

// Register
router.post('/register', [
  body('phoneNumber').trim().isLength({ min: 10 }).withMessage('Phone number must be at least 10 digits'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { phoneNumber, password, role, fullName } = req.body;

    // Check if user exists
    let user = await User.findOne({ phoneNumber });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Only allow admin role to be set during registration if explicitly provided
    // In production, you might want to restrict this further
    const userRole = role === 'admin' ? 'admin' : 'client';

    user = new User({
      phoneNumber,
      password,
      fullName: fullName || '',
      role: userRole
    });

    await user.save();

    const token = generateToken(user._id);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        fullName: user.fullName,
        avatar: user.avatar,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Register Guest (Quick Account)
router.post('/register-guest', async (req, res) => {
  try {
    // Generate unique phone number for guest (using timestamp + random)
    let phoneNumber;
    let userExists = true;
    while (userExists) {
      phoneNumber = `guest_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const existingUser = await User.findOne({ phoneNumber });
      if (!existingUser) {
        userExists = false;
      }
    }

    // Create guest user with default name
    const user = new User({
      phoneNumber,
      fullName: 'Tài khoản Guest',
      role: 'guest',
      password: '' // Empty password for guest
    });

    await user.save();

    const token = generateToken(user._id);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        fullName: user.fullName,
        avatar: user.avatar,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
router.post('/login', [
  body('phoneNumber').trim().notEmpty().withMessage('Phone number is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { phoneNumber, password } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Guest users cannot login with password
    if (user.role === 'guest') {
      return res.status(400).json({ message: 'Guest account cannot login with password. Please use quick account creation.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);

    res.json({
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        fullName: user.fullName,
        avatar: user.avatar,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Check if phone number exists (for login flow)
router.post('/check-phone', [
  body('phoneNumber').trim().notEmpty().withMessage('Phone number is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { phoneNumber } = req.body;
    const user = await User.findOne({ phoneNumber: phoneNumber.trim() });
    
    if (!user) {
      return res.status(404).json({ 
        exists: false, 
        message: 'Số điện thoại chưa được đăng ký' 
      });
    }

    // Check if it's a guest account
    if (user.role === 'guest') {
      return res.status(400).json({ 
        exists: true,
        isGuest: true,
        message: 'Tài khoản guest không thể đăng nhập bằng mật khẩu' 
      });
    }

    return res.json({ 
      exists: true,
      isGuest: false,
      message: 'Số điện thoại đã được đăng ký' 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user._id,
        phoneNumber: req.user.phoneNumber,
        fullName: req.user.fullName,
        avatar: req.user.avatar,
        role: req.user.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { fullName, avatar } = req.body;
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (fullName !== undefined) {
      user.fullName = fullName.trim();
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
      user.avatar = normalizedAvatar;
    }

    await user.save();

    res.json({
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        fullName: user.fullName,
        avatar: user.avatar,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Forgot password - Request reset
router.post('/forgot-password', [
  body('phoneNumber').trim().notEmpty().withMessage('Phone number is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { phoneNumber } = req.body;
    const user = await User.findOne({ phoneNumber: phoneNumber.trim() });

    if (!user) {
      return res.status(404).json({ message: 'Số điện thoại không tồn tại' });
    }

    if (user.role === 'guest') {
      return res.status(400).json({ message: 'Tài khoản Guest không thể đặt lại mật khẩu' });
    }

    // In a real app, you would send an OTP via SMS here
    // For now, we'll just return success (OTP would be sent in production)
    res.json({ 
      message: 'Mã OTP đã được gửi đến số điện thoại của bạn',
      phoneNumber: phoneNumber.trim()
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reset password with OTP (simplified - in production, verify OTP)
router.post('/reset-password', [
  body('phoneNumber').trim().notEmpty().withMessage('Phone number is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('otp').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { phoneNumber, newPassword, otp } = req.body;
    const user = await User.findOne({ phoneNumber: phoneNumber.trim() });

    if (!user) {
      return res.status(404).json({ message: 'Số điện thoại không tồn tại' });
    }

    if (user.role === 'guest') {
      return res.status(400).json({ message: 'Tài khoản Guest không thể đặt lại mật khẩu' });
    }

    // In production, verify OTP here
    // For now, we'll skip OTP verification for development

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Mật khẩu đã được đặt lại thành công' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Change password (requires authentication)
router.put('/change-password', auth, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'guest') {
      return res.status(400).json({ message: 'Tài khoản Guest không thể đổi mật khẩu' });
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Mật khẩu đã được thay đổi thành công' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user profile (admin only, for guest users)
router.put('/users/:userId/profile', auth, async (req, res) => {
  try {
    // Check if current user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only admin can update user profiles' });
    }

    const { userId } = req.params;
    const { fullName, phoneNumber } = req.body;

    // Find the target user
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Only allow updating guest users
    if (targetUser.role !== 'guest') {
      return res.status(400).json({ message: 'Can only update guest user profiles' });
    }

    // Update fields
    if (fullName !== undefined) {
      targetUser.fullName = fullName.trim();
    }
    if (phoneNumber !== undefined && phoneNumber.trim()) {
      // Check if phone number already exists (except for current user)
      const existingUser = await User.findOne({ 
        phoneNumber: phoneNumber.trim(),
        _id: { $ne: userId }
      });
      if (existingUser) {
        return res.status(400).json({ message: 'Số điện thoại đã được sử dụng' });
      }
      targetUser.phoneNumber = phoneNumber.trim();
    }

    await targetUser.save();

    res.json({
      user: {
        id: targetUser._id,
        phoneNumber: targetUser.phoneNumber,
        fullName: targetUser.fullName,
        avatar: targetUser.avatar,
        role: targetUser.role
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

