// One-time, explicitly scoped cleanup. Original application fields are backed up in MongoDB.
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const params = require('../params/params');
const ids = ['6a946b6db24bbb14aabc3318', '6a98d8a88dc3f1a7d19c1166'];
const fields = ['sentTeams', 'sentApplications', 'applicationTeam', 'applicationStatus', 'statusMessage', 'statusUpdatedAt', 'statusBy', 'requestCount', 'lastRequestAt'];

async function main() {
    await mongoose.connect(params.DATABASECONNECTION, { dbName: params.DATABASENAME, serverSelectionTimeoutMS: 10000 });
    const students = mongoose.connection.collection('students');
    const backups = mongoose.connection.collection('applicationResetBackups');
    let cleared = 0;
    for (const id of ids) {
        const doc = await students.findOne({ _id: new mongoose.Types.ObjectId(id) });
        if (!doc || !['pending', 'rejected'].includes(doc.applicationStatus)) continue;
        if ((doc.sentApplications || []).some(a => !['pending', 'rejected'].includes(a.status))) {
            throw new Error('Application state changed; cleanup stopped.');
        }
        const original = Object.fromEntries(fields.filter(key => Object.hasOwn(doc, key)).map(key => [key, doc[key]]));
        const snapshot = Object.fromEntries(fields.map(key => [key, Object.hasOwn(doc, key) ? { $eq: doc[key] } : { $exists: false }]));
        await backups.insertOne({ studentId: doc._id, createdAt: new Date(), reason: 'User-requested pending/rejected reset', original });
        const result = await students.updateOne({ _id: doc._id, ...snapshot }, {
            $set: { sentTeams: [], sentApplications: [], applicationStatus: null, requestCount: 0 },
            $unset: { applicationTeam: '', statusMessage: '', statusUpdatedAt: '', statusBy: '', lastRequestAt: '' }
        });
        if (result.modifiedCount !== 1) throw new Error('Application changed during cleanup; record was not cleared.');
        cleared++;
    }
    const remaining = await students.countDocuments({ $or: [
        { applicationStatus: { $in: ['pending', 'rejected'] } },
        { 'sentApplications.status': { $in: ['pending', 'rejected'] } }
    ] });
    console.log(JSON.stringify({ clearedProfiles: cleared, remainingPendingOrRejected: remaining, backupCollection: 'applicationResetBackups' }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
