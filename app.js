require("dotenv").config();

var express = require("express");
var path = require("path");
var mongoose = require("mongoose");
var bodyParser = require("body-parser");
var cookieParser = require("cookie-parser");
var passport = require("passport");
var session = require("express-session");
var flash = require("connect-flash");
var params = require("./params/params");
var emailConfig = require("./lib/email");

var setUpPassport = require("./setuppassport");
//var routes = require("./routes");

var app = express();

function formatAwardHistoryDisplayEntry(entry) {
    const value = String(entry || '').trim();
    if (!value) return '';
    return value.replace(/^\s*(Winner|Finalist)\b/i, function(match, word) {
        return word.toLowerCase() === 'winner' ? 'Winning Alliance' : 'Finalist Alliance';
    });
}

app.set("port", process.env.PORT || 3000);
app.set("host", process.env.HOST || "0.0.0.0");

// Static files - serve FIRST before setting up routes/views
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public")));

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.locals.formatAwardHistoryDisplayEntry = formatAwardHistoryDisplayEntry;

// Connect to MongoDB but don't block static pages if it fails
console.log('Using DATABASECONNECTION:', params.DATABASECONNECTION);
mongoose.connect(params.DATABASECONNECTION, {
    dbName: params.DATABASENAME,
    serverSelectionTimeoutMS: 5000
}).then(() => {
    console.log(`MongoDB connected to database: ${mongoose.connection.name}`);
}).catch(err => {
    console.log("MongoDB connection failed:", err.message);
});

setUpPassport();

if (!emailConfig.getBrevoConfigStatus().configured) {
    console.warn(emailConfig.getBrevoConfigErrorMessage());
}

app.use(bodyParser.urlencoded({extended:false, limit:'10mb'}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(session({
    secret:"doemlfgddfsoi!gjdsf5684561dsf",
    resave:false,
    saveUninitialized:false
}));

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
