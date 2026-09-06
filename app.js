require("dotenv").config();

var express = require("express");
var helmet = require("helmet");
var path = require("path");
var fs = require("fs");
var crypto = require("crypto");
var mongoose = require("mongoose");
var bodyParser = require("body-parser");
var cookieParser = require("cookie-parser");
var compression = require("compression");
var passport = require("passport");
var session = require("express-session");
var MongoStore = require("connect-mongo").MongoStore;
var rateLimit = require("express-rate-limit").rateLimit;
var flash = require("connect-flash");
var renderView = require("./lib/render-view").renderView;
var params = require("./params/params");
var setUpPassport = require("./setuppassport");
var Team = require("./models/team");
var hasGlobalPrivacyControl = require("./lib/gpc").hasGlobalPrivacyControl;
var countryHelpers = require("./lib/country");
var countryRegionHelpers = require("./lib/country-regions");
var jsonToBase64 = require("./lib/html-data").jsonToBase64;
var subresourceIntegrity = require("./lib/subresource-integrity");
//var routes = require("./routes");

var app = express();

const ASSETS_ROOT = path.join(__dirname, "assets");
const ASSET_INTEGRITY = subresourceIntegrity.buildIntegrityMap(__dirname);

const MAIN_CSS_VERSION = "92";
const MAIN_JS_VERSION = "99";
const HOME_CSS_VERSION = "8";
const HOME_JS_VERSION = "13";
const SITE_SHELL_JS_VERSION = "5";
const BOOTSTRAP_STYLESHEET = '<link rel="stylesheet" href="/assets/vendor/bootstrap/bootstrap.min.css?v=3.3.6">';
const EXTERNAL_ASSET_REPLACEMENTS = [
    [
        "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap",
        "/assets/vendor/inter/inter.css?v=20"
    ],
    [
        "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap",
        "/assets/vendor/inter/inter.css?v=20"
    ],
    [
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
        "/assets/css/icons.min.css?v=1"
    ],
    [
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css",
        "/assets/css/icons.min.css?v=1"
    ],
    [
        "https://cdn.jsdelivr.net/npm/@splidejs/splide@4.1.3/dist/css/splide.min.css",
        "/assets/vendor/splide/splide.min.css?v=4.1.3"
    ],
    [
        "https://cdn.jsdelivr.net/npm/@splidejs/splide@4.1.3/dist/js/splide.min.js",
        "/assets/vendor/splide/splide.min.js?v=4.1.3"
    ],
    [
        "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
        "/assets/vendor/leaflet/leaflet.css?v=1.9.4"
    ],
    [
        "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
        "/assets/vendor/leaflet/leaflet.js?v=1.9.4"
    ]
];

function formatAwardHistoryDisplayEntry(entry) {
    const value = String(entry || '').trim();
    if (!value) return '';
    return value.replace(/^\s*(Winner|Finalist)\b/i, function(match, word) {
        return word.toLowerCase() === 'winner' ? 'Winning Alliance' : 'Finalist Alliance';
    });
}

app.set("port", process.env.PORT || 3000);
app.set("host", process.env.HOST || "0.0.0.0");
app.set("view cache", process.env.NODE_ENV === "production");
app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

const perimeterLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 1200,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ipv6Subnet: 56,
    message: "Too many requests. Please try again shortly.",
    handler: function(req, res, next, options) {
        res.set({ "Retry-After": "60", "Connection": "close" });
        return res.status(options.statusCode || 429).type("text/plain").send(options.message);
    }
});
// Keep the nonce-based CSP below; Helmet supplies the remaining protections.
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: { policy: "credentialless" },
    strictTransportSecurity: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    },
    xFrameOptions: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));

app.use(function setSecurityHeaders(req, res, next) {
    const nonce = crypto.randomBytes(16).toString("base64");
    res.locals.cspNonce = nonce;
    res.set({
        "Content-Security-Policy": [
            "default-src 'none'",
            `script-src 'self' 'nonce-${nonce}' blob: https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com`,
            `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com https://*.googleapis.com https://*.gstatic.com`,
            "style-src-attr 'unsafe-inline'",
            "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com",
            "font-src 'self' data: https://fonts.gstatic.com",
            "connect-src 'self' data: blob: https://nominatim.openstreetmap.org https://*.tile.openstreetmap.org https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com",
            "worker-src 'self' blob:",
            "frame-src https://*.google.com",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self' https://accorid.com",
            "frame-ancestors 'none'"
        ].join("; "),
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)"
    });
    next();
});

// Apply security headers even when the perimeter limiter ends the request.
app.use(perimeterLimiter);
app.use(compression());

app.use(function recognizeGlobalPrivacyControl(req, res, next) {
    req.globalPrivacyControl = hasGlobalPrivacyControl(req.get("Sec-GPC"));
    res.locals.globalPrivacyControl = req.globalPrivacyControl;
    next();
});

app.use(function preloadHomepageStyles(req, res, next) {
    if ((req.method === "GET" || req.method === "HEAD") && req.path === "/") {
        const preload = subresourceIntegrity.versionAssetUrls('<link href="/assets/css/home.min.css">', ASSET_INTEGRITY);
        const href = preload.match(/href="([^"]+)"/)[1];
        res.set("Link", `<${href}>; rel=preload; as=style`);
    }
    next();
});

app.use(function denyServerFiles(req, res, next) {
    let requestPath;
    try {
        requestPath = decodeURIComponent(req.path).toLowerCase();
    } catch (error) {
        return res.status(400).send("Bad request");
    }

    const blocked = [
        /^\/(?:\.env|\.git)(?:\/|$)/,
        /^\/(?:app\.js|package(?:-lock)?\.json|server[^/]*\.log)$/,
        /^\/(?:lib|models|params|routes|scripts|tests|views)(?:\/|$)/
    ];
    if (blocked.some(pattern => pattern.test(requestPath))) {
        return res.status(404).type("text/plain").send("Not found");
    }
    next();
});

// Static files - serve FIRST before setting up routes/views
app.use("/assets", express.static(ASSETS_ROOT, {
    maxAge: process.env.NODE_ENV === "production" ? "1y" : 0,
    immutable: process.env.NODE_ENV === "production",
    etag: true,
    lastModified: true
}));
app.use(express.static(path.join(__dirname, "public"), {
    maxAge: "7d",
    etag: true,
    lastModified: true
}));

app.get("/favicon.ico", function(req, res) {
    res.set("Cache-Control", "public, max-age=604800");
    res.type("png").sendFile(path.join(ASSETS_ROOT, "img", "first-start-logo.png"));
});

app.get("/.well-known/gpc.json", function(req, res) {
    res.set("Cache-Control", "public, max-age=86400");
    res.type("application/json").send({
        gpc: true,
        lastUpdate: "2026-08-04"
    });
});

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.locals.formatAwardHistoryDisplayEntry = formatAwardHistoryDisplayEntry;
app.locals.unitedNationsCountries = countryHelpers.UNITED_NATIONS_COUNTRIES;
app.locals.countriesMatch = countryHelpers.countriesMatch;
app.locals.countryRegionsFor = countryRegionHelpers.getCountryRegions;
app.locals.canonicalizeCountryRegion = countryRegionHelpers.canonicalizeCountryRegion;
app.locals.googleMapsApiKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
app.locals.jsonToBase64 = jsonToBase64;

// Read the shared header when the server starts so rendered pages use the same shell.
// The source file is rebuilt alongside the client shell during development.
const sharedHeaderHtml = fs.readFileSync(path.join(__dirname, "assets", "partial", "header.html"), "utf8");
const sharedFooterHtml = fs.readFileSync(path.join(__dirname, "assets", "partial", "footer.html"), "utf8");

app.engine("ejs", function(filePath, data, callback) {
    renderView(filePath, data, function(err, html) {
        if (err) return callback(err);

        if (typeof html === 'string') {
            if (/<\/head>/i.test(html) && !/<link[^>]+rel=["'][^"']*icon/i.test(html)) {
                html = html.replace(/<\/head>/i, '  <link rel="icon" href="/assets/img/first-start-logo.png?v=1" type="image/png">\n  <link rel="apple-touch-icon" href="/assets/img/first-start-logo.png?v=1">\n</head>');
            }
            if (data && data.cspNonce) {
                html = html.replace(/<script(?![^>]*\bnonce=)([^>]*)>/gi, `<script nonce="${data.cspNonce}"$1>`);
                html = html.replace(/<style(?![^>]*\bnonce=)([^>]*)>/gi, `<style nonce="${data.cspNonce}"$1>`);
            }
            EXTERNAL_ASSET_REPLACEMENTS.forEach(function(replacement) {
                html = html.split(replacement[0]).join(replacement[1]);
            });

            html = html
                .replace(/\s*<link[^>]+rel=["']preconnect["'][^>]+fonts\.googleapis\.com[^>]*>/gi, '')
                .replace(/\s*<link[^>]+rel=["']preconnect["'][^>]+fonts\.gstatic\.com[^>]*>/gi, '')
                .replace(/\s*<link[^>]+href=["']\/assets\/vendor\/inter\/inter\.css(?:\?v=\d+)?["'][^>]*>/gi, '')
                .replace(/\s*<link[^>]+href=["']\/assets\/css\/icons\.min\.css(?:\?v=\d+)?["'][^>]*>/gi, '')
                .replace(/\/assets\/css\/main\.css(?:\?v=\d+)?/g, `/assets/css/main.min.css?v=${MAIN_CSS_VERSION}`)
                .replace(/\/assets\/js\/main\.js(?:\?v=\d+)?/g, `/assets/js/main.min.js?v=${MAIN_JS_VERSION}`)
                .replace(/\/assets\/js\/first-start\.js(?:\?v=\d+)?/g, `/assets/js/first-start.min.js?v=${HOME_JS_VERSION}`);

            if (/\bhome-page\b/.test(html)) {
                html = html
                    .replace(/\/assets\/css\/main\.min\.css(?:\?v=\d+)?/g, `/assets/css/home.min.css?v=${HOME_CSS_VERSION}`)
                    .replace(/\s*<link[^>]+href=["']\/assets\/css\/first-start\.css(?:\?v=\d+)?["'][^>]*>/gi, '');
            }

            // Pages with dependent country/region fields need the full client
            // bundle; the lightweight shell does not initialize their change
            // handlers or hydrate the region options.
            const needsFullClientBundle = /\bid=["']teamsContainer["']/.test(html)
                || /data-country-select/.test(html)
                || /data-region-select/.test(html);
            if (!needsFullClientBundle) {
                html = html.replace(
                    /\/assets\/js\/main(?:\.min)?\.js(?:\?v=\d+)?/g,
                    `/assets/js/site-shell.min.js?v=${SITE_SHELL_JS_VERSION}`
                );
            }

            if (!html.includes('/assets/vendor/bootstrap/bootstrap.min.css') && !/\bhome-page\b/.test(html)) {
                html = html.replace(
                    /(<link[^>]+href=["']\/assets\/css\/main(?:\.min)?\.css[^>]*>)/i,
                    `${BOOTSTRAP_STYLESHEET}\n$1`
                );
            }

            // Development builds can finish after the server has restarted.
            // Hash the current files so the page never rejects a freshly built bundle.
            const integrityMap = process.env.NODE_ENV === 'production'
                ? ASSET_INTEGRITY
                : subresourceIntegrity.buildIntegrityMap(__dirname);
            html = subresourceIntegrity.versionAssetUrls(html, integrityMap);
            html = subresourceIntegrity.addSubresourceIntegrity(html, integrityMap);

            html = html.replace(
                /<header([^>]*)>\s*<\/header>/i,
                `<header$1>\n${sharedHeaderHtml}\n</header>`
            );

            if (!/\bdata-auth-state=/i.test(html)) {
                const authState = data && data.isAuthenticated ? 'authenticated' : 'anonymous';
                html = html.replace(/<html([^>]*)>/i, `<html$1 data-auth-state="${authState}">`);
            }
        }

        if (typeof html === 'string' && /<\/body>/i.test(html) && !/class="(?:home-footer|site-footer)"/i.test(html)) {
            html = html.replace(/<\/body>/i, `${sharedFooterHtml}\n</body>`);
        }

        callback(null, html);
    });
});

// Connect to MongoDB but don't block static pages if it fails.
console.log('Connecting to MongoDB...');
mongoose.connect(params.DATABASECONNECTION, {
    dbName: params.DATABASENAME,
    serverSelectionTimeoutMS: 5000
}).then(() => {
    console.log(`MongoDB connected to database: ${mongoose.connection.name}`);
    return Team.syncIndexes().then(() => {
        console.log('Team indexes synchronized.');
    });
}).catch(err => {
    console.log("MongoDB connection failed:", err.message);
});

setUpPassport();

const MAX_REQUEST_BODY_BYTES = 512 * 1024;
const MAX_REQUEST_URL_LENGTH = 4096;
const activeRequestsByIp = new Map();
let activeDynamicRequests = 0;

function rateLimitResponse(req, res, next, options) {
    const statusCode = options.statusCode || 429;
    res.set("Retry-After", String(Math.ceil(options.windowMs / 1000)));
    if (req.path.startsWith("/api/")) {
        return res.status(statusCode).json({ ok: false, error: options.message });
    }
    return res.status(statusCode).type("text/plain").send(options.message);
}

app.use(function rejectOversizedRequests(req, res, next) {
    if (req.originalUrl.length > MAX_REQUEST_URL_LENGTH) {
        return res.status(414).type("text/plain").send("Request URL is too long.");
    }

    const contentLengthHeader = req.get("Content-Length");
    if (contentLengthHeader) {
        const contentLength = Number(contentLengthHeader);
        if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
            return res.status(400).type("text/plain").send("Invalid Content-Length header.");
        }
        if (contentLength > MAX_REQUEST_BODY_BYTES) {
            return res.status(413).type("text/plain").send("Request body is too large.");
        }
    }
    next();
});

app.use(function shedExcessLoad(req, res, next) {
    const requestIp = req.ip || req.socket.remoteAddress || "unknown";
    const activeForIp = activeRequestsByIp.get(requestIp) || 0;
    const maxGlobal = Number(process.env.MAX_CONCURRENT_REQUESTS) || 200;
    const maxPerIp = Number(process.env.MAX_CONCURRENT_REQUESTS_PER_IP) || 24;

    if (activeDynamicRequests >= maxGlobal || activeForIp >= maxPerIp) {
        res.set({ "Retry-After": "5", "Connection": "close" });
        return res.status(503).type("text/plain").send("Server is busy. Please try again shortly.");
    }

    activeDynamicRequests += 1;
    activeRequestsByIp.set(requestIp, activeForIp + 1);
    let released = false;
    const release = function() {
        if (released) return;
        released = true;
        activeDynamicRequests = Math.max(0, activeDynamicRequests - 1);
        const remainingForIp = (activeRequestsByIp.get(requestIp) || 1) - 1;
        if (remainingForIp <= 0) activeRequestsByIp.delete(requestIp);
        else activeRequestsByIp.set(requestIp, remainingForIp);
    };
    res.once("finish", release);
    res.once("close", release);
    next();
});

const dynamicRequestLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 600,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ipv6Subnet: 56,
    message: "Too many requests. Please try again shortly.",
    handler: rateLimitResponse
});
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ipv6Subnet: 56,
    message: "Too many API requests. Please try again later.",
    handler: rateLimitResponse
});
const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 80,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ipv6Subnet: 56,
    skip: function(req) { return !["POST", "PUT", "PATCH", "DELETE"].includes(req.method); },
    message: "Too many changes were submitted. Please wait and try again.",
    handler: rateLimitResponse
});
const authenticationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ipv6Subnet: 56,
    message: "Too many attempts. Please wait and try again.",
    handler: rateLimitResponse
});
const geocodingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ipv6Subnet: 56,
    message: "Too many location searches. Please wait and try again.",
    handler: rateLimitResponse
});

app.use(dynamicRequestLimiter);
app.use(writeLimiter);
app.use("/api", apiLimiter);
app.use([
    "/api/users/login",
    "/api/users/signup",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/team-register/email-verification",
    "/manage-team/email-verification"
], authenticationLimiter);
app.use(["/api/geocode-zip", "/api/geocode-location"], geocodingLimiter);

// Profile photos are submitted as compressed data URLs. Keep a bounded limit
// large enough for ordinary phone images while still rejecting oversized bodies.
app.use(bodyParser.urlencoded({ extended: false, limit: "5mb", parameterLimit: 100 }));
app.use(express.json({ limit: "5mb", strict: true }));
app.use(cookieParser());
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || (!isProduction ? crypto.randomBytes(32).toString("hex") : "");
if (!sessionSecret) {
    throw new Error("SESSION_SECRET must be set in production.");
}
app.use(session({
    name: "firststart.sid",
    secret: sessionSecret,
    store: MongoStore.create({
        mongoUrl: params.DATABASECONNECTION,
        dbName: params.DATABASENAME,
        collectionName: "sessions",
        ttl: 60 * 60 * 24 * 30,
        autoRemove: "native"
    }),
    resave:false,
    saveUninitialized:false,
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        maxAge: null
    }
}));

app.use(function blockCrossSiteWrites(req, res, next) {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

    const fetchSite = String(req.get("Sec-Fetch-Site") || "").toLowerCase();
    if (fetchSite === "cross-site") {
        return res.status(403).json({ ok: false, error: "Cross-site request blocked." });
    }

    const origin = req.get("Origin");
    if (origin) {
        try {
            if (new URL(origin).host !== req.get("host")) {
                return res.status(403).json({ ok: false, error: "Cross-site request blocked." });
            }
        } catch (error) {
            return res.status(403).json({ ok: false, error: "Invalid request origin." });
        }
    }
    next();
});

app.use("/api", function preventPrivateApiCaching(req, res, next) {
    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
    next();
});

app.use(function exposeAuthenticationState(req, res, next) {
    res.locals.isAuthenticated = Boolean(req.session && req.session.userId);
    next();
});

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.use("/", require("./routes/web"));
app.use("/api", require("./routes/api"));

const port = app.get("port");
const host = app.get("host");
const server = app.listen(port, host, function(){
    console.log(`Server started at http://${host}:${port}`);
});

// Bound slow or abusive connections so they cannot hold server resources
// indefinitely. Keep headersTimeout lower than requestTimeout as required by
// Node's HTTP server.
server.headersTimeout = 10 * 1000;
server.requestTimeout = 30 * 1000;
server.keepAliveTimeout = 5 * 1000;
server.maxHeadersCount = 100;
server.maxRequestsPerSocket = 100;

server.on("error", function(err){
    if (err && err.code === "EADDRINUSE") {
        console.error(`Port ${port} is already in use. Please free the port or set PORT env var.`);
        process.exit(1);
    } else if (err && err.code === "EACCES") {
        console.error(`Port ${port} requires elevated privileges.`);
        process.exit(1);
    } else {
        console.error("Server error:", err);
        process.exit(1);
    }
});

process.on("uncaughtException", function(err){
    console.error("Uncaught exception:", err);
    process.exit(1);
});

process.on("unhandledRejection", function(reason){
    console.error("Unhandled Rejection:", reason);
});
