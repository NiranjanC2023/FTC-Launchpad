document.addEventListener('DOMContentLoaded', function(){
  const carouselRoot = document.querySelector('#fs-carousel-home');
  if (carouselRoot) {
    const track = carouselRoot.querySelector('.splide__list');
    const sourceSlides = Array.from(carouselRoot.querySelectorAll('.splide__list > .splide__slide'));
    const hydrateImage = (image) => {
      if (!image || !image.dataset.carouselSrc) return;
      const picture = image.closest('picture');
      if (picture) {
        picture.querySelectorAll('source[data-carousel-srcset]').forEach((source) => {
          source.srcset = source.dataset.carouselSrcset;
          delete source.dataset.carouselSrcset;
        });
      }
      if (image.dataset.carouselSrcset) {
        image.srcset = image.dataset.carouselSrcset;
        delete image.dataset.carouselSrcset;
      }
      image.src = image.dataset.carouselSrc;
      delete image.dataset.carouselSrc;
    };
    const hydrateSlide = (slide) => {
      if (!slide) return;
      hydrateImage(slide.querySelector('img[data-carousel-src]'));
    };
    let activeIndex = 0;
    let autoplayTimer = null;
    const pagination = carouselRoot.querySelector('.home-carousel-pagination');
    const dots = sourceSlides.map((slide, index) => {
      slide.setAttribute('aria-hidden', index === 0 ? 'false' : 'true');
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'home-carousel-dot';
      dot.setAttribute('aria-label', `Show image ${index + 1}`);
      dot.addEventListener('click', () => showSlide(index, true));
      pagination.appendChild(dot);
      return dot;
    });
    const showSlide = (index, userInitiated = false) => {
      if (!sourceSlides.length || !track) return;
      activeIndex = ((index % sourceSlides.length) + sourceSlides.length) % sourceSlides.length;
      hydrateSlide(sourceSlides[activeIndex]);
      track.style.transform = `translate3d(-${activeIndex * 100}%, 0, 0)`;
      sourceSlides.forEach((slide, slideIndex) => slide.setAttribute('aria-hidden', slideIndex === activeIndex ? 'false' : 'true'));
      dots.forEach((dot, dotIndex) => {
        dot.classList.toggle('is-active', dotIndex === activeIndex);
        dot.setAttribute('aria-current', dotIndex === activeIndex ? 'true' : 'false');
      });
      if (userInitiated) restartAutoplay();
    };
    const stopAutoplay = () => {
      if (autoplayTimer) window.clearInterval(autoplayTimer);
      autoplayTimer = null;
    };
    const startAutoplay = () => {
      stopAutoplay();
      if (sourceSlides.length > 1 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        autoplayTimer = window.setInterval(() => showSlide(activeIndex + 1), 5000);
      }
    };
    const restartAutoplay = () => startAutoplay();
    carouselRoot.querySelector('.home-carousel-arrow-prev').addEventListener('click', () => showSlide(activeIndex - 1, true));
    carouselRoot.querySelector('.home-carousel-arrow-next').addEventListener('click', () => showSlide(activeIndex + 1, true));
    carouselRoot.addEventListener('mouseenter', stopAutoplay);
    carouselRoot.addEventListener('mouseleave', startAutoplay);
    carouselRoot.addEventListener('focusin', stopAutoplay);
    carouselRoot.addEventListener('focusout', startAutoplay);
    document.addEventListener('visibilitychange', () => document.hidden ? stopAutoplay() : startAutoplay());
    showSlide(0);
    startAutoplay();
  }

  const recruitingDataElement = document.querySelector('#homeRecruitingTeamsData');
  const recruitingGrid = document.querySelector('#homeFeaturedTeams');
  const proximityStatus = document.querySelector('#homeProximityStatus');
  const homeSearchInput = document.querySelector('.home-search-field input');
  const homeSearchPlaceholder = 'Search by city, state, country, or team name...';
  const homeSearchMobilePlaceholder = 'Search city, state, or team...';
  const applyHomeSearchPlaceholder = () => {
    if (!homeSearchInput) return;
    const mobile = window.matchMedia('(max-width: 640px)').matches;
    homeSearchInput.placeholder = mobile ? homeSearchMobilePlaceholder : homeSearchPlaceholder;
  };
  applyHomeSearchPlaceholder();
  window.addEventListener('resize', applyHomeSearchPlaceholder, { passive: true });
  if (recruitingDataElement && recruitingGrid && proximityStatus) {
    let recruitingTeams = [];
    try {
      recruitingTeams = JSON.parse(recruitingDataElement.textContent || '[]');
    } catch (error) {
      recruitingTeams = [];
    }

    const toRadians = degrees => degrees * Math.PI / 180;
    const distanceFrom = (origin, team) => {
      const teamLat = Number(team && team.lat);
      const teamLon = Number(team && team.lon);
      if (!Number.isFinite(teamLat) || !Number.isFinite(teamLon)) return Number.POSITIVE_INFINITY;
      const latDelta = toRadians(teamLat - origin.lat);
      const lonDelta = toRadians(teamLon - origin.lon);
      const a = Math.sin(latDelta / 2) ** 2
        + Math.cos(toRadians(origin.lat)) * Math.cos(toRadians(teamLat)) * Math.sin(lonDelta / 2) ** 2;
      return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    const makeElement = (tagName, className, textValue) => {
      const element = document.createElement(tagName);
      if (className) element.className = className;
      if (textValue !== undefined && textValue !== null) element.textContent = String(textValue);
      return element;
    };
    const historySummary = entries => {
      const values = Array.isArray(entries) ? entries.filter(Boolean) : [];
      if (!values.length) return '';
      return `${values.slice(0, 2).join(', ')}${values.length > 2 ? ` +${values.length - 2} more` : ''}`;
    };
    const createTeamCard = (team, index) => {
      const palette = ['#0f766e', '#2563eb', '#7c3aed', '#be123c', '#c2410c', '#047857', '#4338ca', '#b45309', '#0e7490', '#a21caf', '#15803d', '#1d4ed8'];
      const accent = palette[index % palette.length];
      const article = makeElement('article', 'team-card');
      article.style.setProperty('--team-accent', accent);
      article.style.setProperty('--team-card-index', index);

      const bar = makeElement('div', 'team-card-bar');
      bar.style.backgroundColor = accent;
      article.appendChild(bar);

      const body = makeElement('div', 'team-card-body');
      const top = makeElement('div', 'team-card-top');
      const brand = makeElement('div', 'team-card-brand');
      const initials = String(team.name || 'Team').split(/\s+/).slice(0, 2).map(word => word.charAt(0)).join('');
      const logo = makeElement('div', 'team-logo-badge', initials);
      logo.style.borderColor = `${accent}33`;
      logo.style.backgroundColor = `${accent}12`;
      logo.style.color = accent;
      const number = makeElement('div', 'team-number', team.teamNumber ? `#${team.teamNumber}` : (team.isNewTeam ? 'New Team' : 'Team'));
      number.style.borderColor = `${accent}33`;
      number.style.backgroundColor = `${accent}15`;
      number.style.color = accent;
      brand.append(logo, number);
      top.append(brand, makeElement('span', 'league-pill', team.league || team.program || 'FTC'));
      body.append(top, makeElement('h3', '', team.name || 'Robotics team'));

      const location = makeElement('p', 'team-location');
      const pin = makeElement('i', 'fa-solid fa-map-pin');
      pin.setAttribute('aria-hidden', 'true');
      location.append(pin, document.createTextNode(` ${team.location || 'Location not listed'}`));
      body.append(location, makeElement('p', 'team-description', team.description || 'View this recruiting team and see what they are looking for in students.'));

      const awards = historySummary(team.awardHistory);
      const advancement = historySummary(team.advancementHistory);
      if (awards || advancement) {
        const history = makeElement('div', 'team-card-history');
        if (awards) history.append(makeElement('p', 'team-card-history-label', 'Awards'), makeElement('p', 'team-card-history-text', awards));
        if (advancement) history.append(makeElement('p', 'team-card-history-label', 'Advancement'), makeElement('p', 'team-card-history-text', advancement));
        body.appendChild(history);
      }

      body.appendChild(makeElement('div', 'team-roles'));
      const link = makeElement('a', 'team-button', 'View Team & Apply');
      link.href = `/teams-nearby?team=${encodeURIComponent(team.name || '')}`;
      body.appendChild(link);
      article.appendChild(body);
      return article;
    };
    const renderNearestTeams = (origin) => {
      const nearest = recruitingTeams
        .map((team, index) => ({ team, index, distance: distanceFrom(origin, team) }))
        .sort((left, right) => left.distance - right.distance || left.index - right.index)
        .slice(0, 3)
        .map(item => item.team);
      if (!nearest.length || !Number.isFinite(distanceFrom(origin, nearest[0]))) {
        proximityStatus.textContent = 'Recruiting teams are shown by their most recent updates because city-level locations are unavailable.';
        return;
      }
      nearest.sort((left, right) => distanceFrom(origin, left) - distanceFrom(origin, right));
      recruitingGrid.replaceChildren(...nearest.map(createTeamCard));
      proximityStatus.textContent = 'Showing the recruiting teams nearest to your current area. Your precise location stays on this device.';
    };

    if (recruitingTeams.length && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => renderNearestTeams({ lat: position.coords.latitude, lon: position.coords.longitude }),
        () => { proximityStatus.textContent = 'Location is unavailable, so recruiting teams are shown by their most recent updates.'; },
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
      );
    } else {
      proximityStatus.textContent = 'Recruiting teams are shown by their most recent updates.';
    }
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealPlan = [
    ['.navbar', 'fs-reveal', 0],
    ['.home-hero-copy', 'fs-reveal', 0],
    ['#fs-carousel-home', 'fs-reveal fs-reveal--scale', 110],
    ['.home-stats .home-stat-card', 'fs-reveal fs-reveal--up', 60, 70],
    ['.home-why-image', 'fs-reveal fs-reveal--left', 0],
    ['.home-why-copy', 'fs-reveal fs-reveal--right', 120],
    ['.home-path-card-students', 'fs-reveal fs-reveal--left', 0],
    ['.home-path-card-teams', 'fs-reveal fs-reveal--right', 120],
    ['.team-card', 'fs-reveal fs-reveal--up', 0, 90],
    ['.testimonial-card', 'fs-reveal fs-reveal--up', 0, 90],
    ['.home-cta-card', 'fs-reveal fs-reveal--scale', 0],
  ];
  const revealItems = [];

  revealPlan.forEach(([selector, classNames, delay, stagger = 0]) => {
    document.querySelectorAll(selector).forEach((element, index) => {
      element.classList.add(...classNames.split(' '));
      element.style.setProperty('--fs-delay', `${delay + index * stagger}ms`);
      revealItems.push(element);
    });
  });

  document.body.classList.add('fs-animations-ready');

  if (reduceMotion) {
    revealItems.forEach(element => element.classList.add('is-visible'));
    const connectStage = document.querySelector('.connect-stage');
    if (connectStage) connectStage.classList.add('is-visible');
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      if (entry.target.classList.contains('connect-center')) {
        const connectStage = entry.target.closest('.connect-stage');
        if (connectStage) connectStage.classList.add('is-visible');
      }
      observer.unobserve(entry.target);
    });
  }, {
    threshold: 0.18,
    rootMargin: '0px 0px -8% 0px'
  });

  revealItems.forEach(element => {
    if (element.id === 'fs-carousel-home') {
      element.classList.add('is-visible');
      return;
    }
    observer.observe(element);
  });
});
