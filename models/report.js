const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reporterName: { type: String, required: true, trim: true },
  reporterEmail: { type: String, required: true, trim: true, lowercase: true },
  targetType: { type: String, enum: ['team', 'user'], required: true },
  targetTeam: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  contextTeam: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
  targetName: { type: String, required: true, trim: true },
  targetEmail: { type: String, trim: true, lowercase: true },
  reason: {
    type: String,
    enum: ['spam_or_scam', 'inappropriate_content', 'impersonation', 'privacy_or_safety', 'other'],
    required: true
  },
  details: { type: String, trim: true },
  status: { type: String, enum: ['open', 'reviewed', 'resolved', 'dismissed'], default: 'open' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ reporter: 1, createdAt: -1 });
ReportSchema.index({ targetTeam: 1, createdAt: -1 });
ReportSchema.index({ targetUser: 1, createdAt: -1 });

module.exports = mongoose.model('Report', ReportSchema);
