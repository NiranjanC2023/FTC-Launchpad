const express = require("express");
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/user');
const Team = require('../models/team');
const ManagerInvite = require('../models/managerInvite');
const nodemailer = require('nodemailer');
const Student = require('../models/student');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'evergreentechatrons.contact@gmail.com',
        pass: process.env.EMAIL_PASS || 'iftg tyjt luey pqsc'
    },
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 10000
});

// Check connection on startup
transporter.verify((error) => {
    if (error) {
        console.error('Nodemailer Config Error (Check .env):', error.message);
    } else {
        console.log('Nodemailer: Server is ready to send invitation emails');
    }
});

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function signIn(req, user) {
    req.session.userId = user._id.toString();
}

function createInviteToken() {
    return crypto.randomBytes(24).toString('hex');
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

function databaseErrorMessage() {
    return 'Database is not connected. Start MongoDB or set MONGODB_URI, then try again.';
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
        notes: team.notes,
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
    const address = buildAddress(values);
    if (!address) return null;

    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'FTC-Starter-Hub/1.0',
            Accept: 'application/json'
        }
    });

    if (!response.ok) return null;

    const results = await response.json();
    const first = Array.isArray(results) ? results[0] : null;
    if (!first) return null;

    const lat = toNumber(first.lat);
    const lon = toNumber(first.lon);
    if (lat === null || lon === null) return null;

    return { lat, lon };
}

const FIRST_SEARCH_ENDPOINT = 'https://3dl2fnsh51.execute-api.us-east-1.amazonaws.com/prod/first-search';

const PROGRAM_LABELS = {
    FTC: 'FIRST Tech Challenge',
    FRC: 'FIRST Robotics Competition',
    'FLL Challenge': 'FIRST LEGO League Challenge',
    'FLL Explore': 'FIRST LEGO League Explore'
};

function normalizeProgram(program) {
    const value = String(program || '').trim();
    return PROGRAM_LABELS[value] ? value : 'FTC';
}

async function verifyFirstTeam(teamNumber, program) {
    const normalizedProgram = normalizeProgram(program);
    const query = {
        index: 'teams_*',
        query: {
            size: 25,
            query: {
                bool: {
                    must: [
                        { term: { team_number_yearly: String(teamNumber) } },
                        { term: { ff_program_moniker: normalizedProgram } }
                    ]
                }
            }
        }
    };

    const response = await fetch(FIRST_SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(query)
    });

    if (!response.ok) {
        return {
            ok: false,
            configured: true,
            error: `FIRST lookup failed with status ${response.status}.`
        };
    }

    const data = await response.json();
    const teams = Array.isArray(data.results) ? data.results : [];
    const official = teams.find(team => String(team.team_number_yearly) === String(teamNumber) && team.ff_program_moniker === normalizedProgram);

    if (!official) {
        return {
            ok: false,
            configured: true,
            error: `Team ${teamNumber} was not found in ${PROGRAM_LABELS[normalizedProgram]} on the FIRST team search.`
        };
    }

    return { ok: true, configured: true, team: official, program: normalizedProgram };
}

// Home page
router.get("/", function(req, res){
    let carouselImages = [];
    try {
        const dir = path.join(__dirname, '..', 'assets', 'img', 'carousel');
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir)
                .filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f))
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

    res.render("index", { carouselImages: carouselImages });
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
        const values = user ? {
            name: user.name || '',
            age: user.age || '',
            experience: user.experience || '',
            email: user.email || '',
            phone: user.phone || '',
            interests: user.interests || ''
        } : {};

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
        const teams = await Team.find({ verified: true, recruiting: true })
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

        res.render("pages/teams-nearby", { teams: teams.map(mapTeam), studentApp, user: currentUser });
    } catch (err) {
        console.error('Failed to load nearby teams:', err);
        res.render("pages/teams-nearby", { teams: [] });
    }
});

router.get('/team-register', function(req, res) {
    res.render('pages/team-register', { error: null, message: null, values: {} });
});

router.post('/team-register', async function(req, res) {
    const values = req.body;

    try {
        if (!isDatabaseConnected()) {
            return res.render('pages/team-register', { error: databaseErrorMessage(), message: null, values });
        }

        const teamNumber = toNumber(values.teamNumber);
        const program = normalizeProgram(values.program);
        const contact = normalizeEmail(values.contact);
        const hasLocation = Boolean([values.address, values.city].some(value => (value || '').trim()));

        if (!teamNumber || !values.name || !contact || !hasLocation || !values.country) {
            return res.render('pages/team-register', {
                error: 'Program, team number, team name, contact email, city or street, and country are required.',
                message: null,
                values
            });
        }

        const verification = await verifyFirstTeam(teamNumber, program);
        if (!verification.ok) {
            return res.render('pages/team-register', { error: verification.error, message: null, values });
        }

        const official = verification.team;
        const officialName = official.team_nickname || official.team_name_calc || official.team_name || values.name;
        const recruiting = values.recruiting === 'on';
        const coords = await geocodeAddress(values);

        if (!coords) {
            return res.render('pages/team-register', {
                error: 'Could not find that city or street on the map. Check the location, state, and country.',
                message: null,
                values
            });
        }

        const savedTeam = await Team.findOneAndUpdate(
            { teamNumber, program },
            {
                program,
                teamNumber,
                name: officialName,
                contact,
                address: values.address || values.city,
                city: values.city,
                state: values.state,
                country: values.country || 'USA',
                lat: coords.lat,
                lon: coords.lon,
                notes: values.notes,
                recruiting,
                verified: true,
                verifiedAt: new Date(),
                verificationSource: `FIRST ${PROGRAM_LABELS[program]} search`,
                updatedAt: new Date()
            },
            { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        ).exec();

        if (contact) {
            const contactUser = await User.findOne({ email: contact }).select('_id').lean().exec();
            if (contactUser && savedTeam) {
                await Team.findByIdAndUpdate(savedTeam._id, { $addToSet: { managers: contactUser._id } }).exec();
            }
        }

        res.render('pages/team-register', {
            error: null,
            message: `${PROGRAM_LABELS[program]} team ${teamNumber} verified and saved. Recruiting is ${recruiting ? 'on' : 'off'}.`,
            values: {}
        });
    } catch (err) {
        console.error('Team registration failed:', err);
        res.render('pages/team-register', { error: err.message, message: null, values });
    }
});

// Team Management Dashboard
router.get('/manage-team', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.render('pages/manage-team', { error: databaseErrorMessage() });
        
        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        // Handle error messages passed via query string
        const queryError = req.query.error;
        let errorMessage = null;
        
        if (queryError === 'mail_failed') {
            errorMessage = 'Failed to send the invitation email. Please check your email configuration.';
        } else if (queryError === 'invite_invalid') {
            errorMessage = 'Invalid invitation email or token. Please enter a valid email address.';
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
        } else if (querySuccess === 'status_updated') {
            successMessage = 'Status updated and email sent successfully.';
        } else if (querySuccess === 'recruitment_cleared') {
            successMessage = 'Recruitment feed cleared for testing.';
        }

        // Find team associated with this user's email or manager access
        const normalizedEmail = normalizeEmail(user.email);
        const team = await Team.findOne({
            $or: [
                { contact: normalizedEmail },
                { managers: user._id }
            ]
        }).lean().exec();

        let teamManagers = [];
        let managerCandidates = [];
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
                    teamManagers.unshift(primaryManager);
                } else {
                    teamManagers = teamManagers.map(manager => {
                        if (String(manager._id) === String(primaryManager._id)) {
                            return { ...manager, primary: true };
                        }
                        return manager;
                    });
                }
            }

            const teamMembers = await User.find({ teamNumber: team.teamNumber })
                .select('name email profilePicture role')
                .lean()
                .exec();

            const managerIds = (team.managers || []).map(id => String(id));
            managerCandidates = teamMembers.filter(member => {
                return String(member.email).toLowerCase() !== normalizedContact
                    && !managerIds.includes(String(member._id));
            });
        }

        if (!team) {
            return res.render('pages/manage-team', {
                user,
                team: null,
                teamManagers: [],
                managerCandidates: [],
                recruits: [],
                waitlisted: [],
                acceptedCount: 0,
                waitlistCount: 0,
                rejectedCount: 0,
                error: 'You are no longer a manager on any team.',
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
            teamManagers,
            managerCandidates,
            recruits,
            waitlisted,
            acceptedCount,
            waitlistCount,
            rejectedCount,
            error: errorMessage,
            success: successMessage
        });
    } catch (err) {
        console.error('Management page error:', err);
        res.render('pages/manage-team', { 
            error: 'Failed to load dashboard',
            user: null, team: null, recruits: [] 
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
        const studentProfile = await Student.findOne({ email: user.email }).lean().exec();
        
        // Placeholder for applications/invitations logic
        // In a future update, you would query an 'Invitations' model here
        const applications = []; 

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
                    { contact: user.email },
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
                user, team: null, recruits: [] 
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
                { contact: user.email },
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
                { contact: user.email },
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
        const isCaptain = String(user.role || '').trim().toLowerCase() === 'captain';
        const isSelf = String(managerUserId) === String(user._id);
        const targetIsCaptain = String(managerToRemove.role || '').trim().toLowerCase() === 'captain';

        if (targetIsPrimary) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        if (targetIsCaptain && !isPrimary && !isCaptain) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        if (!isSelf && !isPrimary && !isCaptain) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        await Team.findByIdAndUpdate(team._id, { $pull: { managers: managerUserId } }).exec();

        if (isSelf) {
            return res.redirect('/account?success=self_removed');
        }

        res.redirect('/manage-team?success=manager_removed');
    } catch (err) {
        console.error('Remove manager error:', err);
        res.redirect('/manage-team?error=manager_remove_failed');
    }
});

// Toggle captain status for a team manager
router.post('/manage-team/managers/captain', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.status(503).send(databaseErrorMessage());

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const team = await Team.findOne({
            $or: [
                { contact: user.email },
                { managers: user._id }
            ]
        }).exec();

        if (!team) {
            return res.redirect('/manage-team?error=captain_update_denied');
        }

        const normalizedContact = normalizeEmail(team.contact);
        const primaryContactUser = await User.findOne({ email: normalizedContact }).lean().exec();
        const isPrimary = normalizeEmail(user.email) === normalizedContact;
        if (!isPrimary) {
            return res.redirect('/manage-team?error=captain_update_denied');
        }

        const managerUserId = req.body.managerUserId;
        if (!managerUserId || !mongoose.Types.ObjectId.isValid(managerUserId)) {
            return res.redirect('/manage-team?error=captain_update_invalid');
        }

        const isPrimaryTarget = primaryContactUser && String(primaryContactUser._id) === String(managerUserId);
        const isManagerTarget = Array.isArray(team.managers) && team.managers.some(id => String(id) === String(managerUserId));
        if (!isPrimaryTarget && !isManagerTarget) {
            return res.redirect('/manage-team?error=captain_update_invalid');
        }

        const manager = await User.findById(managerUserId).exec();
        if (!manager) {
            return res.redirect('/manage-team?error=captain_update_invalid');
        }

        const isCurrentlyCaptain = String(manager.role || '').trim().toLowerCase() === 'captain';
        if (isCurrentlyCaptain) {
            manager.role = undefined;
            await manager.save();
            return res.redirect('/manage-team?success=captain_removed');
        }

        await User.updateMany(
            { teamNumber: team.teamNumber, role: 'captain' },
            { $unset: { role: '' } }
        ).exec();

        manager.role = 'captain';
        await manager.save();

        res.redirect('/manage-team?success=captain_set');
    } catch (err) {
        console.error('Captain update error:', err);
        res.redirect('/manage-team?error=captain_update_failed');
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
                { contact: user.email },
                { managers: user._id }
            ]
        }).exec();

        if (!team) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        const isPrimary = normalizeEmail(user.email) === normalizeEmail(team.contact);
        const isCaptain = String(user.role || '').trim().toLowerCase() === 'captain';
        if (!isPrimary && !isCaptain) {
            return res.redirect('/manage-team?error=manager_remove_denied');
        }

        await Student.updateMany(
            { applicationTeam: team._id },
            { $unset: { applicationTeam: '', applicationStatus: '', statusMessage: '', statusUpdatedAt: '', statusBy: '' } }
        ).exec();

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
                { contact: user.email },
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
            from: `"${team.name}" <${process.env.EMAIL_USER}>`,
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

        await transporter.sendMail(mailOptions);
        res.redirect('/manage-team?success=invite_sent');
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
        const result = await Team.findOneAndDelete({ contact: user.email }).exec();

        if (result) {
            // Also remove the team association from the user record
            await User.findByIdAndUpdate(user._id, { $unset: { teamNumber: "" } });
            res.redirect('/');
        } else {
            res.render('pages/manage-team', { 
                error: 'No team found associated with your account to delete.',
                user, team: null, recruits: [] 
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
                { contact: user.email },
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
                { contact: user.email },
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
            from: `"${team.name}" <${process.env.EMAIL_USER}>`,
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
                    <p style="font-size: 0.85rem; color: #6b7280;">Sent via FTC Starter Hub Command Center</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

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
                { contact: user.email },
                { managers: user._id }
            ]
        }).lean().exec();

        if (!recruit || !team) return res.redirect('/manage-team');

        const formattedDate = meetingDate ? new Date(meetingDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Not specified';
        const time = meetingTime || 'Not specified';
        const location = meetingLocation || 'To be determined';

        const mailOptions = {
            from: `"${team.name}" <${process.env.EMAIL_USER}>`,
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

        await transporter.sendMail(mailOptions);
        console.log(`Invitation successfully sent to ${recruit.email} from ${team.name}`);
        return res.redirect('/manage-team?success=mail_sent');
    } catch (err) {
        console.error('--- NODEMAILER ERROR ---');
        console.error('Code:', err.code);
        console.error('Response:', err.response);
        
        if (err.code === 'EAUTH') {
            console.error('EMAIL ERROR: Authentication failed. Verify EMAIL_USER and EMAIL_PASS (App Password) in .env');
        } else if (err.code === 'ESOCKET') {
            console.error('EMAIL ERROR: Connection timeout. Check your internet connection.');
        } else {
            console.error('Nodemailer Send Error Detail:', err);
        }
        res.redirect('/manage-team?error=mail_failed');
    }
});

// Member Team Page
router.get('/my-team', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.render('pages/my-team', { error: databaseErrorMessage() });
        
        const user = await User.findById(req.session.userId).lean().exec();
        if (!user || !user.teamNumber) return res.redirect('/');

        const team = await Team.findOne({ teamNumber: user.teamNumber }).lean().exec();
        if (!team) return res.render('pages/my-team', { error: 'Team not found', team: null });

        res.render('pages/my-team', { team, user, error: null });
    } catch (err) {
        res.render('pages/my-team', { error: 'Error loading team page', team: null });
    }
});

router.get('/account', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) {
            return res.render('pages/account', { error: databaseErrorMessage(), user: null, studentProfile: null, team: null });
        }

        const user = await User.findById(req.session.userId).lean().exec();
        if (!user) return res.redirect('/logout');

        const teamByContact = await Team.findOne({ contact: user.email }).lean().exec();
        const teamByManager = await Team.findOne({ managers: user._id }).lean().exec();
        const teamByNumber = user.teamNumber ? await Team.findOne({ teamNumber: user.teamNumber }).lean().exec() : null;
        const studentProfile = await Student.findOne({ email: user.email }).lean().exec();

        res.render('pages/account', {
            error: null,
            user,
            team: teamByContact || teamByNumber || teamByManager,
            studentProfile
        });
    } catch (err) {
        console.error('Failed to load account page:', err);
        res.render('pages/account', { error: 'Unable to load account page right now.', user: null, studentProfile: null, team: null });
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
    res.render('pages/signup', { error: null, inviteToken: req.query.inviteToken || null });
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
    res.render('pages/signup-seeker', { error: null, values, inviteToken: req.query.inviteToken || null });
});

router.get('/signup/manager', async function(req, res){
    const values = {};
    if (req.query.inviteToken) {
        const invite = await ManagerInvite.findOne({ token: req.query.inviteToken }).lean().exec();
        if (invite) {
            values.email = invite.email;
        }
    }
    res.render('pages/signup-manager', { error: null, values, inviteToken: req.query.inviteToken || null });
});

router.post('/signup', async function(req, res){
    const mode = req.body && req.body.signupMode === 'manager' ? 'manager' : 'seeker';
    try {
        if (!isDatabaseConnected()) return res.render(`pages/signup-${mode}`, { error: databaseErrorMessage(), values: req.body || {}, inviteToken: req.body.inviteToken || null });
        const { name, email, password, age, phone, profilePicture, interests, experience, role, inviteToken } = req.body;
        const normalizedEmail = normalizeEmail(email);
        if (!name || !normalizedEmail || !password) return res.render(`pages/signup-${mode}`, { error: 'All fields required', values: req.body, inviteToken: inviteToken || null });
        const existing = await User.findOne({ email: normalizedEmail }).exec();
        if (existing) return res.render(`pages/signup-${mode}`, { error: 'Email already registered', values: req.body, inviteToken: inviteToken || null });
        const user = new User({
            name: name.trim(),
            email: normalizedEmail,
            age: age ? Number(age) : undefined,
            phone,
            profilePicture,
            interests,
            experience,
            role: role ? String(role).trim() : undefined
        });
        await user.setPassword(password);
        await user.save();
        console.log(`User signup saved: ${user.email} -> ${mongoose.connection.name}.${User.collection.name}`);
        signIn(req, user);

        if (inviteToken) {
            const acceptedTeam = await acceptInviteToken(inviteToken, user);
            if (acceptedTeam) return res.redirect('/manage-team');
        }

        res.redirect('/account');
    } catch (err) {
        console.error('Signup failed:', err);
        const renderMode = req.body && req.body.signupMode === 'manager' ? 'manager' : 'seeker';
        res.render(`pages/signup-${renderMode}`, { error: err.message, values: req.body || {}, inviteToken: req.body.inviteToken || null });
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

        const teamByContact = await Team.findOne({ contact: updatedUser.email }).lean().exec();
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
        if (!isDatabaseConnected()) return res.render('pages/account-signup-info', { error: databaseErrorMessage(), success: null, values: {} });

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

        res.render('pages/account-signup-info', { error: null, success: null, values });
    } catch (err) {
        console.error('Signup info page error:', err);
        res.render('pages/account-signup-info', { error: 'Unable to load your signup info.', success: null, values: {} });
    }
});

router.post('/account/signup-info', ensureAuthenticated, async function(req, res) {
    try {
        if (!isDatabaseConnected()) return res.render('pages/account-signup-info', { error: databaseErrorMessage(), success: null, values: req.body || {} });

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
                values: req.body || {}
            });
        }

        const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: req.session.userId } }).lean().exec();
        if (existingUser) {
            return res.render('pages/account-signup-info', {
                error: 'That email is already in use by another account.',
                success: null,
                values: req.body || {}
            });
        }

        await User.findByIdAndUpdate(req.session.userId, {
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
            }
        });
    } catch (err) {
        console.error('Failed to save signup info:', err);
        res.render('pages/account-signup-info', {
            error: err.message || 'Failed to save signup info.',
            success: null,
            values: req.body || {}
        });
    }
});

router.get('/login', function(req, res){
    res.render('pages/login', { error: null, inviteToken: req.query.inviteToken || null });
});

router.post('/login', async function(req, res){
    try {
        if (!isDatabaseConnected()) return res.render('pages/login', { error: databaseErrorMessage(), inviteToken: req.body.inviteToken || null });
        const { email, password, inviteToken } = req.body;
        const remember = req.body && (req.body.remember === '1' || req.body.remember === 'on' || req.body.remember === true);
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || !password) return res.render('pages/login', { error: 'Email and password required', inviteToken: inviteToken || null });
        const user = await User.findOne({ email: normalizedEmail }).exec();
        if (!user) return res.render('pages/login', { error: 'Invalid credentials', inviteToken: inviteToken || null });
        const ok = await user.validatePassword(password);
        if (!ok) return res.render('pages/login', { error: 'Invalid credentials', inviteToken: inviteToken || null });
        signIn(req, user);
        applyRememberMe(req, remember);

        if (inviteToken) {
            const acceptedTeam = await acceptInviteToken(inviteToken, user);
            if (acceptedTeam) return res.redirect('/manage-team');
        }

        // If the user is a team contact or assigned manager, redirect to management dashboard
        const manageTeam = await Team.findOne({
            $or: [
                { contact: normalizedEmail },
                { managers: user._id }
            ]
        }).lean().exec();
        if (manageTeam) return res.redirect('/manage-team');

        // If the user is a member of a team, redirect to their team page
        if (user.teamNumber) return res.redirect('/my-team');

        // If the user is not currently registered with a team, send them to their applications page
        res.redirect('/my-applications');
    } catch (err) {
        res.render('pages/login', { error: err.message, inviteToken: req.body && req.body.inviteToken ? req.body.inviteToken : null });
    }
});

router.get('/logout', function(req, res){
    req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
