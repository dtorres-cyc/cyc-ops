/* Minutas de operaciones: pantalla del panel #panel-minutas.
   Tres vistas: Estado actual (lo que Cris proyecta y Diego revisa), Nueva
   minuta (pensada para llenarse en el celular) e Historial.
   Usa escHtml() y toast() de index.html. El servidor está en /minutas.js. */
const Minutas = (() => {
  const TIPO = { diaria: 'Diaria', lunes: 'Lunes', presentacion: 'Presentación' };
  // Para frases: «la minuta de presentación del miércoles 25»
  const MINUTA = { diaria: 'minuta diaria', lunes: 'minuta de los lunes', presentacion: 'minuta de presentación' };
  // Quiénes se proponen como asistentes según el tipo de reunión
  const ASISTEN = { diaria: ['Cris', 'Héctor'], lunes: ['Diego', 'Cris', 'Héctor'], presentacion: ['Diego', 'Cris'] };
  const X = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  let ctx = null;          // hoy, tipos, estados de repuesto, asistentes (lo entrega el servidor)
  let equipos = [];        // flota, para el selector de equipo
  let vista = 'estado';
  let f = null;            // minuta que se está escribiendo

  const $ = id => document.getElementById(id);
  const api = async (url, opciones) => {
    const r = await fetch(url, opciones);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se pudo completar la acción');
    return j;
  };
  const enviar = (metodo, url, cuerpo) => api(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

  // «2026-11-24» → «martes 24 de noviembre»
  function fechaLarga(fecha) {
    return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  // «2026-11-24» → «24 nov»
  function fechaCorta(fecha) {
    return fecha ? new Date(`${fecha}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }).replace('.', '') : '';
  }
  const nombreEquipo = e => [e.tipo || e.equipo_tipo, e.marca || e.equipo_marca, e.modelo || e.equipo_modelo].filter(Boolean).join(' ');
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  // ─── Entrada ───────────────────────────────────────────────────────────────
  async function abrir() {
    try {
      if (!ctx) ctx = await api('/api/minutas/contexto');
      equipos = await api('/api/equipos');
    } catch (e) { toast(e.message, 'error'); return; }
    ver(vista);
  }

  function ver(cual) {
    vista = cual;
    document.querySelectorAll('.mn-tabs button').forEach(b => b.classList.toggle('active', b.dataset.mn === cual));
    $('mnEstado').hidden = cual !== 'estado';
    $('mnForm').hidden = cual !== 'nueva';
    $('mnHistorial').hidden = cual !== 'historial';
    if (cual === 'estado') cargarEstado();
    else if (cual === 'nueva') { if (!f) nuevaMinuta(ctx.hoy, ctx.tipo_sugerido); else pintarFormulario(); }
    else cargarHistorial();
  }

  // ─── Estado actual ─────────────────────────────────────────────────────────
  function filaAcuerdo(a, conOrigen) {
    return `<div class="mn-fila ${a.cumplido ? 'cumplido' : ''}">
      <input type="checkbox" class="mn-check" ${a.cumplido ? 'checked' : ''} onchange="Minutas.cumplir(${a.id}, this.checked)" aria-label="Marcar como cumplido">
      <div class="mn-fila-cuerpo">
        <div class="mn-fila-titulo">${escHtml(a.texto)}</div>
        <div class="mn-fila-sub">${escHtml(a.responsable)}${conOrigen ? ` · acordado el ${fechaCorta(a.minuta_fecha)}` : ''}</div>
      </div>
      <div class="mn-fila-lado">
        <span class="mn-pill ${a.vencido ? 'rojo' : ''}">${a.vencido ? 'Vencido · ' : ''}${fechaCorta(a.fecha)}</span>
      </div>
    </div>`;
  }

  function filaDetenido(d) {
    const dias = d.dias_detenido;
    const atrasado = d.estimado_operativo && ctx && d.estimado_operativo < ctx.hoy;
    return `<div class="mn-fila">
      <div class="mn-fila-cuerpo">
        <div class="mn-fila-titulo">${escHtml(d.equipo_id)} <span style="font-weight:500;color:var(--text-secondary)">${escHtml(nombreEquipo(d))}</span></div>
        <div class="mn-fila-sub">${escHtml(d.causa)}</div>
      </div>
      <div class="mn-fila-lado">
        <span class="mn-pill ${dias > 7 ? 'rojo' : dias > 2 ? 'ambar' : ''}">${plural(dias, 'día detenido', 'días detenido')}</span>
        <span>${d.estimado_operativo ? `${atrasado ? 'Debía volver' : 'Vuelve'} el ${fechaCorta(d.estimado_operativo)}` : 'Sin fecha de vuelta'}</span>
      </div>
    </div>`;
  }

  function filaRepuesto(r) {
    const color = { 'por pedir': 'rojo', pedido: 'ambar', 'en tránsito': 'ambar', recibido: 'verde' }[r.estado] || '';
    return `<div class="mn-fila">
      <div class="mn-fila-cuerpo">
        <div class="mn-fila-titulo">${escHtml(r.repuesto)}</div>
        <div class="mn-fila-sub">${r.equipo_id ? `Para ${escHtml(r.equipo_id)}` : 'Sin equipo asociado'}</div>
      </div>
      <div class="mn-fila-lado">
        <span class="mn-pill ${color}">${escHtml(r.estado)}</span>
        <span>${r.fecha_estimada ? `${r.atrasado ? 'Se esperaba' : 'Llega'} el ${fechaCorta(r.fecha_estimada)}` : ''}</span>
      </div>
    </div>`;
  }

  async function cargarEstado() {
    let d;
    try { d = await api('/api/minutas/estado'); } catch (e) { toast(e.message, 'error'); return; }
    const vencidos = d.acuerdos.filter(a => a.vencido).length;
    const u = d.ultima;
    $('mnEstado').innerHTML = `
      ${d.falta_hoy ? `<div class="mn-aviso"><span>Hoy todavía no hay minuta.</span><button class="btn btn-primary btn-sm" onclick="Minutas.ver('nueva')">Escribir la de hoy</button></div>` : ''}
      ${u ? `<p class="mn-nota" style="margin-bottom:14px">Según la <strong>${MINUTA[u.tipo]}</strong> del <strong>${fechaLarga(u.fecha)}</strong>, registrada por ${escHtml(u.autor || '—')}.</p>`
          : '<p class="mn-nota" style="margin-bottom:14px">Todavía no hay minutas. La primera se escribe en «Nueva minuta».</p>'}
      <div class="mn-kpis">
        <div class="mn-kpi ${d.detenidos.length ? 'alerta' : ''}"><b>${d.detenidos.length}</b><small>Equipos detenidos</small></div>
        <div class="mn-kpi"><b>${d.repuestos.length}</b><small>Repuestos pendientes</small></div>
        <div class="mn-kpi"><b>${d.acuerdos.length}</b><small>Acuerdos abiertos</small></div>
        <div class="mn-kpi ${vencidos ? 'alerta' : ''}"><b>${vencidos}</b><small>Acuerdos vencidos</small></div>
      </div>
      <div class="mn-card"><h3>Equipos detenidos <span class="mn-count">${d.detenidos.length}</span></h3>
        ${d.detenidos.map(filaDetenido).join('') || '<div class="mn-vacio">Ningún equipo detenido en la última minuta.</div>'}</div>
      <div class="mn-card"><h3>Repuestos pendientes <span class="mn-count">${d.repuestos.length}</span></h3>
        ${d.repuestos.map(filaRepuesto).join('') || '<div class="mn-vacio">Sin repuestos pendientes.</div>'}</div>
      <div class="mn-card"><h3>Acuerdos abiertos <span class="mn-count">${d.acuerdos.length}</span></h3>
        ${d.acuerdos.map(a => filaAcuerdo(a, true)).join('') || '<div class="mn-vacio">No hay acuerdos pendientes.</div>'}</div>
      ${u && (u.trabajos_del_dia || u.novedades) ? `<div class="mn-card">
        ${u.trabajos_del_dia ? `<h3>Trabajos del día</h3><div class="mn-texto" style="margin-bottom:14px">${escHtml(u.trabajos_del_dia)}</div>` : ''}
        ${u.novedades ? `<h3>Novedades</h3><div class="mn-texto">${escHtml(u.novedades)}</div>` : ''}
      </div>` : ''}`;
  }

  async function cumplir(id, cumplido) {
    try {
      await enviar('PATCH', `/api/minutas/acuerdos/${id}`, { cumplido });
      toast(cumplido ? 'Acuerdo cumplido' : 'Acuerdo reabierto');
      if (vista === 'estado') cargarEstado(); else if (vista === 'historial') cargarHistorial();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ─── Nueva minuta ──────────────────────────────────────────────────────────
  // Deja en «f» la minuta de esa fecha y tipo: la que ya existe, o una en blanco.
  async function nuevaMinuta(fecha, tipo) {
    let r;
    try { r = await api(`/api/minutas/una?fecha=${fecha}&tipo=${tipo}`); } catch (e) { toast(e.message, 'error'); return; }
    const m = r.minuta;
    f = {
      fecha, tipo, existe: !!m, editable: r.editable,
      autor: m ? m.autor : (ctx.autor || 'Cris'),
      asistentes: new Set(m ? m.asistentes : ASISTEN[tipo]),
      trabajos_del_dia: m?.trabajos_del_dia || '', novedades: m?.novedades || '',
      detenidos: (m?.detenidos || []).map(d => ({ equipo_id: d.equipo_id, causa: d.causa, desde: d.desde || '', estimado_operativo: d.estimado_operativo || '' })),
      repuestos: (m?.repuestos || []).map(x => ({ equipo_id: x.equipo_id || '', repuesto: x.repuesto, estado: x.estado, fecha_estimada: x.fecha_estimada || '' })),
      acuerdos: (m?.acuerdos || []).map(a => ({ id: a.id, texto: a.texto, responsable: a.responsable, fecha: a.fecha })),
    };
    pintarFormulario();
  }

  const opcionesEquipo = (elegido, vacio) => `<option value="">${vacio}</option>` +
    equipos.map(e => `<option value="${escHtml(e.equipo_id)}" ${e.equipo_id === elegido ? 'selected' : ''}>${escHtml(e.equipo_id)}${nombreEquipo(e) ? ' · ' + escHtml(nombreEquipo(e)) : ''}</option>`).join('') +
    // Un equipo que ya no está activo en la flota igual se muestra, para no perderlo
    (elegido && !equipos.some(e => e.equipo_id === elegido) ? `<option value="${escHtml(elegido)}" selected>${escHtml(elegido)}</option>` : '');

  // Cada campo lleva data-l (lista), data-i (posición) y data-c (campo): así
  // un solo listener guarda lo que se escribe sin volver a dibujar el formulario.
  const campo = (lista, i, c) => `data-l="${lista}" data-i="${i}" data-c="${c}"`;
  const quitar = (lista, i) => `<button type="button" class="mn-quitar" title="Quitar" aria-label="Quitar" onclick="Minutas.quitar('${lista}', ${i})">${X}</button>`;

  function itemDetenido(d, i) {
    return `<div class="mn-item">
      <div class="mn-ancho"><label class="mn-lbl">Equipo</label><select ${campo('detenidos', i, 'equipo_id')}>${opcionesEquipo(d.equipo_id, 'Elegir equipo…')}</select></div>
      <div class="mn-ancho"><label class="mn-lbl">Causa</label><input type="text" ${campo('detenidos', i, 'causa')} value="${escHtml(d.causa)}" placeholder="Qué lo tiene detenido"></div>
      <div><label class="mn-lbl">Detenido desde</label><input type="date" ${campo('detenidos', i, 'desde')} value="${d.desde}" max="${f.fecha}"></div>
      <div><label class="mn-lbl">Vuelve a operar</label><input type="date" ${campo('detenidos', i, 'estimado_operativo')} value="${d.estimado_operativo}"></div>
      ${quitar('detenidos', i)}
    </div>`;
  }
  function itemRepuesto(r, i) {
    return `<div class="mn-item">
      <div class="mn-ancho"><label class="mn-lbl">Equipo (opcional)</label><select ${campo('repuestos', i, 'equipo_id')}>${opcionesEquipo(r.equipo_id, 'Sin equipo')}</select></div>
      <div class="mn-ancho"><label class="mn-lbl">Repuesto</label><input type="text" ${campo('repuestos', i, 'repuesto')} value="${escHtml(r.repuesto)}" placeholder="Qué repuesto falta"></div>
      <div><label class="mn-lbl">Estado</label><select ${campo('repuestos', i, 'estado')}>${ctx.estados_repuesto.map(e => `<option ${e === r.estado ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
      <div><label class="mn-lbl">Llega</label><input type="date" ${campo('repuestos', i, 'fecha_estimada')} value="${r.fecha_estimada}"></div>
      ${quitar('repuestos', i)}
    </div>`;
  }
  function itemAcuerdo(a, i) {
    return `<div class="mn-item acuerdo">
      <div class="mn-ancho"><label class="mn-lbl">Acuerdo</label><input type="text" ${campo('acuerdos', i, 'texto')} value="${escHtml(a.texto)}" placeholder="Qué se acordó" required></div>
      <div><label class="mn-lbl">Responsable</label><input type="text" list="mnPersonas" ${campo('acuerdos', i, 'responsable')} value="${escHtml(a.responsable)}" placeholder="Quién" required></div>
      <div><label class="mn-lbl">Fecha</label><input type="date" ${campo('acuerdos', i, 'fecha')} value="${a.fecha}" required></div>
      ${quitar('acuerdos', i)}
    </div>`;
  }

  function pintarListas() {
    $('mnDetenidos').innerHTML = f.detenidos.map(itemDetenido).join('') || '<div class="mn-vacio">Ningún equipo detenido.</div>';
    $('mnRepuestos').innerHTML = f.repuestos.map(itemRepuesto).join('') || '<div class="mn-vacio">Sin repuestos pendientes.</div>';
    $('mnAcuerdos').innerHTML = f.acuerdos.map(itemAcuerdo).join('') || '<div class="mn-vacio">Sin acuerdos todavía.</div>';
    if (!f.editable) $('mnForm').querySelectorAll('#mnCuerpo input, #mnCuerpo select, #mnCuerpo textarea, #mnCuerpo button').forEach(el => { el.disabled = true; });
  }

  function pintarFormulario() {
    const aviso = !f.editable
      ? `<div class="mn-aviso lectura"><span>La minuta del ${fechaLarga(f.fecha)} ya no se puede editar: solo la de hoy y la del día hábil anterior.</span></div>`
      : f.existe ? `<div class="mn-aviso"><span>Ya existe la ${MINUTA[f.tipo]} del ${fechaLarga(f.fecha)}: la estás editando.</span></div>` : '';
    $('mnForm').innerHTML = `
      ${aviso}
      <div class="mn-card">
        <div class="mn-dos">
          <div><label class="mn-lbl" for="mnFecha">Fecha</label><input type="date" id="mnFecha" value="${f.fecha}" max="${ctx.hoy}"></div>
          <div><label class="mn-lbl" for="mnTipo">Reunión</label><select id="mnTipo">${ctx.tipos.map(t => `<option value="${t}" ${t === f.tipo ? 'selected' : ''}>${TIPO[t]}</option>`).join('')}</select></div>
        </div>
      </div>
      <div id="mnCuerpo">
        <div class="mn-card">
          <h3>Asistentes</h3>
          <div class="mn-chips">${ctx.asistentes.map(n => `<label class="mn-chip"><input type="checkbox" data-asistente="${n}" ${f.asistentes.has(n) ? 'checked' : ''}> ${n}</label>`).join('')}</div>
          ${ctx.autor ? '' : `<div style="margin-top:14px;max-width:260px"><label class="mn-lbl" for="mnAutor">Registra</label><input type="text" id="mnAutor" list="mnPersonas" value="${escHtml(f.autor)}"></div>`}
        </div>
        <div class="mn-card">
          <h3>Equipos detenidos y repuestos</h3>
          <div class="mn-acciones" style="margin-bottom:14px">
            <button type="button" class="btn btn-sm" onclick="Minutas.copiarAnterior()">Copiar desde la minuta anterior</button>
            <button type="button" class="btn btn-sm" onclick="Minutas.sugerir()">Traer detenidos del calendario</button>
          </div>
          <label class="mn-lbl">Equipos detenidos</label>
          <div id="mnDetenidos"></div>
          <button type="button" class="btn btn-sm" onclick="Minutas.agregar('detenidos')">+ Equipo detenido</button>
          <label class="mn-lbl" style="margin-top:20px">Repuestos pendientes</label>
          <div id="mnRepuestos"></div>
          <button type="button" class="btn btn-sm" onclick="Minutas.agregar('repuestos')">+ Repuesto</button>
        </div>
        <div class="mn-card">
          <label class="mn-lbl" for="mnTrabajos">Trabajos del día</label>
          <textarea id="mnTrabajos" placeholder="Qué se hace hoy en el taller">${escHtml(f.trabajos_del_dia)}</textarea>
          <label class="mn-lbl" for="mnNovedades" style="margin-top:14px">Novedades (faena, clientes, personal)</label>
          <textarea id="mnNovedades" placeholder="${f.tipo === 'lunes' ? 'Incluye lo ocurrido el fin de semana' : 'Lo que Diego debería saber'}">${escHtml(f.novedades)}</textarea>
        </div>
        <div class="mn-card">
          <h3>Acuerdos</h3>
          <div id="mnAcuerdos"></div>
          <button type="button" class="btn btn-sm" onclick="Minutas.agregar('acuerdos')">+ Acuerdo</button>
        </div>
        <div class="mn-guardar">
          <button type="submit" class="btn btn-primary">${f.existe ? 'Guardar cambios' : 'Guardar minuta'}</button>
        </div>
      </div>
      <datalist id="mnPersonas">${ctx.asistentes.map(n => `<option value="${n}"></option>`).join('')}</datalist>`;
    pintarListas();
  }

  // Guarda en «f» lo que se va escribiendo
  function alEscribir(e) {
    const t = e.target;
    if (t.dataset.l) f[t.dataset.l][Number(t.dataset.i)][t.dataset.c] = t.value;
    else if (t.dataset.asistente) { if (t.checked) f.asistentes.add(t.dataset.asistente); else f.asistentes.delete(t.dataset.asistente); }
    else if (t.id === 'mnTrabajos') f.trabajos_del_dia = t.value;
    else if (t.id === 'mnNovedades') f.novedades = t.value;
    else if (t.id === 'mnAutor') f.autor = t.value;
  }
  // Cambiar fecha o tipo abre la minuta que corresponda (o una en blanco)
  function alCambiar(e) {
    if (e.target.id === 'mnFecha' && e.target.value) nuevaMinuta(e.target.value, e.target.value === f.fecha ? f.tipo : (new Date(`${e.target.value}T12:00:00`).getDay() === 1 ? 'lunes' : 'diaria'));
    else if (e.target.id === 'mnTipo') nuevaMinuta(f.fecha, e.target.value);
  }

  function agregar(lista) {
    const nuevo = {
      detenidos: { equipo_id: '', causa: '', desde: f.fecha, estimado_operativo: '' },
      repuestos: { equipo_id: '', repuesto: '', estado: 'por pedir', fecha_estimada: '' },
      acuerdos: { texto: '', responsable: '', fecha: '' },
    }[lista];
    f[lista].push(nuevo);
    pintarListas();
    // Deja el cursor en el primer campo de lo recién agregado
    const contenedor = { detenidos: 'mnDetenidos', repuestos: 'mnRepuestos', acuerdos: 'mnAcuerdos' }[lista];
    $(contenedor).lastElementChild?.querySelector('select, input')?.focus();
  }
  function quitar_(lista, i) { f[lista].splice(i, 1); pintarListas(); }

  // Suma a la lista los equipos que no estén ya anotados
  function sumarDetenidos(nuevos) {
    const ya = new Set(f.detenidos.map(d => d.equipo_id));
    const agregados = nuevos.filter(d => !ya.has(d.equipo_id));
    f.detenidos.push(...agregados.map(d => ({ equipo_id: d.equipo_id, causa: d.causa || '', desde: d.desde || '', estimado_operativo: d.estimado_operativo || '' })));
    return agregados.length;
  }

  async function copiarAnterior() {
    try {
      const r = await api(`/api/minutas/anterior?fecha=${f.fecha}&tipo=${f.tipo}`);
      if (!r.origen) { toast('No hay una minuta anterior con detenidos o repuestos', 'error'); return; }
      const n = sumarDetenidos(r.detenidos);
      const ya = new Set(f.repuestos.map(x => `${x.equipo_id}|${x.repuesto}`));
      const repuestos = r.repuestos.filter(x => !ya.has(`${x.equipo_id || ''}|${x.repuesto}`));
      f.repuestos.push(...repuestos.map(x => ({ equipo_id: x.equipo_id || '', repuesto: x.repuesto, estado: x.estado, fecha_estimada: x.fecha_estimada || '' })));
      pintarListas();
      toast(`Copiado de la minuta del ${fechaCorta(r.origen.fecha)}: ${plural(n, 'equipo', 'equipos')} y ${plural(repuestos.length, 'repuesto', 'repuestos')}. Edita solo lo que cambió.`);
    } catch (e) { toast(e.message, 'error'); }
  }

  async function sugerir() {
    try {
      const n = sumarDetenidos(await api(`/api/minutas/sugeridos?fecha=${f.fecha}`));
      pintarListas();
      toast(n ? `${plural(n, 'equipo agregado', 'equipos agregados')} desde el calendario. Revisa la causa.` : 'El calendario no tiene equipos detenidos que falten acá');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function guardar(e) {
    e.preventDefault();
    if (!f.editable) return;
    try {
      await enviar('PUT', '/api/minutas', {
        fecha: f.fecha, tipo: f.tipo, autor: f.autor, asistentes: [...f.asistentes],
        trabajos_del_dia: f.trabajos_del_dia, novedades: f.novedades,
        detenidos: f.detenidos, repuestos: f.repuestos, acuerdos: f.acuerdos,
      });
      toast(f.existe ? 'Minuta actualizada' : 'Minuta guardada');
      f = null;
      ver('estado');
    } catch (err) { toast(err.message, 'error'); }
  }

  function editar(fecha, tipo) {
    f = null;
    vista = 'nueva';
    document.querySelectorAll('.mn-tabs button').forEach(b => b.classList.toggle('active', b.dataset.mn === 'nueva'));
    $('mnEstado').hidden = true; $('mnHistorial').hidden = true; $('mnForm').hidden = false;
    nuevaMinuta(fecha, tipo);
  }

  // ─── Historial ─────────────────────────────────────────────────────────────
  function minutaHistorial(m) {
    const datos = [plural(m.detenidos.length, 'detenido', 'detenidos'), plural(m.repuestos.length, 'repuesto', 'repuestos'), plural(m.acuerdos.length, 'acuerdo', 'acuerdos')].join(' · ');
    const abiertos = m.acuerdos.filter(a => a.vencido).length;
    return `<details class="mn-minuta">
      <summary>
        <span class="mn-sum-fecha">${fechaLarga(m.fecha)}</span>
        <span class="mn-pill">${TIPO[m.tipo]}</span>
        ${abiertos ? `<span class="mn-pill rojo">${plural(abiertos, 'acuerdo vencido', 'acuerdos vencidos')}</span>` : ''}
        <span class="mn-sum-datos">${datos} · ${escHtml(m.autor || '')}</span>
      </summary>
      <div class="mn-detalle">
        <h4>Asistentes</h4><div class="mn-texto">${escHtml(m.asistentes.join(', ') || '—')}</div>
        <h4>Equipos detenidos</h4>${m.detenidos.map(d => `<div class="mn-fila"><div class="mn-fila-cuerpo"><div class="mn-fila-titulo">${escHtml(d.equipo_id)} <span style="font-weight:500;color:var(--text-secondary)">${escHtml(nombreEquipo(d))}</span></div><div class="mn-fila-sub">${escHtml(d.causa)}</div></div><div class="mn-fila-lado"><span>Desde el ${fechaCorta(d.detenido_desde)}</span><span>${d.estimado_operativo ? `Vuelta estimada: ${fechaCorta(d.estimado_operativo)}` : ''}</span></div></div>`).join('') || '<div class="mn-vacio">Ninguno.</div>'}
        <h4>Repuestos</h4>${m.repuestos.map(filaRepuesto).join('') || '<div class="mn-vacio">Ninguno.</div>'}
        ${m.trabajos_del_dia ? `<h4>Trabajos del día</h4><div class="mn-texto">${escHtml(m.trabajos_del_dia)}</div>` : ''}
        ${m.novedades ? `<h4>Novedades</h4><div class="mn-texto">${escHtml(m.novedades)}</div>` : ''}
        <h4>Acuerdos</h4>${m.acuerdos.map(a => filaAcuerdo(a, false)).join('') || '<div class="mn-vacio">Ninguno.</div>'}
        ${m.editable ? `<div style="margin-top:14px"><button class="btn btn-sm" onclick="Minutas.editar('${m.fecha}', '${m.tipo}')">Editar minuta</button></div>` : ''}
      </div>
    </details>`;
  }

  async function cargarHistorial() {
    const cont = $('mnHistorial');
    if (!cont.dataset.listo) {
      cont.dataset.listo = '1';
      cont.innerHTML = `
        <div class="mn-form mn-filtros">
          <select id="mnFTipo" aria-label="Tipo de reunión"><option value="">Todas las reuniones</option>${ctx.tipos.map(t => `<option value="${t}">${TIPO[t]}</option>`).join('')}</select>
          <input type="text" id="mnFEquipo" placeholder="Buscar por equipo…" aria-label="Buscar por equipo">
          <input type="date" id="mnFDesde" aria-label="Desde">
          <input type="date" id="mnFHasta" aria-label="Hasta" max="${ctx.hoy}">
        </div>
        <div id="mnLista"></div>`;
      let espera;
      cont.querySelectorAll('select, input').forEach(el => el.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(cargarHistorial, 250); }));
    }
    // Para conservar abiertas las minutas que ya estaban desplegadas
    const abiertas = new Set([...cont.querySelectorAll('details[open]')].map(d => d.dataset.k));
    const q = new URLSearchParams();
    for (const [k, id] of [['tipo', 'mnFTipo'], ['equipo', 'mnFEquipo'], ['desde', 'mnFDesde'], ['hasta', 'mnFHasta']]) if ($(id).value) q.set(k, $(id).value.trim());
    let d;
    try { d = await api('/api/minutas?' + q); } catch (e) { toast(e.message, 'error'); return; }
    if (!$('mnFDesde').value) $('mnFDesde').value = d.desde;
    if (!$('mnFHasta').value) $('mnFHasta').value = d.hasta;

    // Una sola línea de tiempo: minutas y días hábiles sin minuta, de lo más nuevo a lo más viejo.
    // Con un filtro puesto no se marcan faltas: el día puede tener una minuta que el filtro oculta.
    const conFiltro = q.has('tipo') || q.has('equipo');
    const lineas = d.minutas.map(m => ({ fecha: m.fecha, html: minutaHistorial(m).replace('<details class="mn-minuta">', `<details class="mn-minuta" data-k="${m.id}" ${abiertas.has(String(m.id)) ? 'open' : ''}>`) }));
    if (!conFiltro) d.dias_sin_minuta.forEach(fecha => lineas.push({ fecha, html: `<div class="mn-dia-falta">Sin minuta · <span style="text-transform:capitalize">${fechaLarga(fecha)}</span></div>` }));
    lineas.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
    $('mnLista').innerHTML = (!conFiltro && d.dias_sin_minuta.length ? `<p class="mn-nota" style="margin-bottom:12px">${plural(d.dias_sin_minuta.length, 'día hábil sin minuta', 'días hábiles sin minuta')} en el período.</p>` : '')
      + (lineas.map(l => l.html).join('') || '<div class="mn-card"><div class="mn-vacio">No hay minutas en este período.</div></div>');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = $('mnForm');
    if (!form) return;
    form.addEventListener('input', alEscribir);
    form.addEventListener('change', e => { alEscribir(e); alCambiar(e); });
    form.addEventListener('submit', guardar);
  });

  return { abrir, ver, cumplir, agregar, quitar: quitar_, copiarAnterior, sugerir, editar };
})();
