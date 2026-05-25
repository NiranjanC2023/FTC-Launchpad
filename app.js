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
mongoose.set("bufferCommands", false);

// Static files - serve FIRST before setting up routes/views
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public")));

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

// Connect to MongoDB but don't block static pages if it fails
mongoose.connect(params.DATABASECONNECTION, {
    serverSelectionTimeoutMS: 5000
}).then(() => {
    console.log("MongoDB connected");
}).catch(err => {
    console.log("MongoDB connection failed:", err.message);
});

setUpPassport();

app.use(bodyParser.urlencoded({extended:false}));
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

app.listen(app.get("port"), function(){
    console.log("Server started on port " + app.get("port"));
})
