// Dark mode removed: ensure no `data-theme` attribute remains
document.documentElement.removeAttribute('data-theme');

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

// Persist signup intent early so header logic can read it on load
(function setSignupIntentFromPath() {
  try {
    const p = (window.location && window.location.pathname) || '/';
    if (p.startsWith('/signup/manager')) {
      sessionStorage.setItem('signup_intent', 'manager');
    } else if (p.startsWith('/signup/seeker')) {
      sessionStorage.setItem('signup_intent', 'seeker');
    } else if (p === '/signup') {
      // selection page — clear any previous intent so navbar stays minimal
      sessionStorage.removeItem('signup_intent');
    }
  } catch (e) { /* ignore storage errors */ }
})();

// Copy code functionality
function copyCode(button) {
  const codeBlock = button.closest('.code-block');
  const code = codeBlock.querySelector('code').textContent;
  
  navigator.clipboard.writeText(code).then(() => {
    const originalText = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => {
      button.textContent = originalText;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy code:', err);
  });
}

function getCurrentUser() {
  return window.__USER__ || window.__CURRENT_USER__ || null;
}

function redirectToAuthGate(nextPath, label) {
  const safeNext = nextPath || window.location.pathname || '/';
  const safeLabel = label ? `&label=${encodeURIComponent(label)}` : '';
  window.location.href = `/auth-gate?next=${encodeURIComponent(safeNext)}${safeLabel}`;
}

function requireAuthForAction(nextPath, label, event) {
  if (getCurrentUser()) return true;
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  redirectToAuthGate(nextPath, label);
  return false;
}

function initPageAnimations() {
  try {
    if (!document.body) return;
    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      document.body.classList.remove('page-motion-ready');
      return;
    }

    document.body.classList.add('page-motion-ready');

    const selectors = [
      'main > .container',
      'main > section',
      'main > article',
      'main > .row',
      '.dashboard-panel',
      '.page-header',
      '.card',
      '.hero',
      '.feature-card',
      '.path-card',
      '.step-card',
      '.team-card',
      '.recruit-card',
      '.resource-card',
      '.info-card',
      '.panel',
      '.stats-grid > *',
      '.team-history-item',
      '.team-compare-card',
      '.teams-list > *',
      '.account-section',
      '.form-grid',
      '.auth-card'
    ];

    const targets = Array.from(document.querySelectorAll(selectors.join(',')));
    if (!targets.length) return;

    const seen = new WeakSet();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -4% 0px' });

    targets.forEach((target, index) => {
      if (seen.has(target)) return;
      seen.add(target);
      target.classList.add('reveal-on-scroll');
      target.style.transitionDelay = `${Math.min(index, 14) * 35}ms`;
      observer.observe(target);
    });
  } catch (err) {
    // Animation is decorative only; never block page behavior if it fails.
  }
}

// ---------- Join form + Teams pages logic ----------

const STUDENT_KEY = 'studentInfo_v1';

function initJoinForm() {
  const form = document.getElementById('joinForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      name: form.querySelector('#name').value.trim(),
      age: form.querySelector('#age').value.trim(),
      experience: form.querySelector('#experience').value.trim(),
      email: form.querySelector('#email').value.trim(),
      phone: form.querySelector('#phone').value.trim(),
      interests: form.querySelector('#interests').value.trim(),
      timestamp: new Date().toISOString()
    };

    // Save to database via API before redirecting
    fetch('/api/signups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    .then(() => {
      sessionStorage.setItem(STUDENT_KEY, JSON.stringify(data));
      window.location.href = '/teams-nearby';
    })
    .catch(err => console.error('Failed to save to database:', err));
  });
}

function initAuthGatedActions() {
  const startTeamCards = document.querySelectorAll('.roadmap-card');
  startTeamCards.forEach((card) => {
    if (card.dataset.authBound) return;
    card.dataset.authBound = 'true';
    card.addEventListener('click', (event) => {
      const target = card.getAttribute('href') || '/start-team';
      const label = (card.querySelector('strong') || card.querySelector('h3') || card).textContent.trim();
      requireAuthForAction(target, label, event);
    });
  });

  const resourceLinks = document.querySelectorAll('.resource-links a');
  const publicResourcePaths = new Set([
    '/sdk',
    '/programming',
    '/advanced-programming',
    '/controller-setup',
    '/drivetrain',
    '/mechanical-parts',
    '/assembly',
    '/motor-selection',
    '/funding',
    '/sponsorship',
    '/outreach',
    '/team-org'
  ]);
  resourceLinks.forEach((link) => {
    if (link.dataset.authBound) return;
    if (link.dataset.publicResource === 'true' || link.origin !== window.location.origin) return;
    if (link.pathname.startsWith('/resources/') || publicResourcePaths.has(link.pathname)) return;
    link.dataset.authBound = 'true';
    link.addEventListener('click', (event) => {
      requireAuthForAction(link.getAttribute('href') || '/resources', (link.textContent || '').trim(), event);
    });
  });
}

// A small list of sample teams (name, lat, lon, contact)
const SAMPLE_TEAMS = [
  { name: 'Rookie Robotics', lat: 40.7128, lon: -74.0060, contact: 'rookierobotics@example.com' },
  { name: 'Northside FTC', lat: 40.730610, lon: -73.935242, contact: 'northsideftc@example.com' },
  { name: 'Riverdale Robotics', lat: 40.6782, lon: -73.9442, contact: 'riverdalerobotics@example.com' }
];

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const toRad = (v) => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function getDistanceUnitPreference() {
  const locale = String(
    navigator.language ||
    Intl.DateTimeFormat().resolvedOptions().locale ||
    ''
  );
  const regionMatch = locale.match(/[-_](?<region>[A-Z]{2}|\d{3})$/);
  const region = regionMatch && regionMatch.groups ? regionMatch.groups.region : '';
  return new Set(['US', 'LR', 'MM', 'GB']).has(region) ? 'imperial' : 'metric';
}

function formatDistance(distanceKm, unitPreference) {
  const useImperial = unitPreference === 'imperial';
  const value = useImperial ? distanceKm * 0.621371 : distanceKm;
  const unit = useImperial ? 'mi' : 'km';
  return {
    value,
    label: `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`
  };
}

function formatAwardHistoryDisplayEntry(entry) {
  const value = String(entry || '').trim();
  if (!value) return '';
  return value.replace(/^\s*(Winner|Finalist)\b/i, (_, word) => (
    word.toLowerCase() === 'winner' ? 'Winning Alliance' : 'Finalist Alliance'
  ));
}

function distanceThresholdToKm(value, unitPreference) {
  if (!Number.isFinite(value)) return null;
  return unitPreference === 'imperial' ? value / 0.621371 : value;
}

function buildGoogleMapsSearchUrl(position) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
    return 'https://www.google.com/maps';
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${position.lat},${position.lng}`)}`;
}

function buildGoogleMapsDirectionsUrl(destination, origin = null) {
  if (!destination || !Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) {
    return 'https://www.google.com/maps';
  }

  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lng}`,
    travelmode: 'driving'
  });

  if (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
    params.set('origin', `${origin.lat},${origin.lng}`);
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildGoogleMapsStreetViewUrl(position) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
    return 'https://www.google.com/maps';
  }

  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(`${position.lat},${position.lng}`)}`;
}

function setTeamsStatusText(message) {
  const statusEl = document.getElementById('teamsStatus');
  if (statusEl) statusEl.textContent = message || '';
}

function setTeamsLocationMessage(message, isError = false) {
  const messageEl = document.getElementById('zipLocationMessage');
  if (!messageEl) return;
  messageEl.textContent = message || '';
  messageEl.classList.toggle('is-error', Boolean(isError));
}

function createUserLocationMarker(map, userCoords, bounds, OverlayClass) {
  if (!map || !userCoords || typeof userCoords.lat !== 'number' || typeof userCoords.lon !== 'number') return null;

  const position = { lat: userCoords.lat, lng: userCoords.lon };
  const marker = new OverlayClass({
    position,
    className: 'user-location-marker-icon',
    html: `
      <div class="user-location-marker-wrap" aria-hidden="true">
        <span class="user-location-marker-tag">Your location</span>
        <span class="team-zoom-notifier team-zoom-notifier--user"></span>
      </div>
    `
  });
  marker.setMap(map);

  if (bounds) {
    bounds.extend(position);
  }

  marker.setPosition = (nextPosition) => {
    if (!nextPosition || !Number.isFinite(nextPosition.lat) || !Number.isFinite(nextPosition.lng)) return;
    marker.position = new google.maps.LatLng(nextPosition);
    if (marker.draw) marker.draw();
  };

  return marker;
}

function renderTeams(teams, userCoords, options = {}) {
  const list = document.getElementById('teamsList');
  if (!list) return;

  // clear list
  list.innerHTML = '';
  window._teamMarkers = {};
  window._userLocationMarker = null;
  window._infoWindowTimer = null;
  window._infoWindow = null; // Reset infoWindow to ensure it's recreated with new map instance
  window._teamCards = {};
  window._teamDataByName = {};

  // ensure a map container exists above the list
  let mapEl = document.getElementById('teamsMap');
  if (!mapEl) {
    mapEl = document.createElement('div');
    mapEl.id = 'teamsMap';
    mapEl.style.width = '100%';
    mapEl.style.height = '400px';
    list.parentNode.insertBefore(mapEl, list);
  }

  // create a simple accessible list alongside the map
  const programOptions = ['All', 'FTC', 'FRC', 'FLL Challenge', 'FLL Explore'];
  const distanceUnitPreference = getDistanceUnitPreference();
  const distanceFilterOptions = distanceUnitPreference === 'imperial'
    ? [
        { value: 'all', label: 'Any distance' },
        { value: '5', label: 'Within 5 mi' },
        { value: '10', label: 'Within 10 mi' },
        { value: '25', label: 'Within 25 mi' },
        { value: '50', label: 'Within 50 mi' }
      ]
    : [
        { value: 'all', label: 'Any distance' },
        { value: '5', label: 'Within 5 km' },
        { value: '10', label: 'Within 10 km' },
        { value: '25', label: 'Within 25 km' },
        { value: '50', label: 'Within 50 km' }
      ];
  const selectedTeamQuery = String(options.teamQuery || '').trim();
  const maxRenderedTeams = 800;
  const matchesTeamQuery = (team, query) => {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) return false;
    const name = String(team && team.name || '').trim().toLowerCase();
    const number = String(team && team.teamNumber || '').trim().toLowerCase();
    const key = String(team && team.key || '').trim().toLowerCase();
    return Boolean(
      name.includes(normalizedQuery)
      || number === normalizedQuery
      || key.includes(normalizedQuery)
    );
  };
  const teamsWithCoordinates = Array.isArray(teams)
    ? teams.filter(team => Number.isFinite(team && team.lat) && Number.isFinite(team && team.lon))
    : [];
  let renderableTeams = teamsWithCoordinates;
  if (selectedTeamQuery) {
    const matchingTeams = teamsWithCoordinates.filter(team => matchesTeamQuery(team, selectedTeamQuery));
    if (matchingTeams.length) {
      renderableTeams = matchingTeams.slice(0, maxRenderedTeams);
    } else if (userCoords && Number.isFinite(userCoords.lat) && Number.isFinite(userCoords.lon)) {
      renderableTeams = teamsWithCoordinates
        .map(team => ({
          team,
          distance: haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon)
        }))
        .sort((left, right) => left.distance - right.distance)
        .slice(0, maxRenderedTeams)
        .map(item => item.team);
    } else {
      renderableTeams = teamsWithCoordinates.slice(0, maxRenderedTeams);
    }
  } else if (userCoords && Number.isFinite(userCoords.lat) && Number.isFinite(userCoords.lon)) {
    renderableTeams = teamsWithCoordinates
      .map(team => ({
        team,
        distance: haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon)
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, maxRenderedTeams)
      .map(item => item.team);
  } else {
    renderableTeams = teamsWithCoordinates.slice(0, maxRenderedTeams);
  }
  renderableTeams = renderableTeams
    .slice()
    .sort((left, right) => {
      const leftRank = getTeamStatusRank(left);
      const rightRank = getTeamStatusRank(right);
      if (leftRank !== rightRank) return leftRank - rightRank;

      const leftProgram = String(left.program || 'FTC');
      const rightProgram = String(right.program || 'FTC');
      if (leftProgram !== rightProgram) return leftProgram.localeCompare(rightProgram);

      const leftNumber = Number(left.teamNumber);
      const rightNumber = Number(right.teamNumber);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }

      return String(left.name || '').localeCompare(String(right.name || ''));
    });
  const searchWrap = document.createElement('div');
  searchWrap.className = 'teams-search';
  searchWrap.innerHTML = `
    <label for="teamsSearch">Search teams</label>
    <div class="teams-search-row">
      <div class="teams-search-field">
        <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
        <input id="teamsSearch" type="search" placeholder="Search by team or contact" autocomplete="off" />
        <div class="teams-filter-menu">
          <button type="button" class="teams-filter-button" aria-haspopup="true" aria-expanded="false" aria-controls="teamsProgramDropdown">
            <i class="fa-solid fa-filter" aria-hidden="true"></i>
            <span>Filters</span>
          </button>
          <div id="teamsProgramDropdown" class="teams-filter-dropdown" hidden>
            <label for="teamsProgramFilter">FIRST program</label>
            <select id="teamsProgramFilter" class="teams-program-filter" aria-label="Filter teams by FIRST program">
              ${programOptions.map(program => `<option value="${escapeHTML(program)}">${program === 'All' ? 'All programs' : escapeHTML(program)}</option>`).join('')}
            </select>
            <label for="teamsAwardsFilter">Awards</label>
            <select id="teamsAwardsFilter" class="teams-program-filter" aria-label="Filter teams by awards">
              <option value="all">All teams</option>
              <option value="has-awards">Has awards listed</option>
              <option value="no-awards">No awards listed</option>
            </select>
            <label for="teamsYearsFilter">Years in program</label>
            <select id="teamsYearsFilter" class="teams-program-filter" aria-label="Filter teams by years in program">
              <option value="all">All years</option>
              <option value="new-team">New teams</option>
              <option value="rookie">Rookie (1-2 years)</option>
              <option value="mid">3-5 years</option>
              <option value="veteran">6+ years</option>
              <option value="unknown">Unknown</option>
            </select>
            <label for="teamsAdvancementFilter">Advancement</label>
            <select id="teamsAdvancementFilter" class="teams-program-filter" aria-label="Filter teams by advancement level">
              <option value="all">All advancement</option>
              <option value="Qualifier">Qualifiers</option>
              <option value="Regional">Regionals</option>
              <option value="Worlds">Worlds</option>
              <option value="unknown">Unknown</option>
            </select>
            <label for="teamsDistanceFilter">Distance</label>
            <select id="teamsDistanceFilter" class="teams-program-filter" aria-label="Filter teams by distance">
              ${distanceFilterOptions.map(option => `<option value="${option.value}">${escapeHTML(option.label)}</option>`).join('')}
            </select>
            <div class="teams-filter-actions">
              <button type="button" class="teams-filter-clear">Clear filters</button>
            </div>
          </div>
        </div>
      </div>
      <span class="teams-search-count" aria-live="polite"></span>
    </div>
  `;

  const teamsListContainer = document.createElement('div');
  teamsListContainer.className = 'teams-list-container';

  teamsListContainer.appendChild(searchWrap);

  const emptyEl = document.createElement('p');
  emptyEl.className = 'teams-empty';
  emptyEl.hidden = true;
  emptyEl.textContent = 'No teams match your search.';
  teamsListContainer.appendChild(emptyEl);

  const listEl = document.createElement('div');
  listEl.className = 'teams-list-cards';
  teamsListContainer.appendChild(listEl);

  list.appendChild(teamsListContainer);

  const mapState = window._teamsMapUi || (window._teamsMapUi = {});
  mapState.map = null;
  mapState.allTeams = teams;
  mapState.teams = renderableTeams;
  mapState.userCoords = userCoords;
  mapState.bounds = null;
  mapState.selectedTeamQuery = selectedTeamQuery;
  mapState.activeTeamName = selectedTeamQuery || mapState.activeTeamName || '';
  mapState.mapType = mapState.mapType || 'roadmap';
  mapState.trafficEnabled = Boolean(mapState.trafficEnabled);
  mapState.transitEnabled = Boolean(mapState.transitEnabled);
  mapState.trafficLayer = mapState.trafficLayer || null;
  mapState.transitLayer = mapState.transitLayer || null;

  const searchInput = searchWrap.querySelector('#teamsSearch');
  const programFilter = searchWrap.querySelector('#teamsProgramFilter');
  const awardsFilter = searchWrap.querySelector('#teamsAwardsFilter');
  const yearsFilter = searchWrap.querySelector('#teamsYearsFilter');
  const advancementFilter = searchWrap.querySelector('#teamsAdvancementFilter');
  const distanceFilter = searchWrap.querySelector('#teamsDistanceFilter');
  const filterMenu = searchWrap.querySelector('.teams-filter-menu');
  const filterButton = searchWrap.querySelector('.teams-filter-button');
  const filterDropdown = searchWrap.querySelector('.teams-filter-dropdown');
  const clearFiltersButton = searchWrap.querySelector('.teams-filter-clear');
  const resultCount = searchWrap.querySelector('.teams-search-count');

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

function normalizeAdvancementLevel(level) {
  const value = String(level ?? '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes('scrimmag')) return '';
    if (value.startsWith('qual') || value.includes('super qualifier') || value.includes('league tournament') || value.includes('league meet')) return 'Qualifier';
    if (value.startsWith('reg') || value.includes('premier')) return 'Regional';
    if (value.startsWith('world') || value.includes('first championship') || value.includes('firstchampionship') || value.includes('world championship')) return 'Worlds';
    if (value.includes('championship')) return 'Regional';
  return level;
}

function isTeamRecruiting(team) {
  const value = team && typeof team === 'object' ? team.recruiting : undefined;
  if (value === false || value === 0) return false;

  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return true;
  if (['false', '0', 'off', 'no', 'n', 'inactive', 'not recruiting'].includes(normalized)) {
    return false;
  }

  return true;
}

function isTeamRegistered(team) {
  return !(team && typeof team === 'object' && team.registered === false);
}

function getTeamRecruitingLabel(team) {
  if (!isTeamRegistered(team)) return 'Not registered';
  return isTeamRecruiting(team) ? 'Recruiting' : 'Not recruiting';
}

function getTeamStatusRank(team) {
  if (!isTeamRegistered(team)) return 2;
  return isTeamRecruiting(team) ? 0 : 1;
}

function canSendInfoToTeam(team) {
  return isTeamRegistered(team) && isTeamRecruiting(team);
}

  function advancementLevelRank(level) {
    const normalized = normalizeAdvancementLevel(level);
    if (normalized === 'Worlds') return 3;
    if (normalized === 'Regional') return 2;
    if (normalized === 'Qualifier') return 1;
    return 0;
  }

  function sortAdvancementLevels(levels) {
    return Array.isArray(levels)
      ? Array.from(new Set(levels.map(normalizeAdvancementLevel).filter(Boolean)))
        .sort((left, right) => {
          const diff = advancementLevelRank(right) - advancementLevelRank(left);
          if (diff) return diff;
          return String(left).localeCompare(String(right));
        })
      : [];
  }

  function formatAdvancementEntry(entry, levels, index) {
    const value = String(entry ?? '').trim();
    if (!value) return '';
    if (/^(Qualifier|Regional|Worlds|Super Qualifier|League Tournament|League Meet|Premier|Championship)\b/i.test(value) && /\d{4}/.test(value)) {
      return value.replace(/\s*-\s*/g, ' - ');
    }
    if (/^(Qualifier|Regional|Worlds|Super Qualifier|League Tournament|League Meet|Premier|Championship)\b/i.test(value)) return value;
    if (/^(?:19|20)\d{2}$/.test(value)) {
      const orderedLevels = sortAdvancementLevels(levels);
      const level = orderedLevels.length ? orderedLevels[index % orderedLevels.length] : '';
      return level ? `${level} - ${value}` : value;
    }
    return value;
  }

  function getAdvancementIconClass(entry) {
    const value = normalizeAdvancementLevel(entry);
    if (value === 'Qualifier') return 'fa-solid fa-flag';
    if (value === 'Regional') return 'fa-solid fa-map-location-dot';
    if (value === 'Worlds') return 'fa-solid fa-globe';
    return 'fa-solid fa-flag-checkered';
  }

  function getAdvancementToneClass(entry) {
    const value = normalizeAdvancementLevel(entry);
    if (value === 'Qualifier') return 'qualifier';
    if (value === 'Regional') return 'regional';
    if (value === 'Worlds') return 'worlds';
    return 'other';
  }

  function activateMarkerLabel(teamName) {
    document.querySelectorAll('.marker-label').forEach(el => {
      el.classList.add('marker-label--dim');
      el.classList.remove('marker-label--active');
    });
    // Circle focus is handled through the matching card and map popup.
  }

  function getMapActionTarget() {
    const activeTeam = mapState.activeTeamName ? window._teamDataByName[mapState.activeTeamName] : null;
    if (activeTeam && Number.isFinite(activeTeam.lat) && Number.isFinite(activeTeam.lon)) {
      return { lat: activeTeam.lat, lng: activeTeam.lon };
    }

    const mapCenter = mapState.map && mapState.map.getCenter ? mapState.map.getCenter() : null;
    if (mapCenter) {
      return { lat: mapCenter.lat(), lng: mapCenter.lng() };
    }

    const currentUserCoords = mapState.userCoords || userCoords;
    if (currentUserCoords && Number.isFinite(currentUserCoords.lat) && Number.isFinite(currentUserCoords.lon)) {
      return { lat: currentUserCoords.lat, lng: currentUserCoords.lon };
    }

    return null;
  }

  function applySearch() {
    const query = searchInput.value.trim().toLowerCase();
    const selectedProgram = programFilter ? programFilter.value : 'All';
    const selectedAwards = awardsFilter ? awardsFilter.value : 'all';
    const selectedYears = yearsFilter ? yearsFilter.value : 'all';
    const selectedAdvancement = advancementFilter ? advancementFilter.value : 'all';
    const selectedDistance = distanceFilter ? distanceFilter.value : 'all';
    const normalizedSelectedAdvancement = normalizeAdvancementLevel(selectedAdvancement);
    let visibleCount = 0;

    Object.values(window._teamCards).forEach(card => {
      const matchesProgram = selectedProgram === 'All' || card.dataset.program === selectedProgram;
      const hasAwards = card.dataset.hasAwards === 'true';
      const yearsInProgram = Number(card.dataset.yearsInProgram || '');
      const advancementLevels = String(card.dataset.advancementLevels || '')
        .split('|')
        .map(normalizeAdvancementLevel)
        .filter(Boolean);
      const distanceKm = card.dataset.distanceKm ? Number(card.dataset.distanceKm) : NaN;
      const matchesAwards = selectedAwards === 'all'
        || (selectedAwards === 'has-awards' && hasAwards)
        || (selectedAwards === 'no-awards' && !hasAwards);
      const matchesYears = selectedYears === 'all'
        || (selectedYears === 'new-team' && card.dataset.isNewTeam === 'true')
        || (selectedYears === 'unknown' && !Number.isFinite(yearsInProgram))
        || (selectedYears === 'rookie' && Number.isFinite(yearsInProgram) && yearsInProgram >= 1 && yearsInProgram <= 2)
        || (selectedYears === 'mid' && Number.isFinite(yearsInProgram) && yearsInProgram >= 3 && yearsInProgram <= 5)
        || (selectedYears === 'veteran' && Number.isFinite(yearsInProgram) && yearsInProgram >= 6);
      const matchesAdvancement = selectedAdvancement === 'all'
        || (selectedAdvancement === 'unknown' && advancementLevels.length === 0)
        || advancementLevels.includes(normalizedSelectedAdvancement);
      const maxDistanceKm = distanceThresholdToKm(Number(selectedDistance), distanceUnitPreference);
      const matchesDistance = selectedDistance === 'all'
        || (Number.isFinite(distanceKm) && Number.isFinite(maxDistanceKm) && distanceKm <= maxDistanceKm);
      const matches = matchesProgram && matchesAwards && matchesYears && matchesAdvancement && matchesDistance && (!query || card.dataset.search.includes(query));
      card.hidden = !matches;
      if (matches) visibleCount++;

      setTeamLayerVisible(card.dataset.team, matches);
    });

    resultCount.textContent = `${visibleCount} team${visibleCount === 1 ? '' : 's'}`;
    emptyEl.hidden = visibleCount !== 0;
  }

  function highlightTeamCard(teamName, options = {}) {
    const card = window._teamCards[teamName];
    if (!card) return;

    if (card.hidden) {
      searchInput.value = '';
      applySearch();
    }

    Object.values(window._teamCards).forEach(item => item.classList.remove('is-active'));
    card.classList.add('is-active');

    if (options.scroll) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function focusTeam(teamName, options = {}) {
    const marker = (window._teamMarkers || {})[teamName];
    const map = window._teamsMapInstance;

    highlightTeamCard(teamName, { scroll: Boolean(options.scroll) });
    activateMarkerLabel(teamName);
    if (window._teamsMapUi) {
      window._teamsMapUi.activeTeamName = teamName;
    }

    if (!marker || !map) return false;

    try {
      if (marker.getCenter && map.panTo) {
        map.panTo(marker.getCenter());
        map.setZoom(Math.max(map.getZoom() || 0, options.zoom || 14));
      } else if (marker.getLatLng && map.setView) {
        map.setView(marker.getLatLng(), Math.max(map.getZoom(), options.zoom || 12));
      } else if (marker.getPosition && map.panTo) {
        map.panTo(marker.getPosition());
        const zoom = Math.max(map.getZoom(), options.zoom || 14);
        map.setZoom(zoom);
      }

      if (window._infoWindowTimer) {
        clearTimeout(window._infoWindowTimer);
        window._infoWindowTimer = null;
        // Ensure it's opaque if we interrupted a fade
        const iw = document.querySelector('.gm-style-iw-t');
        if (iw) iw.style.opacity = '1';
      }

      if (options.openPopup !== false && marker.openPopup) {
        marker.openPopup();
      } else if (options.openPopup !== false && window._infoWindow) {
        window._infoWindow.setContent(marker.popupContent);
        window._infoWindow.setPosition(marker.getCenter ? marker.getCenter() : marker.getPosition());
        window._infoWindow.open({ map, shouldFocus: false });
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function focusTeamWhenReady(teamName, options = {}) {
    if (focusTeam(teamName, options)) return;

    let attempts = 0;
    const iv = setInterval(() => {
      attempts++;
      if (focusTeam(teamName, options) || attempts > 20) {
        clearInterval(iv);
      }
    }, 150);
  }

  searchInput.addEventListener('input', applySearch);
  function closeFilterDropdown() {
    if (!filterButton || !filterDropdown || !filterMenu) return;
    filterButton.setAttribute('aria-expanded', 'false');
    filterDropdown.hidden = true;
    filterMenu.classList.remove('is-open');
  }

  function openFilterDropdown() {
    if (!filterButton || !filterDropdown || !filterMenu) return;
    filterButton.setAttribute('aria-expanded', 'true');
    filterDropdown.hidden = false;
    filterMenu.classList.add('is-open');
  }

  function resetFilters() {
    if (searchInput) searchInput.value = '';
    if (programFilter) programFilter.value = 'All';
    if (awardsFilter) awardsFilter.value = 'all';
    if (yearsFilter) yearsFilter.value = 'all';
    if (advancementFilter) advancementFilter.value = 'all';
    if (distanceFilter) distanceFilter.value = 'all';
    applySearch();
    closeFilterDropdown();
    searchInput.focus();
  }

  [programFilter, awardsFilter, yearsFilter, advancementFilter, distanceFilter].filter(Boolean).forEach((filterEl) => {
    filterEl.addEventListener('change', () => {
      applySearch();
    });
  });
  if (clearFiltersButton) {
    clearFiltersButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetFilters();
    });
  }
  if (filterButton && filterDropdown && filterMenu) {
    filterButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const expanded = filterButton.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        closeFilterDropdown();
      } else {
        openFilterDropdown();
      }
    });

    document.addEventListener('click', (event) => {
      if (filterMenu.contains(event.target)) return;
      closeFilterDropdown();
    });
  }

  function setTeamLayerVisible(teamName, visible) {
    const layerSet = (window._teamMapLayers || {})[teamName];
    const marker = (window._teamMarkers || {})[teamName];
    const map = window._teamsMapInstance;
    if (layerSet) {
      if (layerSet.grouped && layerSet.teamVisibility) {
        layerSet.teamVisibility[teamName] = visible;
        visible = Object.values(layerSet.teamVisibility).some(Boolean);
      } else {
        layerSet.visible = visible;
      }
      if (layerSet.circle && layerSet.circle.setMap) {
        layerSet.circle.setMap(visible ? map : null);
      }
      if (layerSet.privacyBlur && layerSet.privacyBlur.setMap) {
        layerSet.privacyBlur.setMap(visible ? map : null);
      }
      if (layerSet.notifier && layerSet.notifier.setVisible) {
        layerSet.notifier.setVisible(visible);
      }
      if (layerSet.circle && layerSet.circle.setMap) {
        if (visible && typeof window._updateTeamZoomNotifiers === 'function') window._updateTeamZoomNotifiers();
        if (typeof window._updatePrivacyBlur === 'function') window._updatePrivacyBlur();
        return;
      }
      [layerSet.circle, layerSet.privacyBlur].forEach(layer => {
        if (!layer || !map || !map.hasLayer || !map.addLayer || !map.removeLayer) return;
        if (visible && !map.hasLayer(layer)) {
          layer.addTo(map);
        } else if (!visible && map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      });
      if (!visible && layerSet.notifier && map && map.hasLayer(layerSet.notifier)) {
        map.removeLayer(layerSet.notifier);
      }
      if (visible && typeof window._updateTeamZoomNotifiers === 'function') {
        window._updateTeamZoomNotifiers();
      }
      if (typeof window._updatePrivacyBlur === 'function') {
        window._updatePrivacyBlur();
      }
      return;
    }

    if (!marker) return;

    if (marker.setVisible) {
      marker.setVisible(visible);
      return;
    }

    if (map && map.hasLayer && map.addLayer && map.removeLayer) {
      if (visible && !map.hasLayer(marker)) {
        marker.addTo(map);
      } else if (!visible && map.hasLayer(marker)) {
        map.removeLayer(marker);
      }
    }
  }

  function renderExpandableHistorySection({ title, iconClass, entries, sectionKey, sourceLink }) {
    const visibleEntries = entries.slice(0, 2);
    const hiddenEntries = entries.slice(2);
    const hasHiddenEntries = hiddenEntries.length > 0;
    const renderEntry = (entry, hidden = false) => {
      const displayEntry = sectionKey === 'awards' ? formatAwardHistoryDisplayEntry(entry) : entry;
      const icon = sectionKey === 'advancement' ? getAdvancementIconClass(entry) : iconClass;
      const toneClass = sectionKey === 'advancement' ? ` team-history-item--${getAdvancementToneClass(entry)}` : ' team-history-item--award';
      const meta = sectionKey === 'advancement' ? normalizeAdvancementLevel(entry) : 'Award';
      return `
        <li class="team-history-item${toneClass}"${hidden ? ' hidden data-history-hidden="true"' : ''}>
          <span class="team-history-entry">
            <span class="team-history-icon" aria-hidden="true"><i class="${escapeHTML(icon)}"></i></span>
            <span class="team-history-text">${escapeHTML(displayEntry)}</span>
            <span class="team-history-meta">${escapeHTML(meta)}</span>
          </span>
        </li>
      `;
    };

    return `
      <div class="team-card-award-history team-history-section" data-history-section="${escapeHTML(sectionKey)}">
        <strong><i class="${escapeHTML(iconClass)}" aria-hidden="true"></i> ${escapeHTML(title)}</strong>
        <ul class="team-history-list">
          ${visibleEntries.map((entry) => renderEntry(entry)).join('')}
          ${hiddenEntries.map((entry) => renderEntry(entry, true)).join('')}
        </ul>
        ${hasHiddenEntries ? `
          <button type="button" class="team-history-toggle" aria-expanded="false" aria-label="Show all ${escapeHTML(title).toLowerCase()}" data-history-toggle="false">
            <span class="team-history-toggle-icon" aria-hidden="true">...</span>
          </button>
        ` : ''}
        ${sourceLink ? `
          <a class="team-history-source-link" href="${escapeHTML(sourceLink.href)}" target="_blank" rel="noopener noreferrer">
            <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
            ${escapeHTML(sourceLink.label)}
          </a>
        ` : ''}
      </div>
    `;
  }

  renderableTeams.forEach(team => {
    const dist = userCoords ? haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon) : null;
    const teamName = String(team.name || 'Unnamed team');
    const programLabel = String(team.program || 'FTC');
    const isNewTeam = Boolean(team.isNewTeam);
    const isRegistered = isTeamRegistered(team);
    const isRecruiting = isTeamRecruiting(team);
    const canReceiveInfo = isRegistered && isRecruiting;
    const teamNumber = isNewTeam
      ? 'New Team'
      : (team.teamNumber ? `${programLabel} ${team.teamNumber}` : `${programLabel} team`);
    const contact = String(team.contact || 'Contact unavailable');
    const location = String(team.location || '').trim();
    const regionLabel = String(team.competitionRegionLabel || team.regionLabel || '').trim();
    const notes = String(team.notes || '').trim();
    const awards = String(team.awards || '').trim();
    const awardHistory = Array.isArray(team.awardHistory) ? team.awardHistory.filter(Boolean) : [];
    const yearsInProgram = Number(team.yearsInProgram);
    const advancementLevels = Array.isArray(team.advancementLevels) ? team.advancementLevels.map(normalizeAdvancementLevel).filter(Boolean) : [];
    const advancementHistory = Array.isArray(team.advancementHistory) ? team.advancementHistory.filter(Boolean) : [];
    const scoutingUrl = getTeamScoutingUrl(team);
    const scoutingLabel = programLabel === 'FTC' ? 'View on FTC Scout' : 'View on The Blue Alliance';
    const advancementEntries = advancementHistory.length
      ? advancementHistory.map((entry, index) => formatAdvancementEntry(entry, advancementLevels, index))
      : advancementLevels;
    const hasTeamRequirements = Boolean(notes);
    const distanceData = Number.isFinite(dist) ? formatDistance(dist, distanceUnitPreference) : null;

    const card = document.createElement('div');
    card.className = 'team-card';
    card.classList.add(isRecruiting ? 'team-card--recruiting' : 'team-card--not-recruiting');
    // attach team name to the DOM card for easy lookup from marker events
    card.dataset.team = teamName;
    card.dataset.program = programLabel;
    card.dataset.isNewTeam = isNewTeam ? 'true' : 'false';
    card.dataset.recruiting = isRecruiting ? 'true' : 'false';
    card.dataset.hasAwards = awards ? 'true' : 'false';
    card.dataset.yearsInProgram = Number.isFinite(yearsInProgram) ? String(yearsInProgram) : '';
    card.dataset.advancementLevels = advancementLevels.join('|');
    card.dataset.regionLabel = regionLabel;
    card.dataset.distanceKm = Number.isFinite(dist) ? String(dist) : '';
    card.dataset.search = `${teamName} ${teamNumber} ${contact} ${location} ${regionLabel} ${notes} ${awards} ${awardHistory.join(' ')} ${advancementLevels.join(' ')} ${advancementHistory.join(' ')}`.toLowerCase();
    card.innerHTML = `
      <div class="team-card-head">
        <div class="team-card-heading">
          <h3 class="team-card-title">${escapeHTML(teamName)}</h3>
          <span class="team-card-label${isNewTeam ? ' team-card-label--new-team' : ''}${!isRegistered ? ' team-card-label--not-registered' : (isRecruiting ? '' : ' team-card-label--not-recruiting')}">${escapeHTML(teamNumber)}${regionLabel ? ` · ${escapeHTML(regionLabel)}` : ''}${isNewTeam ? ' · new team' : (team.verified ? ' · verified' : '')}${!isRegistered ? ' · not registered' : (isRecruiting ? '' : ' · not recruiting')}</span>
          <span class="team-card-status-pill${!isRegistered ? ' team-card-status-pill--not-registered' : (isRecruiting ? ' team-card-status-pill--recruiting' : ' team-card-status-pill--not-recruiting')}">${escapeHTML(getTeamRecruitingLabel(team))}</span>
        </div>
        <div class="team-card-toolbar">
          <button class="btn btn-link goto-marker team-card-icon-button" title="Show on map" aria-label="Show ${escapeHTML(teamName)} on map" data-team="${escapeHTML(teamName)}"><i class="fa-solid fa-map-pin"></i></button>
          <button class="btn btn-link toggle-details team-card-icon-button" aria-expanded="false" aria-label="Toggle details"><i class="fa-solid fa-chevron-down"></i></button>
        </div>
      </div>
      <div class="team-details-content" style="margin-top: 12px; max-height: 0; overflow: hidden; opacity: 0; transition: max-height 260ms ease, opacity 200ms ease;">
        <p class="team-card-contact">${escapeHTML(contact || (isRegistered ? 'Contact unavailable' : 'Not registered'))}</p>
        ${(location || regionLabel) ? `<p class="team-card-meta">${escapeHTML([location, regionLabel].filter(Boolean).join(' · '))}</p>` : ''}
        ${scoutingUrl ? `
          <p class="team-card-source">
            <a href="${escapeHTML(scoutingUrl)}" target="_blank" rel="noopener noreferrer">
              <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
              ${escapeHTML(scoutingLabel)}
            </a>
          </p>
        ` : ''}
        ${distanceData ? `<p class="team-distance"><span>Distance</span><strong>${distanceData.label} away</strong></p>` : ''}
        ${Number.isFinite(yearsInProgram) ? `
          <div class="team-card-stats">
            <div class="team-card-stat">
              <span class="team-card-stat-icon" aria-hidden="true">
                <i class="${yearsInProgram === 0 ? 'fa-solid fa-seedling' : 'fa-regular fa-calendar'}"></i>
              </span>
              <span class="team-card-stat-text">${yearsInProgram === 0 ? 'New Team Forming' : `${escapeHTML(String(yearsInProgram))} year${yearsInProgram === 1 ? '' : 's'} in program`}</span>
            </div>
          </div>
        ` : ''}
        ${hasTeamRequirements ? `
          <div class="team-card-requirements">
            <div class="team-card-requirements-head">
              <span class="team-card-requirements-icon" aria-hidden="true"><i class="fa-solid fa-list-check"></i></span>
              <span class="team-card-requirements-title">Team Requirements</span>
            </div>
            <p class="team-card-requirements-text">${escapeHTML(notes)}</p>
          </div>
        ` : ''}
        ${awardHistory.length ? `
          ${renderExpandableHistorySection({
            title: 'Awards achieved',
            iconClass: 'fa-solid fa-medal',
            entries: awardHistory,
            sectionKey: 'awards'
          })}
        ` : ''}
        ${advancementEntries.length ? `
          ${renderExpandableHistorySection({
            title: 'Competition History',
            iconClass: 'fa-solid fa-flag-checkered',
            entries: advancementEntries,
            sectionKey: 'advancement',
            sourceLink: scoutingUrl ? { href: scoutingUrl, label: scoutingLabel } : null
          })}
        ` : ''}
        <div class="team-actions">
          <button class="btn btn-primary send-btn"${canReceiveInfo ? '' : ' disabled aria-disabled="true"'}>${canReceiveInfo ? 'Send My Info' : (!isRegistered ? 'Not Registered' : 'Not Recruiting')}</button>
        </div>
      </div>
    `;
    window._teamCards[teamName] = card;

    const sendBtn = card.querySelector('.send-btn');
    if (sendBtn && canReceiveInfo) sendBtn.addEventListener('click', (e) => { e.stopPropagation(); sendToTeam(team); });

    const gotoBtn = card.querySelector('.goto-marker');
    if (gotoBtn) gotoBtn.addEventListener('click', event => {
      event.stopPropagation();
      focusTeamWhenReady(teamName, { openPopup: true, zoom: 14 });
    });

    const toggleBtn = card.querySelector('.toggle-details');
    const detailsContent = card.querySelector('.team-details-content');
    const historyToggleButtons = card.querySelectorAll('.team-history-toggle');
    // start collapsed by default for a compact list view
    card.classList.add('collapsed');
    if (detailsContent) {
      // prepare for animated collapse via max-height (use display:block so scrollHeight is measurable)
      detailsContent.style.display = 'block';
      detailsContent.style.maxHeight = '0px';
      detailsContent.style.opacity = '0';
      detailsContent.style.overflow = 'hidden';
      detailsContent.style.transition = 'max-height 260ms ease, opacity 200ms ease';
    }

    historyToggleButtons.forEach((button) => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const section = button.closest('.team-history-section');
        if (!section) return;
        const isExpanded = button.getAttribute('aria-expanded') === 'true';
        const hiddenItems = section.querySelectorAll('li[data-history-hidden="true"]');

        hiddenItems.forEach((item) => {
          item.hidden = isExpanded;
        });

        const nextExpanded = !isExpanded;
        button.setAttribute('aria-expanded', String(nextExpanded));
        button.setAttribute('data-history-toggle', String(nextExpanded));
        const icon = button.querySelector('.team-history-toggle-icon');
        if (icon) {
          icon.textContent = nextExpanded ? '↑' : '...';
        }

        if (card.classList.contains('expanded') && detailsContent) {
          requestAnimationFrame(() => {
            detailsContent.style.maxHeight = detailsContent.scrollHeight + 'px';
          });
        }
      });
    });

    if (toggleBtn && detailsContent) {
      toggleBtn.addEventListener('click', event => {
        event.stopPropagation();
        const isOpen = card.classList.toggle('expanded');
        if (isOpen) {
          card.classList.remove('collapsed');
          toggleBtn.setAttribute('aria-expanded', 'true');
          // set maxHeight dynamically to allow transition
          detailsContent.style.maxHeight = detailsContent.scrollHeight + 'px';
          detailsContent.style.opacity = '1';
          // bring the whole card into view after layout expands
          setTimeout(() => {
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 40);
        } else {
          card.classList.add('collapsed');
          toggleBtn.setAttribute('aria-expanded', 'false');
          detailsContent.style.maxHeight = '0px';
          detailsContent.style.opacity = '0';
        }
      });

      // allow clicking the card head to toggle as well (but ignore goto/toggle clicks)
      const head = card.querySelector('.team-card-head');
      if (head) {
        head.addEventListener('click', (e) => {
          if (e.target.closest('.goto-marker') || e.target.closest('.toggle-details')) return;
          toggleBtn.click();
        });
      }
    }

    let hoverFocusTimer = null;
    card.addEventListener('mouseenter', (event) => {
      if (event.target.closest('.goto-marker') || event.target.closest('.toggle-details') || event.target.closest('.send-btn')) return;
      hoverFocusTimer = setTimeout(() => {
        focusTeamWhenReady(teamName, { openPopup: true, zoom: 14, scroll: true });
      }, 2000);
    });

    card.addEventListener('mouseleave', () => {
      if (hoverFocusTimer) {
        clearTimeout(hoverFocusTimer);
        hoverFocusTimer = null;
      }
    });

    // keep legacy behavior: use goto button to focus/open popup

    listEl.appendChild(card);
  });
  if (selectedTeamQuery && searchInput) {
    searchInput.value = selectedTeamQuery;
  }
  applySearch();

  if (selectedTeamQuery) {
    const normalizedTeamQuery = selectedTeamQuery.toLowerCase();
    const selectedTeam = renderableTeams.find(team => (
      String(team && team.name || '').trim().toLowerCase() === normalizedTeamQuery
      || String(team && team.teamNumber || '').trim().toLowerCase() === normalizedTeamQuery
    ));
    if (selectedTeam) {
      focusTeamWhenReady(String(selectedTeam.name || ''), { openPopup: true, zoom: 14, scroll: true });
    }
  }

  // Initialize Google Maps when its async script is ready.
  let mapInitAttempts = 0;
  const showGoogleMapsError = () => {
    mapEl.innerHTML = '<p class="map-load-error">Google Maps is unavailable. Enable the Maps JavaScript API for the configured key, then reload this page.</p>';
  };
  window.addEventListener('google-maps-auth-error', showGoogleMapsError, { once: true });

  function tryInitMap() {
    if (window.__GOOGLE_MAPS_AUTH_FAILED__) {
      showGoogleMapsError();
      return;
    }
    if (!window.google || !google.maps || !google.maps.Map) {
      mapInitAttempts += 1;
      if (mapInitAttempts > 60) {
        showGoogleMapsError();
        return;
      }
      setTimeout(tryInitMap, 200);
      return;
    }

    if (window._teamsMapInstance && google.maps.event) {
      google.maps.event.clearInstanceListeners(window._teamsMapInstance);
    }
    mapEl.innerHTML = '';

    const map = new google.maps.Map(mapEl, {
      center: { lat: 39.5, lng: -98.35 },
      zoom: 4,
      mapTypeControl: true,
      streetViewControl: true,
      scaleControl: true,
      zoomControl: true,
      rotateControl: true,
      fullscreenControl: true,
      // Use normal map gestures so Google doesn't show the ctrl+scroll hint overlay.
      gestureHandling: 'greedy'
    });
    const privacyBlurZoom = 16;

    class MapDomOverlay extends google.maps.OverlayView {
      constructor({ position, className, html, title, onClick }) {
        super();
        this.position = new google.maps.LatLng(position);
        this.className = className || '';
        this.html = html || '';
        this.title = title || '';
        this.onClick = onClick;
        this.visible = true;
        this.element = null;
      }

      onAdd() {
        const element = document.createElement('div');
        element.className = `google-team-overlay ${this.className}`.trim();
        element.innerHTML = this.html;
        element.style.position = 'absolute';
        element.style.display = this.visible ? 'block' : 'none';
        if (this.title) element.title = this.title;
        if (this.onClick) {
          element.tabIndex = 0;
          element.setAttribute('role', 'button');
          element.addEventListener('click', this.onClick);
          element.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              this.onClick(event);
            }
          });
        }
        this.element = element;
        this.getPanes().overlayMouseTarget.appendChild(element);
      }

      draw() {
        if (!this.element) return;
        const point = this.getProjection().fromLatLngToDivPixel(this.position);
        if (!point) return;
        this.element.style.left = `${point.x}px`;
        this.element.style.top = `${point.y}px`;
      }

      onRemove() {
        if (this.element) this.element.remove();
        this.element = null;
      }

      setVisible(visible) {
        this.visible = Boolean(visible);
        if (this.element) this.element.style.display = this.visible ? 'block' : 'none';
      }

      getPosition() {
        return this.position;
      }
    }

    window._teamsMapInstance = map;
    window._infoWindowTimer = null;
    window._pinnedTeamPopup = null;
    window._teamMapLayers = {};
    window._teamMarkers = {};
    window._userLocationMarker = null;
    window._activeInfoTeam = null;
    window._infoWindow = new google.maps.InfoWindow({ maxWidth: 320 });
    mapState.map = map;
    mapState.trafficLayer = mapState.trafficLayer || new google.maps.TrafficLayer();
    mapState.transitLayer = mapState.transitLayer || new google.maps.TransitLayer();
    if (mapState.mapType && map.setMapTypeId) {
      map.setMapTypeId(mapState.mapType);
    }
    if (mapState.trafficEnabled && mapState.trafficLayer) {
      mapState.trafficLayer.setMap(map);
    }
    if (mapState.transitEnabled && mapState.transitLayer) {
      mapState.transitLayer.setMap(map);
    }

    window._infoWindow.addListener('domready', () => {
      const btn = document.querySelector('.gm-style-iw .popup-send-btn');
      if (!btn || btn.disabled) return;
      btn.onclick = () => {
        const activeTeam = window._activeInfoTeam;
        if (activeTeam) sendToTeam(activeTeam);
      };

      const wrappers = [
        document.querySelector('.gm-style-iw'),
        document.querySelector('.gm-style-iw-d'),
        document.querySelector('.gm-style-iw-c'),
        document.querySelector('.gm-style-iw-t')
      ].filter(Boolean);
      wrappers.forEach((el) => {
        el.style.overflow = 'visible';
        el.style.maxHeight = 'none';
        el.style.maxWidth = 'none';
      });
    });

    const updatePrivacyBlur = () => {
      const shouldBlur = (map.getZoom() || 0) >= privacyBlurZoom;
      Object.values(window._teamMapLayers || {}).forEach(layerSet => {
        if (!layerSet.privacyBlur || !layerSet.privacyBlur.setOptions) return;
        layerSet.privacyBlur.setOptions({
          visible: layerSet.visible !== false,
          fillOpacity: shouldBlur && layerSet.visible !== false ? 0.08 : 0
        });
      });
    };
    const updateTeamZoomNotifiers = () => {
      Object.values(window._teamMapLayers || {}).forEach(layerSet => {
        if (layerSet.notifier && layerSet.notifier.setVisible) {
          layerSet.notifier.setVisible(layerSet.visible !== false);
        }
      });
    };
    window._updatePrivacyBlur = updatePrivacyBlur;
    window._updateTeamZoomNotifiers = updateTeamZoomNotifiers;

    const bounds = new google.maps.LatLngBounds();
    mapState.bounds = bounds;
    window._userLocationMarker = createUserLocationMarker(map, userCoords, bounds, MapDomOverlay);

    const notRecruitingBuckets = new Map();
    const renderEntries = [];

    renderableTeams.forEach(team => {
      if (typeof team.lat !== 'number' || typeof team.lon !== 'number') return;

      const teamName = String(team.name || 'Unnamed team');
      const isRegistered = isTeamRegistered(team);
      const isRecruiting = isTeamRecruiting(team);
      const radiusMeters = Number(team.radiusMeters) || 1000;
      const center = { lat: team.lat, lng: team.lon };
      const locationKey = String(team.location || '').trim().toLowerCase().replace(/\s+/g, ' ');

      if (!isRecruiting) {
        if (!locationKey) {
          renderEntries.push({
            kind: 'single',
            team,
            teamName,
            center,
            radiusMeters,
            isRegistered,
            isRecruiting: false
          });
          return;
        }

        const bucketKey = locationKey;
        const bucket = notRecruitingBuckets.get(bucketKey) || [];
        bucket.push(team);
        notRecruitingBuckets.set(bucketKey, bucket);
        return;
      }

      renderEntries.push({
        kind: 'single',
        team,
        teamName,
        center,
        radiusMeters,
        isRegistered,
        isRecruiting: true
      });
    });

    notRecruitingBuckets.forEach((bucketTeams, bucketKey) => {
      const groupKey = `cluster-${bucketKey}`;

      if (bucketTeams.length >= 2) {
        const firstTeam = bucketTeams[0];
        renderEntries.push({
          kind: 'group',
          groupKey,
          teams: bucketTeams,
          teamName: String(firstTeam.name || 'Unnamed team'),
          center: { lat: firstTeam.lat, lng: firstTeam.lon },
          radiusMeters: Math.max(...bucketTeams.map(item => Number(item.radiusMeters) || 1000))
        });
        return;
      }

      bucketTeams.forEach(team => {
        renderEntries.push({
          kind: 'single',
          team,
          teamName: String(team.name || 'Unnamed team'),
          center: { lat: team.lat, lng: team.lon },
          radiusMeters: Number(team.radiusMeters) || 1000,
          isRegistered: isTeamRegistered(team),
          isRecruiting: false
        });
      });
    });

    function buildSingleTeamPopupContent(team, options = {}) {
      const teamName = String(team.name || 'Unnamed team');
      const programLabel = String(team.program || 'FTC');
      const isNewTeam = Boolean(team.isNewTeam);
      const isRegistered = isTeamRegistered(team);
      const isRecruiting = isTeamRecruiting(team);
      const canReceiveInfo = isRegistered && isRecruiting;
      const location = String(team.location || '').trim();
      const radiusMeters = Number(team.radiusMeters) || 1000;
      const yearsInProgram = Number(team.yearsInProgram);
      const awardsText = String(team.awards || '').trim();
      const awardHistory = Array.isArray(team.awardHistory) ? team.awardHistory.filter(Boolean) : [];
      const advancementLevels = Array.isArray(team.advancementLevels) ? team.advancementLevels.map(normalizeAdvancementLevel).filter(Boolean) : [];
      const advancementHistory = Array.isArray(team.advancementHistory) ? team.advancementHistory.filter(Boolean) : [];
      const advancementEntries = advancementHistory.length
        ? advancementHistory.map((entry, index) => formatAdvancementEntry(entry, advancementLevels, index))
        : advancementLevels;
      const center = { lat: team.lat, lng: team.lon };
      const googleMapsSearchUrl = buildGoogleMapsSearchUrl(center);
      const googleMapsDirectionsUrl = buildGoogleMapsDirectionsUrl(center, userCoords);
      const googleMapsStreetViewUrl = buildGoogleMapsStreetViewUrl(center);
      const distanceData = options.distanceData || null;
      const yearsBlock = Number.isFinite(yearsInProgram)
        ? `<div class="google-team-popup-detail"><strong>Years</strong><span>${yearsInProgram === 0 ? 'New Team Forming' : `${escapeHTML(String(yearsInProgram))} year${yearsInProgram === 1 ? '' : 's'} in program`}</span></div>`
        : '';
      const awardsBlock = (awardsText || awardHistory.length)
        ? `<div class="google-team-popup-detail"><strong>Awards</strong><span>${escapeHTML(awardHistory.length ? formatAwardHistoryDisplayEntry(awardHistory[0]) : awardsText)}${awardHistory.length > 1 ? ` +${awardHistory.length - 1} more` : ''}</span></div>`
        : '';
      const advancementBlock = advancementEntries.length
        ? `<div class="google-team-popup-detail"><strong>Advancement</strong><span>${escapeHTML(advancementEntries.slice(0, 2).join(', '))}${advancementEntries.length > 2 ? ` +${advancementEntries.length - 2} more` : ''}</span></div>`
        : '';

      return `
      <div class="google-team-popup google-team-popup--single">
        <h4>${escapeHTML(teamName)}</h4>
          ${isNewTeam ? '<p class="google-team-popup-subtitle">New Team</p>' : (team.teamNumber ? `<p class="google-team-popup-subtitle">${escapeHTML(programLabel)} ${escapeHTML(team.teamNumber)}</p>` : '')}
          ${location ? `<p>${escapeHTML(location)}</p>` : ''}
          <p class="google-team-popup-status${canReceiveInfo ? '' : ' is-inactive'}${!isRegistered ? ' is-not-registered' : ''}">${getTeamRecruitingLabel(team)}</p>
          <p class="google-team-popup-area">Approximate ${escapeHTML(radiusMeters)}-meter area</p>
          ${yearsBlock}
          ${awardsBlock}
          ${advancementBlock}
          <div class="google-team-popup-contact"><strong>Contact</strong><span>${escapeHTML(team.contact || (isRegistered ? 'Unavailable' : 'Not registered'))}</span></div>
          ${distanceData ? `<p class="google-team-popup-distance">${distanceData.label} away</p>` : ''}
          <div class="google-team-popup-actions">
            <button class="popup-send-btn btn btn-primary" data-team="${escapeHTML(teamName)}"${canReceiveInfo ? '' : ' disabled aria-disabled="true"'}>${canReceiveInfo ? 'Send My Info' : (!isRegistered ? 'Not Registered' : 'Not Recruiting')}</button>
          </div>
        </div>
      `;
    }

    function buildGroupedPopupContent(teamsInGroup, center, radiusMeters) {
      const sortedTeams = teamsInGroup.slice().sort((left, right) => String(left.name || '').localeCompare(String(right.name || '')));
      const googleMapsSearchUrl = buildGoogleMapsSearchUrl(center);
      const teamListHtml = sortedTeams.map((team) => {
        const teamName = String(team.name || 'Unnamed team');
        const programLabel = String(team.program || 'FTC');
        const teamNumber = team.teamNumber ? `<span class="google-team-popup-team-number">${escapeHTML(programLabel)} ${escapeHTML(team.teamNumber)}</span>` : '';
        const teamStatus = getTeamRecruitingLabel(team);
        const contact = String(team.contact || (isTeamRegistered(team) ? 'Unavailable' : 'Not registered'));
        const teamLocation = String(team.location || '').trim();
        const yearsInProgram = Number(team.yearsInProgram);
        const awardsText = String(team.awards || '').trim();
        const awardHistory = Array.isArray(team.awardHistory) ? team.awardHistory.filter(Boolean) : [];
        const advancementLevels = Array.isArray(team.advancementLevels) ? team.advancementLevels.map(normalizeAdvancementLevel).filter(Boolean) : [];
        const advancementHistory = Array.isArray(team.advancementHistory) ? team.advancementHistory.filter(Boolean) : [];
        const advancementEntries = advancementHistory.length
          ? advancementHistory.map((entry, index) => formatAdvancementEntry(entry, advancementLevels, index))
          : advancementLevels;
        return `
          <li class="google-team-popup-team-item">
            <div class="google-team-popup-team-title">
              <strong>${escapeHTML(teamName)}</strong>
              ${teamNumber}
            </div>
            <div class="google-team-popup-team-meta">
              <span>${escapeHTML(teamStatus)}</span>
              <span>${escapeHTML(contact)}</span>
            </div>
            ${teamLocation ? `<div class="google-team-popup-team-location">${escapeHTML(teamLocation)}</div>` : ''}
            ${Number.isFinite(yearsInProgram) ? `<div class="google-team-popup-team-detail"><strong>Years:</strong> ${yearsInProgram === 0 ? 'New Team Forming' : `${escapeHTML(String(yearsInProgram))} year${yearsInProgram === 1 ? '' : 's'} in program`}</div>` : ''}
            ${(awardsText || awardHistory.length) ? `<div class="google-team-popup-team-detail"><strong>Awards:</strong> ${escapeHTML(awardHistory.length ? formatAwardHistoryDisplayEntry(awardHistory[0]) : awardsText)}${awardHistory.length > 1 ? ` +${awardHistory.length - 1} more` : ''}</div>` : ''}
            ${advancementEntries.length ? `<div class="google-team-popup-team-detail"><strong>Advancement:</strong> ${escapeHTML(advancementEntries.slice(0, 2).join(', '))}${advancementEntries.length > 2 ? ` +${advancementEntries.length - 2} more` : ''}</div>` : ''}
          </li>
        `;
      }).join('');

      return `
      <div class="google-team-popup google-team-popup--group">
        <h4>${escapeHTML(sortedTeams.length)} teams share this location</h4>
        <p class="google-team-popup-status is-inactive">Not recruiting</p>
        <p class="google-team-popup-area">Approximate ${escapeHTML(radiusMeters)}-meter area</p>
        <div class="google-team-popup-contact"><strong>Note</strong><span>Only one marker is shown for this location because these teams are all not recruiting and share the same exact location.</span></div>
        <ul class="google-team-popup-team-list">
          ${teamListHtml}
        </ul>
      </div>
      `;
    }

    renderEntries.forEach((entry) => {
      const team = entry.kind === 'group' ? entry.teams[0] : entry.team;
      if (!team) return;

      const teamName = String(entry.teamName || team.name || 'Unnamed team');
      const isRegistered = isTeamRegistered(team);
      const isRecruiting = isTeamRecruiting(team);
      const canReceiveInfo = isRegistered && isRecruiting;
      const dist = userCoords ? haversineDistance(userCoords.lat, userCoords.lon, entry.center.lat, entry.center.lng) : null;
      const distanceData = Number.isFinite(dist) ? formatDistance(dist, distanceUnitPreference) : null;
      const popupContent = entry.kind === 'group'
        ? buildGroupedPopupContent(entry.teams, entry.center, entry.radiusMeters)
        : buildSingleTeamPopupContent(team, { distanceData });
      const markerFillColor = canReceiveInfo ? '#2f80ed' : '#9ca3af';
      const markerStrokeColor = canReceiveInfo ? '#0056b3' : '#4b5563';

      const teamCount = entry.kind === 'group' ? entry.teams.length : 1;
      let markerObject = null;
      const notifier = new MapDomOverlay({
        position: entry.center,
        className: 'team-zoom-notifier-icon',
        title: teamCount > 1 ? `${teamCount} teams are in this area` : `${teamName} is in this area`,
        html: `<span class="team-zoom-notifier${canReceiveInfo ? '' : (isRegistered ? ' team-zoom-notifier--inactive' : ' team-zoom-notifier--unregistered')}${entry.kind === 'group' ? ' team-zoom-notifier--group' : ''}" aria-hidden="true">${entry.kind === 'group' ? `<span class="team-zoom-notifier-count">${escapeHTML(teamCount)}</span>` : ''}</span>`,
        onClick: event => {
          if (event && event.stopPropagation) event.stopPropagation();
          window._pinnedTeamPopup = { teamName, marker: markerObject };
          focusTeam(teamName, { scroll: true, openPopup: true, zoom: 12 });
        }
      });
      notifier.setMap(map);
      markerObject = notifier;

      const circle = isRegistered ? new google.maps.Circle({
        map,
        center: entry.center,
        radius: entry.radiusMeters,
        strokeColor: markerStrokeColor,
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillColor: markerFillColor,
        fillOpacity: canReceiveInfo ? 0.18 : 0.34,
        clickable: true,
        zIndex: entry.kind === 'group' ? 3 : 2
      }) : null;
      const privacyBlur = circle ? new google.maps.Circle({
        map,
        center: entry.center,
        radius: entry.radiusMeters,
        strokeOpacity: 0,
        fillColor: '#ffffff',
        fillOpacity: 0,
        clickable: false,
        zIndex: 1
      }) : null;

      const openPopup = () => {
        window._activeInfoTeam = team;
        mapState.activeTeamName = teamName;
        window._infoWindow.setContent(popupContent);
        window._infoWindow.setPosition(entry.center);
        window._infoWindow.open({ map, shouldFocus: false });
      };

      if (circle) {
        circle.popupContent = popupContent;
        circle.openPopup = openPopup;
        circle.closePopup = () => window._infoWindow.close();
      }
      markerObject = circle || notifier;

      if (entry.kind === 'group') {
        entry.teams.forEach((groupTeam) => {
          const groupTeamName = String(groupTeam.name || 'Unnamed team');
          window._teamDataByName[groupTeamName] = groupTeam;
          window._teamMarkers[groupTeamName] = markerObject;
          window._teamMapLayers[groupTeamName] = {
            circle,
            notifier,
            privacyBlur,
            visible: true,
            grouped: true,
            noCircle: !circle,
            groupKey: entry.groupKey,
            teamNames: entry.teams.map(t => String(t.name || 'Unnamed team')),
            teamVisibility: Object.fromEntries(entry.teams.map(t => [String(t.name || 'Unnamed team'), true]))
          };
        });
      } else {
        window._teamDataByName[teamName] = team;
        window._teamMarkers[teamName] = markerObject;
        window._teamMapLayers[teamName] = { circle, notifier, privacyBlur, visible: true, noCircle: !circle };
      }

      if (circle) {
        circle.addListener('mouseover', () => {
          if (window._pinnedTeamPopup) return;
          if (window._infoWindowTimer) clearTimeout(window._infoWindowTimer);
          window._infoWindowTimer = null;
          openPopup();
        });
        circle.addListener('mouseout', () => {
          if (window._pinnedTeamPopup && window._pinnedTeamPopup.marker === circle) return;
          window._infoWindowTimer = setTimeout(() => {
            window._infoWindow.close();
            window._infoWindowTimer = null;
          }, 500);
        });
        circle.addListener('click', () => {
          window._pinnedTeamPopup = { teamName, marker: circle };
          focusTeam(teamName, { scroll: true, openPopup: true });
        });

        const circleBounds = circle.getBounds();
        if (circleBounds) bounds.union(circleBounds);
      } else {
        notifier.addListener && notifier.addListener('mouseover', () => {
          if (window._pinnedTeamPopup) return;
          if (window._infoWindowTimer) clearTimeout(window._infoWindowTimer);
          window._infoWindowTimer = null;
          openPopup();
        });
        notifier.addListener && notifier.addListener('mouseout', () => {
          if (window._pinnedTeamPopup && window._pinnedTeamPopup.marker === notifier) return;
          window._infoWindowTimer = setTimeout(() => {
            window._infoWindow.close();
            window._infoWindowTimer = null;
          }, 500);
        });
      }
    });

    if (userCoords && typeof userCoords.lat === 'number' && typeof userCoords.lon === 'number') {
      map.setCenter({ lat: userCoords.lat, lng: userCoords.lon });
      map.setZoom(12);
    } else if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 24);
      google.maps.event.addListenerOnce(map, 'idle', () => {
        if ((map.getZoom() || 0) > 14) map.setZoom(14);
      });
    }

    updatePrivacyBlur();
    updateTeamZoomNotifiers();
    map.addListener('zoom_changed', updatePrivacyBlur);
    map.addListener('zoom_changed', updateTeamZoomNotifiers);
    map.addListener('click', () => {
      window._pinnedTeamPopup = null;
      if (window._infoWindowTimer) clearTimeout(window._infoWindowTimer);
      window._infoWindowTimer = null;
      window._infoWindow.close();
    });

    applySearch();
  }

  tryInitMap();
}

async function sendToTeam(team) {
  if (!isTeamRegistered(team)) {
    alert('This team is not registered in the app and cannot receive applications.');
    return;
  }

  if (!isTeamRecruiting(team)) {
    alert('This team is not currently recruiting and cannot receive applications.');
    return;
  }

  if (!getCurrentUser()) {
    redirectToAuthGate(window.location.pathname || '/teams-nearby', 'Send My Info');
    return;
  }

  let raw = sessionStorage.getItem(STUDENT_KEY);
  if (!raw && window.__USER__) {
    const user = window.__USER__;
    raw = JSON.stringify({
      name: String(user.name || '').trim(),
      age: String(user.age || '').trim(),
      experience: String(user.experience || '').trim(),
      email: String(user.email || '').trim(),
      phone: String(user.phone || '').trim(),
      interests: String(user.interests || '').trim(),
      timestamp: new Date().toISOString()
    });
  }

  if (!raw) {
    alert('No student info found. Please fill the signup form first.');
    window.location.href = '/join-form';
    return;
  }

  const info = JSON.parse(raw);
  try {
    const response = await fetch('/api/signups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: info.name,
        age: info.age,
        experience: info.experience,
        email: info.email,
        phone: info.phone,
        interests: info.interests,
        teamId: team && (team.id || team._id)
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(payload && payload.error ? payload.error : 'Unable to save your application right now.');
      return;
    }

    sessionStorage.setItem(STUDENT_KEY, JSON.stringify(info));
    alert(`Your info was sent to ${team.name || 'the team'}.`);
  } catch (err) {
    alert('Unable to save your application right now.');
    if (err && err.message) {
      console.error('Unable to save your application right now:', err);
    }
    return;
  }
}

function initTeamsPage() {
  const container = document.getElementById('teamsContainer');
  if (!container) return;

  const teams = Array.isArray(window.__TEAMS__) && window.__TEAMS__.length > 0 ? window.__TEAMS__ : SAMPLE_TEAMS;
  const coords = window.__USER_COORDS__ || null;
  const status = document.getElementById('teamsStatus');
  const zipForm = document.getElementById('zipLocationForm');
  const zipInput = document.getElementById('zipLocationInput');
  const zipMessage = document.getElementById('zipLocationMessage');
  const searchParams = new URLSearchParams(window.location.search);
  const initialQuery = String(searchParams.get('q') || '').trim();
  const initialTeamQuery = String(searchParams.get('team') || '').trim();
  status.textContent = 'Loading teams…';

  if (zipInput && initialQuery) {
    zipInput.value = initialQuery;
  }

  renderTeams(teams, coords, { teamQuery: initialTeamQuery });

  function setZipMessage(message, isError = false) {
    if (!zipMessage) return;
    zipMessage.textContent = message || '';
    zipMessage.classList.toggle('is-error', Boolean(isError));
  }

  function hasTeamWithinMiles(referenceCoords, radiusMiles) {
    if (!referenceCoords || typeof referenceCoords.lat !== 'number' || typeof referenceCoords.lon !== 'number') return false;
    const radiusKm = radiusMiles / 0.621371;
    return teams.some(team => (
      team
      && typeof team.lat === 'number'
      && typeof team.lon === 'number'
      && haversineDistance(referenceCoords.lat, referenceCoords.lon, team.lat, team.lon) <= radiusKm
    ));
  }

  function updateLocationStatus(referenceCoords, nearbyMessage) {
    status.textContent = hasTeamWithinMiles(referenceCoords, 100)
      ? nearbyMessage
      : "Sorry, we don't find any registered team at your location";
  }

  async function lookupLocation(query) {
    const trimmed = String(query || '').trim();
    if (!trimmed) {
      throw new Error('Enter a city, county, state, country, or ZIP code.');
    }

    const endpoint = /^\d{5}$/.test(trimmed) ? `/api/geocode-zip?zip=${encodeURIComponent(trimmed)}` : `/api/geocode-location?q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(endpoint, { credentials: 'same-origin' });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.ok || !payload.coords) {
      throw new Error(payload.error || 'Could not find that location.');
    }

    const locationCoords = {
      lat: Number(payload.coords.lat),
      lon: Number(payload.coords.lon)
    };

    if (!Number.isFinite(locationCoords.lat) || !Number.isFinite(locationCoords.lon)) {
      throw new Error('Could not find that location.');
    }

    return {
      coords: locationCoords,
      label: payload.displayName || trimmed
    };
  }

  if (zipForm && zipInput) {
    zipForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const query = zipInput.value.trim();

      if (!query) {
        setZipMessage('Enter a city, county, state, country, or ZIP code.', true);
        zipInput.focus();
        return;
      }

      setZipMessage('Looking up location...');

      try {
        const location = await lookupLocation(query);
        renderTeams(teams, location.coords, { teamQuery: initialTeamQuery });
        updateLocationStatus(location.coords, `Showing teams near ${location.label}`);
        setZipMessage('');
      } catch (err) {
        setZipMessage(err && err.message ? err.message : 'Unable to look up that location right now.', true);
      }
    });
  }

  if (initialQuery) {
    lookupLocation(initialQuery)
      .then((location) => {
        renderTeams(teams, location.coords, { teamQuery: initialTeamQuery });
        updateLocationStatus(location.coords, `Showing teams near ${location.label}`);
        setZipMessage('');
      })
      .catch((err) => {
        setZipMessage(err && err.message ? err.message : 'Unable to look up that location right now.', true);
      });
  }

  // Try to get a more accurate list based on user's location, but don't block the UI.
  if (!initialQuery && navigator.geolocation) {
    const geoOptions = { maximumAge: 60000, timeout: 2000, enableHighAccuracy: false };
    navigator.geolocation.getCurrentPosition((pos) => {
      const userCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      renderTeams(teams, userCoords, { teamQuery: initialTeamQuery });
      updateLocationStatus(userCoords, 'Showing nearby teams');
    }, () => {
      status.textContent = 'Using nearby teams (location unavailable)';
      setZipMessage('Enter a city, county, state, country, or ZIP code to sort teams by distance without sharing your location.');
    }, geoOptions);
  } else {
    if (!initialQuery) {
      status.textContent = 'Geolocation not supported — showing nearby teams';
    }
  }
}

function hashStringToHue(input) {
  const text = String(input || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

function getTeamAccent(team) {
  if (team && team.color) return String(team.color);
  const palette = [
    '#0f766e',
    '#2563eb',
    '#7c3aed',
    '#be123c',
    '#c2410c',
    '#047857',
    '#4338ca',
    '#b45309',
    '#0e7490',
    '#a21caf',
    '#15803d',
    '#1d4ed8'
  ];
  const seed = [team && team.name, team && team.teamNumber, team && team.program].filter(Boolean).join('|');
  return palette[hashStringToHue(seed) % palette.length];
}

function getHomeTeamTitle(team) {
  if (team && (team.isNewTeam || !team.teamNumber)) return 'New Team';
  return team && team.teamNumber ? `#${team.teamNumber}` : 'Team';
}

function getHomeTeamYearsLabel(team) {
  const years = Number(team && team.yearsInProgram);
  if (team && (team.isNewTeam || !Number.isFinite(years) || years <= 0)) {
    return 'New Team Forming';
  }
  if (Number.isFinite(years)) {
    return `${years} year${years === 1 ? '' : 's'} in program`;
  }
  return 'Years not listed';
}

function getHomeTeamDescription(team) {
  const note = String(team && team.notes ? team.notes : '').trim();
  if (note) return note;
  if (team && team.isNewTeam) return 'A new team forming and looking for students nearby.';
  return 'View this recruiting team and see what they are looking for in students.';
}

function getHomeTeamBadgeLabel(team) {
  const rawName = String(team && team.name ? team.name : '').trim();
  if (rawName) {
    const words = rawName.split(/\s+/).filter(Boolean);
    const initials = words.slice(0, 2).map(word => word.charAt(0)).join('');
    if (initials) return initials;
  }
  if (team && team.program) {
    return String(team.program).trim().slice(0, 2);
  }
  if (team && team.teamNumber) {
    return String(team.teamNumber).slice(0, 2);
  }
  return 'FT';
}

function getTeamScoutingUrl(team) {
  if (!team || team.isNewTeam || !team.teamNumber) return null;
  const program = String(team.program || 'FTC').trim().toUpperCase();
  const teamNumber = encodeURIComponent(String(team.teamNumber));

  if (program === 'FTC') {
    return `https://ftcscout.org/teams/${teamNumber}`;
  }

  if (program === 'FRC') {
    return `https://www.thebluealliance.com/team/${teamNumber}`;
  }

  return null;
}

function renderHomeFeaturedTeams(teams) {
  const grid = document.getElementById('homeFeaturedTeams');
  if (!grid || !Array.isArray(teams) || !teams.length) return;

  const distanceUnitPreference = getDistanceUnitPreference();
  grid.innerHTML = teams.map((team) => {
    const accent = getTeamAccent(team);
    const location = [team.city, team.state, team.country].filter(Boolean).join(', ') || 'Location not listed';
    const distance = Number.isFinite(team.distance) ? formatDistance(team.distance, distanceUnitPreference).label : null;
    const numberLabel = getHomeTeamTitle(team);
    const yearsLabel = getHomeTeamYearsLabel(team);
    const isRecruiting = isTeamRecruiting(team);
    const statusLabel = isRecruiting ? 'Recruiting' : 'Not recruiting';
    const verifiedLabel = team.verified ? 'Verified' : 'Listed';
    const programLabel = team.program || 'FTC';
    const description = getHomeTeamDescription(team);
    const badgeLabel = getHomeTeamBadgeLabel(team);
    const barStyle = `background-color: ${accent};`;
    const numberStyle = `border-color: ${accent}33; background-color: ${accent}15; color: ${accent};`;
    const logoStyle = `border-color: ${accent}33; background-color: ${accent}12; color: ${accent};`;

    return `
      <article class="team-card" style="--team-accent: ${accent};">
        <div class="team-card-bar" style="${barStyle}"></div>
        <div class="team-card-body">
          <div class="team-card-top">
            <div class="team-card-brand">
              <div class="team-logo-badge" style="${logoStyle}">${escapeHTML(badgeLabel)}</div>
              <div class="team-number" style="${numberStyle}">${escapeHTML(numberLabel)}</div>
            </div>
            <span class="league-pill">${escapeHTML(programLabel)}</span>
          </div>
          <h3>${escapeHTML(team.name || 'Team')}</h3>
          <p class="team-location"><i class="fa-solid fa-map-pin" aria-hidden="true"></i> ${escapeHTML(location)}</p>
          <p class="team-description">${escapeHTML(description)}</p>
          <div class="team-meta">
            <span><span class="team-meta-icon" aria-hidden="true"><i class="fa-solid fa-location-crosshairs" aria-hidden="true"></i></span> ${escapeHTML(distance ? `${distance} away` : location)}</span>
            <span><span class="team-meta-icon" aria-hidden="true"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i></span> ${escapeHTML(yearsLabel)}</span>
          </div>
          <div class="team-roles">
            <span>${escapeHTML(statusLabel)}</span>
            <span>${escapeHTML(verifiedLabel)}</span>
            <span>${escapeHTML(team.isNewTeam ? 'New Team' : 'Established')}</span>
          </div>
          <a href="/teams-nearby?team=${encodeURIComponent(team.name || '')}" class="team-button">View Team &amp; Apply</a>
        </div>
      </article>
    `;
  }).join('');
}

function initHomeFeaturedTeams() {
  if (!document.body.classList.contains('home-page')) return;
  const grid = document.getElementById('homeFeaturedTeams');
  if (!grid || !navigator.geolocation) return;

  const geoOptions = { maximumAge: 60000, timeout: 3000, enableHighAccuracy: false };
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const response = await fetch('/api/teams', { credentials: 'same-origin' });
      if (!response.ok) return;
      const payload = await response.json();
      const allTeams = Array.isArray(payload.teams) ? payload.teams : [];
      const userCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const recruitingTeams = allTeams.filter(team => team && typeof team.lat === 'number' && typeof team.lon === 'number' && isTeamRecruiting(team));
      const nearestTeams = recruitingTeams
        .map(team => ({
          ...team,
          distance: haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon)
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3);

      if (nearestTeams.length) {
        renderHomeFeaturedTeams(nearestTeams);
      }
    } catch (err) {
      console.error('Failed to load nearby homepage teams:', err);
    }
  }, () => {
    // Keep the server-rendered fallback if location is unavailable.
  }, geoOptions);
}

// Signup page: toggle between seeker (join/make) and manager flows
function initSignupForm() {
  const form = document.getElementById('signupForm');
  if (!form) return;

  const modeButtons = document.querySelectorAll('.signup-mode');
  const modeInput = form.querySelector('#signupMode') || form.querySelector('input[name="signupMode"]');
  const managerContainer = form.querySelector('.signup-manager-fields');
  const seekerContainer = form.querySelector('.signup-seeker-fields');

  function setMode(mode) {
    modeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    if (modeInput) modeInput.value = mode;
    if (managerContainer) managerContainer.style.display = mode === 'manager' ? '' : 'none';
    if (seekerContainer) seekerContainer.style.display = mode === 'manager' ? 'none' : '';

    if (managerContainer) {
      managerContainer.querySelectorAll('input, textarea, select').forEach(el => el.disabled = mode !== 'manager');
    }
    if (seekerContainer) {
      seekerContainer.querySelectorAll('input, textarea, select').forEach(el => el.disabled = mode === 'manager');
    }

    try { sessionStorage.setItem('signup_intent', mode); } catch (e) {}
  }

  if (modeButtons && modeButtons.length > 0) {
    modeButtons.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
    // initialize default mode for combined page
    setMode('seeker');
  } else if (modeInput) {
    // standalone seeker/manager pages: respect server-provided hidden input or path
    const initial = modeInput.value || (window.location.pathname && window.location.pathname.includes('/signup/manager') ? 'manager' : 'seeker');
    // ensure containers/fields reflect the initial mode without overwriting server values
    if (managerContainer) managerContainer.style.display = initial === 'manager' ? '' : 'none';
    if (seekerContainer) seekerContainer.style.display = initial === 'manager' ? 'none' : '';
    if (managerContainer) managerContainer.querySelectorAll('input, textarea, select').forEach(el => el.disabled = initial !== 'manager');
    if (seekerContainer) seekerContainer.querySelectorAll('input, textarea, select').forEach(el => el.disabled = initial === 'manager');
    try { sessionStorage.setItem('signup_intent', initial); } catch (e) {}
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  initPageAnimations();
  loadSharedFooter();
  loadSiteShells();
  initJoinForm();
  initAuthGatedActions();
  initHomeFeaturedTeams();
  initTeamsPage();
  initSignupForm();
});

function loadSharedFooter() {
  if (document.querySelector('.home-footer') || document.querySelector('.site-footer')) return;
  fetch('/assets/partial/footer.html')
    .then(r => r.text())
    .then(html => {
      const footerTemplate = document.createElement('template');
      footerTemplate.innerHTML = html.trim();
      const footer = footerTemplate.content.firstElementChild;
      if (footer) document.body.appendChild(footer);
      const yearEl = document.getElementById('site-year');
      if (yearEl) yearEl.textContent = new Date().getFullYear();
    })
    .catch(() => {});
}

// Load shared header/footer and Bootstrap stylesheet
function loadSiteShells() {
  // inject Bootstrap CSS if not present
  if (!document.querySelector('link[href*="bootstrap.min.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://maxcdn.bootstrapcdn.com/bootstrap/3.3.6/css/bootstrap.min.css';
    const appStylesheet = document.querySelector('link[href*="/assets/css/main.css"], link[href*="assets/css/main.css"]');
    document.head.insertBefore(link, appStylesheet || document.head.firstChild);
  }

  // prefix not used; removed to clean up

  // load header
    fetch('/assets/partial/header.html')
    .then(r => r.text())
    .then(html => {
      const header = document.querySelector('header');
      if (header) {
        header.innerHTML = html;
      } else {
        const h = document.createElement('div');
        h.innerHTML = html;
        document.body.insertBefore(h, document.body.firstChild);
      }

      // Immediately rewrite all links so they work even while auth is loading
      const initialAnchors = document.querySelectorAll('[data-href]');
      const gatedTargets = new Set(['/my-applications', '/team-register']);
      initialAnchors.forEach(a => {
        const target = a.getAttribute('data-href');
        if (!target) return;
        if (gatedTargets.has(target)) {
          const label = encodeURIComponent((a.textContent || '').trim());
          a.setAttribute('href', `/auth-gate?next=${encodeURIComponent(target)}${label ? `&label=${label}` : ''}`);
        } else {
          a.setAttribute('href', target);
        }
      });

      function bindNavbarDrawer() {
        const toggle = document.querySelector('[data-navbar-toggle]');
        const drawer = document.querySelector('[data-navbar-collapse]');
        if (!toggle || !drawer) return;

        const mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 860px)') : null;

        function syncDrawerState() {
          const isMobile = mobileQuery ? mobileQuery.matches : window.innerWidth <= 860;
          const isOpen = drawer.classList.contains('is-open');

          if (!isMobile) {
            drawer.hidden = false;
            drawer.classList.remove('is-open');
            toggle.setAttribute('aria-expanded', 'false');
            return;
          }

          drawer.hidden = !isOpen;
          toggle.setAttribute('aria-expanded', String(isOpen));
        }

        if (!toggle.dataset.bound) {
          toggle.dataset.bound = 'true';
          toggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const isOpen = drawer.classList.contains('is-open');
            drawer.classList.toggle('is-open', !isOpen);
            drawer.hidden = isOpen;
            toggle.setAttribute('aria-expanded', String(!isOpen));
          });
        }

        if (!window.__navbarDrawerListenerBound) {
          window.__navbarDrawerListenerBound = true;
          document.addEventListener('click', (event) => {
            if (!drawer.classList.contains('is-open')) return;
            if (drawer.contains(event.target) || toggle.contains(event.target)) return;
            drawer.classList.remove('is-open');
            drawer.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
          });
        }

        window.addEventListener('resize', syncDrawerState, { passive: true });
        syncDrawerState();
      }

      bindNavbarDrawer();

      // Update links and toggle visibility based on auth status
      fetch('/api/users/me')
        .then(r => r.json())
        .then(data => { 
          const user = data.user;
          window.__USER__ = user || null;
          const anchors = document.querySelectorAll('[data-href]');
          const navUserControls = document.querySelector('.nav-user-controls');
          const inboxMenu = document.querySelector('.inbox-menu');
          const inboxToggle = document.querySelector('[data-inbox-toggle]');
          const inboxDropdown = document.querySelector('[data-inbox-dropdown]');
          const inboxList = document.querySelector('[data-inbox-list]');
          const inboxEmpty = document.querySelector('[data-inbox-empty]');
          const inboxTitle = document.querySelector('[data-inbox-title]');
          const inboxClear = document.querySelector('[data-inbox-clear]');
          const accountMenu = document.querySelector('.account-menu');
          const accountToggle = document.querySelector('[data-account-toggle]');
          const accountDropdown = document.querySelector('[data-account-dropdown]');
          const initialsEl = document.querySelector('[data-account-initials]');
          const accountLabelEl = document.querySelector('.account-label');
          const inboxCountEls = document.querySelectorAll('[data-inbox-count]');
          const accountLinks = accountDropdown ? accountDropdown.querySelectorAll('a') : [];
          let notifications = Array.isArray(data.notifications) ? data.notifications : [];
          let unreadCount = Number.isFinite(Number(data.unreadCount)) ? Number(data.unreadCount) : 0;

          function formatNotificationDate(value) {
            const date = value ? new Date(value) : null;
            if (!date || Number.isNaN(date.getTime())) return '';
            return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          }

          function syncUnreadCount(nextCount) {
            unreadCount = Math.max(0, Number(nextCount) || 0);
            inboxCountEls.forEach((el) => {
              el.textContent = el.classList.contains('inbox-dropdown-count')
                ? (unreadCount > 0 ? `${unreadCount} new` : 'All caught up')
                : String(unreadCount);
            });
          }

          function updateInboxControls() {
            if (!inboxClear) return;
            const hasNotifications = notifications.length > 0;
            inboxClear.disabled = !hasNotifications;
            inboxClear.classList.toggle('is-disabled', !hasNotifications);
          }

          function renderNotifications() {
            if (!inboxList || !inboxEmpty || !inboxTitle) return;

            if (!notifications.length) {
              inboxList.innerHTML = '';
              inboxEmpty.hidden = false;
              inboxTitle.textContent = 'Inbox';
              updateInboxControls();
              return;
            }

            inboxEmpty.hidden = true;
            inboxTitle.textContent = unreadCount > 0 ? 'New notifications' : 'Notifications';
            inboxList.innerHTML = notifications.map((notification) => {
              const link = notification.link || '/account';
              const title = escapeHTML(notification.title || 'Notification');
              const body = escapeHTML(notification.body || '');
              const meta = formatNotificationDate(notification.createdAt);
              const isRead = Boolean(notification.readAt);
              return `
                <a class="inbox-dropdown-item ${isRead ? 'is-read' : ''}" href="${escapeHTML(link)}" data-notification-link>
                  <strong>${title}</strong>
                  <span>${body}</span>
                  ${meta ? `<span class="inbox-dropdown-item-meta">${escapeHTML(meta)}</span>` : ''}
                </a>
              `;
            }).join('');
            updateInboxControls();
          }

          renderNotifications();
          syncUnreadCount(unreadCount);

          if (navUserControls) navUserControls.style.display = user ? 'inline-flex' : 'none';
          if (inboxToggle) inboxToggle.setAttribute('aria-expanded', 'false');
          if (inboxDropdown) inboxDropdown.hidden = true;
          if (accountToggle) accountToggle.setAttribute('aria-expanded', 'false');
          if (accountDropdown) accountDropdown.hidden = true;
          if (initialsEl && user) {
            const initials = user.name
              ? user.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map(part => part[0].toUpperCase())
                .join('') || 'U'
              : 'U';
            if (user.profilePicture) {
              initialsEl.innerHTML = `<img src="${escapeHTML(user.profilePicture)}" alt="Profile picture">`;
            } else {
              initialsEl.textContent = initials;
            }
          } else if (initialsEl) {
            initialsEl.textContent = 'U';
          }

          if (user) {
            if (accountLabelEl) accountLabelEl.textContent = 'Account';
            renderNotifications();
            syncUnreadCount(unreadCount);
            if (accountLinks[0]) {
              accountLinks[0].setAttribute('href', '/account');
              accountLinks[0].setAttribute('data-href', '/account');
              accountLinks[0].textContent = 'Settings';
            }
            if (accountLinks[1]) {
              accountLinks[1].setAttribute('href', '/logout');
              accountLinks[1].setAttribute('data-href', '/logout');
              accountLinks[1].textContent = 'Sign Out';
            }
          }

          if (inboxClear && !inboxClear.dataset.bound) {
            inboxClear.dataset.bound = 'true';
            inboxClear.addEventListener('click', async (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!user || !notifications.length) return;

              try {
                await fetch('/api/notifications/clear', { method: 'POST' });
              } catch (e) {}

              notifications = [];
              unreadCount = 0;
              renderNotifications();
              syncUnreadCount(0);
            });
          }

          if (inboxToggle && !inboxToggle.dataset.bound) {
            inboxToggle.dataset.bound = 'true';
            inboxToggle.addEventListener('click', async (event) => {
              event.preventDefault();
              event.stopPropagation();
              const menu = inboxToggle.closest('.inbox-menu');
              const dropdown = menu && menu.querySelector('[data-inbox-dropdown]');
              const expanded = inboxToggle.getAttribute('aria-expanded') === 'true';
              if (dropdown) dropdown.hidden = expanded;
              inboxToggle.setAttribute('aria-expanded', String(!expanded));
              if (menu) menu.classList.toggle('is-open', !expanded);

              if (!expanded && user && unreadCount > 0) {
                try {
                  await fetch('/api/notifications/read', { method: 'POST' });
                } catch (e) {}
                notifications = notifications.map(notification => notification.readAt ? notification : { ...notification, readAt: new Date().toISOString() });
                renderNotifications();
                syncUnreadCount(0);
              }

              const accountMenuEl = document.querySelector('.account-menu');
              if (accountMenuEl) {
                accountMenuEl.classList.remove('is-open');
                const accountToggleEl = accountMenuEl.querySelector('[data-account-toggle]');
                const accountDropdownEl = accountMenuEl.querySelector('[data-account-dropdown]');
                if (accountToggleEl) accountToggleEl.setAttribute('aria-expanded', 'false');
                if (accountDropdownEl) accountDropdownEl.hidden = true;
              }
            });
          }

          if (accountToggle && !accountToggle.dataset.bound) {
            accountToggle.dataset.bound = 'true';
            accountToggle.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              const menu = accountToggle.closest('.account-menu');
              const dropdown = menu && menu.querySelector('[data-account-dropdown]');
              const expanded = accountToggle.getAttribute('aria-expanded') === 'true';
              if (dropdown) dropdown.hidden = expanded;
              accountToggle.setAttribute('aria-expanded', String(!expanded));
              if (menu) menu.classList.toggle('is-open', !expanded);

              const inboxMenuEl = document.querySelector('.inbox-menu');
              if (inboxMenuEl) {
                inboxMenuEl.classList.remove('is-open');
                const inboxToggleEl = inboxMenuEl.querySelector('[data-inbox-toggle]');
                const inboxDropdownEl = inboxMenuEl.querySelector('[data-inbox-dropdown]');
                if (inboxToggleEl) inboxToggleEl.setAttribute('aria-expanded', 'false');
                if (inboxDropdownEl) inboxDropdownEl.hidden = true;
              }
            });
          }

          if (!window.__navMenusListenerBound) {
            window.__navMenusListenerBound = true;
            document.addEventListener('click', (event) => {
              ['.inbox-menu', '.account-menu'].forEach(selector => {
                const menu = document.querySelector(selector);
                if (!menu || !menu.classList.contains('is-open')) return;
                if (menu.contains(event.target)) return;
                menu.classList.remove('is-open');
                const toggle = menu.querySelector('button[aria-haspopup="true"]');
                const dropdown = menu.querySelector('[data-inbox-dropdown], [data-account-dropdown]');
                if (toggle) toggle.setAttribute('aria-expanded', 'false');
                if (dropdown) dropdown.hidden = true;
              });
            });
          }

          anchors.forEach(a => {
            // Toggle visibility based on auth status
            const target = a.getAttribute('data-href');
            const navItem = a.closest('li') || a;
            const intent = (() => { try { return sessionStorage.getItem('signup_intent'); } catch (e) { return null; }})();
            if (target === '/login' || target === '/signup') {
              navItem.style.display = user ? 'none' : '';
              if (user) a.setAttribute('href', target);
            } else if (target === '/team-register') {
              navItem.style.display = '';
              if (user) {
                a.setAttribute('href', target);
              } else {
                const label = encodeURIComponent((a.textContent || '').trim());
                a.setAttribute('href', `/auth-gate?next=${encodeURIComponent(target)}${label ? `&label=${label}` : ''}`);
              }
            } else if (target === '/manage-team') {
              navItem.style.display = (user && user.hasTeam) ? '' : 'none';
              if (user) a.setAttribute('href', target);
            } else if (target === '/my-applications' || target === '/join-form') {
              // Show applications/join form only for students.
              // If the user is focused on registering a team, keep the header focused on that path instead.
              navItem.style.display = (user && !user.hasTeam && intent !== 'manager') ? '' : 'none';
              a.setAttribute('href', target);
            } else if (target === '/my-team') {
              navItem.style.display = (user && user.hasTeam) ? '' : 'none';
              if (user) a.setAttribute('href', target);
            }
          });
        }).catch(() => {});

      }).catch(() => {});

    // (removed) prefix calculation — always use absolute paths for partials
}

