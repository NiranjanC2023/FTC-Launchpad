const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  passwordHash: { type: String, required: true },
  age: { type: Number },
  phone: { type: String, trim: true },
  interests: { type: String, trim: true },
  teamNumber: { type: Number },
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

module.exports = mongoose.model('User', UserSchema, 'Users');
