require('dotenv').config();

const mongoose = require('mongoose');
const params = require('../params/params');

function locationLabel(team) {
  return [team.city, team.state, team.country]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function hasStreetAddress(team) {
  const address = String(team.address || '').trim().toLowerCase();
  return Boolean(address) && address !== locationLabel(team).toLowerCase();
}

async function geocodeExactAddress(team) {
  const address = [team.address, team.city, team.state, team.country]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, {
    headers: { 'User-Agent': 'FTC-Starter-Hub/1.0', Accept: 'application/json' }
  });
  if (!response.ok) return null;
  const [result] = await response.json();
  const lat = Number(result && result.lat);
  const lon = Number(result && result.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

async function run() {
  await mongoose.connect(params.DATABASECONNECTION, {
    dbName: params.DATABASENAME,
    serverSelectionTimeoutMS: 10000
  });

  const teams = mongoose.connection.db.collection('teams');
  const records = await teams.find({}, { projection: { address: 1, city: 1, state: 1, country: 1 } }).toArray();
  let updated = 0;
  let needsAddress = 0;

  for (const team of records) {
    if (!hasStreetAddress(team)) {
      needsAddress += 1;
      continue;
    }
    const coords = await geocodeExactAddress(team);
    if (coords) {
      await teams.updateOne({ _id: team._id }, { $set: coords });
      updated += 1;
    }
    await new Promise(resolve => setTimeout(resolve, 1100));
  }

  console.log(JSON.stringify({ scanned: records.length, updated, needsAddress }));
}

run()
  .catch(error => {
    console.error(`Precise team-coordinate refresh failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
