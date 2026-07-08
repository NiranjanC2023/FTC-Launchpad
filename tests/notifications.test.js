const assert = require('assert');
const notifications = require('../lib/notifications');

assert.strictEqual(typeof notifications.clearNotifications, 'function', 'clearNotifications should be exported');
console.log('notifications helper export check passed');
