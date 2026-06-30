const express = require("express");
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/user');
const Team = require('../models/team');
const ManagerInvite = require('../models/managerInvite');
const { Resend } = require('resend');
const Student = require('../models/student');
const { createNotification, normalizeEmail } = require('../lib/notifications');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const DEFAULT_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const DEFAULT_FROM_NAME = process.env.EMAIL_NAME || 'FTC Starter Hub';
const DEFAULT_FROM = process.env.EMAIL_FROM || `"${DEFAULT_FROM_NAME}" <${DEFAULT_FROM_EMAIL}>`;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'evergreentechatrons.contact@gmail.com';
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

async function sendEmail(mailOptions) {
    if (!resend) {
        throw new Error('Resend is not configured.');
    }

    const normalizedRecipients = Array.isArray(mailOptions.to)
        ? mailOptions.to
        : String(mailOptions.to || '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean);

    const result = await resend.emails.send({
        from: mailOptions.from || DEFAULT_FROM,
        to: normalizedRecipients,
        subject: mailOptions.subject || '',
        html: mailOptions.html || '',
        text: mailOptions.text || undefined,
        replyTo: mailOptions.replyTo || mailOptions.reply_to || undefined
    });

    if (result && result.error) {
        throw new Error(result.error.message || 'Resend send failed.');
    }

    return result;
}

function signIn(req, user) {
    req.session.userId = user._id.toString();
}

async function getPostLoginRedirect(user) {
    const contactQuery = buildContactEmailQuery(user.email);
    const teamAccessConditions = [
        { contact: contactQuery },
        { managers: user._id }
    ];

    const managedTeam = await Team.findOne({ $or: teamAccessConditions }).select('_id').lean().exec();
    if (managedTeam) return '/manage-team';

    if (user.teamNumber) {
        teamAccessConditions.push({ teamNumber: user.teamNumber });
    }

    const affiliatedTeam = await Team.findOne({ $or: teamAccessConditions }).select('_id').lean().exec();
    if (!affiliatedTeam) return '/my-applications';

    return '/';
}

async function getAccessibleTeamsForUser(user) {
    if (!user) return [];
    const contactQuery = buildContactEmailQuery(user.email);
    const query = {
        $or: [
            { contact: contactQuery },
            { managers: user._id }
        ]
    };
    if (user.teamNumber) {
        query.$or.push({ teamNumber: user.teamNumber });
    }

    const teams = await Team.find(query)
        .sort({ updatedAt: -1, createdAt: -1, teamNumber: 1, name: 1 })
        .lean()
        .exec();

    const enrichedTeams = [];
    for (const team of teams) {
        enrichedTeams.push(await enrichTeamWithApi(team));
    }
    return enrichedTeams.filter(Boolean);
}

function hasTeamAccess(user, team) {
    if (!user || !team) return false;
    const normalizedEmail = normalizeEmail(user.email);
    return Boolean(
        (team.contact && normalizeEmail(team.contact) === normalizedEmail)
        || (Array.isArray(team.managers) && team.managers.some(managerId => String(managerId) === String(user._id)))
        || (user.teamNumber && Number(user.teamNumber) === Number(team.teamNumber))
    );
}

function createInviteToken() {
    return crypto.randomBytes(24).toString('hex');
}

function generateNewTeamNumber(seedParts) {
    const source = Array.isArray(seedParts) ? seedParts.filter(Boolean).join('|') : String(seedParts || '');
    const digest = crypto.createHash('sha1').update(source).digest('hex').slice(0, 10);
    const numeric = Number.parseInt(digest, 16);
    return Number.isFinite(numeric) ? -Math.abs(numeric) : -Date.now();
}

function hashResetToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function buildContactEmailQuery(email) {
    const normalized = normalizeEmail(email);
    const raw = String(email || '').trim();
    const values = [...new Set([normalized, raw].filter(Boolean))];
    if (values.length === 1) return values[0];
    return { $in: values };
}

function getAppBaseUrl(req) {
    return String(process.env.APP_URL || process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

async function acceptInviteToken(token, user) {
    if (!token || !user) return null;
    const invite = await ManagerInvite.findOne({ token }).exec();
    if (!invite) return null;
    if (invite.expiresAt && invite.expiresAt < new Date()) return null;
    if (normalizeEmail(user.email) !== normalizeEmail(invite.email)) return null;

    const team = await Team.findById(invite.team).exec();
    if (!team) return null;

    await Team.findByIdAndUpdate(team._id, { $addToSet: { managers: user._id } }).exec();
    invite.acceptedAt = new Date();
    await invite.save();
    return team;
}

function applyRememberMe(req, remember) {
    if (!req.session) return;
    if (remember) {
        req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
    } else {
        req.session.cookie.maxAge = null;
    }
}

function isDatabaseConnected() {
    return mongoose.connection.readyState === 1;
}

function ensureAuthenticated(req, res, next) {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/login');
}

function anonymousAllowedPath(pathname) {
    const path = String(pathname || '/').split('?')[0];
    return path === '/'
        || path === '/login'
        || path === '/forgot-password'
        || path.startsWith('/reset-password')
        || path === '/signup'
        || path === '/signup/seeker'
        || path === '/signup/manager'
        || path === '/auth-gate';
}

router.use(function(req, res, next) {
    if (req.session && req.session.userId) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    if (req.path.startsWith('/assets/')) return next();
    if (anonymousAllowedPath(req.path)) return next();

    const nextPath = sanitizeNextPath(req.originalUrl || req.path, '/');
    return res.redirect(`/auth-gate?next=${encodeURIComponent(nextPath)}&label=${encodeURIComponent('continue')}`);
});

function databaseErrorMessage() {
    return 'Database is not connected. Start MongoDB or set MONGODB_URI, then try again.';
}

function sanitizeNextPath(nextPath, fallback = '/') {
    const value = String(nextPath || '').trim();
    if (!value) return fallback;
    if (!value.startsWith('/') || value.startsWith('//')) return fallback;
    if (value === '/auth-gate') return fallback;
    return value;
}

function getSignupInfoBackTarget(back) {
    return String(back || '').trim() === 'applications' ? 'applications' : 'account';
}

function normalizeManagerRole(role) {
    const value = String(role || '').trim().toLowerCase();
    return value === 'manager' ? 'manager' : '';
}

function isManagerRole(role) {
    return Boolean(normalizeManagerRole(role));
}

function getTeamManagerRole(team, userId) {
    if (!team || !userId) return '';
    const managerIds = Array.isArray(team.managers) ? team.managers : [];
    const isTeamManager = managerIds.some((managerId) => String(managerId) === String(userId));
    return isTeamManager ? 'manager' : '';
}

function setTeamManagerRole(team, userId, role) {
    if (!team || !userId) return;
    if (!Array.isArray(team.managers)) {
        team.managers = [];
    }
    if (!team.managers.some((managerId) => String(managerId) === String(userId))) {
        team.managers.push(userId);
    }
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function privacyOffsetCoords(lat, lon, seedParts) {
    const source = seedParts.filter(Boolean).join('|') || `${lat},${lon}`;
    let hash = 0;

    for (let index = 0; index < source.length; index++) {
        hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
    }

    const angle = (Math.abs(hash) % 360) * Math.PI / 180;
    const distanceMeters = 250 + (Math.abs(hash >> 8) % 151);
    const latOffset = distanceMeters * Math.cos(angle) / 111320;
    const lonOffset = distanceMeters * Math.sin(angle) / (111320 * Math.cos(lat * Math.PI / 180));

    return {
        lat: lat + latOffset,
        lon: lon + lonOffset
    };
}

var sortHistoryEntriesMostRecent = function(entries) {
    const seen = new Set();
    const normalized = Array.isArray(entries)
        ? entries.map((entry, index) => ({
            entry: String(entry || '').trim(),
            year: extractHistorySortYear(entry),
            index
        })).filter(item => Boolean(item.entry))
        : [];

    return normalized
        .sort((left, right) => {
            if (left.year !== right.year) return right.year - left.year;
            if (left.index !== right.index) return left.index - right.index;
            return left.entry.localeCompare(right.entry);
        })
        .filter(item => {
            if (seen.has(item.entry)) return false;
            seen.add(item.entry);
            return true;
        })
        .map(item => item.entry);
};

function mapTeam(team) {
    const location = team.city
        ? [team.city, team.state, team.country].filter(Boolean).join(', ')
        : [team.address, team.state, team.country].filter(Boolean).join(', ');
    const displayCoords = privacyOffsetCoords(team.lat, team.lon, [
        String(team._id || ''),
        team.program,
        String(team.teamNumber || ''),
        team.name
    ]);

    return {
        id: team._id,
        program: team.program || 'FTC',
        teamNumber: team.teamNumber,
        name: team.name,
        contact: team.contact,
        lat: displayCoords.lat,
        lon: displayCoords.lon,
        isNewTeam: Boolean(team.isNewTeam),
        notes: team.notes,
        awards: team.awards,
        awardHistory: sortHistoryEntriesMostRecent(team.awardHistory || []),
        yearsInProgram: team.yearsInProgram,
        advancementLevels: team.advancementLevels,
        advancementHistory: sortHistoryEntriesMostRecent(team.advancementHistory || []),
        recruiting: team.recruiting,
        verified: team.verified,
        radiusMeters: 1000,
        location
    };
}

function buildAddress(values) {
    return [values.address, values.city, values.state, values.country]
        .map(value => (value || '').trim())
        .filter(Boolean)
        .join(', ');
}

async function geocodeAddress(values) {
    const variants = [
        [values.address, values.city, values.state, values.country],
        [values.address, values.city, values.state],
        [values.address, values.city, values.country],
        [values.city, values.state, values.country],
        [values.city, values.country],
        [values.state, values.country],
        [values.address, values.country],
        [values.city],
        [values.address]
    ]
        .map(parts => parts.map(value => (value || '').trim()).filter(Boolean).join(', '))
        .filter(Boolean);

    for (const address of variants) {
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'FTC-Starter-Hub/1.0',
                    Accept: 'application/json'
                }
            });

            if (!response.ok) continue;

            const results = await response.json();
            const first = Array.isArray(results) ? results[0] : null;
            if (!first) continue;

            const lat = toNumber(first.lat);
            const lon = toNumber(first.lon);
            if (lat === null || lon === null) continue;

            return { lat, lon };
        } catch (err) {
            continue;
        }
    }

    return null;
}

const PROGRAM_LABELS = {
    FTC: 'FIRST Tech Challenge',
    FRC: 'FIRST Robotics Competition',
    'FLL Challenge': 'FIRST LEGO League Challenge',
    'FLL Explore': 'FIRST LEGO League Explore'
};
const FTC_SCOUT_API_BASE = 'https://api.ftcscout.org/rest/v1';
const FTC_SCOUT_GRAPHQL_ENDPOINT = 'https://api.ftcscout.org/graphql';
const BLUE_ALLIANCE_API_BASE = 'https://www.thebluealliance.com/api/v3';
const BLUE_ALLIANCE_AUTH_KEY = process.env.TBA_AUTH_KEY || process.env.BLUE_ALLIANCE_API_KEY || process.env.BLUE_ALLIANCE_AUTH_KEY || '';
const teamApiDetailsCache = new Map();
const FTC_AWARD_TYPE_LABELS = {};

function normalizeProgram(program) {
    const value = String(program || '').trim();
    return PROGRAM_LABELS[value] ? value : 'FTC';
}

function isConfiguredCredential(value) {
    return Boolean(String(value || '').trim());
}

function shouldUseTeamApi(program, teamNumber) {
    if (!teamNumber) return false;
    const normalizedProgram = normalizeProgram(program);
    if (normalizedProgram === 'FTC') return true;
    if (normalizedProgram === 'FRC') return isConfiguredCredential(BLUE_ALLIANCE_AUTH_KEY);
    return false;
}

function extractHistorySortYear(entry) {
    const text = String(entry || '').trim();
    if (!text) return 0;

    const matches = text.match(/(?:19|20)\d{2}/g);
    if (!matches || !matches.length) return 0;

    return Number(matches[0]) || 0;
}

function formatSeasonLabel(program, season) {
    const value = Number(season);
    if (!Number.isFinite(value)) return '';
    return `${value}-${value + 1}`;
}

function extractTeamDisplayName(team) {
    if (!team) return '';
    return String(
        team.team_nickname
        || team.nickname
        || team.name
        || team.team_name
        || team.teamName
        || ''
    ).trim();
}

function formatFtcScoutAwardType(value) {
    const normalized = String(value || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim();
    if (!normalized) return '';
    const compact = normalized.replace(/\s+/g, '');
    if (FTC_AWARD_TYPE_LABELS[compact]) return FTC_AWARD_TYPE_LABELS[compact];
    if (FTC_AWARD_TYPE_LABELS[normalized]) return FTC_AWARD_TYPE_LABELS[normalized];
    if (/award$/i.test(normalized) || /(alliance|finalist|winner)/i.test(normalized)) return normalized;
    return `${normalized} Award`;
}

function formatFtcScoutPlacement(placement, awardType) {
    const place = Number(placement);
    if (!Number.isFinite(place) || place <= 1) return '';
    if (/alliance/i.test(String(awardType || ''))) return '';
    if (place === 2) return '2nd Place';
    if (place === 3) return '3rd Place';
    return `${place}th Place`;
}

function formatScoutSeasonLabel(season) {
    const startYear = Number(season);
    if (!Number.isFinite(startYear)) return '';
    return `${startYear}-${startYear + 1}`;
}

function formatCompetitionRegionLabel(team) {
    const events = Array.isArray(team && team.events) ? team.events : [];
    const sourceEvent = events.find(event => event && (event.regionCode || event.districtCode));
    const code = String(sourceEvent && (sourceEvent.regionCode || sourceEvent.districtCode) || '').trim();
    if (!code) return '';
    return `Region ${code}`;
}

function filterAdvancementValues(values) {
    return Array.isArray(values)
        ? values.filter(value => value === 'Qualifier' || value === 'Regional' || value === 'Worlds')
        : [];
}

function filterAdvancementHistoryValues(values) {
    return Array.isArray(values)
        ? values.filter(value => /^(Qualifier|Regional|Worlds)\b/i.test(String(value || '').trim()))
        : [];
}

function formatAdvancementEventLabel(eventType) {
    const type = String(eventType || '').trim();
    if (!type) return '';
    const normalized = type.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
    const compact = normalized.replace(/\s+/g, '').toLowerCase();

    if (compact === 'scrimmage' || compact === 'scrimages') return '';
    if (compact === 'firstchampionship' || compact === 'worldchampionship' || compact === 'worlds') return 'Worlds';
    if (compact === 'superqualifier' || compact === 'superqual') return 'Super Qualifier';
    if (compact === 'leaguetournament') return 'League Tournament';
    if (compact === 'leaguemeet') return 'League Meet';
    if (compact === 'premier') return 'Premier';
    if (compact === 'championship') return 'Championship';
    if (compact === 'regional') return 'Regional';
    if (compact === 'qualifier') return 'Qualifier';

    return normalized;
}

function mapAdvancementCategory(eventType) {
    const label = formatAdvancementEventLabel(eventType);
    const compact = label.replace(/\s+/g, '').toLowerCase();
    if (!compact) return null;
    if (compact === 'worlds') return 'Worlds';
    if (compact === 'superqualifier' || compact === 'leaguetournament' || compact === 'leaguemeet' || compact === 'qualifier') return 'Qualifier';
    if (compact === 'premier' || compact === 'championship' || compact === 'regional') return 'Regional';
    return null;
}

function formatTeamTenureLabel(team) {
    const yearsInProgram = Number(team && team.yearsInProgram);
    if (Number.isFinite(yearsInProgram) && yearsInProgram >= 0) {
        const roundedYears = Math.max(0, Math.round(yearsInProgram));
        return `${roundedYears} year${roundedYears === 1 ? '' : 's'}`;
    }

    const createdAt = team && team.createdAt ? new Date(team.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) return 'Not available';

    const monthsElapsed = Math.max(0, Math.round((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30.4375)));
    if (monthsElapsed < 12) {
        return `${monthsElapsed} month${monthsElapsed === 1 ? '' : 's'}`;
    }

    const yearsElapsed = Math.max(1, Math.round(monthsElapsed / 12));
    return `${yearsElapsed} year${yearsElapsed === 1 ? '' : 's'}`;
}

function formatAwardHistoryEntry(award) {
    const awardType = formatFtcScoutAwardType(award && award.type);
    if (!awardType) return null;
    const displayAwardType = String(awardType || '').replace(/^\s*(Winner|Finalist)\b/i, function(match, word) {
        return word.toLowerCase() === 'winner' ? 'Winning Alliance' : 'Finalist Alliance';
    });
    const placementLabel = formatFtcScoutPlacement(award && award.placement, awardType);
    const seasonLabel = formatScoutSeasonLabel(award && award.season);
    const parts = [displayAwardType];
    if (placementLabel) parts.push(placementLabel);
    if (seasonLabel) parts.push(seasonLabel);
    return parts.join(' - ').trim();
}

function formatAdvancementHistoryEntry(level, season) {
    if (!level) return null;
    const yearLabel = Number(season);
    return Number.isFinite(yearLabel) ? `${level} - ${yearLabel}` : level;
}

function getUniqueNumericValues(values) {
    return Array.from(new Set(
        Array.isArray(values)
            ? values.filter(value => Number.isFinite(Number(value))).map(value => Number(value))
            : []
    )).sort((a, b) => a - b);
}

async function fetchFtcScoutTeamDetails(teamNumber) {
    const body = {
        query: 'query($number:Int!){ teamByNumber(number:$number){ rookieYear awards { type placement season } matches { season event { type } } activeSeasons } }',
        variables: { number: Number(teamNumber) }
    };

    const response = await fetch(FTC_SCOUT_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) return null;

    const payload = await response.json();
    const team = payload && payload.data ? payload.data.teamByNumber : null;
    if (!team) return null;

    const matchParticipations = Array.isArray(team.matches) ? team.matches : [];
    const awards = Array.isArray(team.awards) ? team.awards : [];
    const awardHistory = sortHistoryEntriesMostRecent(awards.map(formatAwardHistoryEntry).filter(Boolean));
    const uniqueAwardTypes = Array.from(new Set(awards.map(award => formatFtcScoutAwardType(award.type)).filter(Boolean)));
    const awardSeasons = getUniqueNumericValues(awards.map(award => award && award.season));
    const matchSeasons = getUniqueNumericValues(matchParticipations.map(participation => participation && participation.season));
    const competitionSeasons = matchSeasons.length ? matchSeasons : (awardSeasons.length ? awardSeasons : getUniqueNumericValues(team.activeSeasons));
    const advancementLevels = [];
    const advancementHistoryRecords = [];

    matchParticipations.forEach((participation, index) => {
        const eventType = participation && participation.event ? participation.event.type : null;
        const displayLabel = formatAdvancementEventLabel(eventType);
        const level = mapAdvancementCategory(eventType);
        if (level && !advancementLevels.includes(level)) advancementLevels.push(level);
        if (displayLabel && !advancementLevels.includes(displayLabel)) advancementLevels.push(displayLabel);
        const historyLabel = level === 'Regional' && displayLabel === 'Championship' ? 'Regional' : (displayLabel || level);
        const historyEntry = formatAdvancementHistoryEntry(historyLabel, participation && participation.season);
        if (historyEntry) {
            advancementHistoryRecords.push({
                entry: historyEntry,
                year: Number(participation && participation.season) || 0,
                levelRank: level === 'Worlds' ? 3 : level === 'Regional' ? 2 : level === 'Qualifier' ? 1 : 0,
                index
            });
        }
    });

    const advancementHistory = advancementHistoryRecords
        .sort((left, right) => {
            if (left.year !== right.year) return right.year - left.year;
            if (left.levelRank !== right.levelRank) return right.levelRank - left.levelRank;
            return left.index - right.index;
        })
        .filter((item, index, list) => list.findIndex(candidate => candidate.entry === item.entry) === index)
        .map(item => item.entry);

    return {
        yearsInProgram: competitionSeasons.length || null,
        awards: uniqueAwardTypes.slice(0, 6).join(', ') || null,
        awardHistory,
        advancementLevels,
        advancementHistory
    };
}

async function fetchTeamDetailsViaApi(program, teamNumber) {
    const normalizedProgram = normalizeProgram(program);
    const cacheKey = `${normalizedProgram}:${Number(teamNumber)}`;
    if (teamApiDetailsCache.has(cacheKey)) {
        return teamApiDetailsCache.get(cacheKey);
    }

    const request = (async () => {
        if (normalizedProgram === 'FTC') {
            const ftcScoutDetails = await fetchFtcScoutTeamDetails(teamNumber).catch(() => null);
            if (!ftcScoutDetails) return null;
            return {
                profile: { team_number: Number(teamNumber) },
                awards: ftcScoutDetails.awards,
                awardHistory: ftcScoutDetails.awardHistory,
                yearsInProgram: ftcScoutDetails.yearsInProgram,
                advancementLevels: ftcScoutDetails.advancementLevels,
                advancementHistory: ftcScoutDetails.advancementHistory
            };
        }

        if (normalizedProgram === 'FRC') {
            if (!isConfiguredCredential(BLUE_ALLIANCE_AUTH_KEY)) return null;
            const response = await fetch(`${BLUE_ALLIANCE_API_BASE}/team/frc${Number(teamNumber)}`, {
                headers: {
                    'X-TBA-Auth-Key': BLUE_ALLIANCE_AUTH_KEY,
                    Accept: 'application/json'
                }
            });
            if (!response.ok) return null;
            const profile = await response.json();
            return {
                profile,
                awards: null,
                awardHistory: [],
                yearsInProgram: null,
                advancementLevels: [],
                advancementHistory: []
            };
        }

        return null;
    })();

    teamApiDetailsCache.set(cacheKey, request);
    return request;
}

async function enrichTeamWithFtcScout(team) {
    if (!team || !team.teamNumber || team.isNewTeam) return team;
    if (!shouldUseTeamApi(team.program || 'FTC', team.teamNumber)) return team;

    const apiDetails = await fetchTeamDetailsViaApi(team.program || 'FTC', team.teamNumber).catch(() => null);
    if (!apiDetails) return team;

    const enrichedTeam = {
        ...team,
        program: team.program || 'FTC',
        awards: apiDetails.awards || team.awards || '',
        awardHistory: apiDetails.awardHistory && apiDetails.awardHistory.length
            ? sortHistoryEntriesMostRecent(apiDetails.awardHistory)
            : sortHistoryEntriesMostRecent(team.awardHistory || []),
        yearsInProgram: apiDetails.yearsInProgram !== null && apiDetails.yearsInProgram !== undefined
            ? apiDetails.yearsInProgram
            : team.yearsInProgram,
        advancementLevels: apiDetails.advancementLevels && apiDetails.advancementLevels.length
            ? apiDetails.advancementLevels
            : (team.advancementLevels || []),
        advancementHistory: apiDetails.advancementHistory && apiDetails.advancementHistory.length
            ? sortHistoryEntriesMostRecent(apiDetails.advancementHistory)
            : sortHistoryEntriesMostRecent(team.advancementHistory || [])
    };
    const teamTenureLabel = formatTeamTenureLabel(enrichedTeam);

    const needsSave = enrichedTeam.awards !== team.awards
        || enrichedTeam.yearsInProgram !== team.yearsInProgram
        || JSON.stringify(enrichedTeam.awardHistory || []) !== JSON.stringify(team.awardHistory || [])
        || String(enrichedTeam.competitionRegionLabel || '') !== String(team.competitionRegionLabel || '')
        || JSON.stringify(enrichedTeam.advancementLevels || []) !== JSON.stringify(team.advancementLevels || [])
        || JSON.stringify(enrichedTeam.advancementHistory || []) !== JSON.stringify(team.advancementHistory || []);
    if (needsSave && team._id) {
        await Team.findByIdAndUpdate(team._id, {
            $set: {
                program: enrichedTeam.program,
                awards: enrichedTeam.awards,
                yearsInProgram: enrichedTeam.yearsInProgram,
                awardHistory: enrichedTeam.awardHistory,
                competitionRegionLabel: enrichedTeam.competitionRegionLabel,
                advancementLevels: enrichedTeam.advancementLevels,
                advancementHistory: enrichedTeam.advancementHistory,
                updatedAt: new Date()
            }
        }).exec().catch(() => null);
    }

    return enrichedTeam;
}

async function enrichTeamWithApi(team) {
    return enrichTeamWithFtcScout(team);
}

async function verifyTeamWithApi(teamNumber, program) {
    const normalizedProgram = normalizeProgram(program);
    if (normalizedProgram === 'FRC' && !isConfiguredCredential(BLUE_ALLIANCE_AUTH_KEY)) {
        return {
            ok: false,
            configured: false,
            error: 'Blue Alliance API key is missing. Add TBA_AUTH_KEY to your .env file to verify FRC teams.'
        };
    }

    const details = await fetchTeamDetailsViaApi(normalizedProgram, teamNumber).catch(() => null);
    if (!details || !details.profile) {
        return {
            ok: false,
            configured: true,
            error: `Team ${teamNumber} was not found in ${PROGRAM_LABELS[normalizedProgram]} on the selected team API.`
        };
    }

    return {
        ok: true,
        configured: true,
        team: details.profile,
        program: normalizedProgram,
        source: normalizedProgram === 'FRC' ? 'Blue Alliance' : 'FTC Scout'
    };
}

// Home page
router.get("/", function(req, res){
    let carouselImages = [];
    let featuredTeams = [];
    try {
        const dir = path.join(__dirname, '..', 'assets', 'img', 'carousel');
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir)
                .filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f))
                .filter(f => f !== '54352814752_6bf43c5dde_c.jpg')
                .sort()
                .slice(0,4);

            carouselImages = files.map(f => {
                const ext = path.extname(f);
                const base = f.slice(0, -ext.length);
                const hiRes = base + '@2x' + ext;
                const hiResPath = path.join(dir, hiRes);
                const src = '/assets/img/carousel/' + encodeURIComponent(f);
                let srcset = null;
                if (fs.existsSync(hiResPath)) {
                    const hi = '/assets/img/carousel/' + encodeURIComponent(hiRes);
                    srcset = `${src} 1x, ${hi} 2x`;
                }
                return { src, srcset };
            });
        }
    } catch (e) {
        carouselImages = [];
    }

    Team.find({ recruiting: true, $or: [{ verified: true }, { isNewTeam: true }] })
        .sort({ updatedAt: -1, teamNumber: 1 })
        .limit(3)
        .lean()
        .exec()
        .then(async (teams) => {
            const enrichedTeams = await Promise.all((Array.isArray(teams) ? teams : []).map(async (team) => {
                if (team && team.program === 'FTC') {
                    return enrichTeamWithFtcScout(team).catch(() => team) || team;
                }
                return team;
            }));

            featuredTeams = enrichedTeams.map((team) => ({
                program: team.program || 'FTC',
                teamNumber: team.teamNumber,
                name: team.name,
                location: [team.city, team.state, team.country].filter(Boolean).join(', ') || team.address || 'Location not listed',
                notes: team.notes || '',
                awards: team.awards || '',
                awardHistory: sortHistoryEntriesMostRecent(team.awardHistory || []),
                yearsInProgram: team.yearsInProgram,
                advancementLevels: Array.isArray(team.advancementLevels) ? team.advancementLevels : [],
                advancementHistory: sortHistoryEntriesMostRecent(team.advancementHistory || []),
                recruiting: team.recruiting,
                verified: team.verified,
                isNewTeam: Boolean(team.isNewTeam)
            }));
        })
        .catch(() => {
            featuredTeams = [];
        })
        .finally(() => {
            res.render("index", { carouselImages: carouselImages, featuredTeams: featuredTeams });
        });
});


// Start Team routes
router.get("/start-team", function(req, res){
    res.render("pages/start-team");
});

router.get("/start-team-step1", function(req, res){
    res.render("pages/start-team-step1");
});

router.get("/start-team-step2", function(req, res){
    res.render("pages/start-team-step2");
});

router.get("/start-team-step3", function(req, res){
    res.render("pages/start-team-step3");
});

router.get("/start-team-step4", function(req, res){
    res.render("pages/start-team-step4");
});

router.get("/start-team-step5", function(req, res){
    res.render("pages/start-team-step5");
});

router.get("/start-team-step6", function(req, res){
    res.render("pages/start-team-step6");
});

router.get("/start-team-step7", function(req, res){
    res.render("pages/start-team-step7");
});

router.get("/start-team-step8", function(req, res){
    res.render("pages/start-team-step8");
});

router.get("/start-team-step9", function(req, res){
    res.render("pages/start-team-step9");
});

// Join Team routes
router.get("/join-team", function(req, res){
    res.render("pages/join-team");
});

router.get("/join-form", async function(req, res){
    try {
        if (!isDatabaseConnected() || !req.session.userId) {
            return res.render("pages/join-form", { values: {} });
        }

        const user = await User.findById(req.session.userId).select('name age experience email phone interests').lean().exec();
        if (!user) {
            return res.render("pages/join-form", { values: {} });
        }

        const studentProfile = user.email
            ? await Student.findOne({ email: normalizeEmail(user.email) }).select('name age experience email phone interests').lean().exec()
            : null;

        const values = {
            name: (studentProfile && studentProfile.name) || user.name || '',
            age: (studentProfile && studentProfile.age) || user.age || '',
            experience: (studentProfile && studentProfile.experience) || user.experience || '',
            email: (studentProfile && studentProfile.email) || user.email || '',
            phone: (studentProfile && studentProfile.phone) || user.phone || '',
            interests: (studentProfile && studentProfile.interests) || user.interests || ''
        };

        res.render("pages/join-form", { values });
    } catch (err) {
        console.error('Failed to load join form profile:', err);
        res.render("pages/join-form", { values: {} });
    }
});

// Resources routes
router.get("/resources", function(req, res){
    res.render("pages/resources");
});

router.get("/programming", function(req, res){
    res.render("pages/programming");
});

router.get("/advanced-programming", function(req, res){
    res.render("pages/advanced_programming");
});

router.get("/sdk", function(req, res){
    res.render("pages/sdk");
});

router.get("/assembly", function(req, res){
    res.render("pages/assembly");
});

router.get("/drivetrain", function(req, res){
    res.render("pages/drivetrain");
});

router.get("/motor-selection", function(req, res){
    res.render("pages/motor-selection");
});

router.get("/mechanical-parts", function(req, res){
    res.render("pages/mechanical-parts");
});

router.get("/controller-setup", function(req, res){
    res.render("pages/controller-setup");
});

router.get("/funding", function(req, res){
    res.render("pages/funding");
});

router.get("/sponsorship", function(req, res){
    res.render("pages/sponsorship");
});

router.get("/outreach", function(req, res){
    res.render("pages/outreach");
});

router.get("/team-org", function(req, res){
    res.render("pages/team-org");
});

router.get("/teams-nearby", async function(req, res){
    try {
        if (!isDatabaseConnected()) return res.render("pages/teams-nearby", { teams: [] });
        const teams = await Team.find({ recruiting: true, $or: [{ verified: true }, { isNewTeam: true }] })
            .sort({ teamNumber: 1 })
            .limit(300)
            .lean()
            .exec();

        let studentApp = null;
        let currentUser = null;
        if (req.session && req.session.userId) {
            currentUser = await User.findById(req.session.userId).select('name age experience email phone interests').lean().exec();
            if (currentUser && currentUser.email) {
                const student = await Student.findOne({ email: normalizeEmail(currentUser.email) }).lean().exec();
                if (student) {
                    studentApp = {
                        applicationStatus: student.applicationStatus || null,
                        requestCount: student.requestCount || 0,
                        lastRequestAt: student.lastRequestAt ? student.lastRequestAt.toISOString() : null,
                        blocked: ['accepted', 'waitlisted'].includes(student.applicationStatus)
                    };
                }
            }
        }

        const enrichedTeams = await Promise.all(
            teams.map(async (team) => {
                if (!team || team.program !== 'FTC' || team.isNewTeam || !team.teamNumber) return team;

                const apiDetails = await fetchTeamDetailsViaApi('FTC', team.teamNumber).catch(() => null);
                if (!apiDetails) return team;

                return {
                    ...team,
                    awards: apiDetails.awards || team.awards || '',
                    awardHistory: apiDetails.awardHistory && apiDetails.awardHistory.length
                        ? sortHistoryEntriesMostRecent(apiDetails.awardHistory)
                        : sortHistoryEntriesMostRecent(team.awardHistory || []),
                    yearsInProgram: apiDetails.yearsInProgram !== null && apiDetails.yearsInProgram !== undefined
                        ? apiDetails.yearsInProgram
                        : team.yearsInProgram,
                    advancementLevels: apiDetails.advancementLevels && apiDetails.advancementLevels.length
                        ? apiDetails.advancementLevels
                        : (team.advancementLevels || []),
                    advancementHistory: apiDetails.advancementHistory && apiDetails.advancementHistory.length
                        ? sortHistoryEntriesMostRecent(apiDetails.advancementHistory)
                        : sortHistoryEntriesMostRecent(team.advancementHistory || [])
                };
            })
        );

        res.render("pages/teams-nearby", { teams: enrichedTeams.map(mapTeam), studentApp, user: currentUser });
    } catch (err) {
        console.error('Failed to load nearby teams:', err);
        res.render("pages/teams-nearby", { teams: [] });
    }
});

router.get('/team-register', function(req, res) {
    res.render('pages/team-register', { error: null, message: null, values: { registrationMode: 'existing' } });
});

router.post('/team-register', async function(req, res) {
    const values = req.body;

    try {
        if (!isDatabaseConnected()) {
            return res.render('pages/team-register', { error: databaseErrorMessage(), message: null, values });
        }

        const program = normalizeProgram(values.program);
        const registrationMode = String(values.registrationMode || 'existing').toLowerCase() === 'new' ? 'new' : 'existing';
        const isNewTeam = registrationMode === 'new';
        const contact = normalizeEmail(values.contact);
        const teamNumber = isNewTeam ? null : toNumber(values.teamNumber);
        const hasLocation = Boolean([values.address, values.city].some(value => (value || '').trim()));

        if ((!isNewTeam && !teamNumber) || !values.name || !contact || !hasLocation || !values.country) {
            return res.render('pages/team-register', {
                error: isNewTeam
                    ? 'Program, team name, contact email, address, and country are required for a new team.'
                    : 'Program, team number, team name, contact email, address, and country are required.',
                message: null,
                values
            });
        }

        let verification = { ok: true, team: null, source: 'Self-reported' };
        if (!isNewTeam) {
            verification = await verifyTeamWithApi(teamNumber, program);
            if (!verification.ok) {
                return res.render('pages/team-register', { error: verification.error, message: null, values });
            }
        }

        const official = verification.team;
        const officialName = isNewTeam
            ? String(values.name || '').trim()
            : (extractTeamDisplayName(official) || official.team_nickname || official.team_name_calc || official.team_name || values.name);
        const recruiting = values.recruiting === 'on';
        const allowFllExtras = program === 'FLL Challenge' || program === 'FLL Explore';
        const coords = await geocodeAddress(values);
        const apiTeamDetails = !isNewTeam && shouldUseTeamApi(program, teamNumber) ? await fetchTeamDetailsViaApi(program, teamNumber).catch(() => null) : null;

        if (!coords) {
            return res.render('pages/team-register', {
                error: 'Could not find that location on the map. Try adding the city, state, and country, or use a more specific address.',
                message: null,
                values
            });
        }

        const teamFilter = isNewTeam
            ? { program, contact, name: officialName }
            : { teamNumber, program };

        const teamData = {
            program,
            ...(isNewTeam ? {} : { teamNumber }),
            isNewTeam,
            name: officialName,
            contact,
            address: values.address || values.city,
            city: values.city,
            state: values.state,
            country: values.country || 'USA',
            lat: coords.lat,
            lon: coords.lon,
            notes: values.notes,
            awards: allowFllExtras
                ? (apiTeamDetails && apiTeamDetails.awards ? apiTeamDetails.awards : values.awards)
                : '',
            awardHistory: apiTeamDetails && apiTeamDetails.awardHistory ? sortHistoryEntriesMostRecent(apiTeamDetails.awardHistory) : [],
            yearsInProgram: apiTeamDetails && apiTeamDetails.yearsInProgram !== null
                ? apiTeamDetails.yearsInProgram
                : (allowFllExtras ? toNumber(values.yearsInProgram) : null),
            advancementLevels: apiTeamDetails && apiTeamDetails.advancementLevels ? apiTeamDetails.advancementLevels : [],
            advancementHistory: apiTeamDetails && apiTeamDetails.advancementHistory ? sortHistoryEntriesMostRecent(apiTeamDetails.advancementHistory) : [],
            recruiting,
            verified: !isNewTeam,
            verifiedAt: isNewTeam ? null : new Date(),
            verificationSource: isNewTeam ? 'Self-reported new team' : `${verification.source || (program === 'FRC' ? 'Blue Alliance' : 'FTC Scout')} lookup`,
            updatedAt: new Date()
        };

        const savedTeam = await Team.findOneAndUpdate(
            teamFilter,
            teamData,
            { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        ).exec();

        if (contact) {
            const contactUser = await User.findOne({ email: contact }).select('_id').lean().exec();
            if (contactUser && savedTeam) {
                await Team.findByIdAndUpdate(savedTeam._id, { $addToSet: { managers: contactUser._id } }).exec();
                if (!isNewTeam) {
                    await User.findByIdAndUpdate(contactUser._id, { $set: { teamNumber } }).exec();
                }
            }
        }

        if (req.session && req.session.userId && savedTeam) {
            await Team.findByIdAndUpdate(savedTeam._id, { $addToSet: { managers: req.session.userId } }).exec();
            if (!isNewTeam) {
                await User.findByIdAndUpdate(req.session.userId, { $set: { teamNumber } }).exec();
            }
        }

        res.render('pages/team-register', {
            error: null,
            message: isNewTeam
                ? `${program} new team saved. It will appear on the map as a new team. Recruiting is ${recruiting ? 'on' : 'off'}.`
                : `${PROGRAM_LABELS[program]} team ${teamNumber} verified and saved. Recruiting is ${recruiting ? 'on' : 'off'}.`,
            values: { registrationMode: 'existing' }
        });
    } catch (err) {
        console.error('Team registration failed:', err);
        res.render('pages/team-register', { error: err.message, message: null, values });
    }
});

// Team Management Dashboard
router.get('/manage-team', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.render('pages/manage-team', { error: databaseErrorMessage(), pendingInvitations: [], teamTenureLabel: null, teamOptions: [], teamSelectionOnly: false, currentTeamRole: '', teamManagers: [], recruits: [], waitlisted: [], acceptedCount: 0, waitlistCount: 0, rejectedCount: 0 });
        
        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        // Handle error messages passed via query string
        const queryError = req.query.error;
        let errorMessage = null;
        
        if (queryError === 'mail_failed') {
            errorMessage = 'Failed to send the invitation email. Please check your email configuration.';
        } else if (queryError === 'invite_invalid') {
            errorMessage = 'Invalid invitation email or token. Please enter a valid email address.';
        } else if (queryError === 'invite_send_failed') {
            errorMessage = 'The invitation was saved, but the email could not be sent. Check your Resend sender settings and try again.';
        } else if (queryError === 'invite_denied') {
            errorMessage = 'You do not have permission to invite managers for this team.';
        } else if (queryError === 'update_failed') {
            errorMessage = 'Failed to update team details.';
        } else if (queryError === 'manager_invalid') {
            errorMessage = 'Selected member is not eligible to become a manager.';
        } else if (queryError === 'manager_remove_invalid') {
            errorMessage = 'Selected user is not a manager or cannot be removed.';
        } else if (queryError === 'manager_remove_denied') {
            errorMessage = 'You do not have permission to remove managers for this team.';
        } else if (queryError === 'manager_remove_failed') {
            errorMessage = 'Unable to remove the manager. Please try again.';
        } else if (queryError === 'manager_add_failed') {
            errorMessage = 'Unable to add the new team manager. Please try again.';
        } else if (queryError === 'role_update_denied') {
            errorMessage = 'You do not have permission to update captain roles for this team.';
        } else if (queryError === 'role_update_invalid') {
            errorMessage = 'Please choose a valid manager and role.';
        } else if (queryError === 'role_update_failed') {
            errorMessage = 'Unable to update the role. Please try again.';
        } else if (queryError === 'pending_invites_clear_denied') {
            errorMessage = 'You do not have permission to clear pending invitations.';
        } else if (queryError === 'pending_invites_clear_failed') {
            errorMessage = 'Unable to clear pending invitations. Please try again.';
        }

        // Handle success messages
        const querySuccess = req.query.success;
        let successMessage = null;
        if (querySuccess === 'invite_sent') {
            successMessage = 'Invitation sent successfully!';
        } else if (querySuccess === 'manager_added') {
            successMessage = 'Manager added successfully!';
        } else if (querySuccess === 'manager_removed') {
            successMessage = 'Manager removed successfully.';
        } else if (querySuccess === 'member_removed') {
            successMessage = 'Member removed from the team successfully.';
        } else if (querySuccess === 'ownership_transferred') {
            successMessage = 'Team ownership transferred successfully.';
        } else if (querySuccess === 'status_updated') {
            successMessage = 'Status updated and email sent successfully.';
        } else if (querySuccess === 'recruitment_cleared') {
            successMessage = 'Recruitment feed cleared for testing.';
        } else if (querySuccess === 'role_updated') {
            successMessage = 'Captain role updated successfully.';
        } else if (querySuccess === 'role_cleared') {
            successMessage = 'Captain role cleared successfully.';
        } else if (querySuccess === 'role_removed') {
            successMessage = 'Manager role removed successfully.';
        } else if (querySuccess === 'left_team') {
            successMessage = 'You left the team successfully.';
        } else if (querySuccess === 'pending_invitations_cleared') {
            successMessage = 'Pending invitations cleared successfully.';
        }

        const teamOptions = await getAccessibleTeamsForUser(user);
        const selectedTeamId = String(req.query.team || req.session.activeTeamId || '').trim();
        let team = selectedTeamId
            ? teamOptions.find(option => String(option._id) === selectedTeamId) || null
            : null;
        const hasAccessibleTeams = teamOptions.length > 0;

        if (!team && hasAccessibleTeams) {
            team = teamOptions[0];
        }

        if (team) {
            req.session.activeTeamId = String(team._id);
        }

        const teamTenureLabel = team ? formatTeamTenureLabel(team) : null;
        const currentTeamRole = team ? getTeamManagerRole(team, user._id) : '';
        const isCaptainForTeam = Boolean(currentTeamRole);

        let teamManagers = [];
        let pendingInvitations = [];
        if (team) {
            teamManagers = team.managers && team.managers.length
                ? await User.find({ _id: { $in: team.managers } }).select('name role email').lean().exec()
                : [];

            const normalizedContact = normalizeEmail(team.contact);
            let primaryManager = null;
            if (normalizedContact) {
                primaryManager = await User.findOne({ email: normalizedContact })
                    .select('name role email')
                    .lean()
                    .exec();
            }

            if (primaryManager) {
                const alreadyPresent = teamManagers.some(manager => String(manager._id) === String(primaryManager._id));
                if (!alreadyPresent) {
                    primaryManager.primary = true;
                    primaryManager.teamRole = getTeamManagerRole(team, primaryManager._id);
                    teamManagers.unshift(primaryManager);
                } else {
                    teamManagers = teamManagers.map(manager => {
                        if (String(manager._id) === String(primaryManager._id)) {
                            return { ...manager, primary: true, teamRole: getTeamManagerRole(team, manager._id) };
                        }
                        return manager;
                    });
                }
            }

            teamManagers = teamManagers.map(manager => ({
                ...manager,
                teamRole: getTeamManagerRole(team, manager._id)
            }));

            const managerEmails = new Set(
                teamManagers
                    .map(manager => normalizeEmail(manager.email))
                    .filter(Boolean)
            );
            if (normalizedContact) {
                managerEmails.add(normalizedContact);
            }

            pendingInvitations = await ManagerInvite.find({
                team: team._id,
                acceptedAt: null,
                expiresAt: { $gt: new Date() }
            })
                .sort({ createdAt: -1 })
                .lean()
                .exec();

            pendingInvitations = pendingInvitations.filter(invite => !managerEmails.has(normalizeEmail(invite.email)));
        }

        if (!team) {
            const teamPickerError = hasAccessibleTeams
                ? 'Choose one of your teams below to open My Team.'
                : 'You are not currently managing a team.';
            return res.render('pages/manage-team', {
                user,
                team: null,
                teamOptions,
                teamSelectionOnly: hasAccessibleTeams,
                teamManagers: [],
                currentTeamRole: '',
                pendingInvitations: [],
                recruits: [],
                waitlisted: [],
                acceptedCount: 0,
                waitlistCount: 0,
                rejectedCount: 0,
                teamTenureLabel: null,
                error: teamPickerError,
                success: null
            });
        }

        // Fetch potential recruits (students who signed up via join-form)
        const allRecruits = await Student.find({}).sort({ createdAt: -1 }).limit(50).lean().exec();
        const recruits = allRecruits.filter(recruit => {
            return !recruit.applicationTeam || String(recruit.applicationTeam) === String(team._id);
        });
        const waitlisted = recruits.filter(recruit => recruit.applicationTeam && String(recruit.applicationTeam) === String(team._id) && recruit.applicationStatus === 'waitlisted');
        const acceptedCount = recruits.filter(recruit => recruit.applicationTeam && String(recruit.applicationTeam) === String(team._id) && recruit.applicationStatus === 'accepted').length;
        const waitlistCount = waitlisted.length;
        const rejectedCount = recruits.filter(recruit => recruit.applicationTeam && String(recruit.applicationTeam) === String(team._id) && recruit.applicationStatus === 'rejected').length;

        res.render('pages/manage-team', { 
            user, 
            team, 
            teamOptions,
            teamSelectionOnly: false,
            teamManagers,
            currentTeamRole,
            pendingInvitations,
            recruits,
            waitlisted,
            acceptedCount,
            waitlistCount,
            rejectedCount,
            teamTenureLabel,
            error: errorMessage,
            success: successMessage
        });
    } catch (err) {
        console.error('Management page error:', err);
        res.render('pages/manage-team', { 
            error: 'Failed to load dashboard',
            user: null, team: null, teamOptions: [], teamSelectionOnly: false, currentTeamRole: '', recruits: [], pendingInvitations: [], teamTenureLabel: null
        });
    }
});

// Student Dashboard / My Applications
router.get('/my-applications', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.render('pages/my-applications', { error: databaseErrorMessage() });
        
        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        // Find the student profile associated with this user's email
        const studentProfile = await Student.findOne({ email: normalizeEmail(user.email) })
            .populate('applicationTeam', 'name teamNumber contact')
            .lean()
            .exec();

        const applications = [];
        if (studentProfile && studentProfile.applicationTeam) {
            applications.push({
                teamName: studentProfile.applicationTeam.name,
                teamNumber: studentProfile.applicationTeam.teamNumber,
                teamContact: studentProfile.applicationTeam.contact,
                status: studentProfile.applicationStatus || 'pending',
                message: studentProfile.statusMessage || '',
                updatedAt: studentProfile.statusUpdatedAt || studentProfile.createdAt
            });
        }

        res.render('pages/my-applications', { 
            user, 
            studentProfile,
            applications,
            error: null 
        });
    } catch (err) {
        console.error('Applications page error:', err);
        res.render('pages/my-applications', { 
            error: 'Failed to load your applications dashboard',
            user: null, studentProfile: null, applications: [] 
        });
    }
});

// Update Team Details
router.post('/manage-team/update', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const { notes, recruiting } = req.body;
        
        // Ensure the user actually has management access on this team
        const team = await Team.findOneAndUpdate(
            {
                $or: [
                    { contact: buildContactEmailQuery(user.email) },
                    { managers: user._id }
                ]
            },
            { 
                notes: notes,
                recruiting: recruiting === 'on',
                updatedAt: new Date()
            },
            { new: true }
        ).exec();

        if (!team) {
            return res.render('pages/manage-team', { 
                error: 'Team not found or you do not have permission to edit it.',
                user, team: null, recruits: [], pendingInvitations: [], currentTeamRole: '', teamOptions: [], teamSelectionOnly: false, teamManagers: [], waitlisted: [], acceptedCount: 0, waitlistCount: 0, rejectedCount: 0
            });
        }

        res.redirect('/manage-team');
    } catch (err) {
        console.error('Update team error:', err);
        res.redirect('/manage-team?error=update_failed');
    }
});

// Add Team Manager
router.post('/manage-team/managers/add', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const team = await Team.findOne({
            $or: [
                    { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).exec();

        if (!team) {
            return res.redirect('/manage-team?error=manager_invalid');
        }

        const managerUserId = req.body.managerUserId;
        if (!managerUserId || !mongoose.Types.ObjectId.isValid(managerUserId)) {
            return res.redirect('/manage-team?error=manager_invalid');
        }

        const candidate = await User.findOne({ _id: managerUserId, teamNumber: team.teamNumber }).exec();
        if (!candidate) {
            return res.redirect('/manage-team?error=manager_invalid');
        }

        await Team.findByIdAndUpdate(team._id, { $addToSet: { managers: candidate._id } }).exec();
        res.redirect('/manage-team?success=manager_added');
    } catch (err) {
        console.error('Add manager error:', err);
        res.redirect('/manage-team?error=manager_add_failed');
    }
});

// Remove a team manager
router.post('/manage-team/managers/remove', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const team = await Team.findOne({
            $or: [
                    { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).exec();

        if (!team) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        const managerUserId = req.body.managerUserId;
        if (!managerUserId || !mongoose.Types.ObjectId.isValid(managerUserId)) {
            return res.redirect('/manage-team?error=manager_remove_invalid');
        }

        const managerToRemove = await User.findById(managerUserId).lean().exec();
        if (!managerToRemove) {
            return res.redirect('/manage-team?error=manager_remove_invalid');
        }

        const normalizedContact = normalizeEmail(team.contact);
        const targetIsPrimary = normalizeEmail(managerToRemove.email) === normalizedContact;
        const isPrimary = normalizeEmail(user.email) === normalizedContact;
        const isManager = Boolean(getTeamManagerRole(team, user._id));
        const isSelf = String(managerUserId) === String(user._id);

        if (targetIsPrimary) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        if (!isSelf && !isPrimary && !isManager) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        await Team.findByIdAndUpdate(team._id, {
            $pull: {
                managers: managerUserId,
                managerRoles: { userId: managerToRemove._id }
            }
        }).exec();

        if (isSelf) {
            return res.redirect('/account?success=self_removed');
        }

        res.redirect('/manage-team?success=manager_removed');
    } catch (err) {
        console.error('Remove manager error:', err);
        res.redirect('/manage-team?error=manager_remove_failed');
    }
});

// Remove manager role but keep the person on the team
router.post('/manage-team/managers/remove-role', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const team = await Team.findOne({
            $or: [
                { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).exec();

        if (!team) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        const managerUserId = req.body.managerUserId;
        if (!managerUserId || !mongoose.Types.ObjectId.isValid(managerUserId)) {
            return res.redirect('/manage-team?error=manager_remove_invalid');
        }

        const managerToRemove = await User.findById(managerUserId).lean().exec();
        if (!managerToRemove) {
            return res.redirect('/manage-team?error=manager_remove_invalid');
        }

        const normalizedContact = normalizeEmail(team.contact);
        const isPrimary = normalizeEmail(user.email) === normalizedContact;
        const isManager = Boolean(getTeamManagerRole(team, user._id));
        const isSelf = String(managerUserId) === String(user._id);
        const targetIsPrimary = normalizeEmail(managerToRemove.email) === normalizedContact;

        if (targetIsPrimary) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        if (!isSelf && !isPrimary && !isManager) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        await Team.findByIdAndUpdate(team._id, {
            $pull: {
                managers: managerUserId,
                managerRoles: { userId: managerToRemove._id }
            },
            updatedAt: new Date()
        }).exec();

        if (isSelf) {
            return res.redirect('/account?success=role_removed');
        }

        res.redirect('/manage-team?success=role_cleared');
    } catch (err) {
        console.error('Remove manager role error:', err);
        res.redirect('/manage-team?error=role_update_failed');
    }
});

// Transfer team ownership to another manager/member
router.post('/manage-team/managers/transfer-ownership', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const team = await Team.findOne({
            $or: [
                { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).exec();

        if (!team) {
            return res.redirect('/manage-team?error=role_update_denied');
        }

        const normalizedContact = normalizeEmail(team.contact);
        const isPrimary = normalizeEmail(user.email) === normalizedContact;
        if (!isPrimary) {
            return res.redirect('/manage-team?error=role_update_denied');
        }

        const managerUserId = req.body.managerUserId;
        if (!managerUserId || !mongoose.Types.ObjectId.isValid(managerUserId)) {
            return res.redirect('/manage-team?error=role_update_invalid');
        }

        const targetUser = await User.findById(managerUserId).exec();
        if (!targetUser || (team.teamNumber && Number(targetUser.teamNumber) !== Number(team.teamNumber))) {
            return res.redirect('/manage-team?error=role_update_invalid');
        }

        team.contact = normalizeEmail(targetUser.email);
        if (!Array.isArray(team.managers)) {
            team.managers = [];
        }
        if (!team.managers.some(id => String(id) === String(targetUser._id))) {
            team.managers.push(targetUser._id);
        }
        if (!Array.isArray(team.managerRoles)) {
            team.managerRoles = [];
        }
        team.managerRoles = team.managerRoles.filter(entry => String(entry.userId) !== String(targetUser._id));
        team.managerRoles.push({ userId: targetUser._id, role: 'manager' });
        team.updatedAt = new Date();
        await team.save();

        if (team.teamNumber) {
            await User.findByIdAndUpdate(targetUser._id, { $set: { teamNumber: team.teamNumber } }).exec();
        }

        res.redirect('/manage-team?success=ownership_transferred');
    } catch (err) {
        console.error('Transfer ownership error:', err);
        res.redirect('/manage-team?error=role_update_failed');
    }
});

// Remove a member from the team entirely
router.post('/manage-team/managers/remove-member', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const team = await Team.findOne({
            $or: [
                { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).exec();

        if (!team) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        const managerUserId = req.body.managerUserId;
        if (!managerUserId || !mongoose.Types.ObjectId.isValid(managerUserId)) {
            return res.redirect('/manage-team?error=manager_remove_invalid');
        }

        const memberToRemove = await User.findById(managerUserId).lean().exec();
        if (!memberToRemove) {
            return res.redirect('/manage-team?error=manager_remove_invalid');
        }

        const normalizedContact = normalizeEmail(team.contact);
        const targetIsPrimary = normalizeEmail(memberToRemove.email) === normalizedContact;
        const isPrimary = normalizeEmail(user.email) === normalizedContact;
        const isManager = Boolean(getTeamManagerRole(team, user._id));
        const isSelf = String(managerUserId) === String(user._id);

        if (targetIsPrimary) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        if (!isSelf && !isPrimary && !isManager) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        await Team.findByIdAndUpdate(team._id, {
            $pull: {
                managers: managerUserId,
                managerRoles: { userId: memberToRemove._id }
            },
            updatedAt: new Date()
        }).exec();

        if (team.teamNumber && Number(memberToRemove.teamNumber) === Number(team.teamNumber)) {
            await User.findByIdAndUpdate(memberToRemove._id, { $unset: { teamNumber: "" } }).exec();
        }

        if (isSelf) {
            return res.redirect('/account?success=removed_from_team');
        }

        res.redirect('/manage-team?success=member_removed');
    } catch (err) {
        console.error('Remove member error:', err);
        res.redirect('/manage-team?error=manager_remove_failed');
    }
});

// Leave team as the current user
router.post('/manage-team/managers/leave-team', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const team = await Team.findOne({
            $or: [
                { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).exec();

        if (!team) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        const isPrimary = normalizeEmail(user.email) === normalizeEmail(team.contact);
        const isManager = Boolean(getTeamManagerRole(team, user._id));
        if (!isPrimary && !isManager) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        if (isPrimary) {
            const remainingManagers = await User.find({
                _id: { $in: (Array.isArray(team.managers) ? team.managers : []).filter(id => String(id) !== String(user._id)) }
            }).sort({ createdAt: 1 }).lean().exec();

            const nextOwner = remainingManagers[0];
            if (!nextOwner) {
                return res.redirect('/manage-team?error=manager_remove_denied');
            }

            team.contact = normalizeEmail(nextOwner.email);
            team.managers = (Array.isArray(team.managers) ? team.managers : []).filter(id => String(id) !== String(user._id));
            team.managerRoles = (Array.isArray(team.managerRoles) ? team.managerRoles : []).filter(entry => String(entry.userId) !== String(user._id));
            if (!team.managers.some(id => String(id) === String(nextOwner._id))) {
                team.managers.push(nextOwner._id);
            }
            team.managerRoles.push({ userId: nextOwner._id, role: 'manager' });
            team.updatedAt = new Date();
            await team.save();

            if (team.teamNumber) {
                await User.findByIdAndUpdate(nextOwner._id, { $set: { teamNumber: team.teamNumber } }).exec();
            }
        } else {
            await Team.findByIdAndUpdate(team._id, {
                $pull: {
                    managers: user._id,
                    managerRoles: { userId: user._id }
                },
                updatedAt: new Date()
            }).exec();
        }

        await User.findByIdAndUpdate(user._id, { $unset: { teamNumber: "" } }).exec();
        req.session.activeTeamId = null;
        return res.redirect('/my-team?success=left_team');
    } catch (err) {
        console.error('Leave team error:', err);
        res.redirect('/manage-team?error=manager_remove_failed');
    }
});

// Update a manager assignment
router.post('/manage-team/managers/captain', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const team = await Team.findOne({
            $or: [
                    { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).exec();

        if (!team) {
            return res.redirect('/manage-team?error=role_update_denied');
        }

        const normalizedContact = normalizeEmail(team.contact);
        const primaryContactUser = await User.findOne({ email: normalizedContact }).lean().exec();
        const isPrimary = normalizeEmail(user.email) === normalizedContact;
        if (!isPrimary) {
            return res.redirect('/manage-team?error=role_update_denied');
        }

        const managerUserId = req.body.managerUserId;
        if (!managerUserId || !mongoose.Types.ObjectId.isValid(managerUserId)) {
            return res.redirect('/manage-team?error=role_update_invalid');
        }

        const isPrimaryTarget = primaryContactUser && String(primaryContactUser._id) === String(managerUserId);
        const isManagerTarget = Array.isArray(team.managers) && team.managers.some(id => String(id) === String(managerUserId));
        if (!isPrimaryTarget && !isManagerTarget) {
            return res.redirect('/manage-team?error=role_update_invalid');
        }

        const manager = await User.findById(managerUserId).exec();
        if (!manager) {
            return res.redirect('/manage-team?error=role_update_invalid');
        }

        setTeamManagerRole(team, manager._id, 'manager');
        await team.save();

        res.redirect('/manage-team?success=role_updated');
    } catch (err) {
        console.error('Captain update error:', err);
        res.redirect('/manage-team?error=role_update_failed');
    }
});

router.post('/manage-team/invitations/clear', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const team = await Team.findOne({
            $or: [
                    { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).lean().exec();

        if (!team) {
            return res.redirect('/manage-team?error=pending_invites_clear_denied');
        }

        const normalizedContact = normalizeEmail(team.contact);
        const isPrimary = normalizeEmail(user.email) === normalizedContact;
        const isManager = Boolean(getTeamManagerRole(team, user._id));
        if (!isPrimary && !isManager) {
            return res.redirect('/manage-team?error=pending_invites_clear_denied');
        }

        await ManagerInvite.deleteMany({
            team: team._id,
            acceptedAt: null
        }).exec();

        res.redirect('/manage-team?success=pending_invitations_cleared');
    } catch (err) {
        console.error('Clear pending invitations error:', err);
        res.redirect('/manage-team?error=pending_invites_clear_failed');
    }
});

// Clear the team recruitment feed for testing
router.post('/manage-team/recruitment/clear', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const team = await Team.findOne({
            $or: [
                    { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).exec();

        if (!team) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        const isPrimary = normalizeEmail(user.email) === normalizeEmail(team.contact);
        const isManager = Boolean(getTeamManagerRole(team, user._id));
        if (!isPrimary && !isManager) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        await Student.deleteMany({
            $or: [
                { applicationTeam: { $exists: false } },
                { applicationTeam: null },
                { applicationTeam: team._id }
            ]
        }).exec();

        res.redirect('/manage-team?success=recruitment_cleared');
    } catch (err) {
        console.error('Clear recruitment feed error:', err);
        res.redirect('/manage-team?error=manager_remove_failed');
    }
});

// Invite a user by email to become a manager
router.post('/manage-team/invite', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const team = await Team.findOne({
            $or: [
                { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).exec();

        if (!team) {
            return res.redirect('/manage-team?error=invite_denied');
        }

        const inviteEmail = normalizeEmail(req.body.email);
        if (!inviteEmail) {
            return res.redirect('/manage-team?error=invite_invalid');
        }

        let invite = await ManagerInvite.findOne({ team: team._id, email: inviteEmail, acceptedAt: null }).exec();
        if (!invite) {
            const token = createInviteToken();
            invite = new ManagerInvite({ team: team._id, email: inviteEmail, token });
            await invite.save();
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const inviteLink = `${baseUrl}/invite/${invite.token}`;

        const mailOptions = {
            from: DEFAULT_FROM,
            to: inviteEmail,
            subject: `Invitation to manage ${team.name}`,
            html: `
                <div style="font-family:sans-serif; padding:20px; color:#333;">
                    <h2>You have been invited to manage ${team.name}</h2>
                    <p><strong>Team:</strong> ${team.name} (#${team.teamNumber})</p>
                    <p>Click the link below to accept your management invitation:</p>
                    <p><a href="${inviteLink}" style="display:inline-block; padding:12px 18px; background:#0369a1; color:#fff; text-decoration:none; border-radius:6px;">Accept invitation</a></p>
                    <p>If you don’t have an account yet, you’ll be asked to sign up with this email.</p>
                </div>
            `
        };

        await createNotification({
            recipientEmail: inviteEmail,
            type: 'manager-invite',
            title: 'Manager invitation',
            body: `You were invited to help manage ${team.name}.`,
            link: `/invite/${invite.token}`,
            metadata: { teamId: String(team._id), teamName: team.name }
        });

        try {
            await sendEmail(mailOptions);
            res.redirect('/manage-team?success=invite_sent');
        } catch (mailErr) {
            console.error('Invite email delivery failed:', mailErr);
            res.redirect('/manage-team?error=invite_send_failed');
        }
    } catch (err) {
        console.error('Invite send error:', err);
        res.redirect('/manage-team?error=invite_invalid');
    }
});

// Delete Team
router.post('/manage-team/delete', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).exec();
        if (!user) return res.redirect('/logout');

        // Delete the team where the contact email matches the logged-in user
        const result = await Team.findOneAndDelete({ contact: buildContactEmailQuery(user.email) }).exec();

        if (result) {
            // Also remove the team association from the user record
            await User.findByIdAndUpdate(user._id, { $unset: { teamNumber: "" } });
            res.redirect('/');
        } else {
            res.render('pages/manage-team', { 
                error: 'No team found associated with your account to delete.',
                user, team: null, recruits: [], pendingInvitations: [], currentTeamRole: '', teamOptions: [], teamSelectionOnly: false, teamManagers: [], waitlisted: [], acceptedCount: 0, waitlistCount: 0, rejectedCount: 0
            });
        }
    } catch (err) {
        console.error('Delete team error:', err);
        res.redirect('/manage-team?error=delete_failed');
    }
});

// Contact Recruit Page
router.get('/manage-team/contact/:recruitId', ensureAuthenticated, async function(req, res) {
    try {
        const recruit = await Student.findById(req.params.recruitId).lean().exec();
        const user = await User.findById(req.session.userId).lean().exec();
        const team = await Team.findOne({
            $or: [
                { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).lean().exec();
        
        if (!recruit || !team) return res.redirect('/manage-team');
        
        res.render('pages/contact-recruit', { recruit, team, user, error: null });
    } catch (err) {
        res.redirect('/manage-team');
    }
});

// Update recruit application status and send email
router.post('/manage-team/recruit/:recruitId/status', ensureAuthenticated, async function(req, res) {
    try {
        const action = String(req.body.action || '').trim().toLowerCase();
        const customMessage = String(req.body.customMessage || '').trim();
        if (!['accept', 'waitlist', 'reject'].includes(action)) {
            return res.redirect('/manage-team?error=mail_failed');
        }

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const team = await Team.findOne({
            $or: [
                { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).lean().exec();
        if (!team) return res.redirect('/manage-team?error=invite_denied');

        const recruit = await Student.findById(req.params.recruitId).exec();
        if (!recruit || !recruit.email) return res.redirect('/manage-team?error=mail_failed');

        let subject;
        let bodyIntro;
        let status;

        const customBlock = customMessage ? `
            <div style="margin: 20px 0; padding: 18px; background: #f8fafc; border-radius: 10px;">
                <p style="margin:0 0 8px; font-weight:700;">Message from ${team.name}:</p>
                <p style="margin:0;">${customMessage}</p>
            </div>
        ` : '';

        if (action === 'reject') {
            subject = `${team.name} Application Update`;
            bodyIntro = `Thank you for your interest in joining ${team.name}. After reviewing your profile, we are unable to move forward at this time. We appreciate your interest and wish you the best in your season.`;
            status = 'rejected';
        } else if (action === 'waitlist') {
            subject = `${team.name} Waitlist Notification`;
            bodyIntro = `Thank you for applying to ${team.name}. We really like your profile and would like to keep you on our waitlist. We will contact you if a spot opens.`;
            status = 'waitlisted';
        } else {
            subject = `${team.name} Application Accepted`;
            bodyIntro = `Congratulations! ${team.name} would like to invite you to join our team. Please reply to this email and we will share the next steps with you.`;
            status = 'accepted';
        }

        const mailOptions = {
            from: DEFAULT_FROM,
            replyTo: team.contact,
            to: recruit.email,
            subject,
            html: `
                <div style="font-family: sans-serif; padding: 20px; color: #333;">
                    <h2>Hello ${recruit.name || 'there'}!</h2>
                    <p>${bodyIntro}</p>
                    ${customBlock}
                    <p style="margin-top: 20px;">If you have questions, please reply to this message at <strong>${team.contact}</strong>.</p>
                    <hr style="margin: 30px 0; border: none; border-top: 1px solid #e2e8f0;" />
                    <p style="font-size: 0.85rem; color: #6b7280;">Sent via FTC Starter Hub My Team</p>
                </div>
            `
        };

        await sendEmail(mailOptions);
        await createNotification({
            recipientEmail: recruit.email,
            type: 'application-status',
            title: subject,
            body: bodyIntro,
            link: '/my-applications',
            metadata: { teamId: String(team._id), recruitId: String(recruit._id), status }
        });

        recruit.applicationStatus = status;
        recruit.applicationTeam = team._id;
        recruit.statusMessage = customMessage || null;
        recruit.statusUpdatedAt = new Date();
        recruit.statusBy = user._id;
        await recruit.save();

        res.redirect('/manage-team?success=status_updated');
    } catch (err) {
        console.error('Status update error:', err);
        res.redirect('/manage-team?error=mail_failed');
    }
});

// Handle Contact Email Submission
router.post('/manage-team/contact/:recruitId', ensureAuthenticated, async function(req, res) {
    try {
        const { message, meetingDate, meetingTime, meetingLocation } = req.body;
        const recruit = await Student.findById(req.params.recruitId).exec();
        const user = await User.findById(req.session.userId).lean().exec();
        const team = await Team.findOne({
            $or: [
                { contact: buildContactEmailQuery(user.email) },
                { managers: user._id }
            ]
        }).lean().exec();

        if (!recruit || !team) return res.redirect('/manage-team');

        const formattedDate = meetingDate ? new Date(meetingDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Not specified';
        const time = meetingTime || 'Not specified';
        const location = meetingLocation || 'To be determined';

        const mailOptions = {
            from: DEFAULT_FROM,
            replyTo: team.contact,
            to: recruit.email,
            subject: `Invitation from ${team.program || 'FIRST'} Team ${team.teamNumber}: ${team.name}`,
            html: `
                <div style="font-family: sans-serif; padding: 20px; color: #333;">
                    <h2>Hello ${recruit.name}!</h2>
                    <p>${team.program || 'FIRST'} Team <strong>${team.teamNumber} - ${team.name}</strong> has seen your profile on the FTC Starter Hub and would like to connect!</p>
                    <div style="background: #f4f4f4; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p style="margin-top:0;"><strong>Message from the team:</strong></p>
                        <p>${message}</p>
                    </div>
                    <div style="margin: 20px 0; border-left: 4px solid #0056b3; padding-left: 15px;">
                        <p><strong>Suggested Date:</strong> ${formattedDate}</p>
                        <p><strong>Suggested Time:</strong> ${time}</p>
                        <p><strong>Location/Method:</strong> ${location}</p>
                    </div>
                    <p>Please reply directly to this email (${team.contact}) to coordinate.</p>
                    <hr>
                    <p style="font-size: 0.8rem; color: #666;">Sent via FTC Starter Hub Dashboard</p>
                </div>
            `
        };

        await sendEmail(mailOptions);
        await createNotification({
            recipientEmail: recruit.email,
            type: 'team-contact',
            title: `Message from ${team.name}`,
            body: `A manager from ${team.name} contacted you about joining the team.`,
            link: '/my-applications',
            metadata: { teamId: String(team._id), recruitId: String(recruit._id) }
        });
        console.log(`Invitation successfully sent to ${recruit.email} from ${team.name}`);
        return res.redirect('/manage-team?success=mail_sent');
    } catch (err) {
        console.error('--- RESEND ERROR ---');
        console.error('Code:', err.code);
        console.error('Response:', err.response);
        console.error('EMAIL ERROR: Unable to send through Resend. Verify RESEND_API_KEY and RESEND_FROM_EMAIL in .env.');
        console.error('Resend Send Error Detail:', err);
        res.redirect('/manage-team?error=mail_failed');
    }
});

// Member Team Page
router.get('/my-team', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.redirect('/manage-team');

        const selectedTeamId = String(req.query.team || req.session.activeTeamId || '').trim();
        const query = selectedTeamId ? `?team=${encodeURIComponent(selectedTeamId)}` : '';
        return res.redirect(`/manage-team${query}`);
    } catch (err) {
        res.redirect('/manage-team');
    }
});

router.get('/account', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) {
            return res.render('pages/account', { error: databaseErrorMessage(), user: null, studentProfile: null, team: null, teamOptions: [] });
        }

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const teamOptions = await getAccessibleTeamsForUser(user);
        const teamByContact = await Team.findOne({ contact: buildContactEmailQuery(user.email) }).lean().exec();
        const teamByManager = await Team.findOne({ managers: user._id }).lean().exec();
        const teamByNumber = user.teamNumber ? await Team.findOne({ teamNumber: user.teamNumber }).lean().exec() : null;
        const studentProfile = await Student.findOne({ email: user.email }).lean().exec();
        const selectedTeam = teamOptions.find(option => String(option._id) === String(req.query.team || req.session.activeTeamId || '')) || teamOptions[0] || teamByContact || teamByNumber || teamByManager || null;
        if (selectedTeam) {
            req.session.activeTeamId = String(selectedTeam._id);
        }

        res.render('pages/account', {
            error: null,
            user,
            team: selectedTeam,
            teamOptions,
            studentProfile
        });
    } catch (err) {
        console.error('Failed to load account page:', err);
        res.render('pages/account', { error: 'Unable to load account page right now.', user: null, studentProfile: null, team: null, teamOptions: [] });
    }
});

// Invite landing page
router.get('/invite/:token', async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.render('pages/invite-signup', { error: databaseErrorMessage(), token: req.params.token, email: '', teamName: '' });

        const invite = await ManagerInvite.findOne({ token: req.params.token }).lean().exec();
        if (!invite) {
            return res.render('pages/invite-signup', { error: 'This invitation link is invalid or expired.', token: req.params.token, email: '', teamName: '' });
        }

        const team = await Team.findById(invite.team).lean().exec();
        if (!team) {
            return res.render('pages/invite-signup', { error: 'The invited team could not be found.', token: req.params.token, email: invite.email, teamName: '' });
        }

        if (req.session.userId) {
            const user = await User.findById(req.session.userId).lean().exec();
            if (user && normalizeEmail(user.email) === normalizeEmail(invite.email)) {
                await acceptInviteToken(req.params.token, user);
                return res.redirect('/manage-team');
            }
        }

        res.render('pages/invite-signup', { error: null, token: req.params.token, email: invite.email, teamName: team.name });
    } catch (err) {
        console.error('Invite route error:', err);
        res.render('pages/invite-signup', { error: 'Unable to process the invitation right now.', token: req.params.token, email: '', teamName: '' });
    }
});

// Account routes
router.get('/signup', function(req, res){
    res.render('pages/signup', {
        error: null,
        inviteToken: req.query.inviteToken || null,
        nextPath: sanitizeNextPath(req.query.next, '')
    });
});

// Dedicated pages for each signup mode (selection page links here)
router.get('/signup/seeker', async function(req, res){
    const values = {};
    if (req.query.inviteToken) {
        const invite = await ManagerInvite.findOne({ token: req.query.inviteToken }).lean().exec();
        if (invite) {
            values.email = invite.email;
        }
    }
    res.render('pages/signup-seeker', {
        error: null,
        values,
        inviteToken: req.query.inviteToken || null,
        nextPath: sanitizeNextPath(req.query.next, '')
    });
});

router.get('/signup/manager', async function(req, res){
    const values = {};
    if (req.query.inviteToken) {
        const invite = await ManagerInvite.findOne({ token: req.query.inviteToken }).lean().exec();
        if (invite) {
            values.email = invite.email;
        }
    }
    res.render('pages/signup-manager', {
        error: null,
        values,
        inviteToken: req.query.inviteToken || null,
        nextPath: sanitizeNextPath(req.query.next, '')
    });
});

router.post('/signup', async function(req, res){
    const mode = req.body && req.body.signupMode === 'manager' ? 'manager' : 'seeker';
    try {
        if (!isDatabaseConnected()) return res.render(`pages/signup-${mode}`, { error: databaseErrorMessage(), values: req.body || {}, inviteToken: req.body.inviteToken || null, nextPath: sanitizeNextPath(req.body.next, '') });
        const { name, email, password, age, phone, profilePicture, interests, experience, role, inviteToken } = req.body;
        const nextPath = sanitizeNextPath(req.body.next, '');
        const normalizedEmail = normalizeEmail(email);
        const requiredFields = mode === 'manager'
            ? { name, normalizedEmail, password, team: req.body.team, role, phone, profilePicture }
            : { name, normalizedEmail, password, age, phone, profilePicture, interests, experience };
        const hasMissingRequiredField = Object.values(requiredFields).some(value => !String(value ?? '').trim());
        if (hasMissingRequiredField) return res.render(`pages/signup-${mode}`, { error: 'All fields required', values: req.body, inviteToken: inviteToken || null, nextPath });

        const numericAge = Number(age);
        if (mode === 'seeker' && (!Number.isFinite(numericAge) || numericAge < 6)) {
            return res.render(`pages/signup-${mode}`, { error: 'Please enter a valid age.', values: req.body, inviteToken: inviteToken || null, nextPath });
        }
        const existing = await User.findOne({ email: normalizedEmail }).exec();
        if (existing) return res.render(`pages/signup-${mode}`, { error: 'Email already registered', values: req.body, inviteToken: inviteToken || null, nextPath });
        const user = new User({
            name: name.trim(),
            email: normalizedEmail,
            age: mode === 'seeker' ? numericAge : undefined,
            phone: String(phone).trim(),
            profilePicture: String(profilePicture).trim(),
            interests: mode === 'seeker' ? String(interests).trim() : undefined,
            experience: mode === 'seeker' ? String(experience).trim() : undefined,
            role: String(role).trim()
        });
        await user.setPassword(password);
        await user.save();
        console.log(`User signup saved: ${user.email} -> ${mongoose.connection.name}.${User.collection.name}`);
        signIn(req, user);

        if (inviteToken) {
            const acceptedTeam = await acceptInviteToken(inviteToken, user);
            if (acceptedTeam) return res.redirect(nextPath || '/manage-team');
        }

        if (nextPath) return res.redirect(nextPath);
        res.redirect('/');
    } catch (err) {
        console.error('Signup failed:', err);
        const renderMode = req.body && req.body.signupMode === 'manager' ? 'manager' : 'seeker';
        res.render(`pages/signup-${renderMode}`, { error: err.message, values: req.body || {}, inviteToken: req.body.inviteToken || null, nextPath: sanitizeNextPath(req.body.next, '') });
    }
});

router.post('/account', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) {
            return res.render('pages/account', { error: databaseErrorMessage(), user: null, studentProfile: null, team: null });
        }

        const profilePicture = String(req.body.profilePicture || '').trim();
        const update = profilePicture
            ? { $set: { profilePicture } }
            : { $unset: { profilePicture: "" } };
        const updatedUser = await User.findByIdAndUpdate(
            req.session.userId,
            update,
            { new: true, runValidators: true }
        ).lean().exec();

        if (!updatedUser) return res.redirect('/logout');

        const teamByContact = await Team.findOne({ contact: buildContactEmailQuery(updatedUser.email) }).lean().exec();
        const teamByNumber = updatedUser.teamNumber ? await Team.findOne({ teamNumber: updatedUser.teamNumber }).lean().exec() : null;
        const studentProfile = await Student.findOne({ email: updatedUser.email }).lean().exec();

        res.render('pages/account', {
            error: null,
            success: 'Profile picture updated.',
            user: updatedUser,
            team: teamByContact || teamByNumber,
            studentProfile
        });
    } catch (err) {
        console.error('Failed to update account:', err);
        res.render('pages/account', { error: err.message, user: null, studentProfile: null, team: null });
    }
});

router.get('/account/signup-info', ensureAuthenticated, async function(req, res) {
    try {
        const backTarget = getSignupInfoBackTarget(req.query.back);
        const backUrl = backTarget === 'applications' ? '/my-applications' : '/account';
        if (!isDatabaseConnected()) return res.render('pages/account-signup-info', { error: databaseErrorMessage(), success: null, values: {}, backTarget, backUrl });

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const values = {
            name: user.name || '',
            age: user.age || '',
            experience: user.experience || '',
            email: user.email || '',
            phone: user.phone || '',
            interests: user.interests || ''
        };

        res.render('pages/account-signup-info', { error: null, success: null, values, backTarget, backUrl });
    } catch (err) {
        console.error('Signup info page error:', err);
        const backTarget = getSignupInfoBackTarget(req.query.back);
        const backUrl = backTarget === 'applications' ? '/my-applications' : '/account';
        res.render('pages/account-signup-info', { error: 'Unable to load your signup info.', success: null, values: {}, backTarget, backUrl });
    }
});

router.post('/account/signup-info', ensureAuthenticated, async function(req, res) {
    try {
        const backTarget = getSignupInfoBackTarget(req.body.back);
        const backUrl = backTarget === 'applications' ? '/my-applications' : '/account';
        if (!isDatabaseConnected()) return res.render('pages/account-signup-info', { error: databaseErrorMessage(), success: null, values: req.body || {}, backTarget, backUrl });

        const currentUser = await User.findById(req.session.userId).lean().exec();
        if (!currentUser) return res.redirect('/logout');

        const name = String(req.body.name || '').trim();
        const age = String(req.body.age || '').trim();
        const experience = String(req.body.experience || '').trim();
        const email = String(req.body.email || '').trim();
        const phone = String(req.body.phone || '').trim();
        const interests = String(req.body.interests || '').trim();

        const normalizedEmail = normalizeEmail(email);
        if (!name || !normalizedEmail) {
            return res.render('pages/account-signup-info', {
                error: 'Name and valid email are required.',
                success: null,
                values: req.body || {},
                backTarget,
                backUrl
            });
        }

        const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: req.session.userId } }).lean().exec();
        if (existingUser) {
            return res.render('pages/account-signup-info', {
                error: 'That email is already in use by another account.',
                success: null,
                values: req.body || {},
                backTarget,
                backUrl
            });
        }

        const updatedUser = await User.findByIdAndUpdate(req.session.userId, {
            name,
            age: age ? Number(age) : undefined,
            email: normalizedEmail,
            phone,
            interests,
            experience
        }, { new: true, runValidators: true }).exec();

        const student = await Student.findOne({ email: normalizeEmail(currentUser.email) }).exec();
        if (student) {
            student.name = name;
            student.age = age;
            student.experience = experience;
            student.interests = interests;
            student.phone = phone;
            student.email = normalizedEmail;
            await student.save();
        }

        const emailChanged = normalizeEmail(currentUser.email) !== normalizeEmail(updatedUser && updatedUser.email ? updatedUser.email : normalizedEmail);
        if (emailChanged) {
            return req.session.destroy((sessionErr) => {
                if (sessionErr) {
                    console.error('Failed to destroy session after email change:', sessionErr);
                }
                return res.redirect(`/login?notice=${encodeURIComponent('Your email was updated. Please sign in again.')}`);
            });
        }

        res.render('pages/account-signup-info', {
            error: null,
            success: 'Signup info saved successfully.',
            values: {
                name,
                age,
                experience,
                email: normalizedEmail,
                phone,
                interests
            },
            backTarget,
            backUrl
        });
    } catch (err) {
        console.error('Failed to save signup info:', err);
        const backTarget = getSignupInfoBackTarget(req.body && req.body.back);
        const backUrl = backTarget === 'applications' ? '/my-applications' : '/account';
        res.render('pages/account-signup-info', {
            error: err.message || 'Failed to save signup info.',
            success: null,
            values: req.body || {},
            backTarget,
            backUrl
        });
    }
});

router.get('/login', function(req, res){
    res.render('pages/login', {
        error: null,
        notice: req.query.notice || null,
        inviteToken: req.query.inviteToken || null,
        nextPath: sanitizeNextPath(req.query.next, '')
    });
});

router.get('/forgot-password', function(req, res){
    res.render('pages/forgot-password', {
        supportEmail: SUPPORT_EMAIL,
        error: null,
        success: null,
        email: ''
    });
});

router.post('/forgot-password', async function(req, res){
    const email = normalizeEmail(req.body && req.body.email);
    const supportEmail = SUPPORT_EMAIL;

    try {
        if (!isDatabaseConnected()) {
            return res.render('pages/forgot-password', {
                supportEmail,
                error: databaseErrorMessage(),
                success: null,
                email: req.body && req.body.email ? String(req.body.email) : ''
            });
        }

        if (!email) {
            return res.render('pages/forgot-password', {
                supportEmail,
                error: 'Please enter the email address on your account.',
                success: null,
                email: ''
            });
        }

        const user = await User.findOne({ email }).exec();
        if (user) {
            const token = user.createPasswordResetToken();
            await user.save();

            const resetUrl = `${getAppBaseUrl(req)}/reset-password/${encodeURIComponent(token)}`;
            await sendEmail({
                from: DEFAULT_FROM,
                to: user.email,
                subject: 'Reset your FTC Starter Hub password',
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; color: #1f2937;">
                        <h2 style="margin-top:0;">Password reset request</h2>
                        <p>We received a request to reset the password for your FTC Starter Hub account.</p>
                        <p style="margin: 22px 0;">
                            <a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#0b7a39;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Set a new password</a>
                        </p>
                        <p>If you did not request this, you can ignore this email.</p>
                        <p style="font-size: 0.9rem; color: #6b7280;">This link expires in 1 hour.</p>
                    </div>
                `,
                replyTo: supportEmail
            });
        }

        return res.render('pages/forgot-password', {
            supportEmail,
            error: null,
            success: 'If an account exists for that email, we sent a password reset link.',
            email: ''
        });
    } catch (err) {
        console.error('Password reset request error:', err);
        return res.render('pages/forgot-password', {
            supportEmail,
            error: 'We could not process that request right now.',
            success: null,
            email: req.body && req.body.email ? String(req.body.email) : ''
        });
    }
});

router.get('/reset-password/:token', async function(req, res){
    try {
        if (!isDatabaseConnected()) {
            return res.render('pages/reset-password', {
                error: databaseErrorMessage(),
                token: req.params.token,
                success: null
            });
        }

        const tokenHash = hashResetToken(req.params.token);
        const user = await User.findOne({
            passwordResetTokenHash: tokenHash,
            passwordResetTokenExpiresAt: { $gt: new Date() }
        }).exec();

        if (!user) {
            return res.render('pages/reset-password', {
                error: 'That reset link is invalid or has expired.',
                token: req.params.token,
                success: null
            });
        }

        return res.render('pages/reset-password', {
            error: null,
            token: req.params.token,
            success: null
        });
    } catch (err) {
        console.error('Password reset page error:', err);
        return res.render('pages/reset-password', {
            error: 'Unable to open the reset page right now.',
            token: req.params.token,
            success: null
        });
    }
});

router.post('/reset-password/:token', async function(req, res){
    try {
        if (!isDatabaseConnected()) {
            return res.render('pages/reset-password', {
                error: databaseErrorMessage(),
                token: req.params.token,
                success: null
            });
        }

        const { password, confirmPassword } = req.body || {};
        if (!password || !confirmPassword) {
            return res.render('pages/reset-password', {
                error: 'Please enter and confirm your new password.',
                token: req.params.token,
                success: null
            });
        }

        if (String(password) !== String(confirmPassword)) {
            return res.render('pages/reset-password', {
                error: 'Passwords do not match.',
                token: req.params.token,
                success: null
            });
        }

        if (String(password).length < 8) {
            return res.render('pages/reset-password', {
                error: 'Password must be at least 8 characters long.',
                token: req.params.token,
                success: null
            });
        }

        const tokenHash = hashResetToken(req.params.token);
        const user = await User.findOne({
            passwordResetTokenHash: tokenHash,
            passwordResetTokenExpiresAt: { $gt: new Date() }
        }).exec();

        if (!user) {
            return res.render('pages/reset-password', {
                error: 'That reset link is invalid or has expired.',
                token: req.params.token,
                success: null
            });
        }

        await user.setPassword(password);
        user.passwordResetTokenHash = undefined;
        user.passwordResetTokenExpiresAt = undefined;
        await user.save();

        return res.render('pages/reset-password', {
            error: null,
            token: null,
            success: 'Your password has been updated. You can log in now.'
        });
    } catch (err) {
        console.error('Password reset submit error:', err);
        return res.render('pages/reset-password', {
            error: 'Unable to update your password right now.',
            token: req.params.token,
            success: null
        });
    }
});

router.get('/auth-gate', function(req, res){
    const nextPath = sanitizeNextPath(req.query.next, '/');
    if (req.session.userId) {
        return res.redirect(nextPath);
    }

    res.render('pages/auth-gate', {
        nextPath,
        destinationLabel: String(req.query.label || '').trim()
    });
});

router.post('/login', async function(req, res){
    try {
        if (!isDatabaseConnected()) return res.render('pages/login', { error: databaseErrorMessage(), notice: null, inviteToken: req.body.inviteToken || null, nextPath: sanitizeNextPath(req.body.next, '') });
        const { email, password, inviteToken } = req.body;
        const nextPath = sanitizeNextPath(req.body.next, '');
        const remember = req.body && (req.body.remember === '1' || req.body.remember === 'on' || req.body.remember === true);
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || !password) return res.render('pages/login', { error: 'Email and password required', notice: null, inviteToken: inviteToken || null, nextPath });
        const user = await User.findOne({ email: normalizedEmail }).exec();
        if (!user) return res.render('pages/login', { error: 'Invalid credentials', notice: null, inviteToken: inviteToken || null, nextPath });
        const ok = await user.validatePassword(password);
        if (!ok) return res.render('pages/login', { error: 'Invalid credentials', notice: null, inviteToken: inviteToken || null, nextPath });
        signIn(req, user);
        applyRememberMe(req, remember);

        if (inviteToken) {
            const acceptedTeam = await acceptInviteToken(inviteToken, user);
            if (acceptedTeam) return res.redirect(nextPath || '/manage-team');
        }

        if (nextPath) return res.redirect(nextPath);
        res.redirect(await getPostLoginRedirect(user));
    } catch (err) {
        res.render('pages/login', { error: err.message, notice: null, inviteToken: req.body && req.body.inviteToken ? req.body.inviteToken : null, nextPath: sanitizeNextPath(req.body && req.body.next, '') });
    }
});

router.get('/logout', function(req, res){
    req.session.destroy(() => res.redirect('/'));
});

module.exports = router;

