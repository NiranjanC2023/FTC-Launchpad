module.exports = {
    DATABASECONNECTION: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ftc-launchpad",
    DATABASENAME: process.env.MONGODB_DB || "FTC Teams",
    FTC_API_USERNAME: process.env.FTC_API_USERNAME || "",
    FTC_API_TOKEN: process.env.FTC_API_TOKEN || ""
};
