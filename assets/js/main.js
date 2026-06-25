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
    // Circle focus is handled through the matching card and map popup.
  }

  function applySearch() {
    const query = searchInput.value.trim().toLowerCase();
    let visibleCount = 0;

    Object.values(window._teamCards).forEach(card => {
      const matches = !query || card.dataset.search.includes(query);
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

    const bounds = L.latLngBounds();
    teams.forEach(team => {
      if (typeof team.lat !== 'number' || typeof team.lon !== 'number') return;
      
      const teamName = String(team.name || 'Unnamed team');
      const programLabel = String(team.program || 'FTC');
      const dist = userCoords ? haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon) : null;
      const location = String(team.location || '').trim();
      const radiusMeters = Number(team.radiusMeters) || 1000;

      const popupContent = `
        <div style="padding: 2px 15px 15px 15px; color: #111; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; min-width: 220px; line-height: 1.4;">
      <h4 style="margin: 0 0 10px 0; font-size: 1.8em; font-weight: 900; color: #0056b3; line-height: 1.15; padding-top: 0;">${escapeHTML(teamName)}</h4>
          ${team.teamNumber ? `<p style="margin: 0 0 6px 0; font-size: 1.1em; font-weight: 700; color: #333;">${escapeHTML(programLabel)} ${escapeHTML(team.teamNumber)}</p>` : ''}
          ${location ? `<p style="margin: 0 0 10px 0; font-size: 0.95em; font-weight: 600; color: #444;">${escapeHTML(location)}</p>` : ''}
          <p style="margin: 0 0 12px 0; font-size: 0.95em; font-weight: 700; color: #0056b3;">Approximate ${escapeHTML(radiusMeters)}-meter area</p>
          <div style="margin-bottom: 12px;">
            <p style="margin: 0; font-size: 0.9em; font-weight: 800; color: #555; text-transform: uppercase;">Contact</p>
            <p style="margin: 0; font-size: 1em; font-weight: 600; color: #222;">${escapeHTML(team.contact || 'Unavailable')}</p>
          </div>
          ${dist !== null ? `<p style="margin: 0 0 15px 0; font-size: 1em; font-weight: 800; color: #d32f2f;">${dist.toFixed(1)} km away</p>` : ''}
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

function sendToTeam(team) {
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
      status.textContent = `Found your location (${userCoords.lat.toFixed(3)}, ${userCoords.lon.toFixed(3)})`;
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
          const navUserControls = document.querySelector('.nav-user-controls');
          const inboxMenu = document.querySelector('.inbox-menu');
          const inboxToggle = document.querySelector('[data-inbox-toggle]');
          const inboxDropdown = document.querySelector('[data-inbox-dropdown]');
          const accountMenu = document.querySelector('.account-menu');
          const accountToggle = document.querySelector('[data-account-toggle]');
          const accountDropdown = document.querySelector('[data-account-dropdown]');
          const initialsEl = document.querySelector('[data-account-initials]');
          const accountLabelEl = document.querySelector('.account-label');
          const inboxCountEls = document.querySelectorAll('[data-inbox-count]');
          const inboxLinks = inboxDropdown ? inboxDropdown.querySelectorAll('a') : [];
          const accountLinks = accountDropdown ? accountDropdown.querySelectorAll('a') : [];
          const applicationUpdate = user && user.applicationUpdate ? user.applicationUpdate : null;
          const applicationUpdatedAt = applicationUpdate && applicationUpdate.updatedAt ? applicationUpdate.updatedAt : 'current';
          const applicationTeamId = applicationUpdate && applicationUpdate.team ? (applicationUpdate.team.id || applicationUpdate.team.name) : 'team';
          const notificationStorageKey = user && applicationUpdate
            ? `inbox_recruitment_${user.id || user.email || 'current'}_${applicationTeamId}_${applicationUpdate.status}_${applicationUpdatedAt}`
            : null;

          function applicationStatusLabel(status) {
            if (status === 'accepted') return 'accepted';
            if (status === 'waitlisted') return 'waitlisted';
            if (status === 'rejected') return 'rejected';
            return 'updated';
          }

          function applicationStatusTitle(status) {
            if (status === 'accepted') return 'Application accepted';
            if (status === 'waitlisted') return 'Application waitlisted';
            if (status === 'rejected') return 'Application rejected';
            return 'Application updated';
          }

          function applicationStatusSummary(update) {
            const teamName = update && update.team && update.team.name ? update.team.name : 'A team';
            const label = applicationStatusLabel(update && update.status);
            return `${teamName} ${label} your recruitment application.`;
          }

          function getUnreadCount() {
            if (!notificationStorageKey) return 0;
            try {
              const stored = sessionStorage.getItem(notificationStorageKey);
              if (stored === null) return 1;
              const parsed = Number(stored);
              return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
            } catch (e) {
              return 1;
            }
          }

          function setUnreadCount(nextCount) {
            const safeCount = Math.max(0, Number(nextCount) || 0);
            inboxCountEls.forEach((el) => {
              el.textContent = el.classList.contains('inbox-dropdown-count')
                ? (safeCount > 0 ? `${safeCount} new` : 'All caught up')
                : String(safeCount);
            });
            if (!notificationStorageKey) return;
            try { sessionStorage.setItem(notificationStorageKey, String(safeCount)); } catch (e) {}
          }

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
            setUnreadCount(getUnreadCount());
            if (inboxLinks[0]) {
              if (applicationUpdate) {
                inboxLinks[0].hidden = false;
                inboxLinks[0].setAttribute('href', '/my-applications?mail=application-status');
                inboxLinks[0].setAttribute('data-href', '/my-applications?mail=application-status');
                inboxLinks[0].innerHTML = `<strong>${escapeHTML(applicationStatusTitle(applicationUpdate.status))}</strong><span>${escapeHTML(applicationStatusSummary(applicationUpdate))}</span>`;
              } else {
                inboxLinks[0].hidden = false;
                inboxLinks[0].setAttribute('href', '/my-applications');
                inboxLinks[0].setAttribute('data-href', '/my-applications');
                inboxLinks[0].innerHTML = '<strong>No recruitment updates</strong><span>Your application inbox is all caught up.</span>';
              }
            }
            if (inboxLinks[1]) {
              inboxLinks[1].hidden = true;
            }
            if (inboxLinks[2]) {
              inboxLinks[2].hidden = true;
            }
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
            inboxToggle.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              const menu = inboxToggle.closest('.inbox-menu');
              const dropdown = menu && menu.querySelector('[data-inbox-dropdown]');
              const expanded = inboxToggle.getAttribute('aria-expanded') === 'true';
              if (dropdown) dropdown.hidden = expanded;
              inboxToggle.setAttribute('aria-expanded', String(!expanded));
              if (menu) menu.classList.toggle('is-open', !expanded);
              if (!expanded && user) setUnreadCount(0);

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
