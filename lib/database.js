const mongoose = require('mongoose');

function isDatabaseConnected() {
    return mongoose.connection.readyState === 1;
}

function waitForDatabase(timeoutMs = 5000) {
    if (isDatabaseConnected()) return Promise.resolve(true);

    return new Promise((resolve) => {
        let settled = false;
        const finish = (connected) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            mongoose.connection.removeListener('connected', onConnected);
            mongoose.connection.removeListener('error', onFailure);
            mongoose.connection.removeListener('disconnected', onFailure);
            resolve(connected);
        };
        const onConnected = () => finish(true);
        const onFailure = () => finish(false);
        const timeout = setTimeout(() => finish(isDatabaseConnected()), timeoutMs);

        mongoose.connection.once('connected', onConnected);
        mongoose.connection.once('error', onFailure);
        mongoose.connection.once('disconnected', onFailure);
    });
}

module.exports = { isDatabaseConnected, waitForDatabase };
