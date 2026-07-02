const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  age: { type: String },
  experience: { type: String },
  email: { type: String },
  phone: { type: String },
  interests: { type: String },
  sentTeams: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
  sentApplications: [{
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    status: { type: String, enum: ['pending', 'accepted', 'waitlisted', 'rejected'], default: 'pending' },
    message: { type: String },
    updatedAt: { type: Date, default: Date.now }
  }],
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
