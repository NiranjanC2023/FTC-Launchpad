const fs = require('fs/promises');
const path = require('path');

const FTC_SCOUT_API_BASE = 'https://api.ftcscout.org/rest/v1';
const BLUE_ALLIANCE_API_BASE = 'https://www.thebluealliance.com/api/v3';
const TBA_AUTH_KEY = process.env.TBA_AUTH_KEY || process.env.BLUE_ALLIANCE_API_KEY || process.env.BLUE_ALLIANCE_AUTH_KEY || '';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'official-teams-map.json');

let cacheState = null;
let cachePromise = null;

function normalizeProgram(program) {
  const value = String(program || '').trim().toUpperCase();
  if (value === 'FRC') return 'FRC';
  return 'FTC';
}

function normalizePart(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function splitNameVariants(value) {
  const text = normalizePart(value);
  if (!text) return [];

  const variants = [text];
  const strippedPrefix = text
    .replace(/^(?:FRC|FTC)\s+Team\s+\d+\s*[-:]\s*/i, '')
    .replace(/^Team\s+\d+\s*[-:]\s*/i, '')
    .replace(/^\s*#\s*\d+\s*[-:]\s*/i, '');
  if (strippedPrefix && strippedPrefix !== text) variants.push(strippedPrefix);

  const lastDashPart = text.split(/\s*[-–—:]\s*/).map(normalizePart).filter(Boolean).pop();
  if (lastDashPart && lastDashPart !== text) variants.push(lastDashPart);

  const slashParts = text.split(/[\/|&;]/).map(normalizePart).filter(Boolean);
  if (slashParts.length) variants.push(...slashParts);

  return Array.from(new Set(variants.filter(Boolean)));
}

function extractPrimaryTeamClause(value) {
  const text = normalizePart(value);
  if (!text) return '';

  const dashParts = text.split(/\s*[-–—:]\s*/).map(normalizePart).filter(Boolean);
  const dashSuffix = dashParts.length > 1 ? dashParts[dashParts.length - 1] : '';
  const primarySuffix = dashSuffix ? dashSuffix.split(/[\/|&;]/).map(normalizePart).filter(Boolean)[0] : '';
  if (primarySuffix) return primarySuffix;

  const slashPrefix = text.split(/[\/|&;]/).map(normalizePart).filter(Boolean)[0];
  return slashPrefix || text;
}

function scoreTeamNameCandidate(value) {
  const text = normalizePart(value);
  if (!text) return Number.NEGATIVE_INFINITY;

  let score = 0;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const punctuationCount = (text.match(/[\/|&;]/g) || []).length;

  if (text.length <= 24) score += 5;
  else if (text.length <= 40) score += 4;
  else if (text.length <= 60) score += 1;
  else score -= 4;

  if (wordCount >= 2 && wordCount <= 5) score += 4;
  else if (wordCount === 1) score += 1;
  else if (wordCount > 8) score -= 2;

  if (punctuationCount > 0) score -= punctuationCount * 3;
  if (/team\s*\d+/i.test(text)) score -= 3;
  if (/(?:\bFRC\b|\bFTC\b)/i.test(text) && text.length > 30) score -= 1;
  if (/school$/i.test(text) && !/\bteam\b/i.test(text)) score -= 1;
  if (/[A-Za-z]/.test(text)) score += 1;
  if (/^[A-Z0-9\s\-]+$/.test(text) && text.length > 24) score -= 1;

  return score;
}

function getPreferredTeamName(source) {
  if (!source || typeof source !== 'object') return '';

  const normalizedCandidates = [];
  const addCandidate = (value, priority = 0) => {
    const text = normalizePart(value);
    if (!text) return;
    normalizedCandidates.push({ value: text, priority });
  };

  const addSourceCandidates = (candidateSource, tier) => {
    addCandidate(candidateSource.nickname, tier + 30);
    addCandidate(candidateSource.team_nickname, tier + 30);
    addCandidate(candidateSource.teamName, tier + 30);
    addCandidate(candidateSource.team_name, tier + 30);

    const rawName = normalizePart(candidateSource.name);
    if (rawName) {
      const messy = rawName.length > 40 || /[\/|&;]/.test(rawName) || /\s*[-–—:]\s*/.test(rawName);
      addCandidate(messy ? extractPrimaryTeamClause(rawName) : rawName, tier + (messy ? 25 : 20));
      for (const variant of splitNameVariants(rawName)) {
        addCandidate(variant, tier + (messy ? 8 : 18));
      }
    }

    addCandidate(candidateSource.schoolName, tier + 15);
    addCandidate(candidateSource.school_name, tier + 15);
  };

  addSourceCandidates(source, 0);

  if (source.profile && typeof source.profile === 'object') {
    addSourceCandidates(source.profile, 10);
  }

  if (!normalizedCandidates.length) return '';

  let best = '';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of normalizedCandidates) {
    const score = (candidate.priority * 100) + scoreTeamNameCandidate(candidate.value);
    if (score > bestScore || (score === bestScore && candidate.value.length < best.length)) {
      best = candidate.value;
      bestScore = score;
    }
  }

  return best.trim();
}

function normalizeCachedTeamRecord(team) {
  if (!team || typeof team !== 'object') return team;
  const preferredName = getPreferredTeamName(team);
  const name = preferredName || normalizePart(team.name || '');
  return {
    ...team,
    name
  };
}

function uniqueStrings(values) {
  return Array.from(new Set(
    Array.isArray(values)
      ? values.map(value => normalizePart(value)).filter(Boolean)
      : []
  ));
}

function buildLocationQueriesFromParts(city, state, country) {
  const queries = [
    [city, state, country],
    [city, state],
    [city, country],
    [state, country],
    [city],
    [state],
    [country]
  ]
    .map(parts => parts.map(normalizePart).filter(Boolean).join(', '))
    .filter(Boolean);

  return uniqueStrings(queries);
}

function buildTeamRecord(team, program) {
  const normalizedProgram = normalizeProgram(program);
  const teamNumber = Number(team && (team.number || team.team_number || team.teamNumber));
  if (!Number.isFinite(teamNumber)) return null;

  const name = getPreferredTeamName(team);

  const city = normalizePart(team && (team.city || team.location && team.location.city));
  const state = normalizePart(team && (team.state || team.state_prov || team.location && team.location.state));
  const country = normalizePart(team && (team.country || team.location && team.location.country));
  const locationQueries = buildLocationQueriesFromParts(city, state, country);

  return {
    key: `${normalizedProgram}:${teamNumber}`,
    program: normalizedProgram,
    teamNumber,
    name,
    city,
    state,
    country,
    location: locationQueries[0] || [city, state, country].filter(Boolean).join(', '),
    locationQueries,
    contact: 'Not registered',
    recruiting: false,
    registered: false,
    verified: false,
    isNewTeam: false,
    source: normalizedProgram === 'FRC' ? 'The Blue Alliance' : 'FTC Scout'
  };
}

async function fetchFtcScoutTeams() {
  const response = await fetch(`${FTC_SCOUT_API_BASE}/teams/search?limit=50000`);
  if (!response.ok) return [];

  const payload = await response.json().catch(() => []);
  return Array.isArray(payload) ? payload : [];
}

async function fetchBlueAllianceTeams() {
  const statusResponse = await fetch(`${BLUE_ALLIANCE_API_BASE}/status`, {
    headers: {
      'X-TBA-Auth-Key': TBA_AUTH_KEY,
      Accept: 'application/json'
    }
  });
  if (!statusResponse.ok) return [];

  const status = await statusResponse.json().catch(() => ({}));
  const maxTeamPage = Number(status && status.max_team_page) || 0;
  if (!maxTeamPage) return [];

  const teams = [];
  for (let page = 1; page <= maxTeamPage; page += 1) {
    const response = await fetch(`${BLUE_ALLIANCE_API_BASE}/teams/${page}/simple`, {
      headers: {
        'X-TBA-Auth-Key': TBA_AUTH_KEY,
        Accept: 'application/json'
      }
    });

    if (!response.ok) continue;

    const rows = await response.json().catch(() => []);
    if (Array.isArray(rows)) {
      teams.push(...rows);
    }
  }

  return teams;
}

async function readCacheFile() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.teams) || !parsed.teams.length) return null;
    return {
      ...parsed,
      teams: parsed.teams.map(normalizeCachedTeamRecord).filter(Boolean)
    };
  } catch (err) {
    return null;
  }
}

async function writeCacheFile(payload) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeGeocodeResult(result) {
  if (!result || typeof result !== 'object') return null;
  const geometry = result.geometry || {};
  const location = geometry.location || {};
  const lat = Number(location.lat);
  const lon = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    formattedAddress: normalizePart(result.formatted_address || '')
  };
}

async function geocodeQuery(query) {
  if (!GOOGLE_MAPS_API_KEY) return null;

  const address = normalizePart(query);
  if (!address) return null;

  const variants = uniqueStrings([
    address,
    address.replace(/\bUSA\b/gi, 'United States'),
    address.replace(/\bU\.S\.A\.\b/gi, 'United States'),
    address.replace(/\bUS\b/gi, 'United States')
  ]);

  for (const candidate of variants) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(candidate)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&language=en`;
        const response = await fetch(url);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload) {
          await sleep(150 * (attempt + 1));
          continue;
        }

        if (payload.status === 'OK' && Array.isArray(payload.results) && payload.results.length) {
          return normalizeGeocodeResult(payload.results[0]);
        }

        if (payload.status === 'ZERO_RESULTS') break;

        if (payload.status === 'OVER_QUERY_LIMIT') {
          await sleep(500 * (attempt + 1));
          continue;
        }

        if (payload.status === 'REQUEST_DENIED') {
          return null;
        }

        await sleep(150 * (attempt + 1));
      } catch (err) {
        await sleep(150 * (attempt + 1));
      }
    }
  }

  return null;
}

async function withConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const limit = Math.max(1, Math.min(concurrency || 4, list.length));
  const results = new Array(list.length);
  let index = 0;

  async function run() {
    while (index < list.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(list[currentIndex], currentIndex);
    }
  }

  const runners = Array.from({ length: limit }, () => run());
  await Promise.all(runners);
  return results;
}

async function buildOfficialTeamsCache() {
  const [ftcTeams, frcTeams] = await Promise.all([
    fetchFtcScoutTeams(),
    fetchBlueAllianceTeams()
  ]);

  const rawTeams = [
    ...(Array.isArray(ftcTeams) ? ftcTeams.map(team => buildTeamRecord(team, 'FTC')).filter(Boolean) : []),
    ...(Array.isArray(frcTeams) ? frcTeams.map(team => buildTeamRecord(team, 'FRC')).filter(Boolean) : [])
  ];

  const deduped = [];
  const seen = new Set();
  for (const team of rawTeams) {
    if (!team || !team.key || seen.has(team.key)) continue;
    seen.add(team.key);
    deduped.push(team);
  }

  const locationGroups = new Map();
  for (const team of deduped) {
    const primaryQuery = team.locationQueries[0] || team.location;
    if (!primaryQuery) continue;
    if (!locationGroups.has(primaryQuery)) {
      locationGroups.set(primaryQuery, new Set());
    }
    const group = locationGroups.get(primaryQuery);
    team.locationQueries.forEach(query => group.add(query));
  }

  const existingCache = await readCacheFile();
  const locationCache = new Map(
    existingCache && existingCache.locationCache && typeof existingCache.locationCache === 'object'
      ? Object.entries(existingCache.locationCache)
      : []
  );

  const locationEntries = Array.from(locationGroups.entries()).map(([primaryQuery, queries]) => ({
    primaryQuery,
    queries: Array.from(queries)
  }));

  console.log(`[official-teams] building map cache for ${deduped.length} teams and ${locationEntries.length} locations`);

  await withConcurrency(locationEntries, 4, async (entry, index) => {
    const cached = locationCache.get(entry.primaryQuery);
    if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lon)) {
      for (const query of entry.queries) {
        locationCache.set(query, cached);
      }
      return cached;
    }

    const coords = await geocodeQuery(entry.primaryQuery);
    if (coords) {
      for (const query of entry.queries) {
        locationCache.set(query, coords);
      }
    }

    if ((index + 1) % 100 === 0) {
      console.log(`[official-teams] geocoded ${index + 1}/${locationEntries.length} locations`);
    }

    return coords;
  });

  const teams = deduped.map(team => {
    const coords = team.locationQueries
      .map(query => locationCache.get(query))
      .find(value => value && Number.isFinite(value.lat) && Number.isFinite(value.lon)) || null;

    return {
      ...team,
      lat: coords ? coords.lat : null,
      lon: coords ? coords.lon : null,
      geocodedLocation: coords ? coords.formattedAddress || team.location : null
    };
  });

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    teams,
    locationCache: Object.fromEntries(locationCache.entries())
  };

  await writeCacheFile(payload);
  return payload;
}

async function getOfficialTeamsForMap({ forceRefresh = false } = {}) {
  if (!forceRefresh && cacheState && Array.isArray(cacheState.teams) && cacheState.teams.length) {
    return cacheState.teams;
  }

  if (!forceRefresh && cachePromise) {
    const payload = await cachePromise;
    return Array.isArray(payload && payload.teams) ? payload.teams : [];
  }

  cachePromise = (async () => {
    if (!forceRefresh) {
      const cached = await readCacheFile();
      if (cached && Array.isArray(cached.teams) && cached.teams.length) {
        cacheState = cached;
        return cached;
      }
    }

    const built = await buildOfficialTeamsCache();
    cacheState = built;
    return built;
  })();

  try {
    const payload = await cachePromise;
    return Array.isArray(payload && payload.teams) ? payload.teams : [];
  } finally {
    cachePromise = null;
  }
}

async function refreshOfficialTeamsCache() {
  cacheState = null;
  cachePromise = null;
  return getOfficialTeamsForMap({ forceRefresh: true });
}

module.exports = {
  getOfficialTeamsForMap,
  refreshOfficialTeamsCache,
  getPreferredTeamName
};
