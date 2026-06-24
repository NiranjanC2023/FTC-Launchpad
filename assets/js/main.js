// Dark mode removed: ensure no `data-theme` attribute remains
document.documentElement.removeAttribute('data-theme');

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
    // Google Maps markers handle labels/tooltips differently; 
    // we focus on card highlighting and InfoWindow state.
  }

  function applySearch() {
    const query = searchInput.value.trim().toLowerCase();
    let visibleCount = 0;

    Object.values(window._teamCards).forEach(card => {
      const matches = !query || card.dataset.search.includes(query);
      card.hidden = !matches;
      if (matches) visibleCount++;

      const marker = (window._teamMarkers || {})[card.dataset.team];
      if (marker) {
        marker.setVisible(matches);
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
      map.panTo(marker.getPosition());
      const zoom = Math.max(map.getZoom(), options.zoom || 14);
      map.setZoom(zoom);

      if (window._infoWindowTimer) {
        clearTimeout(window._infoWindowTimer);
        window._infoWindowTimer = null;
        // Ensure it's opaque if we interrupted a fade
        const iw = document.querySelector('.gm-style-iw-t');
        if (iw) iw.style.opacity = '1';
      }

      if (options.openPopup !== false && window._infoWindow) {
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

  teams.forEach(team => {
    const dist = userCoords ? haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon) : null;
    const teamName = String(team.name || 'Unnamed team');
    const programLabel = String(team.program || 'FTC');
    const teamNumber = team.teamNumber ? `${programLabel} ${team.teamNumber}` : `${programLabel} team`;
    const contact = String(team.contact || 'Contact unavailable');
    const location = String(team.location || '').trim();
    const notes = String(team.notes || '').trim();

    const card = document.createElement('div');
    card.className = 'team-card';
    // attach team name to the DOM card for easy lookup from marker events
    card.dataset.team = teamName;
    card.dataset.search = `${teamName} ${teamNumber} ${contact} ${location} ${notes}`.toLowerCase();
    card.innerHTML = `
      <div class="team-card-head" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div style="font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; flex: 1 1 auto;">
          <h3 class="team-card-title">${escapeHTML(teamName)}</h3>
          <span class="team-card-label" style="display: block; font-size: 0.95rem; font-weight: 700; color: #333; margin-top: 6px;">${escapeHTML(teamNumber)}${team.verified ? ' · verified' : ''}</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex: 0 0 auto;">
          <button class="btn btn-link goto-marker" title="Show on map" aria-label="Show ${escapeHTML(teamName)} on map" data-team="${escapeHTML(teamName)}"><i class="fa-solid fa-location-dot"></i></button>
          <button class="btn btn-link toggle-details" aria-expanded="false" aria-label="Toggle details"><i class="fa-solid fa-chevron-down"></i></button>
        </div>
      </div>
      <div class="team-details-content" style="margin-top: 12px; max-height: 0; overflow: hidden; opacity: 0; transition: max-height 260ms ease, opacity 200ms ease;">
        <p class="team-card-contact" style="margin: 0; font-size: 1em; font-weight: 600; color: #222;">${escapeHTML(contact)}</p>
        ${location ? `<p class="team-card-meta" style="margin: 6px 0 0 0; font-size: 0.9em; font-weight: 500; color: #666;">${escapeHTML(location)}</p>` : ''}
        ${notes ? `<p class="team-card-notes" style="margin: 8px 0 0 0; color: #444; font-style: italic;">${escapeHTML(notes)}</p>` : ''}
        ${dist !== null ? `<p class="team-distance" style="margin: 8px 0 0 0;"><span>Distance</span><strong>${dist.toFixed(1)} km away</strong></p>` : ''}
        <div class="team-actions" style="margin-top: 10px;">
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
          // ensure visible in scroll area
          detailsContent.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  // initialize Google Map when available
  function tryInitMap() {
    if (!window.google || !window.google.maps) {
      setTimeout(tryInitMap, 200);
      return;
    }

    const mapOptions = {
      zoom: 4,
      center: { lat: 39.5, lng: -98.35 },
      mapTypeControl: true, // Allow users to switch map types (Roadmap, Satellite, Hybrid)
      streetViewControl: true, // Enable the Pegman for Street View
      fullscreenControl: true, // Allow fullscreen map view
      gestureHandling: 'greedy', // Improves touch/scroll interaction on mobile
      tilt: 45, // Initial 3D tilt for a more dynamic view
      heading: 0, // Initial map heading (0 degrees is North)
      mapTypeId: 'hybrid' // Start in satellite view with labels
    };

    const map = new google.maps.Map(document.getElementById('teamsMap'), mapOptions);
    window._teamsMapInstance = map;
    window._infoWindow = new google.maps.InfoWindow();
    window._infoWindowTimer = null;

    const bounds = new google.maps.LatLngBounds();
    teams.forEach(team => {
      if (typeof team.lat !== 'number' || typeof team.lon !== 'number') return;
      
      const teamName = String(team.name || 'Unnamed team');
      const programLabel = String(team.program || 'FTC');
      const dist = userCoords ? haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon) : null;

      const popupContent = `
        <div style="padding: 2px 15px 15px 15px; color: #111; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; min-width: 220px; line-height: 1.4;">
      <h4 style="margin: 0 0 10px 0; font-size: 1.8em; font-weight: 900; color: #0056b3; line-height: 1.15; padding-top: 0;">${escapeHTML(teamName)}</h4>
          ${team.teamNumber ? `<p style="margin: 0 0 6px 0; font-size: 1.1em; font-weight: 700; color: #333;">${escapeHTML(programLabel)} ${escapeHTML(team.teamNumber)}</p>` : ''}
          <div style="margin-bottom: 12px;">
            <p style="margin: 0; font-size: 0.9em; font-weight: 800; color: #555; text-transform: uppercase;">Contact</p>
            <p style="margin: 0; font-size: 1em; font-weight: 600; color: #222;">${escapeHTML(team.contact || 'Unavailable')}</p>
          </div>
          ${dist !== null ? `<p style="margin: 0 0 15px 0; font-size: 1em; font-weight: 800; color: #d32f2f;">${dist.toFixed(1)} km away</p>` : ''}
          <button class="popup-send-btn btn btn-primary" style="width: 100%; font-weight: 800; padding: 10px; border-radius: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: none;" data-team="${escapeHTML(teamName)}">Send My Info</button>
        </div>
      `;

      const marker = new google.maps.Marker({
        position: { lat: team.lat, lng: team.lon },
        map: map,
        title: teamName
      });
      
      marker.popupContent = popupContent;
      if (!window._teamMarkers) window._teamMarkers = {};
      window._teamMarkers[teamName] = marker;

      marker.addListener('mouseover', () => {
        if (window._infoWindowTimer) {
          clearTimeout(window._infoWindowTimer);
          window._infoWindowTimer = null;
        }
        // Show the info window on hover without moving the map
        if (window._infoWindow) {
          window._infoWindow.setContent(marker.popupContent);
          window._infoWindow.open(map, marker);
          // Reset opacity for the new window content
          setTimeout(() => {
            const iw = document.querySelector('.gm-style-iw-t');
            if (iw) iw.style.opacity = '1';
          }, 10);
        }
      });

      marker.addListener('mouseout', () => {
        // Close the info window after 0.5 seconds if the mouse leaves the marker
        window._infoWindowTimer = setTimeout(() => {
          if (window._infoWindow) {
            const iw = document.querySelector('.gm-style-iw-t');
            if (iw) {
              iw.style.opacity = '0';
              // Wait for the fade to complete before closing the object
              setTimeout(() => {
                if (window._infoWindow) window._infoWindow.close();
                window._infoWindowTimer = null;
              }, 200);
            } else {
              window._infoWindow.close();
              window._infoWindowTimer = null;
            }
          } else {
            window._infoWindowTimer = null;
          }
        }, 500);
      });

      marker.addListener('click', () => {
        focusTeam(teamName, { scroll: true, openPopup: true });
      });

      bounds.extend(marker.getPosition());
    });

    if (teams.length > 0) {
      map.fitBounds(bounds);
    }

    google.maps.event.addListener(window._infoWindow, 'domready', () => {
      const iwContainer = document.querySelector('.gm-style-iw-t');
      if (iwContainer) {
        // If mouse enters the bubble, stop the timer so it doesn't disappear
        iwContainer.addEventListener('mouseenter', () => {
          if (window._infoWindowTimer) {
            clearTimeout(window._infoWindowTimer);
            window._infoWindowTimer = null;
          }
          iwContainer.style.opacity = '1';
        });

        // If mouse leaves the bubble, restart the fade-out timer
        iwContainer.addEventListener('mouseleave', () => {
          window._infoWindowTimer = setTimeout(() => {
            iwContainer.style.opacity = '0';
            setTimeout(() => {
              if (window._infoWindow) window._infoWindow.close();
              window._infoWindowTimer = null;
            }, 200);
          }, 500);
        });
      }
      const btn = document.querySelector('.popup-send-btn');
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

  // Show a "Done" popup to confirm the action
  alert("Done! Your mail app has been opened to send your information to " + (team.name || "the team") + ".");
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
  loadSiteShells();
  initJoinForm();
  initTeamsPage();
  initSignupForm();
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

  // inject Google Maps JS for interactive maps
  if (!window.google && !document.querySelector('script[data-google]')) {
    const lscript = document.createElement('script');
    lscript.src = 'https://maps.googleapis.com/maps/api/js?key=AIzaSyCDYUgmHFX_FezspmqvSGdgD-7491w_drE';
    lscript.setAttribute('data-google', 'true');
    lscript.async = true;
    lscript.defer = true;
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
          const accountMenu = document.querySelector('.account-menu');
          const accountToggle = document.querySelector('[data-account-toggle]');
          const accountDropdown = document.querySelector('[data-account-dropdown]');
          const initialsEl = document.querySelector('[data-account-initials]');

          if (accountMenu) accountMenu.style.display = user ? '' : 'none';
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
            });
          }

          if (!window.__accountMenuListenerBound) {
            window.__accountMenuListenerBound = true;
            document.addEventListener('click', (event) => {
              const menu = document.querySelector('.account-menu');
              if (!menu || !menu.classList.contains('is-open')) return;
              if (menu.contains(event.target)) return;
              menu.classList.remove('is-open');
              const toggle = menu.querySelector('[data-account-toggle]');
              const dropdown = menu.querySelector('[data-account-dropdown]');
              if (toggle) toggle.setAttribute('aria-expanded', 'false');
              if (dropdown) dropdown.hidden = true;
            });
          }

          anchors.forEach(a => {
            // Toggle visibility based on auth status
            const target = a.getAttribute('data-href');
            const navItem = a.closest('li') || a;
            if (target === '/login' || target === '/signup') {
              navItem.style.display = user ? 'none' : '';
            } else if (target === '/team-register') {
              // Only show the "Register Team" link when the user is an authenticated team contact
              // or when the current anonymous session explicitly selected the manager/signup intent.
              const intent = (() => { try { return sessionStorage.getItem('signup_intent'); } catch (e) { return null; }})();
              const allowedForUser = user ? !!user.hasTeam : false;
              navItem.style.display = (allowedForUser || intent === 'manager') ? '' : 'none';
            } else if (target === '/manage-team') {
              navItem.style.display = (user && user.hasTeam) ? '' : 'none';
            } else if (target === '/my-applications' || target === '/join-form') {
              // Show applications and join form only for students (logged in users without a team)
              // We hide these if the user is already a team manager
              navItem.style.display = (user && !user.hasTeam) ? '' : (user ? 'none' : '');
            } else if (target === '/my-team') {
              navItem.style.display = (user && user.teamNumber) ? '' : 'none';
            }
          });
        }).catch(() => {});

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
