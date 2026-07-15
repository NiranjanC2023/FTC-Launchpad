var express = require("express");
var router = express.Router();
const mongoose = require('mongoose');
const Team = require('../models/team');
const Student = require('../models/student');
const User = require('../models/user');
const { createNotification, listNotifications, countUnreadNotifications, markNotificationsRead, clearNotifications, serializeNotification, normalizeEmail } = require('../lib/notifications');
const { DEFAULT_FROM, buildTransactionalEmailTemplate, sendTransactionalEmail } = require('../lib/email');
const { isRecruitingTeam } = require('../lib/team-status');

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

function parseCoordinate(value) {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

// Approximate a user's location from a US ZIP code.
router.get('/geocode-zip', async function(req, res) {
	try {
		const zip = String(req.query.zip || '').trim();
		if (!/^\d{5}$/.test(zip)) {
			return res.status(400).json({ ok: false, error: 'Enter a valid 5-digit ZIP code.' });
		}

		const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&postalcode=${encodeURIComponent(zip)}`;
		const response = await fetch(url, {
			headers: {
				'User-Agent': 'FTC-Starter-Hub/1.0',
				Accept: 'application/json'
			}
		});

		if (!response.ok) {
			return res.status(502).json({ ok: false, error: 'Unable to look up that ZIP code right now.' });
		}

		const results = await response.json();
		const first = Array.isArray(results) ? results[0] : null;
		const lat = first ? parseCoordinate(first.lat) : null;
		const lon = first ? parseCoordinate(first.lon) : null;

		if (lat === null || lon === null) {
			return res.status(404).json({ ok: false, error: 'Could not find that ZIP code.' });
		}

		res.json({ ok: true, coords: { lat, lon } });
	} catch (err) {
		res.status(500).json({ ok: false, error: 'Unable to look up that ZIP code right now.' });
	}
});

// Approximate a user's location from a free-form location query.
router.get('/geocode-location', async function(req, res) {
	try {
		const query = String(req.query.q || '').trim();
		if (!query) {
			return res.status(400).json({ ok: false, error: 'Enter a city, county, state, or ZIP code.' });
		}

		const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
		const response = await fetch(url, {
			headers: {
				'User-Agent': 'FTC-Starter-Hub/1.0',
				Accept: 'application/json'
			}
		});

		if (!response.ok) {
			return res.status(502).json({ ok: false, error: 'Unable to look up that location right now.' });
		}

		const results = await response.json();
		const first = Array.isArray(results) ? results[0] : null;
		const lat = first ? parseCoordinate(first.lat) : null;
		const lon = first ? parseCoordinate(first.lon) : null;

		if (lat === null || lon === null) {
			return res.status(404).json({ ok: false, error: 'Could not find that location.' });
		}

		res.json({
			ok: true,
			coords: { lat, lon },
			displayName: first.display_name || query
		});
	} catch (err) {
		res.status(500).json({ ok: false, error: 'Unable to look up that location right now.' });
	}
});

// List teams
router.get('/teams', async function(req, res) {
	try {
		const teams = await Team.find({}).sort({ createdAt: -1 }).limit(200).lean().exec();
		res.json({
			ok: true,
			teams: Array.isArray(teams)
				? teams.map((team) => ({
					...team,
					recruiting: isRecruitingTeam(team)
				}))
				: []
		});
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
		const team = shouldApplyToTeam ? await Team.findById(normalizedTeamId).select('_id name teamNumber contact recruiting').lean().exec() : null;
		if (normalizedTeamId && !team) return res.status(400).json({ ok: false, error: 'valid team required' });
		if (team && !isRecruitingTeam(team)) {
			return res.status(403).json({ ok: false, error: 'This team is not currently recruiting and cannot receive applications.' });
		}

		const now = new Date();
		let student = await Student.findOne({ email: normalizedEmail }).exec();

		if (student) {
			const sentTeams = Array.isArray(student.sentTeams) ? student.sentTeams.map(teamId => String(teamId)) : [];
			const alreadySentToTeam = Boolean(team && sentTeams.includes(String(team._id)));
			if (alreadySentToTeam) {
				return res.status(403).json({ ok: false, error: 'You have already sent your information to this team.' });
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
				student.sentTeams = Array.from(new Set([...(Array.isArray(student.sentTeams) ? student.sentTeams.map(id => String(id)) : []), String(team._id)]));
				student.sentApplications = Array.isArray(student.sentApplications) ? student.sentApplications : [];
				const historyIndex = student.sentApplications.findIndex(entry => String(entry.team) === String(team._id));
				if (historyIndex === -1) {
					student.sentApplications.push({ team: team._id, status: 'pending', updatedAt: now });
				} else {
					student.sentApplications[historyIndex].status = 'pending';
					student.sentApplications[historyIndex].message = undefined;
					student.sentApplications[historyIndex].updatedAt = now;
				}
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
			if (team && team.contact) {
				const teamEmail = String(team.contact || '').trim();
				if (teamEmail) {
					const html = buildTransactionalEmailTemplate({
						preheader: `${name} sent team info through FIRST Start.`,
						title: 'New student info received',
						intro: `${name} sent their information to ${team.name}. Here is the ready-to-review profile submitted through FIRST Start.`,
						details: [
							{ label: 'Student', value: name },
							{ label: 'Email', value: normalizedEmail },
							{ label: 'Phone', value: phone || 'Not provided' },
							{ label: 'Age', value: age || 'Not provided' },
							{ label: 'Experience', value: experience || 'Not provided' },
							{ label: 'Interests', value: interests || 'Not provided' }
						],
						outro: 'You can reply directly to this email to continue the conversation.',
						footer: `This message was sent automatically from FIRST Start for ${team.name}.`
					});

					await sendTransactionalEmail({
						from: DEFAULT_FROM,
						to: teamEmail,
						subject: `New student info for ${team.name}`,
						html,
						text: [
							'New student info received',
							'',
							`${name} sent their information to ${team.name}.`,
							'',
							`Student: ${name}`,
							`Email: ${normalizedEmail}`,
							`Phone: ${phone || 'Not provided'}`,
							`Age: ${age || 'Not provided'}`,
							`Experience: ${experience || 'Not provided'}`,
							`Interests: ${interests || 'Not provided'}`,
							'',
							'This message was sent automatically from FIRST Start.'
						].join('\n')
					});
				}
			}
			return res.json({ ok: true, student });
		}

		student = new Student({
			name,
			age,
			experience,
			email: normalizedEmail,
			phone,
			interests,
			sentTeams: team ? [team._id] : [],
			sentApplications: team ? [{ team: team._id, status: 'pending', updatedAt: now }] : [],
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
		if (team && team.contact) {
			const teamEmail = String(team.contact || '').trim();
			if (teamEmail) {
				const html = buildTransactionalEmailTemplate({
					preheader: `${name} sent team info through FIRST Start.`,
					title: 'New student info received',
					intro: `${name} sent their information to ${team.name}. Here is the ready-to-review profile submitted through FIRST Start.`,
					details: [
						{ label: 'Student', value: name },
						{ label: 'Email', value: normalizedEmail },
						{ label: 'Phone', value: phone || 'Not provided' },
						{ label: 'Age', value: age || 'Not provided' },
						{ label: 'Experience', value: experience || 'Not provided' },
						{ label: 'Interests', value: interests || 'Not provided' }
					],
					outro: 'You can reply directly to this email to continue the conversation.',
					footer: `This message was sent automatically from FIRST Start for ${team.name}.`
				});

				await sendTransactionalEmail({
					from: DEFAULT_FROM,
					to: teamEmail,
					subject: `New student info for ${team.name}`,
					html,
					text: [
						'New student info received',
						'',
						`${name} sent their information to ${team.name}.`,
						'',
						`Student: ${name}`,
						`Email: ${normalizedEmail}`,
						`Phone: ${phone || 'Not provided'}`,
						`Age: ${age || 'Not provided'}`,
						`Experience: ${experience || 'Not provided'}`,
						`Interests: ${interests || 'Not provided'}`,
						'',
						'This message was sent automatically from FIRST Start.'
					].join('\n')
				});
			}
		}
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

router.post('/notifications/clear', async function(req, res) {
	try {
		if (!requireDatabase(res)) return;
		if (!req.session.userId) return res.status(401).json({ ok: false, error: 'not authenticated' });

		const user = await User.findById(req.session.userId).select('email').lean().exec();
		if (!user) return res.status(401).json({ ok: false, error: 'not authenticated' });

		const deletedCount = await clearNotifications(user.email);
		res.json({ ok: true, deletedCount });
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
