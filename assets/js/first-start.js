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
      heightRatio: 9/16,
      cover: true,
    }).mount();
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealPlan = [
    ['.first-start-header', 'fs-reveal', 0],
    ['#fs-carousel-home', 'fs-reveal fs-reveal--scale', 110],
    ['.why-join h3', 'fs-reveal fs-reveal--right', 180],
    ['.why-join .lead', 'fs-reveal fs-reveal--right', 250],
    ['.why-join li', 'fs-reveal fs-reveal--right', 320, 70],
    ['.connect-graphic h3', 'fs-reveal', 0],
    ['.connect-subtitle', 'fs-reveal', 90],
    ['.connect-card-join', 'fs-reveal fs-reveal--left', 140],
    ['.connect-center', 'fs-reveal fs-reveal--scale', 220],
    ['.connect-card-register', 'fs-reveal fs-reveal--right', 300],
    ['.site-footer', 'fs-reveal', 0],
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
