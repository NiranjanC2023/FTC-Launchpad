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
    window.location.href = 'teams-nearby.html';
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

  list.innerHTML = '';
  teams.forEach(team => {
    const dist = userCoords ? haversineDistance(userCoords.lat, userCoords.lon, team.lat, team.lon) : null;

    const card = document.createElement('div');
    card.className = 'team-card';
    card.innerHTML = `
      <h3>${team.name}</h3>
      <p>${team.contact}</p>
      ${dist !== null ? `<p><strong>${dist.toFixed(1)} km away</strong></p>` : ''}
      <div class="team-actions">
        <button class="btn btn-primary send-btn">Send My Info</button>
      </div>
    `;

    const btn = card.querySelector('.send-btn');
    btn.addEventListener('click', () => sendToTeam(team));

    list.appendChild(card);
  });
}

function sendToTeam(team) {
  const raw = sessionStorage.getItem(STUDENT_KEY);
  if (!raw) {
    alert('No student info found. Please fill the signup form first.');
    window.location.href = 'join-form.html';
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
    container.innerHTML = `<p>No signup info found. <a href="join-form.html">Fill the form first</a>.</p>`;
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

  const prefix = location.pathname.includes('/pages/') ? '../' : '';

  // load header
  fetch(prefix + 'assets/partial/header.html')
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
        a.setAttribute('href', prefix + target);
      });
      // bind theme toggle after header is in DOM
      bindThemeToggle();
    }).catch(() => {});

  // load footer
  fetch(prefix + 'assets/partial/footer.html')
    .then(r => r.text())
    .then(html => {
      const footerContainer = document.createElement('div');
      footerContainer.innerHTML = html;
      document.body.appendChild(footerContainer);
      const yearEl = document.getElementById('site-year');
      if (yearEl) yearEl.textContent = new Date().getFullYear();
    }).catch(() => {});
}
