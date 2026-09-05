const ejs = require('ejs');
const path = require('path');

function renderView(filePath, data, callback) {
    // An explicit options argument prevents EJS from interpreting locals (including
    // settings['view options']) as compiler options. Never derive these from data.
    return ejs.renderFile(filePath, data, {
        views: [path.join(__dirname, '..', 'views')],
        cache: process.env.NODE_ENV === 'production',
        client: false,
        delimiter: '%',
        escapeFunction: ejs.escapeXML
    }, callback);
}

module.exports = { renderView };
