const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  country: { type: String, trim: true },
  state: { type: String, trim: true },
  experience: { type: String },
  currentGrade: { type: String, trim: true, maxlength: 40 },
  email: { type: String },
  phone: { type: String },
  interests: { type: String },
  sentTeams: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Team' }],
  sentApplications: [{
    currentGrade: { type: String, trim: true, maxlength: 40 },
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

StudentSchema.index({ email: 1 });
StudentSchema.index({ 'sentApplications.team': 1, createdAt: -1 });
StudentSchema.index({ applicationTeam: 1, applicationStatus: 1 });

module.exports = mongoose.model('Student', StudentSchema);
