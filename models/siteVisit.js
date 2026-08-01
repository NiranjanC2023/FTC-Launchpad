const mongoose = require('mongoose');

const SiteVisitSchema = new mongoose.Schema({
  path: { type: String, required: true, trim: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  referrer: { type: String, trim: true },
  userAgent: { type: String, trim: true },
  createdAt: { type: Date, default: Date.now, index: true }
}, {
  collection: 'SiteVisits'
});

SiteVisitSchema.index({ createdAt: -1 });
SiteVisitSchema.index({ path: 1, createdAt: -1 });

module.exports = mongoose.model('SiteVisit', SiteVisitSchema, 'SiteVisits');
