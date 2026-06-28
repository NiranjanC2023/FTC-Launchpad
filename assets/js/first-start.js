document.addEventListener('DOMContentLoaded', function(){
  if (typeof Splide !== 'undefined') {
    new Splide('#fs-carousel-home', {
      type: 'loop',
      perPage: 1,
      autoplay: true,
      interval: 3000,
      speed: 700,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      pauseOnHover: true,
      pauseOnFocus: true,
      pagination: true,
      arrows: true,
      accessibility: true,
      cover: true,
    }).mount();
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
    ['.home-footer', 'fs-reveal', 0],
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

  revealItems.forEach(element => observer.observe(element));
});
