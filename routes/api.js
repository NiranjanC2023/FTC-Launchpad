var express = require("express");
var router = express.Router();
const mongoose = require('mongoose');
const Team = require('../models/team');
const Student = require('../models/student');
const User = require('../models/user');

function normalizeEmail(email) {
	return String(email || '').trim().toLowerCase();
}

function publicUser(user) {
	return {
		id: user._id,
		name: user.name,
		email: user.email,
		age: user.age,
		phone: user.phone,
		interests: user.interests
	};
}

function signIn(req, user) {
	req.session.userId = user._id.toString();
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

function toNumber(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function publicTeam(team) {
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
	const username = process.env.FTC_API_USERNAME;
	const token = process.env.FTC_API_TOKEN;
	const season = process.env.FTC_API_SEASON || '2025';

	if (!username || !token) {
		return {
			ok: false,
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
		return { ok: false, error: `FIRST verification failed with status ${response.status}.` };
	}

	const data = await response.json();
	const teams = Array.isArray(data.teams) ? data.teams : [];
	const official = teams.find(team => Number(team.teamNumber) === Number(teamNumber));
	if (!official) return { ok: false, error: `Team ${teamNumber} was not found in the FIRST FTC Events database for season ${season}.` };

	return { ok: true, team: official, season };
}

// List teams
router.get('/teams', async function(req, res) {
	try {
		if (!requireDatabase(res)) return;
		const filter = req.query.all === 'true' ? {} : { verified: true, recruiting: true };
		const teams = await Team.find(filter).sort({ teamNumber: 1 }).limit(300).lean().exec();
		res.json({ ok: true, teams: teams.map(publicTeam) });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// Create a team
router.post('/teams', async function(req, res) {
	try {
		if (!requireDatabase(res)) return;
		const { teamNumber, name, contact, address, city, state, country, notes, recruiting } = req.body;
		const parsedTeamNumber = toNumber(teamNumber);
		if (!parsedTeamNumber || !name || !contact || !address || !city || !country) {
			return res.status(400).json({ ok: false, error: 'teamNumber/name/contact/address/city/country required' });
		}

		const verification = await verifyFirstTeam(parsedTeamNumber);
		if (!verification.ok) return res.status(400).json({ ok: false, error: verification.error });

		const official = verification.team;
		const officialName = official.nameFull || official.nameShort || official.name || name;
		const coords = await geocodeAddress({ address, city, state, country });
		if (!coords) {
			return res.status(400).json({ ok: false, error: 'could not find that address on the map' });
		}

		const team = await Team.findOneAndUpdate(
			{ teamNumber: parsedTeamNumber },
			{
				teamNumber: parsedTeamNumber,
				name: officialName,
				contact: normalizeEmail(contact),
				address,
				city,
				state,
				country: country || 'USA',
				lat: coords.lat,
				lon: coords.lon,
				notes,
				recruiting: recruiting === true || recruiting === 'true' || recruiting === 'on',
				verified: true,
				verifiedAt: new Date(),
				verificationSource: `FIRST FTC Events API ${verification.season}`,
				updatedAt: new Date()
			},
			{ upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
		).lean().exec();
		res.json({ ok: true, team: publicTeam(team) });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// Create student signup
router.post('/signups', async function(req, res) {
	try {
		const { name, age, experience, email, phone, interests } = req.body;
		if (!name) return res.status(400).json({ ok: false, error: 'name required' });
		const student = new Student({ name, age, experience, email, phone, interests });
		await student.save();
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
		const { name, email, password, age, phone, interests } = req.body;
		const normalizedEmail = normalizeEmail(email);
		if (!name || !normalizedEmail || !password) return res.status(400).json({ ok: false, error: 'name/email/password required' });
		const existing = await User.findOne({ email: normalizedEmail }).exec();
		if (existing) return res.status(400).json({ ok: false, error: 'email already registered' });
		const user = new User({
			name: name.trim(),
			email: normalizedEmail,
			age: age ? Number(age) : undefined,
			phone,
			interests
		});
		await user.setPassword(password);
		await user.save();
		console.log(`User API signup saved: ${user.email} -> ${mongoose.connection.name}.${User.collection.name}`);
		// set session
		signIn(req, user);
		res.json({ ok: true, user: publicUser(user) });
	} catch (err) {
		console.error('API signup failed:', err);
		res.status(500).json({ ok: false, error: err.message });
	}
});

// User login (API)
router.post('/users/login', async function(req, res) {
	try {
		if (!requireDatabase(res)) return;
		const { email, password } = req.body;
		const normalizedEmail = normalizeEmail(email);
		if (!normalizedEmail || !password) return res.status(400).json({ ok: false, error: 'email/password required' });
		const user = await User.findOne({ email: normalizedEmail }).exec();
		if (!user) return res.status(400).json({ ok: false, error: 'invalid credentials' });
		const ok = await user.validatePassword(password);
		if (!ok) return res.status(400).json({ ok: false, error: 'invalid credentials' });
		signIn(req, user);
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

// Current user
router.get('/users/me', async function(req, res) {
	try {
		if (!req.session.userId) return res.json({ ok: true, user: null });
		if (!requireDatabase(res)) return;
		const user = await User.findById(req.session.userId).select('name email age phone interests createdAt').exec();
		res.json({ ok: true, user: user ? publicUser(user) : null });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

module.exports = router;

