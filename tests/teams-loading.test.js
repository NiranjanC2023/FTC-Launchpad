const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('assets/js/main.js', 'utf8');
const initializer = source.slice(source.indexOf('function initTeamsPage()'), source.indexOf('function initCountryRegionSelects()'));
const elements = {
  teamsContainer: {},
  teamsStatus: { textContent: 'Looking for teams...' },
  zipLocationMessage: { textContent: '', classList: { toggle() {} } },
  zipLocationForm: { addEventListener() {} },
  zipLocationInput: { value: '' }
};
let rendered;
let locationRequested = false;
const context = vm.createContext({
  document: { getElementById: id => elements[id] || null },
  window: { __TEAMS__: [{ name: 'Test team', lat: 1, lon: 2 }], location: { search: '' } },
  navigator: { geolocation: { getCurrentPosition() { locationRequested = true; } } },
  URLSearchParams,
  renderTeams(teams) { rendered = teams; }
});
vm.runInContext(initializer + '\ninitTeamsPage();', context);
assert.equal(locationRequested, true);
assert.equal(rendered.length, 1, 'Render cards even when the location prompt never resolves');
assert.equal(rendered[0].name, 'Test team');
assert.notEqual(elements.teamsStatus.textContent, 'Looking for teams...');
console.log('Team loading regression test passed.');
