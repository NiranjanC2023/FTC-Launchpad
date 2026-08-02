const assert = require('assert');
const webRoutes = require('../routes/web');

async function run() {
  const helpers = webRoutes.__test;
  assert.strictEqual(helpers.parsePositiveTeamNumber('25690'), 25690);
  assert.strictEqual(helpers.parsePositiveTeamNumber(''), null);
  assert.strictEqual(helpers.parsePositiveTeamNumber('0'), null);
  assert.strictEqual(helpers.parsePositiveTeamNumber('12.5'), null);
  assert.strictEqual(helpers.normalizeRegion('CA'), helpers.normalizeRegion('California'));
  assert.strictEqual(helpers.normalizeCountry('USA'), helpers.normalizeCountry('United States of America'));
  assert.strictEqual(helpers.normalizeTeamName('The Cheesy Poofs'), helpers.normalizeTeamName('Cheesy Poofs'));
  assert.strictEqual(
    helpers.buildTeamRegistrationAddress({}, 'San Jose', 'CA', 'USA'),
    'San Jose, CA, USA'
  );
  assert.strictEqual(
    helpers.buildTeamRegistrationAddress({ address: 'Community Center' }, 'San Jose', 'CA', 'USA'),
    'Community Center'
  );
  assert.strictEqual(
    helpers.locationMatchesOfficialRecord(
      { city: 'San Jose', state: 'CA', country: 'USA' },
      { city: 'San Jose', state: 'CA', country: 'USA' }
    ),
    true
  );
  assert.strictEqual(
    helpers.locationMatchesOfficialRecord(
      { city: 'Oakland', state: 'CA', country: 'USA' },
      { city: 'San Jose', state: 'CA', country: 'USA' }
    ),
    false
  );

  const invalid = await helpers.verifyTeamWithApi('', 'FTC', 'Example');
  assert.strictEqual(invalid.ok, false);
  assert.match(invalid.error, /valid team number/i);

  const unsupported = await helpers.verifyTeamWithApi('123', 'FLL Challenge', 'Example');
  assert.strictEqual(unsupported.ok, false);
  assert.match(unsupported.error, /not available/i);

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.strictEqual(url, 'https://api.ftcscout.org/graphql');
    return {
      ok: true,
      json: async () => ({
        data: {
          teamByNumber: {
            number: 98765,
            name: 'Official Team Name',
            schoolName: 'Community',
            rookieYear: 2025,
            location: { city: 'San Jose', state: 'CA', country: 'USA', venue: '' },
            awards: [],
            matches: [],
            activeSeasons: [2025]
          }
        }
      })
    };
  };

  try {
    const verified = await helpers.verifyTeamWithApi('98765', 'FTC', 'A user-entered alias');
    assert.strictEqual(verified.ok, true);
    assert.strictEqual(verified.officialName, 'Official Team Name');
    assert.strictEqual(verified.nameMatched, false);
    assert.deepStrictEqual(helpers.extractTeamLocation(verified.details), {
      city: 'San Jose',
      state: 'CA',
      country: 'USA'
    });
    const matchingDetails = helpers.verifySubmittedTeamDetails(verified, {
      name: 'The Official Team Name',
      city: 'San José',
      state: 'California',
      country: 'United States of America'
    });
    assert.strictEqual(matchingDetails.ok, true);

    const mismatchedDetails = helpers.verifySubmittedTeamDetails(verified, {
      name: 'Official Team Name',
      city: 'Los Angeles',
      state: 'CA',
      country: 'USA'
    });
    assert.strictEqual(mismatchedDetails.ok, false);
    assert.deepStrictEqual(mismatchedDetails.mismatches, ['city']);
  } finally {
    global.fetch = originalFetch;
  }

  console.log('team verification checks passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
