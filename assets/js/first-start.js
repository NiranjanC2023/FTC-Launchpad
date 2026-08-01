document.addEventListener('DOMContentLoaded', function(){
  const carouselRoot = document.querySelector('#fs-carousel-home');
  if (carouselRoot) {
    const track = carouselRoot.querySelector('.splide__list');
    const sourceSlides = Array.from(carouselRoot.querySelectorAll('.splide__list > .splide__slide'));
    const hydrateImage = (image) => {
      if (!image || !image.dataset.carouselSrc) return;
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
      hydrateSlide(sourceSlides[(activeIndex + 1) % sourceSlides.length]);
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

  revealItems.forEach(element => {
    if (element.id === 'fs-carousel-home') {
      element.classList.add('is-visible');
      return;
    }
    observer.observe(element);
  });
});
