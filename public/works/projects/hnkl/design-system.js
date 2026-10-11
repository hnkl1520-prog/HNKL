(() => {
  'use strict';
  const section = document.querySelector('.hnkl-ds');
  if (!section) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const graphs = section.querySelectorAll('.hnkl-ds__graph');
  const sizeGraph = graph => graph.style.setProperty('--graph-scale', graph.clientWidth / 456);
  graphs.forEach(sizeGraph);
  const graphObserver = new ResizeObserver(entries => entries.forEach(({ target }) => sizeGraph(target)));
  graphs.forEach(graph => graphObserver.observe(graph));

  section.querySelectorAll('[data-switch-demo]').forEach(demo => {
    const buttons = [...demo.querySelectorAll('[data-demo-mode]')];
    const pill = demo.querySelector('.hnkl-ds__pill');
    const label = demo.querySelector('[data-demo-theme]');
    let active = buttons[0];
    function positionPill(immediate) {
      const values = { left: active.offsetLeft, width: active.offsetWidth };
      if (window.gsap && !immediate && !reduced.matches) {
        window.gsap.to(pill, { ...values, duration: 1, ease: 'elastic.out(1, 0.4)', overwrite: true, onComplete: () => { pill.style.left = `${active.offsetLeft}px`; pill.style.width = `${active.offsetWidth}px`; } });
      } else {
        if (window.gsap) window.gsap.killTweensOf(pill);
        pill.style.left = `${values.left}px`;
        pill.style.width = `${values.width}px`;
      }
    }
    buttons.forEach(button => button.addEventListener('click', () => {
      active = button;
      const labs = button.dataset.demoMode === 'labs';
      demo.classList.toggle('is-labs', labs);
      label.textContent = labs ? 'Dark' : 'Light';
      buttons.forEach(item => {
        const selected = item === button;
        item.classList.toggle('is-active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      positionPill(false);
    }));
    positionPill(true);
    new ResizeObserver(() => positionPill(true)).observe(demo.querySelector('.hnkl-ds__switcher'));
    document.fonts?.ready.then(() => positionPill(true));
  });

})();
