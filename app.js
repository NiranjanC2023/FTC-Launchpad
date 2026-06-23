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

var setUpPassport = require("./setuppassport");
//var routes = require("./routes");

var app = express();

app.set("port", process.env.PORT || 3000);

// Static files - serve FIRST before setting up routes/views
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public")));

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Connect to MongoDB but don't block static pages if it fails
mongoose.connect(params.DATABASECONNECTION, {
    dbName: params.DATABASENAME,
    serverSelectionTimeoutMS: 5000
}).then(() => {
    console.log(`MongoDB connected to database: ${mongoose.connection.name}`);
}).catch(err => {
    console.log("MongoDB connection failed:", err.message);
});

setUpPassport();

app.use(bodyParser.urlencoded({extended:false}));
app.use(express.json());
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
const server = app.listen(port, function(){
    console.log("Server started on port " + port);
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
