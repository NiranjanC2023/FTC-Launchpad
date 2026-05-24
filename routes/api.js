var express = require("express");
var router = express.Router();
const Team = require('../models/team');
const Student = require('../models/student');
const User = require('../models/user');

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
		const { name, email, password } = req.body;
		if (!name || !email || !password) return res.status(400).json({ ok: false, error: 'name/email/password required' });
		const existing = await User.findOne({ email: email.toLowerCase() }).exec();
		if (existing) return res.status(400).json({ ok: false, error: 'email already registered' });
		const user = new User({ name, email: email.toLowerCase() });
		await user.setPassword(password);
		await user.save();
		// set session
		req.session.userId = user._id;
		res.json({ ok: true, user: { id: user._id, name: user.name, email: user.email } });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

// User login (API)
router.post('/users/login', async function(req, res) {
	try {
		const { email, password } = req.body;
		if (!email || !password) return res.status(400).json({ ok: false, error: 'email/password required' });
		const user = await User.findOne({ email: email.toLowerCase() }).exec();
		if (!user) return res.status(400).json({ ok: false, error: 'invalid credentials' });
		const ok = await user.validatePassword(password);
		if (!ok) return res.status(400).json({ ok: false, error: 'invalid credentials' });
		req.session.userId = user._id;
		res.json({ ok: true, user: { id: user._id, name: user.name, email: user.email } });
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
		const user = await User.findById(req.session.userId).select('name email createdAt').exec();
		res.json({ ok: true, user });
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message });
	}
});

module.exports = router;

