const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  passwordHash: { type: String, required: true },
  age: { type: Number },
  phone: { type: String, trim: true },
  profilePicture: { type: String, trim: true },
  interests: { type: String, trim: true },
  experience: { type: String, trim: true },
  teamNumber: { type: Number },
  passwordResetTokenHash: { type: String },
  passwordResetTokenExpiresAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
}, {
  collection: 'Users'
});

UserSchema.methods.setPassword = async function(password) {
  const hash = await bcrypt.hash(password, 10);
  this.passwordHash = hash;
};

UserSchema.methods.validatePassword = async function(password) {
  if (!this.passwordHash) return false;
  return await bcrypt.compare(password, this.passwordHash);
};

UserSchema.methods.createPasswordResetToken = function() {
  const token = crypto.randomBytes(32).toString('hex');
  this.passwordResetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
  this.passwordResetTokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60);
  return token;
};

UserSchema.index({ teamNumber: 1 });
UserSchema.index({ passwordResetTokenHash: 1, passwordResetTokenExpiresAt: 1 });

module.exports = mongoose.model('User', UserSchema, 'Users');
