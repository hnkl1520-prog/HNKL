// VIBRA's sticky hero and rising overview, scoped to this case study.
document.addEventListener('DOMContentLoaded', () => {
  const stage = document.querySelector('.case-hero-stage');
  const hero = stage?.querySelector('.case-hero');
  const cover = stage?.querySelector('.case-overview');
  const inner = stage?.querySelector('.case-overview__inner');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let scheduled = false;
  function updateHero() {
    scheduled = false;
    if (!stage || !cover || !hero || !inner) return;
    if (reduced.matches) {
      stage.classList.remove('is-boosted');
      stage.style.removeProperty('padding-bottom');
      cover.style.removeProperty('transform');
      inner.style.removeProperty('opacity');
      inner.style.removeProperty('transform');
      return;
    }
    const height = hero.offsetHeight;
    const boost = parseFloat(getComputedStyle(stage).getPropertyValue('--hero-boost')) || .35;
    const shift = height * boost;
    const scroll = Math.max(0, window.scrollY - stage.offsetTop);
    const progress = Math.min(scroll / (height - shift), 1);
    const offset = (1 - progress) * shift;
    stage.style.setProperty('--hero-shift', `${shift}px`);
    cover.style.transform = `translate3d(0, ${offset}px, 0)`;
    stage.style.paddingBottom = `${offset}px`;
    stage.classList.add('is-boosted');
    const reveal = Math.min(1, Math.max(0, (height - cover.getBoundingClientRect().top) / (height * .65)));
    inner.style.opacity = String(reveal);
    inner.style.transform = `translate3d(0, ${(1 - reveal) * 50}px, 0)`;
  }
  const queue = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(updateHero); } };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  reduced.addEventListener('change', queue);
  updateHero();
  const diagrams = document.querySelectorAll('.case-ia');
  const resizeDiagram = element => {
    element.style.setProperty('--ia-scale', element.clientWidth / 1024);
    element.style.setProperty('--ia-mobile-scale', element.clientWidth / 720);
  };
  diagrams.forEach(element => {
    resizeDiagram(element);
    new ResizeObserver(() => resizeDiagram(element)).observe(element);
  });

  // Silent media loops run only in view; reduced-motion visitors see still frames.
  document.querySelectorAll('[data-motion-demo]').forEach(demo => {
    const video = demo.querySelector('video');
    let visible = false;
    const sync = () => {
      if (visible && !document.hidden && !reduced.matches) {
        video.play().catch(() => { /* Keep the poster if autoplay is unavailable. */ });
      }
      else video.pause();
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .15;
      sync();
    }, { threshold: .15 });
    observer.observe(demo);
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener('change', sync);
  });
});
