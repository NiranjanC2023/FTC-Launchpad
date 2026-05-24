// Theme Toggle functionality (bind after header injection)
const html = document.documentElement;
const savedTheme = localStorage.getItem('theme') || 'light';
html.setAttribute('data-theme', savedTheme);

// Respect user's system preference on first visit
if (!localStorage.getItem('theme')) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = prefersDark ? 'dark' : 'light';
  html.setAttribute('data-theme', initialTheme);
  localStorage.setItem('theme', initialTheme);
}

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

    sessionStorage.setItem(STUDENT_KEY, JSON.stringify(data));
    window.location.href = '/teams-nearby';
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
  const listEl = document.createElement('div');
  listEl.className = 'teams-list-cards';
  list.appendChild(listEl);

  // prepare marker index for quick lookup from list items
  if (!window._teamMarkers) window._teamMarkers = {};

  teams.forEach(team => {
    const dist = userCoords ? haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon) : null;

    const card = document.createElement('div');
    card.className = 'team-card';
    card.innerHTML = `
      <div class="team-card-head">
        <h3>${team.name}</h3>
        <button class="btn btn-link goto-marker" title="Show on map" data-team="${team.name}"><i class="fa-solid fa-location-dot"></i></button>
      </div>
      <p>${team.contact}</p>
      ${dist !== null ? `<p><strong>${dist.toFixed(1)} km away</strong></p>` : ''}
      <div class="team-actions">
        <button class="btn btn-primary send-btn">Send My Info</button>
      </div>
    `;

    const sendBtn = card.querySelector('.send-btn');
    sendBtn.addEventListener('click', () => sendToTeam(team));

    // goto-marker handler (may wait for map/marker readiness)
    const gotoBtn = card.querySelector('.goto-marker');
    gotoBtn.addEventListener('click', () => {
      const teamName = gotoBtn.getAttribute('data-team');
      // Try to open marker immediately if available
      function openMarker() {
        const markers = window._teamMarkers || {};
        const marker = markers[teamName];
        const map = window._teamsMapInstance;
        if (marker && map) {
          try {
            const latlng = marker.getLatLng();
            map.setView(latlng, 13);
            marker.openPopup();
            return true;
          } catch (e) {
            return false;
          }
        }
        return false;
      }

      // keep trying for a short period if map/marker not ready yet
      if (!openMarker()) {
        let attempts = 0;
        const iv = setInterval(() => {
          attempts++;
          if (openMarker() || attempts > 20) clearInterval(iv);
        }, 200);
      }
    });

    listEl.appendChild(card);
  });

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
      const iconHtml = '<i class="fa-solid fa-location-dot"></i>';
      const faIcon = L.divIcon({
        className: 'fa-marker-icon',
        html: iconHtml,
        // larger icon size for better visibility on map
        iconSize: [48, 48],
        iconAnchor: [24, 48]
      });
      const marker = L.marker([team.lat, team.lon], { icon: faIcon }).addTo(map);
      // index marker by team name for list -> map interactions
      if (!window._teamMarkers) window._teamMarkers = {};
      window._teamMarkers[team.name] = marker;
      const dist = userCoords ? haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon) : null;
      const popupContent = `
        <strong>${team.name}</strong><br/>
        ${team.contact}<br/>
        ${dist !== null ? `<em>${dist.toFixed(1)} km away</em><br/>` : ''}
        <button class="popup-send-btn btn btn-primary" data-team="${team.name}">Send My Info</button>
      `;
      marker.bindPopup(popupContent);
      markerCoords.push([team.lat, team.lon]);
    });

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
  if (!studentRaw) {
    container.innerHTML = `<p>No signup info found. <a href="/join-form">Fill the form first</a>.</p>`;
    return;
  }

  // If server provided teams (EJS), use them directly
  if (window.__TEAMS__) {
    const teams = window.__TEAMS__;
    const coords = window.__USER_COORDS__ || null;
    const status = document.getElementById('teamsStatus');
    if (status) status.textContent = 'Loaded teams from server';
    renderTeams(teams, coords);
    return;
  }

  const status = document.getElementById('teamsStatus');
  status.textContent = 'Trying to get your location…';

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      status.textContent = `Found your location (${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)})`;
      const withDist = SAMPLE_TEAMS.map(t => ({ ...t, distance: haversineDistance(coords.lat, coords.lon, t.lat, t.lon) }));
      withDist.sort((a,b) => a.distance - b.distance);
      renderTeams(withDist, coords);
    }, (err) => {
      status.textContent = 'Location denied or unavailable — showing nearby teams';
      renderTeams(SAMPLE_TEAMS, null);
    });
  } else {
    status.textContent = 'Geolocation not supported — showing nearby teams';
    renderTeams(SAMPLE_TEAMS, null);
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  loadSiteShells();
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
    document.head.appendChild(link);
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

      // rewrite links using data-href attributes so paths work in pages/ and root
        const anchors = document.querySelectorAll('[data-href]');
        anchors.forEach(a => {
          const target = a.getAttribute('data-href');
          if (target) a.setAttribute('href', target);
      });
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
