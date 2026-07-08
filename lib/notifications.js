const Notification = require('../models/notification');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function createNotification(payload) {
  const recipientEmail = normalizeEmail(payload && payload.recipientEmail);
  if (!recipientEmail) return null;

  const notification = new Notification({
    recipientEmail,
    type: String(payload.type || 'info').trim() || 'info',
    title: String(payload.title || 'Notification').trim(),
    body: String(payload.body || '').trim(),
    link: String(payload.link || '/account').trim() || '/account',
    metadata: payload.metadata || undefined
  });

  return notification.save();
}

async function listNotifications(recipientEmail, limit = 50) {
  const normalizedEmail = normalizeEmail(recipientEmail);
  if (!normalizedEmail) return [];

  return Notification.find({ recipientEmail: normalizedEmail })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()
    .exec();
}

async function countUnreadNotifications(recipientEmail) {
  const normalizedEmail = normalizeEmail(recipientEmail);
  if (!normalizedEmail) return 0;

  return Notification.countDocuments({ recipientEmail: normalizedEmail, readAt: { $exists: false } }).exec();
}

async function markNotificationsRead(recipientEmail) {
  const normalizedEmail = normalizeEmail(recipientEmail);
  if (!normalizedEmail) return 0;

  const result = await Notification.updateMany(
    { recipientEmail: normalizedEmail, readAt: { $exists: false } },
    { $set: { readAt: new Date() } }
  ).exec();

  return typeof result.modifiedCount === 'number' ? result.modifiedCount : (result.nModified || 0);
}

async function clearNotifications(recipientEmail) {
  const normalizedEmail = normalizeEmail(recipientEmail);
  if (!normalizedEmail) return 0;

  const result = await Notification.deleteMany({ recipientEmail: normalizedEmail }).exec();
  return typeof result.deletedCount === 'number' ? result.deletedCount : 0;
}

function serializeNotification(notification) {
  if (!notification) return null;
  return {
    id: String(notification._id),
    type: notification.type || 'info',
    title: notification.title || 'Notification',
    body: notification.body || '',
    link: notification.link || '/account',
    createdAt: notification.createdAt || null,
    readAt: notification.readAt || null
  };
}

module.exports = {
  createNotification,
  listNotifications,
  countUnreadNotifications,
  markNotificationsRead,
  clearNotifications,
  serializeNotification,
  normalizeEmail
};
