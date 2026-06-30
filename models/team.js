const mongoose = require('mongoose');

const TeamSchema = new mongoose.Schema({
  program: { type: String, required: true, trim: true, default: 'FTC' },
  teamNumber: { type: Number, unique: true, sparse: true },
  isNewTeam: { type: Boolean, default: false },
  name: { type: String, required: true },
  contact: { type: String, required: true, trim: true },
  managers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  managerRoles: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, trim: true }
  }],
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
  competitionRegionLabel: { type: String, trim: true },
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
