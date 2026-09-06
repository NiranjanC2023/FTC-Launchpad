const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INTEGRITY_ASSETS = [
    '/assets/js/main.min.js',
    '/assets/js/site-shell.min.js',
    '/assets/js/first-start.min.js',
    '/assets/css/main.min.css',
    '/assets/css/home.min.css',
    '/assets/vendor/bootstrap/bootstrap.min.css'
];

function buildIntegrityMap(projectRoot) {
    return new Map(INTEGRITY_ASSETS.map(assetUrl => {
        const filePath = path.join(projectRoot, ...assetUrl.split('/').filter(Boolean));
        const digest = crypto.createHash('sha384').update(fs.readFileSync(filePath)).digest('base64');
        return [assetUrl, `sha384-${digest}`];
    }));
}

function assetPathFromUrl(value) {
    const url = String(value || '').split(/[?#]/, 1)[0];
    return url.startsWith('/assets/') ? url : '';
}

function addSubresourceIntegrity(html, integrityMap) {
    const addIntegrity = (tag, url) => {
        if (/\bintegrity\s*=/i.test(tag)) return tag;
        const integrity = integrityMap.get(assetPathFromUrl(url));
        if (!integrity) return tag;
        return tag.replace(/>$/, ` integrity="${integrity}" crossorigin="anonymous">`);
    };

    return String(html)
        .replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (tag, src) => addIntegrity(tag, src))
        .replace(/<link\b(?=[^>]*\brel=["'][^"']*stylesheet)(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/gi,
            (tag, href) => addIntegrity(tag, href));
}

// Use the same digest for caching and integrity so a rebuild cannot reuse an
// immutable URL whose cached bytes no longer match the page's integrity value.
function versionAssetUrls(html, integrityMap) {
    return String(html).replace(/\b(src|href)=(['"])(\/assets\/[^'"<>]+)\2/g, (attribute, name, quote, value) => {
        const digest = integrityMap.get(assetPathFromUrl(value));
        if (!digest) return attribute;
        const url = new URL(value, 'http://localhost');
        url.searchParams.set('v', digest.slice('sha384-'.length).replace(/[^a-zA-Z0-9]/g, '').slice(0, 24));
        return `${name}=${quote}${url.pathname}${url.search}${url.hash}${quote}`;
    });
}

module.exports = { INTEGRITY_ASSETS, buildIntegrityMap, addSubresourceIntegrity, versionAssetUrls };
