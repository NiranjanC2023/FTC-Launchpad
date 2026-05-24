var express = require("express");
var router = express.Router();
const Team = require('../models/team');
const Student = require('../models/student');

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

module.exports = router;
