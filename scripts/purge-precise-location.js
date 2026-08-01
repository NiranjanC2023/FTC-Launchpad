require('dotenv').config();

const mongoose = require('mongoose');
const params = require('../params/params');

function localityAddress(team) {
  return [team.city, team.state, team.country]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function coarseCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

async function run() {
  await mongoose.connect(params.DATABASECONNECTION, {
    dbName: params.DATABASENAME,
    serverSelectionTimeoutMS: 10000
  });

  const database = mongoose.connection.db;
  const students = database.collection('students');
  const teams = database.collection('teams');

  const applicantCleanup = await students.updateMany({}, {
    $unset: {
      lat: '',
      lon: '',
      latitude: '',
      longitude: '',
      coordinates: '',
      coords: '',
      geolocation: '',
      preciseLocation: '',
      locationCookie: ''
    }
  });

  const teamDocs = await teams.find({}, {
    projection: { _id: 1, address: 1, city: 1, state: 1, country: 1, lat: 1, lon: 1 }
  }).toArray();
  const operations = teamDocs.map(team => {
    const set = { address: localityAddress(team) || 'Location withheld' };
    const lat = coarseCoordinate(team.lat);
    const lon = coarseCoordinate(team.lon);
    if (lat !== null) set.lat = lat;
    if (lon !== null) set.lon = lon;
    return { updateOne: { filter: { _id: team._id }, update: { $set: set } } };
  });
  const teamCleanup = operations.length ? await teams.bulkWrite(operations) : null;

  console.log(JSON.stringify({
    applicantRecordsScanned: applicantCleanup.matchedCount,
    applicantRecordsChanged: applicantCleanup.modifiedCount,
    teamRecordsScanned: teamDocs.length,
    teamRecordsChanged: teamCleanup ? teamCleanup.modifiedCount : 0
  }));
}

run()
  .catch(error => {
    console.error(`Location cleanup failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
