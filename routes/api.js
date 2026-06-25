var express = require("express");
var router = express.Router();
const mongoose = require('mongoose');
const Team = require('../models/team');
const Student = require('../models/student');
const User = require('../models/user');
const { createNotification, listNotifications, countUnreadNotifications, markNotificationsRead, serializeNotification, normalizeEmail } = require('../lib/notifications');

function publicUser(user) {
	return {
		id: user._id,
		name: user.name,
		email: user.email,
		age: user.age,
		phone: user.phone,
		profilePicture: user.profilePicture,
		interests: user.interests,
		experience: user.experience,
		teamNumber: user.teamNumber
	};
}

function signIn(req, user) {
	req.session.userId = user._id.toString();
}

function applyRememberMe(req, remember) {
	if (!req.session) return;
	req.session.cookie.maxAge = remember ? 1000 * 60 * 60 * 24 * 30 : null;
}

function isDatabaseConnected() {
	return mongoose.connection.readyState === 1;
}

function requireDatabase(res) {
	if (isDatabaseConnected()) return true;
	res.status(503).json({
		ok: false,
		error: 'database is not connected; start MongoDB or set MONGODB_URI'
	});
	return false;
}

// List teams
router.get('/teams', async function(req, res) {
	try {
		const teams = await Team.find({}).sort({ createdAt: -1 }).limit(200).exec();
		res.json({ ok: true, teams });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// Create a team
router.post('/teams', async function(req, res) {
	try {
		const { name, contact, lat, lon, notes } = req.body;
		if (!name || !lat || !lon) return res.status(400).json({ ok: false, error: 'name/lat/lon required' });
		const team = new Team({ name, contact, lat: parseFloat(lat), lon: parseFloat(lon), notes });
		await team.save();
		res.json({ ok: true, team });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// Create or update student signup
router.post('/signups', async function(req, res) {
	try {
		const { name, age, experience, email, phone, interests, teamId } = req.body;
		if (!name) return res.status(400).json({ ok: false, error: 'name required' });
		const normalizedEmail = normalizeEmail(email);
		if (!normalizedEmail) return res.status(400).json({ ok: false, error: 'valid email required' });
		const normalizedTeamId = String(teamId || '').trim();
		const shouldApplyToTeam = Boolean(normalizedTeamId && mongoose.Types.ObjectId.isValid(normalizedTeamId));
		const team = shouldApplyToTeam ? await Team.findById(normalizedTeamId).select('_id name teamNumber contact').lean().exec() : null;
		if (normalizedTeamId && !team) return res.status(400).json({ ok: false, error: 'valid team required' });

		const now = new Date();
		let student = await Student.findOne({ email: normalizedEmail }).exec();

		if (student) {
			if (student.applicationStatus === 'accepted' || student.applicationStatus === 'waitlisted') {
				return res.status(403).json({ ok: false, error: 'You cannot submit another request while your application is accepted or waitlisted.' });
			}

			const minWaitMs = 1000 * 60 * 60 * 8; // 8 hours between submissions
			if (student.lastRequestAt && now - student.lastRequestAt < minWaitMs) {
				const remainingMinutes = Math.ceil((minWaitMs - (now - student.lastRequestAt)) / 60000);
				return res.status(429).json({ ok: false, error: `Please wait ${remainingMinutes} more minute(s) before submitting again.` });
			}

			const isRejected = student.applicationStatus === 'rejected';
			student.name = name;
			student.age = age;
			student.experience = experience;
			student.phone = phone;
			student.interests = interests;
			student.email = normalizedEmail;
			if (isRejected) {
				student.applicationStatus = undefined;
				student.applicationTeam = undefined;
				student.statusMessage = undefined;
				student.statusUpdatedAt = undefined;
				student.statusBy = undefined;
			}
			if (team) {
				student.applicationTeam = team._id;
				student.applicationStatus = 'pending';
				student.statusMessage = undefined;
				student.statusUpdatedAt = undefined;
				student.statusBy = undefined;
			}
			student.requestCount = (student.requestCount || 0) + 1;
			student.lastRequestAt = now;
			await student.save();
			await createNotification({
				recipientEmail: normalizedEmail,
				type: 'application',
				title: team ? `Application sent to ${team.name}` : 'Application updated',
				body: team
					? `Your application to ${team.name} is pending review and is visible in My Applications.`
					: 'Your join-team profile was updated and is visible in your inbox.',
				link: '/my-applications',
				metadata: { source: 'join-form' }
			});
			return res.json({ ok: true, student });
		}

		student = new Student({
			name,
			age,
			experience,
			email: normalizedEmail,
			phone,
			interests,
			requestCount: 1,
			lastRequestAt: now,
			applicationTeam: team ? team._id : undefined,
			applicationStatus: team ? 'pending' : undefined
		});
		await student.save();
		await createNotification({
			recipientEmail: normalizedEmail,
			type: 'application',
			title: team ? `Application sent to ${team.name}` : 'Application submitted',
			body: team
				? `Your application to ${team.name} is pending review and is visible in My Applications.`
				: 'Your join-team profile was saved and is ready for teams to review.',
			link: '/my-applications',
			metadata: { source: 'join-form' }
		});
		res.json({ ok: true, student });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// List recent signups
router.get('/signups', async function(req, res) {
	try {
		const students = await Student.find({}).sort({ createdAt: -1 }).limit(200).exec();
		res.json({ ok: true, students });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// User signup (API)
router.post('/users/signup', async function(req, res) {
	try {
		if (!requireDatabase(res)) return;
		const { name, email, password, age, phone, profilePicture, interests, experience } = req.body;
		const normalizedEmail = normalizeEmail(email);
		if (!name || !normalizedEmail || !password) return res.status(400).json({ ok: false, error: 'name/email/password required' });
		const existing = await User.findOne({ email: normalizedEmail }).exec();
		if (existing) return res.status(400).json({ ok: false, error: 'email already registered' });
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
		// set session
		signIn(req, user);
		res.json({ ok: true, user: publicUser(user) });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// User login (API)
router.post('/users/login', async function(req, res) {
	try {
		if (!requireDatabase(res)) return;
		const { email, password } = req.body;
		const remember = req.body && (req.body.remember === '1' || req.body.remember === 'on' || req.body.remember === true);
		const normalizedEmail = normalizeEmail(email);
		if (!normalizedEmail || !password) return res.status(400).json({ ok: false, error: 'email/password required' });
		const user = await User.findOne({ email: normalizedEmail }).exec();
		if (!user) return res.status(400).json({ ok: false, error: 'invalid credentials' });
		const ok = await user.validatePassword(password);
		if (!ok) return res.status(400).json({ ok: false, error: 'invalid credentials' });
		signIn(req, user);
		applyRememberMe(req, remember);
		res.json({ ok: true, user: publicUser(user) });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// Logout (API)
router.post('/users/logout', function(req, res) {
	req.session.destroy(err => {
		if (err) return res.status(500).json({ ok: false, error: 'failed to logout' });
		res.json({ ok: true });
	});
});

router.post('/notifications/read', async function(req, res) {
	try {
		if (!requireDatabase(res)) return;
		if (!req.session.userId) return res.status(401).json({ ok: false, error: 'not authenticated' });

		const user = await User.findById(req.session.userId).select('email').lean().exec();
		if (!user) return res.status(401).json({ ok: false, error: 'not authenticated' });

		await markNotificationsRead(user.email);
		res.json({ ok: true });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// Current user
router.get('/users/me', async function(req, res) {
	try {
		if (!req.session.userId) return res.json({ ok: true, user: null });
		if (!requireDatabase(res)) return;
		const user = await User.findById(req.session.userId).select('name email age phone profilePicture interests experience teamNumber createdAt').exec();
		if (!user) return res.json({ ok: true, user: null });

		const normalizedEmail = normalizeEmail(user.email);
		const team = await Team.findOne({
			$or: [
				{ contact: normalizedEmail },
				{ managers: user._id }
			]
		}).select('_id').lean().exec();
		const notifications = await listNotifications(normalizedEmail, 50);
		const unreadCount = await countUnreadNotifications(normalizedEmail);
		res.json({
			ok: true,
			user: { ...publicUser(user), hasTeam: !!team },
			notifications: notifications.map(serializeNotification),
			unreadCount
		});
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

module.exports = router;
