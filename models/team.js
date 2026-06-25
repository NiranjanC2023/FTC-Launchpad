const mongoose = require('mongoose');

const TeamSchema = new mongoose.Schema({
  program: { type: String, required: true, trim: true, default: 'FTC' },
  teamNumber: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  contact: { type: String, required: true, trim: true },
  managers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  address: { type: String, required: true, trim: true },
  city: { type: String, trim: true },
  state: { type: String, trim: true },
  country: { type: String, trim: true },
  lat: { type: Number, required: true },
  lon: { type: Number, required: true },
  notes: { type: String },
  awards: { type: String, trim: true },
  awardHistory: [{ type: String, trim: true }],
  yearsInProgram: { type: Number, min: 0 },
  advancementLevels: [{ type: String, trim: true }],
  advancementHistory: [{ type: String, trim: true }],
  recruiting: { type: Boolean, default: true },
  verified: { type: Boolean, default: false },
  verifiedAt: { type: Date },
  verificationSource: { type: String },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Team', TeamSchema);
