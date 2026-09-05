// Share exclusions between collection and reporting, including historical visits.
const LOCAL_HOST_PATTERN = /^(?:(?:[a-z0-9-]+\.)*localhost\.?|127(?:\.\d{1,3}){3}|\[?::(?:ffff:127(?:\.\d{1,3}){3}|1)\]?|0\.0\.0\.0)(?::\d+)?$/i;
const UPTIME_AGENT_PATTERN = /uptime[\s_-]*(?:robot|kuma|bot)|uptime\.com|better[\s_-]*uptime|betterstack|pingdom|statuscake|site24x7|healthchecks|GoogleStackdriverMonitoring/i;

// This Express site has no PHP or WordPress pages. These are scanner targets.
const SCANNER_PATH_PATTERN = /(?:^|\/)(?:wp-admin|wp-includes|wordpress|phpmyadmin|\.git|\.env)(?:[/.?]|$)|\.php(?:[/?]|$)/i;

function isExcludedTraffic(host, userAgent, path) {
    return LOCAL_HOST_PATTERN.test(String(host || '').trim())
        || UPTIME_AGENT_PATTERN.test(String(userAgent || '').trim())
        || SCANNER_PATH_PATTERN.test(String(path || ''));
}

function publicTrafficFilter() {
    // $not also preserves legacy visits with no host/user-agent metadata.
    return {
        host: { $not: LOCAL_HOST_PATTERN },
        userAgent: { $not: UPTIME_AGENT_PATTERN },
        path: { $not: SCANNER_PATH_PATTERN }
    };
}

module.exports = { isExcludedTraffic, publicTrafficFilter };
