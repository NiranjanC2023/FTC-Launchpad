const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mainScript = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'main.js'), 'utf8');
const mapLoopStart = mainScript.indexOf('teams.forEach(team => {', mainScript.indexOf('function tryInitMap()'));
const mapLoopEnd = mainScript.indexOf('bounds.extend(marker.getBounds());', mapLoopStart);

assert.ok(mapLoopStart >= 0 && mapLoopEnd > mapLoopStart, 'expected the Leaflet team marker loop');

const mapLoop = mainScript.slice(mapLoopStart, mapLoopEnd);
assert.match(
  mapLoop,
  /const teamContact = String\(team\.contact \|\| ''\)\.trim\(\);/,
  'the marker popup must define teamContact inside the map loop'
);
assert.match(mapLoop, /teamContact \? `<p style=/, 'the marker popup should render the scoped contact value');

console.log('teams map checks passed');
