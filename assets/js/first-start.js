document.addEventListener('DOMContentLoaded', function(){
  if (typeof Splide !== 'undefined') {
    new Splide('#fs-carousel-home', {
      type: 'loop',
      perPage: 1,
      autoplay: true,
      interval: 5000,
      pauseOnHover: true,
      pauseOnFocus: true,
      pagination: true,
      arrows: true,
      accessibility: true,
      heightRatio: 9/16,
      cover: true,
    }).mount();
  }
});
