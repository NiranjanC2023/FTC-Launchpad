require("dotenv").config();

var express = require("express");
var path = require("path");
var fs = require("fs");
var zlib = require("zlib");
var mongoose = require("mongoose");
var bodyParser = require("body-parser");
var cookieParser = require("cookie-parser");
var compression = require("compression");
var passport = require("passport");
var session = require("express-session");
var flash = require("connect-flash");
var ejs = require("ejs");
var params = require("./params/params");
var setUpPassport = require("./setuppassport");
//var routes = require("./routes");

var app = express();

const ASSETS_ROOT = path.join(__dirname, "assets");
const GZIP_CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8"
};

const MAIN_CSS_VERSION = "30";
const MAIN_JS_VERSION = "40";
const HOME_JS_VERSION = "12";
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

app.use(compression());

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

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.locals.formatAwardHistoryDisplayEntry = formatAwardHistoryDisplayEntry;

const sharedHeaderHtml = fs.readFileSync(path.join(__dirname, "assets", "partial", "header.html"), "utf8");
const sharedFooterHtml = fs.readFileSync(path.join(__dirname, "assets", "partial", "footer.html"), "utf8");

app.engine("ejs", function(filePath, data, callback) {
    ejs.renderFile(filePath, data, function(err, html) {
        if (err) return callback(err);

        if (typeof html === 'string') {
            EXTERNAL_ASSET_REPLACEMENTS.forEach(function(replacement) {
                html = html.split(replacement[0]).join(replacement[1]);
            });

            html = html
                .replace(/\s*<link[^>]+rel=["']preconnect["'][^>]+fonts\.googleapis\.com[^>]*>/gi, '')
                .replace(/\s*<link[^>]+rel=["']preconnect["'][^>]+fonts\.gstatic\.com[^>]*>/gi, '')
                .replace(/\/assets\/css\/main\.css(?:\?v=\d+)?/g, `/assets/css/main.min.css?v=${MAIN_CSS_VERSION}`)
                .replace(/\/assets\/js\/main\.js(?:\?v=\d+)?/g, `/assets/js/main.min.js?v=${MAIN_JS_VERSION}`)
                .replace(/\/assets\/js\/first-start\.js(?:\?v=\d+)?/g, `/assets/js/first-start.min.js?v=${HOME_JS_VERSION}`);

            html = html
                .replace(/<link href="(\/assets\/vendor\/inter\/inter\.css\?v=20)" rel="stylesheet">/gi, '<link rel="preload" as="style" href="$1" onload="this.onload=null;this.rel=\'stylesheet\'"><noscript><link rel="stylesheet" href="$1"></noscript>')
                .replace(/<link rel="stylesheet" href="(\/assets\/css\/icons\.min\.css\?v=1)">/gi, '<link rel="preload" as="style" href="$1" onload="this.onload=null;this.rel=\'stylesheet\'"><noscript><link rel="stylesheet" href="$1"></noscript>');

            const needsFullClientBundle = /\bhome-page\b/.test(html) || /\bid=["']teamsContainer["']/.test(html);
            if (!needsFullClientBundle) {
                html = html.replace(
                    /\/assets\/js\/main(?:\.min)?\.js(?:\?v=\d+)?/g,
                    '/assets/js/site-shell.min.js?v=1'
                );
            }

            if (!html.includes('/assets/vendor/bootstrap/bootstrap.min.css')) {
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
}).catch(err => {
    console.log("MongoDB connection failed:", err.message);
});

setUpPassport();

app.use(bodyParser.urlencoded({extended:false, limit:'10mb'}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || "doemlfgddfsoi!gjdsf5684561dsf",
    resave:false,
    saveUninitialized:false
}));

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
