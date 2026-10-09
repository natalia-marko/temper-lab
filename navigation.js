(() => {
  const sidebar = document.getElementById('site-sidebar');
  const main = document.getElementById('main-content');
  const openButton = document.getElementById('nav-open');
  const closeButton = document.getElementById('nav-close');
  const backdrop = document.getElementById('nav-backdrop');
  if (!sidebar || !main || !openButton || !closeButton || !backdrop) return;

  const mobile = window.matchMedia('(max-width: 860px)');
  const storageKey = 'temper-nav-collapsed';
  let collapsed = false;
  try { collapsed = localStorage.getItem(storageKey) === 'true'; } catch (_) {}
  let drawerOpen = false;

  function render() {
    const open = mobile.matches ? drawerOpen : !collapsed;
    document.body.dataset.navigation = open ? 'open' : 'closed';
    document.body.classList.toggle('nav-drawer-open', mobile.matches && open);
    sidebar.inert = !open;
    main.inert = mobile.matches && open;
    openButton.hidden = open;
    closeButton.hidden = !open;
    backdrop.hidden = !mobile.matches || !open;
    openButton.setAttribute('aria-expanded', String(open));
    closeButton.setAttribute('aria-expanded', String(open));
    window.dispatchEvent(new Event('resize'));
  }

  function setOpen(open) {
    if (mobile.matches) drawerOpen = open;
    else {
      collapsed = !open;
      try { localStorage.setItem(storageKey, String(collapsed)); } catch (_) {}
    }
    render();
    (open ? closeButton : openButton).focus();
  }

  document.body.classList.add('nav-ready');
  render();
  openButton.addEventListener('click', () => setOpen(true));
  closeButton.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.dataset.navigation === 'open'
        && (mobile.matches || sidebar.contains(document.activeElement))) {
      event.preventDefault();
      setOpen(false);
    }
    if (event.key !== 'Tab' || !mobile.matches || !drawerOpen) return;
    const controls = [...sidebar.querySelectorAll('a[href], button:not([hidden])')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
  mobile.addEventListener('change', () => {
    const focusWasInSidebar = sidebar.contains(document.activeElement);
    drawerOpen = false;
    render();
    if (focusWasInSidebar && sidebar.inert) openButton.focus();
  });
})();
