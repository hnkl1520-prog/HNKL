/* Shared behavior for standalone construction and not-found pages. */
(() => {
  document.querySelectorAll('.back-btn').forEach(button => {
    button.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (history.length > 1) {
        event.preventDefault();
        history.back();
      }
    });
  });
})();
