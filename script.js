// Theme Toggle functionality
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

// Load theme preference from localStorage
const savedTheme = localStorage.getItem('theme') || 'light';
html.setAttribute('data-theme', savedTheme);

// Toggle theme on button click
themeToggle.addEventListener('click', () => {
  const currentTheme = html.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
});

// Respect user's system preference on first visit
if (!localStorage.getItem('theme')) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = prefersDark ? 'dark' : 'light';
  html.setAttribute('data-theme', initialTheme);
  localStorage.setItem('theme', initialTheme);
}