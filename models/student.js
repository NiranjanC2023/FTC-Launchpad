const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  age: { type: String },
  experience: { type: String },
  email: { type: String },
  phone: { type: String },
  interests: { type: String },
  applicationTeam: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  applicationStatus: { type: String, enum: ['pending', 'accepted', 'waitlisted', 'rejected'], default: null },
  statusMessage: { type: String },
  statusUpdatedAt: { type: Date },
  statusBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  requestCount: { type: Number, default: 0 },
  lastRequestAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Student', StudentSchema);
