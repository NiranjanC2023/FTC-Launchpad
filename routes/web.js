const express = require("express");
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/user');
const Team = require('../models/team');
const nodemailer = require('nodemailer');
const Student = require('../models/student');
const params = require('../params/params');

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

async function verifyFirstTeam(teamNumber) {
    const username = params.FTC_API_USERNAME;
    const token = params.FTC_API_TOKEN;
    const season = process.env.FTC_API_SEASON || '2025';

    if (!username || !token) {
        return {
            ok: false,
            configured: false,
            error: 'FIRST verification is not configured. Add FTC_API_USERNAME and FTC_API_TOKEN to .env.'
        };
    }

    const url = `https://ftc-api.firstinspires.org/v2.0/${season}/teams?teamNumber=${encodeURIComponent(teamNumber)}`;
    const auth = Buffer.from(`${username}:${token}`).toString('base64');
    const response = await fetch(url, {
        headers: {
            Authorization: `Basic ${auth}`,
            Accept: 'application/json'
        }
    });

    if (!response.ok) {
        return {
            ok: false,
            configured: true,
            error: `FIRST verification failed with status ${response.status}. Check your API credentials and season.`
        };
    }

    const data = await response.json();
    const teams = Array.isArray(data.teams) ? data.teams : [];
    const official = teams.find(team => Number(team.teamNumber) === Number(teamNumber));

    if (!official) {
        return {
            ok: false,
            configured: true,
            error: `Team ${teamNumber} was not found in the FIRST FTC Events database for season ${season}.`
        };
    }

    return { ok: true, configured: true, team: official, season };
}

// Home page
router.get("/", function(req, res){
    res.render("index");
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

router.get("/join-form", function(req, res){
    res.render("pages/join-form");
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
        const contact = normalizeEmail(values.contact);

        if (!teamNumber || !values.name || !contact || !values.address || !values.city || !values.country) {
            return res.render('pages/team-register', {
                error: 'Team number, team name, contact email, address, city, and country are required.',
                message: null,
                values
            });
        }

        const verification = await verifyFirstTeam(teamNumber);
        if (!verification.ok) {
            return res.render('pages/team-register', { error: verification.error, message: null, values });
        }

        const official = verification.team;
        const officialName = official.nameShort || official.nameFull || values.name;
        const recruiting = values.recruiting === 'on';
        const coords = await geocodeAddress(values);

        if (!coords) {
            return res.render('pages/team-register', {
                error: 'Could not find that address on the map. Check the address, city, state, and country.',
                message: null,
                values
            });
        }

        await Team.findOneAndUpdate(
            { teamNumber },
            {
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
                verificationSource: `FIRST FTC Events API ${verification.season}`,
                updatedAt: new Date()
            },
            { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        ).exec();

        res.render('pages/team-register', {
            error: null,
            message: `Team ${teamNumber} verified and saved. Recruiting is ${recruiting ? 'on' : 'off'}.`,
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
        }

        // Handle success messages
        const querySuccess = req.query.success;
        let successMessage = null;
        if (querySuccess === 'mail_sent') {
            successMessage = 'Invitation sent successfully!';
        }

        // Find team associated with this user's email
        const team = await Team.findOne({ contact: user.email }).lean().exec();
        
        // Fetch potential recruits (students who signed up via join-form)
        const recruits = await Student.find({}).sort({ createdAt: -1 }).limit(50).lean().exec();

        res.render('pages/manage-team', { 
            user, 
            team, 
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
        
        // Ensure the user actually owns this team by checking the contact email
        const team = await Team.findOneAndUpdate(
            { contact: user.email },
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
        const team = await Team.findOne({ contact: user.email }).lean().exec();
        
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
        const team = await Team.findOne({ contact: user.email }).lean().exec();

        if (!recruit || !team) return res.redirect('/manage-team');

        const formattedDate = meetingDate ? new Date(meetingDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Not specified';
        const time = meetingTime || 'Not specified';
        const location = meetingLocation || 'To be determined';

        const mailOptions = {
            from: `"${team.name}" <${process.env.EMAIL_USER}>`,
            replyTo: team.contact,
            to: recruit.email,
            subject: `Invitation from FTC Team ${team.teamNumber}: ${team.name}`,
            html: `
                <div style="font-family: sans-serif; padding: 20px; color: #333;">
                    <h2>Hello ${recruit.name}!</h2>
                    <p>FTC Team <strong>${team.teamNumber} - ${team.name}</strong> has seen your profile on the FTC Starter Hub and would like to connect!</p>
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
        const { name, email, password, age, phone, interests } = req.body;
        const normalizedEmail = normalizeEmail(email);
        if (!name || !normalizedEmail || !password) return res.render(`pages/signup-${mode}`, { error: 'All fields required', values: req.body });
        const existing = await User.findOne({ email: normalizedEmail }).exec();
        if (existing) return res.render(`pages/signup-${mode}`, { error: 'Email already registered', values: req.body });
        const user = new User({
            name: name.trim(),
            email: normalizedEmail,
            age: age ? Number(age) : undefined,
            phone,
            interests
        });
        await user.setPassword(password);
        await user.save();
        console.log(`User signup saved: ${user.email} -> ${mongoose.connection.name}.${User.collection.name}`);
        signIn(req, user);
        res.redirect('/');
    } catch (err) {
        console.error('Signup failed:', err);
        const renderMode = req.body && req.body.signupMode === 'manager' ? 'manager' : 'seeker';
        res.render(`pages/signup-${renderMode}`, { error: err.message, values: req.body || {} });
    }
});

router.get('/login', function(req, res){
    res.render('pages/login', { error: null });
});

router.post('/login', async function(req, res){
    try {
        if (!isDatabaseConnected()) return res.render('pages/login', { error: databaseErrorMessage() });
        const { email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || !password) return res.render('pages/login', { error: 'Email and password required' });
        const user = await User.findOne({ email: normalizedEmail }).exec();
        if (!user) return res.render('pages/login', { error: 'Invalid credentials' });
        const ok = await user.validatePassword(password);
        if (!ok) return res.render('pages/login', { error: 'Invalid credentials' });
        signIn(req, user);

        // If the user is a team contact, redirect to management dashboard
        const team = await Team.findOne({ contact: normalizedEmail }).lean().exec();
        if (team) return res.redirect('/manage-team');

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
