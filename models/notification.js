const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  recipientEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
  type: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  body: { type: String, required: true, trim: true },
  link: { type: String, trim: true, default: '/account' },
  readAt: { type: Date },
  metadata: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now, index: true }
}, {
  collection: 'Notifications'
});

module.exports = mongoose.model('Notification', NotificationSchema, 'Notifications');
