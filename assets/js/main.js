// Theme Toggle functionality (bind after header injection)
const html = document.documentElement;
const savedTheme = localStorage.getItem('theme') || 'light';
html.setAttribute('data-theme', savedTheme);

function bindThemeToggle() {
  const themeToggle = document.getElementById('themeToggle');
  if (!themeToggle) return;
  themeToggle.addEventListener('click', () => {
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });
}

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

function renderTeams(teams, userCoords) {
  const list = document.getElementById('teamsList');
  if (!list) return;

  // clear list
  list.innerHTML = '';
  window._teamMarkers = {};
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
  const searchWrap = document.createElement('div');
  searchWrap.className = 'teams-search';
  searchWrap.innerHTML = `
    <label for="teamsSearch">Search teams</label>
    <div class="teams-search-field">
      <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
      <input id="teamsSearch" type="search" placeholder="Search by team or contact" autocomplete="off" />
      <span class="teams-search-count" aria-live="polite"></span>
    </div>
  `;
  list.appendChild(searchWrap);

  const emptyEl = document.createElement('p');
  emptyEl.className = 'teams-empty';
  emptyEl.hidden = true;
  emptyEl.textContent = 'No teams match your search.';
  list.appendChild(emptyEl);

  const listEl = document.createElement('div');
  listEl.className = 'teams-list-cards';
  list.appendChild(listEl);

  const searchInput = searchWrap.querySelector('#teamsSearch');
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

  function activateMarkerLabel(teamName) {
    document.querySelectorAll('.marker-label').forEach(el => {
      el.classList.add('marker-label--dim');
      el.classList.remove('marker-label--active');
    });

    const marker = (window._teamMarkers || {})[teamName];
    const tooltip = marker && marker.getTooltip ? marker.getTooltip() : null;
    const tooltipEl = tooltip && tooltip.getElement ? tooltip.getElement() : null;
    if (tooltipEl) {
      tooltipEl.classList.remove('marker-label--dim');
      tooltipEl.classList.add('marker-label--active');
    }
  }

  function applySearch() {
    const query = searchInput.value.trim().toLowerCase();
    let visibleCount = 0;

    Object.values(window._teamCards).forEach(card => {
      const matches = !query || card.dataset.search.includes(query);
      card.hidden = !matches;
      if (matches) visibleCount++;

      const marker = (window._teamMarkers || {})[card.dataset.team];
      if (marker && marker.setOpacity) {
        marker.setOpacity(matches ? 1 : 0.28);
      }
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
      const latlng = marker.getLatLng();
      const zoom = Math.max(map.getZoom(), options.zoom || 14);
      if (map.flyTo) {
        map.flyTo(latlng, zoom, { animate: true, duration: 0.45 });
      } else {
        map.setView(latlng, zoom);
      }

      if (options.openPopup !== false) {
        marker.openPopup();
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

  teams.forEach(team => {
    const dist = userCoords ? haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon) : null;
    const teamName = String(team.name || 'Unnamed team');
    const teamNumber = team.teamNumber ? `FTC ${team.teamNumber}` : 'FTC team';
    const contact = String(team.contact || 'Contact unavailable');
    const location = String(team.location || '').trim();
    const notes = String(team.notes || '').trim();

    const card = document.createElement('div');
    card.className = 'team-card';
    // attach team name to the DOM card for easy lookup from marker events
    card.dataset.team = teamName;
    card.dataset.search = `${teamName} ${teamNumber} ${contact} ${location} ${notes}`.toLowerCase();
    card.innerHTML = `
      <div class="team-card-head">
        <div>
          <h3>${escapeHTML(teamName)}</h3>
          <span class="team-card-label">${escapeHTML(teamNumber)}${team.verified ? ' · verified' : ''}</span>
        </div>
        <button class="btn btn-link goto-marker" title="Show on map" aria-label="Show ${escapeHTML(teamName)} on map" data-team="${escapeHTML(teamName)}"><i class="fa-solid fa-location-dot"></i></button>
      </div>
      <p class="team-card-contact">${escapeHTML(contact)}</p>
      ${location ? `<p class="team-card-meta">${escapeHTML(location)}</p>` : ''}
      ${notes ? `<p class="team-card-notes">${escapeHTML(notes)}</p>` : ''}
      ${dist !== null ? `<p class="team-distance"><span>Distance</span><strong>${dist.toFixed(1)} km away</strong></p>` : ''}
      <div class="team-actions">
        <button class="btn btn-primary send-btn">Send My Info</button>
      </div>
    `;
    window._teamCards[teamName] = card;

    const sendBtn = card.querySelector('.send-btn');
    sendBtn.addEventListener('click', () => sendToTeam(team));

    const gotoBtn = card.querySelector('.goto-marker');
    gotoBtn.addEventListener('click', event => {
      event.stopPropagation();
      focusTeamWhenReady(teamName, { openPopup: true, zoom: 14 });
    });

    card.addEventListener('mouseenter', () => {
      focusTeamWhenReady(teamName, { openPopup: true, zoom: 14 });
    });
    card.addEventListener('focusin', () => {
      focusTeamWhenReady(teamName, { openPopup: true, zoom: 14 });
    });
    card.addEventListener('click', event => {
      if (event.target.closest('.send-btn, .goto-marker')) return;
      focusTeamWhenReady(teamName, { openPopup: true, zoom: 14 });
    });

    listEl.appendChild(card);
  });
  applySearch();

  // initialize Leaflet map when available
  function tryInitMap() {
    if (!window.L) {
      setTimeout(tryInitMap, 200);
      return;
    }

    // remove existing map instance if any
    if (window._teamsMapInstance) {
      try { window._teamsMapInstance.remove(); } catch (e) {}
      window._teamsMapInstance = null;
    }

    const map = L.map('teamsMap', { scrollWheelZoom: false });
    window._teamsMapInstance = map;

    const markerCoords = [];
    teams.forEach(team => {
      if (typeof team.lat !== 'number' || typeof team.lon !== 'number') return;
      // use a Font Awesome based divIcon so the marker matches the list icon (solid, red)
        // (removed helper wrappers) marker open logic handled by goto button below
      const iconHtml = '<i class="fa-solid fa-location-dot"></i>';
      const faIcon = L.divIcon({
        className: 'fa-marker-icon',
        html: iconHtml,
        iconSize: [48, 48],
        iconAnchor: [24, 48],
        tooltipAnchor: [0, -22],
        popupAnchor: [0, -54]
      });
      
      const teamName = String(team.name || 'Unnamed team');
      const dist = userCoords ? haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon) : null;
      
      const marker = L.marker([team.lat, team.lon], { icon: faIcon }).addTo(map);
      
      // Always show the team name above the marker as a permanent tooltip/label
      marker.bindTooltip(teamName, {
        permanent: true,
        direction: 'top',
        offset: [0, -16],
        opacity: 1,
        className: 'marker-label'
      });
      // index marker by team name for list -> map interactions
      if (!window._teamMarkers) window._teamMarkers = {};
      window._teamMarkers[teamName] = marker;

      // Open popup on hover and highlight the hovered marker's label while dimming others
      marker.on('mouseover', function() {
        try { marker.openPopup(); } catch(e) {}
        activateMarkerLabel(teamName);
        highlightTeamCard(teamName);
      });

      marker.on('mouseout', function() {
        try { marker.closePopup(); } catch(e) {}
      });

      marker.on('click', function() {
        focusTeam(teamName, { scroll: true, openPopup: true, zoom: 14 });
      });
      const popupContent = `
        <strong>${escapeHTML(teamName)}</strong><br/>
        ${team.teamNumber ? `FTC ${escapeHTML(team.teamNumber)}<br/>` : ''}
        ${escapeHTML(team.contact || 'Contact unavailable')}<br/>
        ${team.location ? `${escapeHTML(team.location)}<br/>` : ''}
        ${dist !== null ? `<em>${dist.toFixed(1)} km away</em><br/>` : ''}
        <button class="popup-send-btn btn btn-primary" data-team="${escapeHTML(teamName)}">Send My Info</button>
      `;
      marker.bindPopup(popupContent, {
        offset: L.point(0, -12),
        autoPan: true,
        autoPanPadding: L.point(24, 24)
      });
      markerCoords.push([team.lat, team.lon]);
    });
    applySearch();

    map.on('popupopen', function() {
      const btn = document.querySelector('.popup-send-btn');
      if (btn) {
        btn.addEventListener('click', () => {
          const teamName = btn.getAttribute('data-team');
          const team = teams.find(t => t.name === teamName);
          if (team) sendToTeam(team);
        });
      }
    });

    if (markerCoords.length > 0) {
      const bounds = L.latLngBounds(markerCoords);
      if (userCoords) {
        map.setView([userCoords.lat, userCoords.lon], 10);
      } else {
        map.fitBounds(bounds.pad(0.2));
      }
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    } else {
      map.setView([39.5, -98.35], 4);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    }
  }

  tryInitMap();
}

function sendToTeam(team) {
  const raw = sessionStorage.getItem(STUDENT_KEY);
  if (!raw) {
    alert('No student info found. Please fill the signup form first.');
    window.location.href = '/join-form';
    return;
  }

  const info = JSON.parse(raw);
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

  // Open mail client with prefilled message
  window.location.href = `mailto:${team.contact}?subject=${subject}&body=${body}`;
}

function initTeamsPage() {
  const container = document.getElementById('teamsContainer');
  if (!container) return;

  const studentRaw = sessionStorage.getItem(STUDENT_KEY);
  const serverTeams = Array.isArray(window.__TEAMS__) ? window.__TEAMS__ : null;
  if (!studentRaw && !serverTeams) {
    const status = document.getElementById('teamsStatus');
    if (status) status.innerHTML = 'No signup info found. <a href="/join-form">Fill the form first</a>.';
    // render sample teams so the page layout and map still appear
    renderTeams(SAMPLE_TEAMS, null);
    return;
  }

  // If server provided teams (EJS), use them directly
  if (serverTeams) {
    const teams = serverTeams;
    const coords = window.__USER_COORDS__ || null;
    const status = document.getElementById('teamsStatus');
    if (status) {
      status.textContent = teams.length
        ? 'Showing verified teams that are recruiting'
        : 'No verified teams are currently marked as recruiting';
    }
    renderTeams(teams, coords);
    return;
  }

  const status = document.getElementById('teamsStatus');
  // Render a usable view immediately so the page isn't blank while waiting for geolocation
  status.textContent = 'Loading teams…';
  renderTeams(SAMPLE_TEAMS, null);

  // Try to get a more accurate list based on user's location, but don't block the UI.
  if (navigator.geolocation) {
    const geoOptions = { maximumAge: 60000, timeout: 2000, enableHighAccuracy: false };
    navigator.geolocation.getCurrentPosition((pos) => {
      const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      status.textContent = `Found your location (${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)})`;
      const withDist = SAMPLE_TEAMS.map(t => ({ ...t, distance: haversineDistance(coords.lat, coords.lon, t.lat, t.lon) }));
      withDist.sort((a,b) => a.distance - b.distance);
      renderTeams(withDist, coords);
    }, (err) => {
      // If geolocation fails or times out, leave the immediate list in place and show a brief notice.
      status.textContent = 'Using nearby teams (location unavailable)';
    }, geoOptions);
  } else {
    status.textContent = 'Geolocation not supported — showing nearby teams';
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  loadSiteShells();
  bindThemeToggle();
  initJoinForm();
  initTeamsPage();
});

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

  // inject Leaflet CSS + JS for interactive maps (if not present)
  if (!document.querySelector('link[href*="leaflet.css"]')) {
    const llink = document.createElement('link');
    llink.rel = 'stylesheet';
    llink.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(llink);
  }
  if (!window.L && !document.querySelector('script[data-leaflet]')) {
    const lscript = document.createElement('script');
    lscript.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    lscript.setAttribute('data-leaflet', 'true');
    document.body.appendChild(lscript);
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
      initialAnchors.forEach(a => {
        const target = a.getAttribute('data-href');
        if (target) a.setAttribute('href', target);
      });

      // Update links and toggle visibility based on auth status
      fetch('/api/users/me')
        .then(r => r.json())
        .then(data => { 
          const user = data.user;
          const anchors = document.querySelectorAll('[data-href]');
          anchors.forEach(a => {
            // Toggle visibility based on auth status
            const target = a.getAttribute('data-href');
            const navItem = a.closest('li') || a;
            if (target === '/login' || target === '/signup') {
              navItem.style.display = user ? 'none' : '';
            } else if (target === '/logout') {
              navItem.style.display = user ? '' : 'none';
            } else if (target === '/manage-team') {
              navItem.style.display = (user && user.hasTeam) ? '' : 'none';
            } else if (target === '/my-team') {
              navItem.style.display = (user && user.teamNumber) ? '' : 'none';
            }
          });
        }).catch(() => {});

      // bind theme toggle after header is in DOM
      bindThemeToggle();
    }).catch(() => {});

  // load footer
    fetch('/assets/partial/footer.html')
    .then(r => r.text())
    .then(html => {
      const footerContainer = document.createElement('div');
      footerContainer.innerHTML = html;
      document.body.appendChild(footerContainer);
      const yearEl = document.getElementById('site-year');
      if (yearEl) yearEl.textContent = new Date().getFullYear();
    }).catch(() => {});

    // (removed) prefix calculation — always use absolute paths for partials
}
