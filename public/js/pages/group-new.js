// Wizard de criação de grupo (gestor) ou escala individual (plantonista).
// Etapa 1: informações. Etapa 2: turnos.
// O grupo é gravado ao sair da etapa 1, então dá para fechar e continuar depois.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  query,
  where,
  limit,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, navigate, isLeaving } from '../firebase.js';
import { initLayout } from '../layout.js';
import { icon, renderIcons } from '../icons.js';
import { PROFESSIONAL_CATEGORIES } from '/data/categories.js';
import { GROUP_COLORS, DEFAULT_GROUP_COLOR } from '/data/colors.js';
import { STATES } from '/data/states.js';
import { normalize, searchKeywords } from '../validators.js';
import { toMinutes, toTime, durationMinutes, endsNextDay, formatDuration, SHIFT_PRESETS } from '../shifts.js';
import {
  escapeHtml,
  initials,
  toast,
  setLoading,
  setFieldError,
  clearFormErrors,
  clearErrorsWhileTyping,
  showFormAlert,
  confirmDialog,
  firebaseErrorMessage,
} from '../ui.js';

renderIcons();
const { user } = await initLayout({ active: 'schedules' });

// ---------- Estado ----------
const params = new URLSearchParams(location.search);
let groupId = params.get('id');
let group = null;
let type = params.get('type') === 'personal' ? 'personal' : 'team';
let selectedUnit = null;
let shifts = [];
let shiftsLoaded = false;
let stopShifts = null;

const $ = (id) => document.getElementById(id);

// Grupo já existente (continuar configuração)
if (groupId) {
  const snapshot = await getDoc(doc(db, 'groups', groupId)).catch(() => null);
  if (!snapshot?.exists() || !snapshot.data().managerIds?.includes(user.uid)) {
    toast('Grupo não encontrado ou você não tem permissão para editá-lo.', 'error');
    setTimeout(() => navigate('/schedules.html', { replace: true }), 1500);
    await new Promise(() => {});
  }
  group = { id: snapshot.id, ...snapshot.data() };
  type = group.type;
  selectedUnit = group.unit;
}

const isTeam = type === 'team';

// ---------- Textos conforme o tipo ----------
const texts = isTeam
  ? {
      title: groupId ? 'Configurar grupo' : 'Criar novo grupo',
      subtitle: 'Monte a escala da sua equipe em poucos passos.',
      nameLabel: 'Nome do grupo',
      namePlaceholder: 'Ex.: UTI Adulto',
    }
  : {
      title: groupId ? 'Configurar escala' : 'Criar escala individual',
      subtitle: 'Organize seus próprios plantões em um só lugar.',
      nameLabel: 'Nome da escala',
      namePlaceholder: 'Ex.: Meus plantões',
    };

$('wizard-title').textContent = texts.title;
$('wizard-subtitle').textContent = texts.subtitle;
$('group-name-label').textContent = texts.nameLabel;
$('group-name').placeholder = texts.namePlaceholder;
document.title = `${texts.title} | EscalaMed`;
if (!isTeam) {
  $('unit-label').textContent = 'Unidade de saúde (opcional)';
  $('category-label').textContent = 'Categoria profissional (opcional)';
}

// ---------- Etapas ----------
const STEPS = ['info', 'shifts'];

function goTo(step, { focus = true } = {}) {
  const index = STEPS.indexOf(step);
  STEPS.forEach((name, i) => {
    $(`step-${name}`).hidden = name !== step;
    const item = document.querySelector(`.step[data-step="${name}"]`);
    item.classList.toggle('is-done', i < index);
    item.querySelector('.step-number').innerHTML = i < index ? icon('check') : String(i + 1);
    if (i === index) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });

  if (groupId) history.replaceState(null, '', `/group-new.html?id=${groupId}&step=${step}`);

  if (step === 'shifts') {
    listenShifts();
    if (focus) {
      $('shifts-title').tabIndex = -1;
      $('shifts-title').focus();
    }
  } else if (focus) {
    $('group-name').focus();
  }
}

// =========================================================
// Etapa 1: informações
// =========================================================
const infoForm = $('step-info');

$('group-category').insertAdjacentHTML(
  'beforeend',
  PROFESSIONAL_CATEGORIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join(''),
);
$('unit-state').insertAdjacentHTML(
  'beforeend',
  STATES.map((s) => `<option value="${s.uf}">${s.uf} · ${s.name}</option>`).join(''),
);

$('swatches').innerHTML = GROUP_COLORS.map(
  (c) => `<label class="swatch" title="${c.name}">
      <input type="radio" name="color" value="${c.hex}" aria-label="${c.name}" />
      <span style="background:${c.hex};color:${c.hex}">${icon('check')}</span>
    </label>`,
).join('');

// Preenche com os dados atuais (quando volta para editar)
infoForm.name.value = group?.name ?? '';
infoForm.categoryId.value = group?.categoryId ?? '';
const initialColor = group?.color ?? DEFAULT_GROUP_COLOR;
(infoForm.querySelector(`input[name=color][value="${initialColor}"]`) ?? infoForm.color[0]).checked = true;

function currentColor() {
  return infoForm.querySelector('input[name=color]:checked')?.value ?? DEFAULT_GROUP_COLOR;
}

function renderPreview() {
  const name = infoForm.name.value.trim();
  const subtitle = !isTeam
    ? 'Escala individual'
    : selectedUnit
      ? `${selectedUnit.name} · ${selectedUnit.city}/${selectedUnit.state}`
      : 'Unidade de saúde';
  $('group-preview').innerHTML = `
    <span class="group-avatar" style="background:${currentColor()}" aria-hidden="true">${escapeHtml(initials(name || '?'))}</span>
    <div><strong>${escapeHtml(name || texts.nameLabel)}</strong><small>${escapeHtml(subtitle)}</small></div>`;
}

infoForm.addEventListener('input', renderPreview);

// ---------- Busca de unidade de saúde ----------
const unitInput = $('unit-search');
const unitList = $('unit-options');
let unitResults = [];
let activeOption = -1;
let searchTimer = null;
let searchSeq = 0;

function setListOpen(open) {
  unitList.hidden = !open;
  unitInput.setAttribute('aria-expanded', String(open));
  if (!open) {
    activeOption = -1;
    unitInput.removeAttribute('aria-activedescendant');
  }
}

function renderUnitOptions(status) {
  const typed = unitInput.value.trim();
  const options = unitResults.map(
    (u, i) => `<li class="combobox-option" role="option" id="unit-opt-${i}" data-index="${i}" aria-selected="${i === activeOption}">
        <span>${escapeHtml(u.name)}</span><small>${escapeHtml(u.city)}/${escapeHtml(u.state)}</small>
      </li>`,
  );
  const createIndex = unitResults.length;
  options.push(
    `<li class="combobox-option is-create" role="option" id="unit-opt-${createIndex}" data-create aria-selected="${activeOption === createIndex}">
      ${icon('plus')}<span>Cadastrar ${typed ? `"${escapeHtml(typed)}"` : 'nova unidade'}</span>
    </li>`,
  );
  unitList.innerHTML = (status ? `<li class="combobox-status" role="presentation">${status}</li>` : '') + options.join('');
  setListOpen(true);
  if (activeOption >= 0) unitInput.setAttribute('aria-activedescendant', `unit-opt-${activeOption}`);
}

async function searchUnits(text) {
  const term = normalize(text);
  const words = term.split(' ').filter(Boolean);
  const units = collection(db, 'healthUnits');
  const queries = [
    query(units, where('nameLower', '>=', term), where('nameLower', '<=', `${term}`), limit(8)),
    query(units, where('cityLower', '>=', term), where('cityLower', '<=', `${term}`), limit(8)),
  ];
  // Palavra inteira em qualquer posição do nome (ex.: "lucas" acha "Hospital São Lucas")
  const longest = [...words].sort((a, b) => b.length - a.length)[0];
  if (longest?.length >= 3) queries.push(query(units, where('keywords', 'array-contains', longest), limit(10)));

  const snapshots = await Promise.all(queries.map((q) => getDocs(q)));
  const found = new Map();
  snapshots.forEach((s) => s.docs.forEach((d) => found.set(d.id, { id: d.id, ...d.data() })));

  // Cada palavra digitada precisa começar alguma palavra do nome ou da cidade
  return [...found.values()]
    .filter((u) => {
      const tokens = normalize(`${u.name} ${u.city}`).split(/[^a-z0-9]+/);
      return words.every((w) => tokens.some((t) => t.startsWith(w)));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 8);
}

unitInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const text = unitInput.value.trim();
  if (normalize(text).length < 2) {
    setListOpen(false);
    return;
  }
  unitResults = [];
  activeOption = -1;
  renderUnitOptions('Buscando…');
  const seq = ++searchSeq;
  searchTimer = setTimeout(async () => {
    try {
      const results = await searchUnits(text);
      if (seq !== searchSeq) return; // chegou uma busca mais nova
      unitResults = results;
      renderUnitOptions(results.length ? '' : 'Nenhuma unidade encontrada.');
    } catch (error) {
      if (seq === searchSeq) renderUnitOptions(firebaseErrorMessage(error));
    }
  }, 300);
});

unitInput.addEventListener('keydown', (event) => {
  if (unitList.hidden) return;
  const total = unitResults.length + 1;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    activeOption = (activeOption + (event.key === 'ArrowDown' ? 1 : -1) + total) % total;
    renderUnitOptions();
    $(`unit-opt-${activeOption}`)?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter' && activeOption >= 0) {
    event.preventDefault();
    chooseOption(activeOption);
  } else if (event.key === 'Escape') {
    setListOpen(false);
  }
});

unitInput.addEventListener('blur', () => setTimeout(() => setListOpen(false), 150));

// mousedown em vez de click: escolhe antes de o campo perder o foco
unitList.addEventListener('mousedown', (event) => {
  const option = event.target.closest('.combobox-option');
  if (!option) return;
  event.preventDefault();
  chooseOption(option.hasAttribute('data-create') ? unitResults.length : Number(option.dataset.index));
});

function chooseOption(index) {
  if (index === unitResults.length) {
    openUnitModal(unitInput.value.trim());
  } else {
    selectUnit(unitResults[index]);
  }
  setListOpen(false);
}

function selectUnit(unit) {
  selectedUnit = unit ? { id: unit.id, name: unit.name, city: unit.city, state: unit.state } : null;
  const box = $('selected-unit');
  $('unit-combobox').hidden = Boolean(selectedUnit);
  box.hidden = !selectedUnit;
  if (selectedUnit) {
    box.innerHTML = `${icon('mapPin')}
      <div><strong>${escapeHtml(selectedUnit.name)}</strong><small>${escapeHtml(selectedUnit.city)}/${escapeHtml(selectedUnit.state)}</small></div>
      <button type="button" class="btn-icon" id="clear-unit" aria-label="Trocar unidade" title="Trocar unidade">${icon('x')}</button>`;
    setFieldError(unitInput, '');
  } else {
    unitInput.value = '';
  }
  renderPreview();
}

$('selected-unit').addEventListener('click', (event) => {
  if (!event.target.closest('#clear-unit')) return;
  selectUnit(null);
  unitInput.focus();
});

// ---------- Cadastrar unidade nova ----------
const unitForm = $('unit-form');

function openUnitModal(name) {
  unitForm.reset();
  clearFormErrors(unitForm);
  unitForm.name.value = name;
  $('modal-unit').showModal();
  (name ? unitForm.city : unitForm.name).focus();
}

unitForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(unitForm);
  const name = unitForm.name.value.trim().replace(/\s+/g, ' ');
  const city = unitForm.city.value.trim().replace(/\s+/g, ' ');
  const state = unitForm.state.value;

  const errors = [];
  if (name.length < 3) errors.push([unitForm.name, 'Informe o nome da unidade (mínimo 3 letras).']);
  if (city.length < 2) errors.push([unitForm.city, 'Informe a cidade.']);
  if (!state) errors.push([unitForm.state, 'Selecione a UF.']);
  if (errors.length) {
    errors.forEach(([input, message]) => setFieldError(input, message));
    errors[0][0].focus();
    return;
  }

  const button = unitForm.querySelector('[type=submit]');
  setLoading(button, true);
  try {
    // Já existe uma unidade igual? Usa a existente
    const existing = await getDocs(
      query(
        collection(db, 'healthUnits'),
        where('nameLower', '==', normalize(name)),
        where('cityLower', '==', normalize(city)),
        limit(1),
      ),
    );
    if (!existing.empty) {
      const d = existing.docs[0];
      selectUnit({ id: d.id, ...d.data() });
      toast('Essa unidade já estava cadastrada e foi selecionada.');
    } else {
      const unit = { name, city, state };
      const ref = await addDoc(collection(db, 'healthUnits'), {
        ...unit,
        nameLower: normalize(name),
        cityLower: normalize(city),
        keywords: searchKeywords(name, city),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      selectUnit({ id: ref.id, ...unit });
      toast('Unidade cadastrada.', 'success');
    }
    $('modal-unit').close();
  } catch (error) {
    showFormAlert(unitForm, firebaseErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
});

// ---------- Próximo (grava o grupo) ----------
infoForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(infoForm);
  const name = infoForm.name.value.trim().replace(/\s+/g, ' ');
  const categoryId = infoForm.categoryId.value || null;

  const errors = [];
  if (name.length < 3) errors.push([infoForm.name, 'Informe um nome com pelo menos 3 letras.']);
  if (isTeam && !selectedUnit) errors.push([unitInput, 'Escolha a unidade de saúde do grupo.']);
  if (isTeam && !categoryId) errors.push([infoForm.categoryId, 'Escolha a categoria profissional do grupo.']);
  if (errors.length) {
    errors.forEach(([input, message]) => setFieldError(input, message));
    errors[0][0].focus();
    return;
  }

  const data = { name, color: currentColor(), unit: selectedUnit, categoryId };
  const button = infoForm.querySelector('[type=submit]');
  setLoading(button, true);
  try {
    if (groupId) {
      await updateDoc(doc(db, 'groups', groupId), { ...data, updatedAt: serverTimestamp() });
      group = { ...group, ...data };
    } else {
      groupId = await createGroup(data);
    }
    goTo('shifts');
  } catch (error) {
    showFormAlert(infoForm, firebaseErrorMessage(error));
  } finally {
    setLoading(button, false);
  }
});

// Cria o grupo e o registro do criador como gestor, juntos
async function createGroup(data) {
  const ref = doc(collection(db, 'groups'));
  let memberName = (user.displayName || user.email?.split('@')[0] || '').trim().slice(0, 80);
  if (memberName.length < 2) memberName = 'Usuário';

  const newGroup = {
    ...data,
    type,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
    ownerId: user.uid,
    managerIds: [user.uid],
    memberIds: [user.uid],
    setupStep: 'shifts',
  };

  const batch = writeBatch(db);
  batch.set(ref, { ...newGroup, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(db, 'groups', ref.id, 'members', user.uid), {
    role: 'manager',
    name: memberName,
    photoURL: user.photoURL ?? null,
    joinedAt: serverTimestamp(),
  });
  await batch.commit();

  group = { id: ref.id, ...newGroup };
  return ref.id;
}

// =========================================================
// Etapa 2: turnos
// =========================================================
const shiftList = $('shift-list');
const shiftForm = $('shift-form');
let editingShift = null;

$('presets').insertAdjacentHTML(
  'beforeend',
  SHIFT_PRESETS.map(
    (p, i) =>
      `<button type="button" class="chip" data-preset="${i}">${p.title} · ${toTime(p.start)}–${toTime(p.end)}</button>`,
  ).join(''),
);

function listenShifts() {
  if (stopShifts) return;
  renderShifts();
  stopShifts = onSnapshot(
    collection(db, 'groups', groupId, 'shifts'),
    (snapshot) => {
      shifts = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.startMinute - b.startMinute || a.title.localeCompare(b.title, 'pt-BR'));
      shiftsLoaded = true;
      renderShifts();
    },
    (error) => {
      if (!isLeaving()) toast(firebaseErrorMessage(error), 'error');
    },
  );
}

function shiftTimeHtml(shift) {
  const duration = durationMinutes(shift.startMinute, shift.endMinute);
  const nextDay = endsNextDay(shift.startMinute, shift.endMinute)
    ? '<span class="badge">Termina no dia seguinte</span>'
    : '';
  return `<span>${toTime(shift.startMinute)} – ${toTime(shift.endMinute)}</span><span aria-hidden="true">·</span><span>${formatDuration(duration)}</span>${nextDay}`;
}

let lastShiftsHtml = '';

// Só troca o HTML quando algo mudou (evita perder o foco do teclado à toa)
function setShiftsHtml(html) {
  if (html === lastShiftsHtml) return;
  lastShiftsHtml = html;
  shiftList.innerHTML = html;
}

function renderShifts() {
  shiftList.style.setProperty('--shift-color', group?.color ?? DEFAULT_GROUP_COLOR);
  if (!shiftsLoaded) {
    setShiftsHtml('<li class="skeleton" style="height:64px"></li><li class="skeleton" style="height:64px"></li>');
    return;
  }
  if (!shifts.length) {
    setShiftsHtml(`<li class="empty-state">${icon('clock')}<h3>Nenhum turno cadastrado</h3>
      <p>Adicione os turnos da escala ou use uma das sugestões acima.</p></li>`);
    return;
  }
  setShiftsHtml(shifts
    .map(
      (s) => `<li class="shift-item">
        <div><strong>${escapeHtml(s.title)}</strong><span class="shift-time">${shiftTimeHtml(s)}</span></div>
        <div class="shift-actions">
          <button type="button" class="btn-icon" data-edit="${s.id}" aria-label="Editar turno ${escapeHtml(s.title)}" title="Editar">${icon('edit')}</button>
          <button type="button" class="btn-icon is-danger" data-delete="${s.id}" aria-label="Excluir turno ${escapeHtml(s.title)}" title="Excluir">${icon('trash')}</button>
        </div>
      </li>`,
    )
    .join(''));
}

shiftList.addEventListener('click', async (event) => {
  const editButton = event.target.closest('[data-edit]');
  if (editButton) {
    openShiftModal(shifts.find((s) => s.id === editButton.dataset.edit));
    return;
  }
  const deleteButton = event.target.closest('[data-delete]');
  if (!deleteButton) return;
  const shift = shifts.find((s) => s.id === deleteButton.dataset.delete);
  const confirmed = await confirmDialog({
    title: 'Excluir turno?',
    message: `O turno "${shift.title}" será excluído. Essa ação não pode ser desfeita.`,
    confirmText: 'Excluir',
    danger: true,
  });
  if (!confirmed) return;
  try {
    await deleteDoc(doc(db, 'groups', groupId, 'shifts', shift.id));
    toast('Turno excluído.');
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
  }
});

$('presets').addEventListener('click', async (event) => {
  const chip = event.target.closest('[data-preset]');
  if (!chip) return;
  const preset = SHIFT_PRESETS[Number(chip.dataset.preset)];
  const exists = shifts.some(
    (s) => s.startMinute === preset.start && s.endMinute === preset.end && normalize(s.title) === normalize(preset.title),
  );
  if (exists) {
    toast(`O turno ${preset.title} já está na lista.`);
    return;
  }
  chip.disabled = true;
  try {
    await addDoc(collection(db, 'groups', groupId, 'shifts'), {
      title: preset.title,
      startMinute: preset.start,
      endMinute: preset.end,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
  } finally {
    chip.disabled = false;
  }
});

// ---------- Modal de turno ----------
function updateShiftHint() {
  const { start, end } = shiftForm;
  if (!start.value || !end.value) {
    $('shift-hint').textContent = '';
    return;
  }
  const s = toMinutes(start.value);
  const e = toMinutes(end.value);
  const nextDay = endsNextDay(s, e) ? ' · termina no dia seguinte' : '';
  $('shift-hint').textContent = `Duração: ${formatDuration(durationMinutes(s, e))}${nextDay}`;
}

function openShiftModal(shift = null) {
  editingShift = shift;
  shiftForm.reset();
  clearFormErrors(shiftForm);
  $('modal-shift-title').textContent = shift ? 'Editar turno' : 'Novo turno';
  if (shift) {
    shiftForm.title.value = shift.title;
    shiftForm.start.value = toTime(shift.startMinute);
    shiftForm.end.value = toTime(shift.endMinute);
  }
  updateShiftHint();
  $('modal-shift').showModal();
  shiftForm.title.focus();
}

$('add-shift').addEventListener('click', () => openShiftModal());
shiftForm.addEventListener('input', updateShiftHint);

shiftForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormErrors(shiftForm);
  const title = shiftForm.title.value.trim().replace(/\s+/g, ' ');

  const errors = [];
  if (!title) errors.push([shiftForm.title, 'Informe o título do turno.']);
  if (!shiftForm.start.value) errors.push([shiftForm.start, 'Informe a hora de início.']);
  if (!shiftForm.end.value) errors.push([shiftForm.end, 'Informe a hora de fim.']);
  if (errors.length) {
    errors.forEach(([input, message]) => setFieldError(input, message));
    errors[0][0].focus();
    return;
  }

  const data = {
    title,
    startMinute: toMinutes(shiftForm.start.value),
    endMinute: toMinutes(shiftForm.end.value),
    updatedAt: serverTimestamp(),
  };

  // O Firestore mostra a mudança na lista na hora; não esperamos o servidor
  // confirmar para fechar (assim funciona até com internet lenta).
  const write = editingShift
    ? updateDoc(doc(db, 'groups', groupId, 'shifts', editingShift.id), data)
    : setDoc(doc(collection(db, 'groups', groupId, 'shifts')), { ...data, createdAt: serverTimestamp() });
  write.catch((error) => toast(firebaseErrorMessage(error), 'error'));

  $('modal-shift').close();
  toast(editingShift ? 'Turno atualizado.' : 'Turno adicionado.', 'success');
});

// ---------- Navegação entre etapas ----------
$('back-to-info').addEventListener('click', () => goTo('info'));

$('finish').addEventListener('click', async (event) => {
  if (!shifts.length) {
    toast('Adicione pelo menos um turno para concluir.', 'error');
    return;
  }
  const button = event.currentTarget;
  setLoading(button, true);
  try {
    await updateDoc(doc(db, 'groups', groupId), { setupStep: 'done', updatedAt: serverTimestamp() });
    navigate('/schedules.html?created=1');
  } catch (error) {
    toast(firebaseErrorMessage(error), 'error');
    setLoading(button, false);
  }
});

// ---------- Início ----------
[infoForm, unitForm, shiftForm].forEach(clearErrorsWhileTyping);
if (selectedUnit) selectUnit(selectedUnit);
renderPreview();
goTo(groupId && params.get('step') !== 'info' ? 'shifts' : 'info', { focus: false });
