const mongoose = require('mongoose');

const TeamSchema = new mongoose.Schema({
  program: { type: String, required: true, trim: true, default: 'FTC' },
  teamNumber: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  contact: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  city: { type: String, trim: true },
  state: { type: String, trim: true },
  country: { type: String, trim: true },
  lat: { type: Number, required: true },
  lon: { type: Number, required: true },
  notes: { type: String },
  recruiting: { type: Boolean, default: true },
  verified: { type: Boolean, default: false },
  verifiedAt: { type: Date },
  verificationSource: { type: String },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Team', TeamSchema);
