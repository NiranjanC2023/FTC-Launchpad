module.exports = {
    DATABASECONNECTION: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ftc-launchpad",
    DATABASENAME: process.env.MONGODB_DB || "data",
    FTC_API_USERNAME: process.env.FTC_API_USERNAME || "evergreentechatrons",
    FTC_API_TOKEN: process.env.FTC_API_TOKEN || "BE4296FE-25B8-4356-9C53-7DCD971FC066"
};
