const express = require("express");
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/user');
const Team = require('../models/team');
const nodemailer = require('nodemailer');
const Student = require('../models/student');
const fs = require('fs');
const path = require('path');

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

function mapTeam(team) {
    return {
        program: team.program || 'FTC',
        teamNumber: team.teamNumber,
        name: team.name,
        contact: team.contact,
        lat: team.lat,
        lon: team.lon,
        notes: team.notes,
        recruiting: team.recruiting,
        verified: team.verified,
        location: [team.city, team.state, team.country].filter(Boolean).join(', ')
    };
}

function buildAddress(values) {
    return [values.address, values.city, values.state, values.country].filter(Boolean).join(', ');
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
        res.render("pages/teams-nearby", { teams: teams.map(mapTeam) });
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

        if (!teamNumber || !values.name || !contact || !values.address || !values.city || !values.country) {
            return res.render('pages/team-register', {
                error: 'Program, team number, team name, contact email, address, city, and country are required.',
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
                error: 'Could not find that address on the map. Check the address, city, state, and country.',
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
                address: values.address,
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
        } else if (queryError === 'update_failed') {
            errorMessage = 'Failed to update team details.';
        } else if (queryError === 'manager_invalid') {
            errorMessage = 'Selected member is not eligible to become a manager.';
        } else if (queryError === 'manager_add_failed') {
            errorMessage = 'Unable to add the new team manager. Please try again.';
        }

        // Handle success messages
        const querySuccess = req.query.success;
        let successMessage = null;
        if (querySuccess === 'mail_sent') {
            successMessage = 'Invitation sent successfully!';
        } else if (querySuccess === 'manager_added') {
            successMessage = 'Manager added successfully!';
        }

        // Find team associated with this user's email or manager access
        const team = await Team.findOne({
            $or: [
                { contact: user.email },
                { managers: user._id }
            ]
        }).lean().exec();

        let teamManagers = [];
        let managerCandidates = [];
        if (team) {
            teamManagers = team.managers && team.managers.length
                ? await User.find({ _id: { $in: team.managers } }).select('name email').lean().exec()
                : [];

            const teamMembers = await User.find({ teamNumber: team.teamNumber })
                .select('name email profilePicture')
                .lean()
                .exec();

            const managerIds = (team.managers || []).map(id => String(id));
            managerCandidates = teamMembers.filter(member => {
                return String(member.email).toLowerCase() !== String(team.contact).toLowerCase()
                    && !managerIds.includes(String(member._id));
            });
        }
        
        // Fetch potential recruits (students who signed up via join-form)
        const recruits = await Student.find({}).sort({ createdAt: -1 }).limit(50).lean().exec();

        res.render('pages/manage-team', { 
            user, 
            team, 
            teamManagers,
            managerCandidates,
            recruits,
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

// Account routes
router.get('/signup', function(req, res){
    res.render('pages/signup', { error: null });
});

// Dedicated pages for each signup mode (selection page links here)
router.get('/signup/seeker', function(req, res){
    res.render('pages/signup-seeker', { error: null, values: {} });
});

router.get('/signup/manager', function(req, res){
    res.render('pages/signup-manager', { error: null, values: {} });
});

router.post('/signup', async function(req, res){
    const mode = req.body && req.body.signupMode === 'manager' ? 'manager' : 'seeker';
    try {
        if (!isDatabaseConnected()) return res.render(`pages/signup-${mode}`, { error: databaseErrorMessage(), values: req.body || {} });
        const { name, email, password, age, phone, profilePicture, interests, experience } = req.body;
        const normalizedEmail = normalizeEmail(email);
        if (!name || !normalizedEmail || !password) return res.render(`pages/signup-${mode}`, { error: 'All fields required', values: req.body });
        const existing = await User.findOne({ email: normalizedEmail }).exec();
        if (existing) return res.render(`pages/signup-${mode}`, { error: 'Email already registered', values: req.body });
        const user = new User({
            name: name.trim(),
            email: normalizedEmail,
            age: age ? Number(age) : undefined,
            phone,
            profilePicture,
            interests,
            experience
        });
        await user.setPassword(password);
        await user.save();
        console.log(`User signup saved: ${user.email} -> ${mongoose.connection.name}.${User.collection.name}`);
        signIn(req, user);
        res.redirect('/account');
    } catch (err) {
        console.error('Signup failed:', err);
        const renderMode = req.body && req.body.signupMode === 'manager' ? 'manager' : 'seeker';
        res.render(`pages/signup-${renderMode}`, { error: err.message, values: req.body || {} });
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

router.get('/login', function(req, res){
    res.render('pages/login', { error: null });
});

router.post('/login', async function(req, res){
    try {
        if (!isDatabaseConnected()) return res.render('pages/login', { error: databaseErrorMessage() });
        const { email, password } = req.body;
        const remember = req.body && (req.body.remember === '1' || req.body.remember === 'on' || req.body.remember === true);
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || !password) return res.render('pages/login', { error: 'Email and password required' });
        const user = await User.findOne({ email: normalizedEmail }).exec();
        if (!user) return res.render('pages/login', { error: 'Invalid credentials' });
        const ok = await user.validatePassword(password);
        if (!ok) return res.render('pages/login', { error: 'Invalid credentials' });
        signIn(req, user);
        applyRememberMe(req, remember);

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

        res.redirect('/');
    } catch (err) {
        res.render('pages/login', { error: err.message });
    }
});

router.get('/logout', function(req, res){
    req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
