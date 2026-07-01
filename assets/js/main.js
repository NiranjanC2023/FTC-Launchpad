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

function createUserLocationMarker(map, userCoords, bounds) {
  if (!map || !userCoords || typeof userCoords.lat !== 'number' || typeof userCoords.lon !== 'number') return null;

  const marker = L.marker([userCoords.lat, userCoords.lon], {
    interactive: false,
    keyboard: false,
    title: 'Your location',
    icon: L.divIcon({
      className: 'user-location-marker-icon',
      html: `
        <div class="user-location-marker-wrap" aria-hidden="true">
          <span class="user-location-marker-tag">Your location</span>
          <span class="team-zoom-notifier team-zoom-notifier--user"></span>
        </div>
      `,
      iconSize: [88, 46],
      iconAnchor: [44, 40],
      popupAnchor: [0, -28]
    })
  }).addTo(map);

  if (bounds) {
    bounds.extend([userCoords.lat, userCoords.lon]);
  }

  return marker;
}

function renderTeams(teams, userCoords) {
  const list = document.getElementById('teamsList');
  if (!list) return;

  // clear list
  list.innerHTML = '';
  window._teamMarkers = {};
  window._userLocationMarker = null;
  window._infoWindowTimer = null;
  window._infoWindow = null; // Reset infoWindow to ensure it's recreated with new map instance
  window._teamCards = {};

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

    if (!marker || !map) return false;

    try {
      if (marker.getLatLng && map.setView) {
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
        window._infoWindow.open(map, marker);
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
      layerSet.visible = visible;
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

  function renderExpandableHistorySection({ title, iconClass, entries, sectionKey }) {
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
      </div>
    `;
  }

  teams.forEach(team => {
    const dist = userCoords ? haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon) : null;
    const teamName = String(team.name || 'Unnamed team');
    const programLabel = String(team.program || 'FTC');
    const isNewTeam = Boolean(team.isNewTeam);
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
    const advancementEntries = advancementHistory.length
      ? advancementHistory.map((entry, index) => formatAdvancementEntry(entry, advancementLevels, index))
      : advancementLevels;
    const teamRequirementsText = notes || 'Add your team requirements, such as meeting schedule, grades accepted, skills needed, or application steps.';
    const distanceData = Number.isFinite(dist) ? formatDistance(dist, distanceUnitPreference) : null;

    const card = document.createElement('div');
    card.className = 'team-card';
    // attach team name to the DOM card for easy lookup from marker events
    card.dataset.team = teamName;
    card.dataset.program = programLabel;
    card.dataset.isNewTeam = isNewTeam ? 'true' : 'false';
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
          <span class="team-card-label${isNewTeam ? ' team-card-label--new-team' : ''}">${escapeHTML(teamNumber)}${regionLabel ? ` · ${escapeHTML(regionLabel)}` : ''}${isNewTeam ? ' · new team' : (team.verified ? ' · verified' : '')}</span>
        </div>
        <div class="team-card-toolbar">
          <button class="btn btn-link goto-marker team-card-icon-button" title="Show on map" aria-label="Show ${escapeHTML(teamName)} on map" data-team="${escapeHTML(teamName)}"><i class="fa-solid fa-map-pin"></i></button>
          <button class="btn btn-link toggle-details team-card-icon-button" aria-expanded="false" aria-label="Toggle details"><i class="fa-solid fa-chevron-down"></i></button>
        </div>
      </div>
      <div class="team-details-content" style="margin-top: 12px; max-height: 0; overflow: hidden; opacity: 0; transition: max-height 260ms ease, opacity 200ms ease;">
        <p class="team-card-contact">${escapeHTML(contact)}</p>
        ${(location || regionLabel) ? `<p class="team-card-meta">${escapeHTML([location, regionLabel].filter(Boolean).join(' · '))}</p>` : ''}
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
        <div class="team-card-requirements">
          <div class="team-card-requirements-head">
            <span class="team-card-requirements-icon" aria-hidden="true"><i class="fa-solid fa-list-check"></i></span>
            <span class="team-card-requirements-title">Team Requirements</span>
          </div>
          <p class="team-card-requirements-text">${escapeHTML(teamRequirementsText)}</p>
        </div>
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
            sectionKey: 'advancement'
          })}
        ` : ''}
        <div class="team-actions">
          <button class="btn btn-primary send-btn">Send My Info</button>
        </div>
      </div>
    `;
    window._teamCards[teamName] = card;

    const sendBtn = card.querySelector('.send-btn');
    if (sendBtn) sendBtn.addEventListener('click', (e) => { e.stopPropagation(); sendToTeam(team); });

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
  applySearch();

  // initialize Leaflet map when available
  function tryInitMap() {
    if (!window.L) {
      setTimeout(tryInitMap, 200);
      return;
    }

    if (window._teamsMapInstance && window._teamsMapInstance.remove) {
      window._teamsMapInstance.remove();
    }

    const map = L.map('teamsMap', {
      center: [39.5, -98.35],
      zoom: 4,
      scrollWheelZoom: true
    });
    const privacyBlurZoom = 16;
    const notifierMaxZoom = 10;
    const privacyBlurLayers = [];
    const PrivacyBlurCircle = L.Layer.extend({
      initialize(latlng, radiusMeters) {
        this._latlng = L.latLng(latlng);
        this._radiusMeters = radiusMeters;
      },
      onAdd(layerMap) {
        this._map = layerMap;
        this._el = L.DomUtil.create('div', 'team-privacy-blur');
        layerMap.getPanes().overlayPane.appendChild(this._el);
        layerMap.on('zoom viewreset move', this._reset, this);
        this._reset();
      },
      onRemove(layerMap) {
        layerMap.off('zoom viewreset move', this._reset, this);
        if (this._el) L.DomUtil.remove(this._el);
        this._map = null;
        this._el = null;
      },
      setVisible(visible) {
        if (this._el) this._el.classList.toggle('is-visible', visible);
      },
      _reset() {
        if (!this._map || !this._el) return;
        const center = this._map.latLngToLayerPoint(this._latlng);
        const lngOffset = this._radiusMeters / (111320 * Math.cos(this._latlng.lat * Math.PI / 180));
        const edge = this._map.latLngToLayerPoint([this._latlng.lat, this._latlng.lng + lngOffset]);
        const radiusPx = Math.max(8, Math.abs(edge.x - center.x));
        const size = radiusPx * 2;

        this._el.style.width = `${size}px`;
        this._el.style.height = `${size}px`;
        L.DomUtil.setPosition(this._el, center.subtract([radiusPx, radiusPx]));
      }
    });
    const updatePrivacyBlur = () => {
      const shouldBlur = map.getZoom() >= privacyBlurZoom;
      privacyBlurLayers.forEach(layer => layer.setVisible(shouldBlur));
    };
    const updateTeamZoomNotifiers = () => {
      const shouldShow = map.getZoom() <= notifierMaxZoom;
      Object.values(window._teamMapLayers || {}).forEach(layerSet => {
        if (!layerSet.notifier) return;
        const onMap = map.hasLayer(layerSet.notifier);
        if (shouldShow && layerSet.visible !== false && !onMap) {
          layerSet.notifier.addTo(map);
        } else if ((!shouldShow || layerSet.visible === false) && onMap) {
          map.removeLayer(layerSet.notifier);
        }
      });
    };
    window._updatePrivacyBlur = updatePrivacyBlur;
    window._updateTeamZoomNotifiers = updateTeamZoomNotifiers;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    window._teamsMapInstance = map;
    window._infoWindowTimer = null;
    window._teamMapLayers = {};
    window._teamMarkers = {};
    window._userLocationMarker = null;

    const bounds = L.latLngBounds();
    window._userLocationMarker = createUserLocationMarker(map, userCoords, bounds);

    teams.forEach(team => {
      if (typeof team.lat !== 'number' || typeof team.lon !== 'number') return;
      
      const teamName = String(team.name || 'Unnamed team');
      const programLabel = String(team.program || 'FTC');
      const isNewTeam = Boolean(team.isNewTeam);
      const dist = userCoords ? haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon) : null;
      const distanceData = Number.isFinite(dist) ? formatDistance(dist, distanceUnitPreference) : null;
      const location = String(team.location || '').trim();
      const radiusMeters = Number(team.radiusMeters) || 1000;

      const popupContent = `
        <div style="padding: 2px 15px 15px 15px; color: #111; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; min-width: 220px; line-height: 1.4;">
      <h4 style="margin: 0 0 10px 0; font-size: 1.8em; font-weight: 900; color: #0056b3; line-height: 1.15; padding-top: 0;">${escapeHTML(teamName)}</h4>
          ${isNewTeam ? `<p style="margin: 0 0 6px 0; font-size: 1.1em; font-weight: 700; color: #333;">New Team</p>` : (team.teamNumber ? `<p style="margin: 0 0 6px 0; font-size: 1.1em; font-weight: 700; color: #333;">${escapeHTML(programLabel)} ${escapeHTML(team.teamNumber)}</p>` : '')}
          ${location ? `<p style="margin: 0 0 10px 0; font-size: 0.95em; font-weight: 600; color: #444;">${escapeHTML(location)}</p>` : ''}
          <p style="margin: 0 0 12px 0; font-size: 0.95em; font-weight: 700; color: #0056b3;">Approximate ${escapeHTML(radiusMeters)}-meter area</p>
          <div style="margin-bottom: 12px;">
            <p style="margin: 0; font-size: 0.9em; font-weight: 800; color: #555; text-transform: uppercase;">Contact</p>
            <p style="margin: 0; font-size: 1em; font-weight: 600; color: #222;">${escapeHTML(team.contact || 'Unavailable')}</p>
          </div>
          ${distanceData ? `<p style="margin: 0 0 15px 0; font-size: 1em; font-weight: 800; color: #d32f2f;">${distanceData.label} away</p>` : ''}
          <button class="popup-send-btn btn btn-primary" style="width: 100%; font-weight: 800; padding: 10px; border-radius: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: none;" data-team="${escapeHTML(teamName)}">Send My Info</button>
        </div>
      `;

      const marker = L.circle([team.lat, team.lon], {
        radius: radiusMeters,
        color: '#0056b3',
        weight: 2,
        opacity: 0.85,
        fillColor: '#2f80ed',
        fillOpacity: 0.18
      }).addTo(map);
      const privacyBlurLayer = new PrivacyBlurCircle([team.lat, team.lon], radiusMeters).addTo(map);
      privacyBlurLayers.push(privacyBlurLayer);
      const notifier = L.marker([team.lat, team.lon], {
        interactive: true,
        keyboard: true,
        title: `${teamName} is in this area`,
        icon: L.divIcon({
          className: 'team-zoom-notifier-icon',
          html: '<span class="team-zoom-notifier" aria-hidden="true"></span>',
          iconSize: [28, 36],
          iconAnchor: [14, 34],
          popupAnchor: [0, -34]
        })
      });

      marker.bindPopup(popupContent, { maxWidth: 320 });
      if (!window._teamMarkers) window._teamMarkers = {};
      window._teamMarkers[teamName] = marker;
      if (!window._teamMapLayers) window._teamMapLayers = {};
      window._teamMapLayers[teamName] = {
        circle: marker,
        notifier,
        privacyBlur: privacyBlurLayer,
        visible: true
      };

      marker.on('mouseover', () => {
        if (window._infoWindowTimer) {
          clearTimeout(window._infoWindowTimer);
          window._infoWindowTimer = null;
        }
        marker.openPopup();
      });

      marker.on('mouseout', () => {
        window._infoWindowTimer = setTimeout(() => {
          marker.closePopup();
          window._infoWindowTimer = null;
        }, 500);
      });

      marker.on('click', () => {
        focusTeam(teamName, { scroll: true, openPopup: true });
      });
      notifier.on('click', () => {
        focusTeam(teamName, { scroll: true, openPopup: true, zoom: 12 });
      });

      bounds.extend(marker.getBounds());
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24] });
    } else if (window._userLocationMarker && userCoords) {
      map.setView([userCoords.lat, userCoords.lon], 13);
    }
    updatePrivacyBlur();
    updateTeamZoomNotifiers();
    map.on('zoomend', updatePrivacyBlur);
    map.on('zoomend', updateTeamZoomNotifiers);

    map.on('popupopen', event => {
      const popupEl = event.popup && event.popup.getElement ? event.popup.getElement() : null;
      const btn = popupEl ? popupEl.querySelector('.popup-send-btn') : null;
      if (btn) {
        btn.onclick = () => {
          const teamName = btn.getAttribute('data-team');
          const team = teams.find(t => t.name === teamName);
          if (team) sendToTeam(team);
        };
      }
    });

    applySearch();
  }

  tryInitMap();
}

async function sendToTeam(team) {
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

  if (window.__STUDENT_APP__ && window.__STUDENT_APP__.blocked) {
    alert(`Your application is currently ${window.__STUDENT_APP__.applicationStatus}. You cannot send more requests through this account.`);
    return;
  }

  if (window.__STUDENT_APP__ && window.__STUDENT_APP__.lastRequestAt) {
    const last = new Date(window.__STUDENT_APP__.lastRequestAt);
    const minWaitMs = 1000 * 60 * 60 * 8;
    const remaining = minWaitMs - (Date.now() - last.getTime());
    if (remaining > 0) {
      const minutes = Math.ceil(remaining / 60000);
      alert(`Please wait ${minutes} more minute(s) before sending another request.`);
      return;
    }
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
  } catch (err) {
    alert('Unable to save your application right now.');
    return;
  }

  const subject = encodeURIComponent(`Student Interested: ${info.name}`);
  const bodyLines = [
    `Name: ${info.name}`,
    `Age: ${info.age}`,
    `Experience: ${info.experience}`,
    `Interests: ${info.interests}`,
    `Email: ${info.email}`,
    `Phone: ${info.phone}`,
    `Sent from: FTC Starter Hub`,
  ];
  const body = encodeURIComponent(bodyLines.join('\n'));
  const recipient = team.contact || '';
  const domain = (recipient.split('@')[1] || '').toLowerCase();

  const providerUrls = {
    'gmail.com': `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipient)}&su=${subject}&body=${body}`,
    'googlemail.com': `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipient)}&su=${subject}&body=${body}`,
    'yahoo.com': `https://compose.mail.yahoo.com/?to=${encodeURIComponent(recipient)}&subject=${subject}&body=${body}`,
    'ymail.com': `https://compose.mail.yahoo.com/?to=${encodeURIComponent(recipient)}&subject=${subject}&body=${body}`,
    'outlook.com': `https://outlook.live.com/owa/?path=/mail/action/compose&to=${encodeURIComponent(recipient)}&subject=${subject}&body=${body}`,
    'hotmail.com': `https://outlook.live.com/owa/?path=/mail/action/compose&to=${encodeURIComponent(recipient)}&subject=${subject}&body=${body}`,
    'live.com': `https://outlook.live.com/owa/?path=/mail/action/compose&to=${encodeURIComponent(recipient)}&subject=${subject}&body=${body}`,
    'msn.com': `https://outlook.live.com/owa/?path=/mail/action/compose&to=${encodeURIComponent(recipient)}&subject=${subject}&body=${body}`,
    'protonmail.com': `https://mail.proton.me/compose?to=${encodeURIComponent(recipient)}&subject=${subject}&body=${body}`,
    'icloud.com': `https://www.icloud.com/mail`,
    'zoho.com': `https://mail.zoho.com/compose?to=${encodeURIComponent(recipient)}&subject=${subject}&body=${body}`
  };

  const providerUrl = providerUrls[domain];
  if (providerUrl) {
    window.open(providerUrl, '_blank');
    alert('Opened webmail for ' + domain + '. Please complete the message in your browser.');
  } else {
    window.location.href = `mailto:${recipient}?subject=${subject}&body=${body}`;
    alert('Opened your default mail client so you can send your information to ' + (team.name || 'the team') + '.');
  }
}

function initTeamsPage() {
  const container = document.getElementById('teamsContainer');
  if (!container) return;

  const teams = Array.isArray(window.__TEAMS__) && window.__TEAMS__.length > 0 ? window.__TEAMS__ : SAMPLE_TEAMS;
  const coords = window.__USER_COORDS__ || null;
  const status = document.getElementById('teamsStatus');
  status.textContent = 'Loading teams…';

  renderTeams(teams, coords);

  // Try to get a more accurate list based on user's location, but don't block the UI.
  if (navigator.geolocation) {
    const geoOptions = { maximumAge: 60000, timeout: 2000, enableHighAccuracy: false };
    navigator.geolocation.getCurrentPosition((pos) => {
      const userCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      status.textContent = 'Found your location';
      const withDist = teams.map(t => ({ ...t, distance: haversineDistance(userCoords.lat, userCoords.lon, t.lat, t.lon) }));
      withDist.sort((a,b) => a.distance - b.distance);
      renderTeams(withDist, userCoords);
    }, (err) => {
      status.textContent = 'Using nearby teams (location unavailable)';
    }, geoOptions);
  } else {
    status.textContent = 'Geolocation not supported — showing nearby teams';
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
  const hue = hashStringToHue([team && team.name, team && team.teamNumber, team && team.program].filter(Boolean).join('|'));
  return `hsl(${hue}, 72%, 52%)`;
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
    const statusLabel = team.recruiting ? 'Recruiting' : 'Not recruiting';
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
          <a href="/teams-nearby" class="team-button">View Team &amp; Apply</a>
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
      const recruitingTeams = allTeams.filter(team => team && typeof team.lat === 'number' && typeof team.lon === 'number' && team.recruiting);
      const pool = recruitingTeams.length >= 3 ? recruitingTeams : allTeams.filter(team => team && typeof team.lat === 'number' && typeof team.lon === 'number');
      const nearestTeams = pool
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
  initHomeFeaturedTeams();
  initTeamsPage();
  initSignupForm();
});

function loadSharedFooter() {
  if (document.querySelector('.site-footer')) return;
  fetch('/assets/partial/footer.html')
    .then(r => r.text())
    .then(html => {
      const footerContainer = document.createElement('div');
      footerContainer.innerHTML = html;
      document.body.appendChild(footerContainer);
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
      const gatedTargets = new Set(['/start-team', '/teams-nearby', '/my-applications', '/team-register', '/resources']);
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
          const anchors = document.querySelectorAll('[data-href]');
          const navUserControls = document.querySelector('.nav-user-controls');
          const inboxMenu = document.querySelector('.inbox-menu');
          const inboxToggle = document.querySelector('[data-inbox-toggle]');
          const inboxDropdown = document.querySelector('[data-inbox-dropdown]');
          const inboxList = document.querySelector('[data-inbox-list]');
          const inboxEmpty = document.querySelector('[data-inbox-empty]');
          const inboxTitle = document.querySelector('[data-inbox-title]');
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

          function renderNotifications() {
            if (!inboxList || !inboxEmpty || !inboxTitle) return;

            if (!notifications.length) {
              inboxList.innerHTML = '';
              inboxEmpty.hidden = false;
              inboxTitle.textContent = 'Inbox';
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
              // Only show the "Register Team" link when the user is an authenticated team contact
              // or on the home/start page for anonymous visitors.
              const isStartPage = window.location.pathname === '/';
              const allowedForUser = user ? !!user.hasTeam : false;
              navItem.style.display = (allowedForUser || intent === 'manager' || (!user && isStartPage)) ? '' : 'none';
              a.setAttribute('href', user ? target : `/auth-gate?next=${encodeURIComponent(target)}&label=${encodeURIComponent((a.textContent || '').trim())}`);
            } else if (target === '/manage-team') {
              navItem.style.display = (user && user.hasTeam) ? '' : 'none';
              if (user) a.setAttribute('href', target);
            } else if (target === '/my-applications' || target === '/join-form') {
              // Show applications/join form only for students.
              // If the user is focused on registering a team, keep the header focused on that path instead.
              navItem.style.display = (user && !user.hasTeam && intent !== 'manager') ? '' : 'none';
              a.setAttribute('href', user ? target : `/auth-gate?next=${encodeURIComponent(target)}&label=${encodeURIComponent((a.textContent || '').trim())}`);
            } else if (target === '/my-team') {
              navItem.style.display = (user && user.hasTeam) ? '' : 'none';
              if (user) a.setAttribute('href', target);
            } else if (gatedTargets.has(target)) {
              a.setAttribute('href', user ? target : `/auth-gate?next=${encodeURIComponent(target)}&label=${encodeURIComponent((a.textContent || '').trim())}`);
            }
          });
        }).catch(() => {});

      }).catch(() => {});

    // (removed) prefix calculation — always use absolute paths for partials
}

