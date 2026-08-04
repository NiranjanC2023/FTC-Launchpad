require("dotenv").config();

var express = require("express");
var path = require("path");
var fs = require("fs");
var zlib = require("zlib");
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
var ejs = require("ejs");
var params = require("./params/params");
var setUpPassport = require("./setuppassport");
var Team = require("./models/team");
var hasGlobalPrivacyControl = require("./lib/gpc").hasGlobalPrivacyControl;
//var routes = require("./routes");

var app = express();

const ASSETS_ROOT = path.join(__dirname, "assets");
const HOME_STYLESHEET_PATH = path.join(ASSETS_ROOT, "css", "home.min.css");
const HOME_STYLESHEET = fs.existsSync(HOME_STYLESHEET_PATH)
    ? fs.readFileSync(HOME_STYLESHEET_PATH, "utf8")
    : "";
const GZIP_CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8"
};

const MAIN_CSS_VERSION = "32";
const MAIN_JS_VERSION = "43";
const HOME_JS_VERSION = "13";
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

function acceptsGzip(req) {
    return req.acceptsEncodings("gzip") === "gzip";
}

function servePrecompressedAsset(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!acceptsGzip(req)) return next();

    const extension = path.extname(req.path).toLowerCase();
    const contentType = GZIP_CONTENT_TYPES[extension];
    if (!contentType) return next();

    let decodedPath;
    try {
        decodedPath = decodeURIComponent(req.path);
    } catch (error) {
        return next();
    }

    const assetPath = path.resolve(ASSETS_ROOT, "." + decodedPath);
    const relativePath = path.relative(ASSETS_ROOT, assetPath);
    if (relativePath.startsWith(".." + path.sep) || path.isAbsolute(relativePath)) return next();

    const gzipPath = assetPath + ".gz";
    fs.stat(gzipPath, function(error, stats) {
        if (error || !stats.isFile()) return next();

        res.set("Content-Encoding", "gzip");
        res.set("Content-Type", contentType);
        res.set("Vary", "Accept-Encoding");
        res.sendFile(gzipPath, {
            acceptRanges: false,
            immutable: true,
            maxAge: "1y"
        }, function(sendError) {
            if (sendError) next(sendError);
        });
    });
}

app.set("port", process.env.PORT || 3000);
app.set("host", process.env.HOST || "0.0.0.0");
app.set("view cache", process.env.NODE_ENV === "production");
app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);

app.use(compression());

app.use(function setSecurityHeaders(req, res, next) {
    const nonce = crypto.randomBytes(16).toString("base64");
    res.locals.cspNonce = nonce;
    res.set({
        "Content-Security-Policy": [
            "default-src 'self'",
            `script-src 'self' 'nonce-${nonce}'`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://maps.googleapis.com https://maps.gstatic.com",
            "font-src 'self' data:",
            "connect-src 'self' https://nominatim.openstreetmap.org https://*.tile.openstreetmap.org https://maps.googleapis.com https://maps.gstatic.com",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'"
        ].join("; "),
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "Cross-Origin-Opener-Policy": "same-origin",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(self)"
    });
    next();
});

app.use(function recognizeGlobalPrivacyControl(req, res, next) {
    req.globalPrivacyControl = hasGlobalPrivacyControl(req.get("Sec-GPC"));
    res.locals.globalPrivacyControl = req.globalPrivacyControl;
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
app.use("/assets", servePrecompressedAsset);
app.use("/assets", express.static(ASSETS_ROOT, {
    maxAge: "1y",
    immutable: true,
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

const sharedHeaderHtml = fs.readFileSync(path.join(__dirname, "assets", "partial", "header.html"), "utf8");
const sharedFooterHtml = fs.readFileSync(path.join(__dirname, "assets", "partial", "footer.html"), "utf8");

app.engine("ejs", function(filePath, data, callback) {
    ejs.renderFile(filePath, data, function(err, html) {
        if (err) return callback(err);

        if (typeof html === 'string') {
            if (/<\/head>/i.test(html) && !/<link[^>]+rel=["'][^"']*icon/i.test(html)) {
                html = html.replace(/<\/head>/i, '  <link rel="icon" href="/assets/img/first-start-logo.png?v=1" type="image/png">\n  <link rel="apple-touch-icon" href="/assets/img/first-start-logo.png?v=1">\n</head>');
            }
            if (data && data.cspNonce) {
                html = html.replace(/<script(?![^>]*\bnonce=)([^>]*)>/gi, `<script nonce="${data.cspNonce}"$1>`);
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
                    .replace(/\/assets\/css\/main\.min\.css(?:\?v=\d+)?/g, '/assets/css/home.min.css?v=1')
                    .replace(/\s*<link[^>]+href=["']\/assets\/css\/first-start\.css(?:\?v=\d+)?["'][^>]*>/gi, '');
                if (HOME_STYLESHEET) {
                    html = html.replace(
                        /<link[^>]+href=["']\/assets\/css\/home\.min\.css(?:\?v=\d+)?["'][^>]*>/i,
                        `<style data-home-styles="3">${HOME_STYLESHEET}</style>`
                    );
                    html = html.replace(
                        /(<style data-home-styles="3">[\s\S]*?<\/style>)/i,
                        `$1<style data-home-header-tweak="1">@media (max-width: 1120px) {.home-page .creator-badge { display: none !important; }}</style>`
                    );
                }
            }

            const needsFullClientBundle = /\bid=["']teamsContainer["']/.test(html);
            if (!needsFullClientBundle) {
                html = html.replace(
                    /\/assets\/js\/main(?:\.min)?\.js(?:\?v=\d+)?/g,
                    '/assets/js/site-shell.min.js?v=3'
                );
            }

            if (!html.includes('/assets/vendor/bootstrap/bootstrap.min.css') && !/\bhome-page\b/.test(html)) {
                html = html.replace(
                    /(<link[^>]+href=["']\/assets\/css\/main(?:\.min)?\.css[^>]*>)/i,
                    `${BOOTSTRAP_STYLESHEET}\n$1`
                );
            }

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

app.use(bodyParser.urlencoded({extended:false, limit:'512kb'}));
app.use(express.json({ limit: '512kb' }));
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

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { ok: false, error: "Too many requests. Please try again later." }
});
const authenticationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { ok: false, error: "Too many attempts. Please wait and try again." }
});
const geocodingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { ok: false, error: "Too many location searches. Please wait and try again." }
});
app.use("/api", apiLimiter);
app.use(["/api/users/login", "/api/users/signup", "/login", "/signup", "/forgot-password", "/reset-password"], authenticationLimiter);
app.use(["/api/geocode-zip", "/api/geocode-location"], geocodingLimiter);
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
