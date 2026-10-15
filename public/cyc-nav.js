/* ═══════════════════════════════════════════════════════════════════════════
   Menú lateral común de la suite CyC
   Archivo canónico. Se copia idéntico a cyc-hub, cyc-ops, cyc-tasks y
   cyc-inspecciones, igual que cyc-tokens.css. Si hay que agregar una sección,
   se agrega en MENU, acá, y se copia a las cuatro apps.

   Cada app lo carga con:
     <script src="/cyc-nav.js" data-app="hub"></script>     (hub | ops | tasks | insp)
   justo después de cyc-tokens.css. Sin defer: así el espacio del menú queda
   reservado antes de que la página se pinte y nada salta.

   Mientras está activo, <html> lleva la clase «cyc-nav-on». Cada app la usa
   para esconder su propio menú interno y el botón «Volver al Hub».
   Lo que la página tenga fijo contra el borde izquierdo (position: fixed;
   left: 0) se corre con left: var(--cyc-nav-offset, 0), que vale 0 en móvil.

   Las secciones internas de una app se abren por hash (#calendario, #kanban…).
   La app escucha «hashchange» y, cuando cambia de sección por su cuenta,
   actualiza el hash con history.replaceState: el menú se entera solo.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.CycNav) return;
  // Una app embebida en otra (Inspecciones dentro de Operaciones) no repite el menú
  if (window.self !== window.top) return;

  const APPS = {
    hub:   'https://cyc-hub-production.up.railway.app',
    ops:   'https://cyc-ops-production.up.railway.app',
    tasks: 'https://cyc-tasks-production.up.railway.app',
    insp:  'https://cyc-inspecciones-production.up.railway.app',
  };

  const MENU = [
    { label: 'Inicio', icon: 'home', app: 'hub', path: '/' },
    { section: 'Áreas' },
    { label: 'Área Comercial', icon: 'brief', children: [
      { label: 'Cotizador',         app: 'hub', path: '/cotizador' },
      { label: 'Envío de Flota',    app: 'hub', path: '/flota' },
      { label: 'Pipeline CRM',      app: 'hub', path: '/informe/index.html#crm' },
      { label: 'Informe Comercial', children: [
        { label: 'Estado de arriendo',  app: 'hub', path: '/informe/index.html#flota' },
        { label: 'Gestión de contratos', app: 'hub', path: '/informe/index.html#arriendo' },
        { label: 'Daños y mermas',      app: 'hub', path: '/informe/index.html#danos' },
        { label: 'Facturación',         app: 'hub', path: '/informe/index.html#facturacion' },
        { label: 'Alertas',             app: 'hub', path: '/informe/index.html#alertas' },
      ] },
      { label: 'Marketing Digital', app: 'hub', path: '/marketing/index.html' },
      { label: 'Cobranza',          app: 'hub', path: '/cobranza' },
    ] },
    { label: 'Operaciones', icon: 'wrench', children: [
      { label: 'Calendario de flota',     app: 'ops', path: '/#calendario' },
      { label: 'Dashboard de operación',  app: 'ops', path: '/#dashboard' },
      { label: 'Inspección de equipos',   app: 'ops', path: '/#inspecciones' },
      { label: 'Calendario de mecánicos', app: 'ops', path: '/#mecanicos' },
      { label: 'Mantenciones',            app: 'ops', path: '/#mantenciones' },
      { label: 'Gestión de recursos',     app: 'ops', path: '/#equipos' },
    ] },
    { label: 'Inspecciones', icon: 'clip', children: [
      { label: 'Inicio',           app: 'insp', path: '/' },
      { label: 'Órdenes',          app: 'insp', path: '/ordenes' },
      { label: 'Nueva orden',      app: 'insp', path: '/ordenes/nueva' },
      { label: 'Importar equipos', app: 'insp', path: '/equipos/importar' },
    ] },
    { label: 'Resultados y Finanzas', icon: 'chart', children: [
      { label: 'Resumen',          app: 'hub', path: '/finanzas/' },
      { label: 'Ingresos',         app: 'hub', path: '/finanzas/ingresos' },
      { label: 'Costos',           app: 'hub', path: '/finanzas/costos' },
      { label: 'Resultados',       app: 'hub', path: '/finanzas/resultados' },
      { label: 'Datos y planillas', app: 'hub', path: '/finanzas/datos' },
      { label: 'Instructivo',      app: 'hub', path: '/finanzas/instructivo' },
    ] },
    { label: 'Gestión de Tareas', icon: 'check', children: [
      { label: 'Kanban',        app: 'tasks', path: '/#kanban' },
      { label: 'Tabla',         app: 'tasks', path: '/#table' },
      { label: 'Calendario',    app: 'tasks', path: '/#calendar' },
      { label: 'Gantt',         app: 'tasks', path: '/#gantt' },
      { label: 'Configuración', app: 'tasks', path: '/#config' },
    ] },
  ];

  const ICONS = {
    home:   '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    brief:  '<rect x="2" y="7" width="20" height="14" rx="2.5"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    clip:   '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    chart:  '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
    check:  '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    chev:   '<path d="m9 6 6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    panel:  '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 10l-2 2 2 2"/>',
    menu:   '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close:  '<path d="M18 6 6 18M6 6l12 12"/>',
  };
  const svg = (name, cls) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  const CSS = `
:root{--cyc-nav-w:264px}
html.cyc-nav-rail{--cyc-nav-w:64px}
html.cyc-nav-on{--cyc-nav-offset:var(--cyc-nav-w)}
html.cyc-nav-on body{margin-left:var(--cyc-nav-offset);transition:margin-left 150ms cubic-bezier(.32,.72,0,1)}
html.cyc-nav-on .btn-volver-hub{display:none!important}

/* Fondo gris claro para que el menú se distinga de la página (#F5F6F8).
   Sobre él, el gris de texto de la suite (#64748B) queda en 4,0:1; por eso
   el menú usa su propio gris apagado, #5B6573 (5,0:1). */
#cyc-nav{--cn-bg:#E9ECF0;--cn-muted:#5B6573;--cn-hover:rgba(26,29,35,.06);--cn-line:#D8DDE3;
  position:fixed;top:0;left:0;bottom:0;width:var(--cyc-nav-w);z-index:50;display:flex;flex-direction:column;
  background:var(--cn-bg);border-right:1px solid var(--cn-line);overflow:hidden;
  font-family:'Barlow',var(--font-barlow),-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;line-height:1.3;
  color:var(--cyc-text-2,#4A535F);text-align:left;transition:width 150ms cubic-bezier(.32,.72,0,1)}
#cyc-nav *,#cyc-nav *::before,#cyc-nav *::after{box-sizing:border-box;margin:0;padding:0}
#cyc-nav a{text-decoration:none;color:inherit}
#cyc-nav button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
#cyc-nav svg{stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;fill:none;flex-shrink:0}
#cyc-nav .cn-ico{width:18px;height:18px}
#cyc-nav .cn-chev{width:15px;height:15px;margin-left:auto;color:var(--cn-muted);transition:transform 150ms}
#cyc-nav details[open]>summary .cn-chev{transform:rotate(90deg)}

#cyc-nav .cn-head{display:flex;align-items:center;gap:10px;padding:16px 14px 12px 16px;min-height:64px}
#cyc-nav .cn-logo{width:40px;height:24px;flex-shrink:0;background:var(--cyc-brand,#EF7834);
  -webkit-mask:url(/isotipo-cyc-simple.svg) center/contain no-repeat;mask:url(/isotipo-cyc-simple.svg) center/contain no-repeat}
#cyc-nav .cn-brand{line-height:1.15;white-space:nowrap}
#cyc-nav .cn-brand b{display:block;font-size:15px;font-weight:800;color:var(--cyc-text,#1A1D23);letter-spacing:-.2px}
#cyc-nav .cn-brand span{font-size:12px;color:var(--cn-muted)}
#cyc-nav .cn-icon-btn{margin-left:auto;width:30px;height:30px;border-radius:8px;display:grid;place-items:center;color:var(--cn-muted)}
#cyc-nav .cn-icon-btn:hover{background:var(--cn-hover);color:var(--cyc-text,#1A1D23)}
#cyc-nav .cn-icon-btn svg{width:18px;height:18px}
#cyc-nav .cn-close{display:none}

#cyc-nav .cn-search{position:relative;margin:0 12px 8px}
#cyc-nav .cn-search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:15px;height:15px;color:var(--cn-muted)}
#cyc-nav .cn-search input{width:100%;font:inherit;font-size:13px;padding:8px 48px 8px 33px;border:1px solid var(--cn-line);
  border-radius:var(--cyc-r-field,8px);background:#fff;color:var(--cyc-text,#1A1D23);outline:none}
#cyc-nav .cn-search input:focus{border-color:var(--cyc-brand-line,#F9C6A9);background:#fff}
#cyc-nav .cn-search input::placeholder{color:var(--cn-muted)}
#cyc-nav .cn-search kbd{position:absolute;right:8px;top:50%;transform:translateY(-50%);font-family:inherit;font-size:11px;font-weight:600;color:var(--cn-muted);
  border:1px solid var(--cn-line);border-radius:5px;padding:1px 6px;background:#fff}

#cyc-nav .cn-nav{flex:1;overflow-y:auto;overflow-x:hidden;padding:4px 10px 16px}
#cyc-nav .cn-label{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--cn-muted);padding:14px 10px 6px;white-space:nowrap}
#cyc-nav .cn-sep{display:none;height:1px;background:var(--cn-line);margin:8px 6px}

#cyc-nav .cn-top,#cyc-nav .cn-group>summary{display:flex;align-items:center;gap:11px;padding:8px 10px;border-radius:9px;font-weight:600;font-size:14px;
  color:var(--cyc-text-2,#4A535F);cursor:pointer;position:relative;white-space:nowrap;list-style:none;user-select:none;
  transition:background 150ms,color 150ms}
#cyc-nav summary::-webkit-details-marker{display:none}
#cyc-nav .cn-top:hover,#cyc-nav .cn-group>summary:hover{background:var(--cn-hover);color:var(--cyc-text,#1A1D23)}
#cyc-nav .cn-group.cn-has-active>summary{color:var(--cyc-text,#1A1D23)}
#cyc-nav .cn-group.cn-has-active>summary .cn-ico{color:var(--cyc-brand-ink,#AC4A11)}

#cyc-nav .cn-sub{margin:2px 0 6px 20px;padding-left:12px;border-left:1px solid var(--cn-line)}
#cyc-nav .cn-sub .cn-sub{margin:0 0 4px 8px}
#cyc-nav .cn-sub a,#cyc-nav .cn-sub summary{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;font-size:13.5px;font-weight:500;
  color:var(--cyc-text-2,#4A535F);position:relative;white-space:nowrap;cursor:pointer;list-style:none}
#cyc-nav .cn-sub .cn-sub a{font-size:13px;color:var(--cn-muted)}
#cyc-nav .cn-sub a:hover,#cyc-nav .cn-sub summary:hover{background:var(--cn-hover);color:var(--cyc-text,#1A1D23)}

#cyc-nav .cn-active{background:var(--cyc-brand-soft,#FEF2EB)!important;color:var(--cyc-brand-ink,#AC4A11)!important;font-weight:600!important}
#cyc-nav .cn-active::before{content:'';position:absolute;left:-13px;top:6px;bottom:6px;width:3px;border-radius:3px;background:var(--cyc-brand,#EF7834)}
#cyc-nav .cn-top.cn-active::before{left:-10px}
#cyc-nav .cn-empty{padding:12px 10px;font-size:13px;color:var(--cn-muted)}

#cyc-nav .cn-foot{border-top:1px solid var(--cn-line);padding:10px 12px;display:flex;align-items:center;gap:8px;font-size:12px;color:var(--cn-muted);white-space:nowrap}

/* Riel: solo íconos */
html.cyc-nav-rail #cyc-nav .cn-brand,html.cyc-nav-rail #cyc-nav .cn-search,html.cyc-nav-rail #cyc-nav .cn-label,
html.cyc-nav-rail #cyc-nav .cn-sub,html.cyc-nav-rail #cyc-nav .cn-chev,html.cyc-nav-rail #cyc-nav .cn-txt,html.cyc-nav-rail #cyc-nav .cn-foot-txt{display:none}
html.cyc-nav-rail #cyc-nav .cn-head{flex-direction:column;justify-content:center;padding:16px 0 10px;gap:8px}
html.cyc-nav-rail #cyc-nav .cn-icon-btn{margin:0}
html.cyc-nav-rail #cyc-nav .cn-collapse svg{transform:scaleX(-1)}
html.cyc-nav-rail #cyc-nav .cn-top,html.cyc-nav-rail #cyc-nav .cn-group>summary{justify-content:center;padding:10px 0}
html.cyc-nav-rail #cyc-nav .cn-group.cn-has-active>summary{background:var(--cyc-brand-soft,#FEF2EB)}
html.cyc-nav-rail #cyc-nav .cn-top.cn-active::before{display:none}
html.cyc-nav-rail #cyc-nav .cn-sep{display:block}
html.cyc-nav-rail #cyc-nav .cn-foot{justify-content:center}

/* Botón flotante y cajón en pantallas angostas */
#cyc-nav-fab{display:none}
#cyc-nav-scrim{display:none}
@media (max-width:900px){
  html.cyc-nav-on{--cyc-nav-offset:0px}
  #cyc-nav{width:min(300px,86vw);z-index:1000;transform:translateX(-100%);transition:transform 150ms cubic-bezier(.32,.72,0,1);box-shadow:0 24px 48px -20px rgba(26,29,35,.35)}
  html.cyc-nav-open #cyc-nav{transform:none}
  #cyc-nav .cn-collapse{display:none}
  #cyc-nav .cn-close{display:grid}
  html.cyc-nav-rail #cyc-nav .cn-brand,html.cyc-nav-rail #cyc-nav .cn-search,html.cyc-nav-rail #cyc-nav .cn-label,
  html.cyc-nav-rail #cyc-nav .cn-sub,html.cyc-nav-rail #cyc-nav .cn-chev,html.cyc-nav-rail #cyc-nav .cn-txt,html.cyc-nav-rail #cyc-nav .cn-foot-txt{display:revert}
  html.cyc-nav-rail #cyc-nav .cn-head{flex-direction:row;padding:16px 14px 12px 16px}
  html.cyc-nav-rail #cyc-nav .cn-top,html.cyc-nav-rail #cyc-nav .cn-group>summary{justify-content:flex-start;padding:8px 10px}
  html.cyc-nav-rail #cyc-nav .cn-sep{display:none}
  html.cyc-nav-open #cyc-nav-scrim{display:block;position:fixed;inset:0;background:rgba(26,29,35,.35);z-index:999}
  #cyc-nav-fab{display:grid;place-items:center;position:fixed;left:16px;bottom:var(--cyc-nav-fab-bottom,16px);z-index:998;width:48px;height:48px;border-radius:999px;border:0;cursor:pointer;
    background:var(--cyc-brand,#EF7834);color:#fff;box-shadow:0 8px 20px -6px rgba(239,120,52,.6)}
  #cyc-nav-fab svg{width:22px;height:22px;stroke:currentColor;stroke-width:2;stroke-linecap:round;fill:none}
  html.cyc-nav-open #cyc-nav-fab{display:none}
}
@media print{#cyc-nav,#cyc-nav-fab,#cyc-nav-scrim{display:none!important}html.cyc-nav-on body{margin-left:0!important}}
@media (prefers-reduced-motion:reduce){#cyc-nav,html.cyc-nav-on body{transition:none!important}}
`;

  const script = document.currentScript;
  const CURRENT = (script && script.dataset.app) || detectApp();
  function detectApp() {
    const h = location.hostname;
    if (h.includes('inspecciones')) return 'insp';
    if (h.includes('cyc-ops')) return 'ops';
    if (h.includes('cyc-tasks')) return 'tasks';
    return 'hub';
  }

  const store = {
    get(k) { try { return localStorage.getItem('cycnav.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('cycnav.' + k, v); } catch (e) { /* sin almacenamiento */ } },
  };

  // ── Lo que se puede hacer antes de que exista el <body> ──────────────────
  const root = document.documentElement;
  const style = document.createElement('style');
  style.id = 'cyc-nav-style';
  style.textContent = CSS;
  document.head.appendChild(style);
  root.classList.add('cyc-nav-on');
  if (store.get('rail') === '1') root.classList.add('cyc-nav-rail');

  // ── Utilidades de rutas ───────────────────────────────────────────────────
  const norm = p => (p.replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/+$/, '') || '/');
  function split(path) {
    const i = path.indexOf('#');
    return i < 0 ? { path: norm(path), hash: '' } : { path: norm(path.slice(0, i) || '/'), hash: path.slice(i) };
  }
  const href = item => (item.app === CURRENT ? item.path : APPS[item.app] + item.path);

  let uid = 0;
  const leaves = [];
  function renderItems(items, depth) {
    return items.map(it => {
      if (it.section) return `<div class="cn-label">${it.section}</div><div class="cn-sep"></div>`;
      if (it.children) {
        const id = 'g' + (uid++);
        const sum = depth === 0
          ? `<summary title="${it.label}">${svg(it.icon, 'cn-ico')}<span class="cn-txt">${it.label}</span>${svg('chev', 'cn-chev')}</summary>`
          : `<summary>${it.label}${svg('chev', 'cn-chev')}</summary>`;
        return `<details class="${depth === 0 ? 'cn-group' : ''}" data-id="${id}">${sum}<div class="cn-sub">${renderItems(it.children, depth + 1)}</div></details>`;
      }
      const n = leaves.push(it) - 1;
      return depth === 0
        ? `<a class="cn-top" href="${href(it)}" data-leaf="${n}" title="${it.label}">${svg(it.icon, 'cn-ico')}<span class="cn-txt">${it.label}</span></a>`
        : `<a href="${href(it)}" data-leaf="${n}">${it.label}</a>`;
    }).join('');
  }

  let aside, nav;
  function build() {
    aside = document.createElement('aside');
    aside.id = 'cyc-nav';
    aside.setAttribute('aria-label', 'Menú de la suite CyC');
    aside.innerHTML = `
      <div class="cn-head">
        <span class="cn-logo" aria-hidden="true"></span>
        <div class="cn-brand"><b>CYC Hub</b><span>Transportes CyC</span></div>
        <button class="cn-icon-btn cn-collapse" type="button" title="Contraer menú">${svg('panel')}</button>
        <button class="cn-icon-btn cn-close" type="button" title="Cerrar menú">${svg('close')}</button>
      </div>
      <div class="cn-search">${svg('search')}<input type="search" placeholder="Buscar sección…" aria-label="Buscar sección"><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd></div>
      <nav class="cn-nav">${renderItems(MENU, 0)}<div class="cn-empty" hidden>Sin resultados</div></nav>
      <div class="cn-foot"><span class="cn-foot-txt">Transportes CyC Limitada</span></div>`;
    nav = aside.querySelector('.cn-nav');

    const fab = document.createElement('button');
    fab.id = 'cyc-nav-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Abrir menú');
    fab.innerHTML = svg('menu');
    const scrim = document.createElement('div');
    scrim.id = 'cyc-nav-scrim';

    document.body.prepend(scrim);
    document.body.prepend(fab);
    document.body.prepend(aside);

    fab.addEventListener('click', () => root.classList.add('cyc-nav-open'));
    scrim.addEventListener('click', close);
    aside.querySelector('.cn-close').addEventListener('click', close);
    aside.querySelector('.cn-collapse').addEventListener('click', () => setRail(!root.classList.contains('cyc-nav-rail')));

    // Recordar qué áreas quedaron abiertas
    const abiertas = new Set((store.get('open') || '').split(',').filter(Boolean));
    nav.querySelectorAll('details').forEach(d => {
      if (abiertas.has(d.dataset.id)) d.open = true;
      d.addEventListener('toggle', () => {
        if (searching) return;
        const ids = [...nav.querySelectorAll('details[open]')].map(x => x.dataset.id);
        store.set('open', ids.join(','));
      });
    });

    // En el riel, tocar un área despliega el menú completo
    nav.querySelectorAll('.cn-group>summary').forEach(s => s.addEventListener('click', e => {
      if (root.classList.contains('cyc-nav-rail') && matchMedia('(min-width:901px)').matches) {
        e.preventDefault();
        setRail(false);
        s.parentElement.open = true;
      }
    }));

    // Un enlace a la misma página solo con otro hash no recarga: cerrar el cajón
    nav.addEventListener('click', e => { if (e.target.closest('a')) close(); });

    const input = aside.querySelector('input');
    input.addEventListener('input', () => filter(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { input.value = ''; filter(''); input.blur(); }
      if (e.key === 'Enter') {
        const first = [...nav.querySelectorAll('a[data-leaf]')].find(a => a.style.display !== 'none');
        if (first) first.click();
      }
    });
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setRail(false);
        root.classList.add('cyc-nav-open');
        input.focus();
        input.select();
      }
      if (e.key === 'Escape') close();
    });

    refresh();
  }

  function close() { root.classList.remove('cyc-nav-open'); }
  function setRail(on) {
    root.classList.toggle('cyc-nav-rail', on);
    store.set('rail', on ? '1' : '0');
    // Gráficos y grillas que miden su contenedor necesitan enterarse
    setTimeout(() => window.dispatchEvent(new Event('resize')), 180);
  }

  let searching = false;
  let openBeforeSearch = null;
  function filter(q) {
    q = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const all = [...nav.querySelectorAll('details')];
    if (q && !searching) { searching = true; openBeforeSearch = all.map(d => d.open); }
    let hits = 0;
    nav.querySelectorAll('a[data-leaf]').forEach(a => {
      const trail = [a.textContent, ...parentsOf(a).map(d => d.querySelector(':scope>summary').textContent)].join(' ')
        .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const ok = !q || trail.includes(q);
      a.style.display = ok ? '' : 'none';
      if (ok) hits++;
    });
    all.slice().reverse().forEach(d => {
      const visible = [...d.querySelectorAll('a[data-leaf]')].some(a => a.style.display !== 'none');
      d.style.display = !q || visible ? '' : 'none';
      if (q) d.open = visible;
    });
    nav.querySelectorAll('.cn-label').forEach(l => { l.style.display = q ? 'none' : ''; });
    nav.querySelector('.cn-empty').hidden = !q || hits > 0;
    if (!q && searching) {
      searching = false;
      all.forEach((d, i) => { d.open = openBeforeSearch[i]; });
      refresh();
    }
  }

  function parentsOf(el) {
    const out = [];
    for (let d = el.parentElement.closest('details'); d; d = d.parentElement.closest('details')) out.push(d);
    return out;
  }

  // Marca la sección actual: ruta + hash exactos, o la ruta sola si esa entrada
  // del menú no lleva hash. Si la página no está en el menú (el detalle de una
  // orden, por ejemplo), al menos abre el área que la contiene.
  function refresh() {
    if (!nav) return;
    const cur = { path: norm(location.pathname), hash: location.hash };
    const mine = leaves.map((it, i) => ({ i, ...split(it.path), it })).filter(x => x.it.app === CURRENT);
    let hit = mine.find(x => x.path === cur.path && x.hash === cur.hash)
           || mine.find(x => x.path === cur.path && !x.hash);
    let prefix = null;
    if (!hit) {
      prefix = mine.filter(x => x.path !== '/' && (cur.path + '/').startsWith(x.path + '/'))
                   .sort((a, b) => b.path.length - a.path.length)[0];
    }

    nav.querySelectorAll('.cn-active').forEach(e => e.classList.remove('cn-active'));
    nav.querySelectorAll('.cn-has-active').forEach(e => e.classList.remove('cn-has-active'));
    const target = hit || prefix;
    if (!target) return;
    const a = nav.querySelector(`a[data-leaf="${target.i}"]`);
    if (hit) { a.classList.add('cn-active'); a.setAttribute('aria-current', 'page'); }
    parentsOf(a).forEach(d => {
      d.open = true;
      if (d.classList.contains('cn-group')) d.classList.add('cn-has-active');
    });
    if (hit && !searching) a.scrollIntoView({ block: 'nearest' });
  }

  // Next.js y los cambios de pestaña internos usan pushState/replaceState
  ['pushState', 'replaceState'].forEach(fn => {
    const orig = history[fn];
    history[fn] = function () {
      const r = orig.apply(this, arguments);
      setTimeout(refresh, 0);
      return r;
    };
  });
  window.addEventListener('hashchange', refresh);
  window.addEventListener('popstate', refresh);

  window.CycNav = { refresh, setRail, open: () => root.classList.add('cyc-nav-open'), close };

  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
