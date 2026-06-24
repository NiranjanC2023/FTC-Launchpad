const mongoose = require('mongoose');

const ManagerInviteSchema = new mongoose.Schema({
  team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  token: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) },
  acceptedAt: { type: Date }
}, {
  collection: 'ManagerInvites'
});

module.exports = mongoose.model('ManagerInvite', ManagerInviteSchema);