// Busca de pessoas na barra do topo: sugestões enquanto digita e, ao escolher,
// um cartão com os dados públicos da pessoa (nunca e-mail ou telefone) e os grupos em comum.
import {
  collection,
  getDocs,
  query,
  where,
  limit,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { isProfileComplete } from './auth.js';
import { icon } from './icons.js';
import { escapeHtml, initials, firebaseErrorMessage } from './ui.js';
import { normalize } from './validators.js';
import { professionLabel, councilLabel } from '/data/categories.js';

const MAX_RESULTS = 8;
const END = ''; // fim do intervalo nas buscas por começo de texto

const avatar = ({ name, photoURL }, className) =>
  photoURL
    ? `<span class="${className}"><img src="${escapeHtml(photoURL)}" alt="" referrerpolicy="no-referrer" /></span>`
    : `<span class="${className}">${escapeHtml(initials(name))}</span>`;

const details = (person) => [professionLabel(person), councilLabel(person.council)].filter(Boolean).join(' · ');

// Procura por: começo do nome completo, começo do nome de usuário e palavra inteira do nome.
// Depois, cada palavra digitada precisa começar alguma palavra do nome ou do usuário.
async function searchPeople(text, selfUid) {
  const term = normalize(text);
  const words = term.split(' ').filter(Boolean);
  const users = collection(db, 'users');
  const queries = [query(users, where('nameLower', '>=', term), where('nameLower', '<=', term + END), limit(10))];
  if (words.length === 1) {
    queries.push(query(users, where('username', '>=', term), where('username', '<=', term + END), limit(5)));
  }
  words
    .filter((w) => w.length >= 2)
    .slice(0, 3)
    .forEach((w) => queries.push(query(users, where('searchKeywords', 'array-contains', w), limit(10))));

  const snapshots = await Promise.all(queries.map((q) => getDocs(q)));
  const found = new Map();
  snapshots.forEach((s) => s.docs.forEach((d) => found.set(d.id, { uid: d.id, ...d.data() })));

  return [...found.values()]
    .filter((p) => p.uid !== selfUid && isProfileComplete(p))
    .filter((p) => {
      const tokens = normalize(`${p.name} ${p.username ?? ''}`).split(/[^a-z0-9]+/);
      return words.every((w) => tokens.some((t) => t.startsWith(w)));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, MAX_RESULTS);
}

// Grupos do usuário logado (carregados uma vez, para mostrar "grupos em comum")
let myGroups = null;
async function loadMyGroups(uid) {
  if (!myGroups) {
    myGroups = getDocs(query(collection(db, 'groups'), where('memberIds', 'array-contains', uid)))
      .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))
      .catch(() => {
        myGroups = null;
        return [];
      });
  }
  return myGroups;
}

export function personModalHtml() {
  return `
    <dialog class="modal modal-center" id="modal-person" aria-labelledby="modal-person-name">
      <div class="dialog-header" style="border:0;justify-content:flex-end">
        <button type="button" class="btn-icon" data-close aria-label="Fechar">${icon('x')}</button>
      </div>
      <div class="dialog-body" id="modal-person-body"></div>
      <div class="dialog-footer"><button type="button" class="btn btn-secondary" data-close>Fechar</button></div>
    </dialog>`;
}

async function openPerson(person, selfUid) {
  const dialog = document.getElementById('modal-person');
  const body = document.getElementById('modal-person-body');
  const info = details(person);
  body.innerHTML = `
    ${avatar(person, 'avatar person-avatar')}
    <h2 id="modal-person-name">${escapeHtml(person.name)}</h2>
    ${person.username ? `<p class="muted">@${escapeHtml(person.username)}</p>` : ''}
    ${info ? `<p class="person-details">${escapeHtml(info)}</p>` : ''}
    <div class="person-groups" id="person-groups"><span class="muted text-sm">Buscando grupos em comum…</span></div>`;
  dialog.showModal();

  const common = (await loadMyGroups(selfUid)).filter((g) => g.memberIds?.includes(person.uid));
  const box = document.getElementById('person-groups');
  if (!box || !dialog.open) return;
  box.innerHTML = common.length
    ? `<h3 class="section-title">Grupos em comum</h3>
       <ul>${common
         .map((g) => `<li><a href="/group.html?id=${encodeURIComponent(g.id)}">${icon('users')}${escapeHtml(g.name)}</a></li>`)
         .join('')}</ul>`
    : '<p class="muted text-sm">Nenhum grupo em comum.</p>';
}

// form: o <form> da barra do topo; selfUid: quem está logado (fica fora dos resultados)
export function setupPeopleSearch(form, selfUid) {
  const input = form.querySelector('input');
  const list = document.createElement('ul');
  list.className = 'search-results';
  list.id = 'global-search-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Pessoas encontradas');
  list.hidden = true;
  form.append(list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');

  let results = [];
  let active = -1;
  let timer = null;
  let seq = 0;

  const setOpen = (open) => {
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) input.removeAttribute('aria-activedescendant');
  };

  function render(status = '') {
    list.innerHTML =
      (status ? `<li class="search-status" role="presentation">${escapeHtml(status)}</li>` : '') +
      results
        .map(
          (p, i) => `
          <li class="search-option" role="option" id="person-opt-${i}" data-index="${i}" aria-selected="${i === active}">
            ${avatar(p, 'avatar')}
            <span><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(details(p) || (p.username ? `@${p.username}` : ''))}</small></span>
          </li>`,
        )
        .join('');
    setOpen(true);
    if (active >= 0) input.setAttribute('aria-activedescendant', `person-opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function choose(index) {
    const person = results[index];
    if (!person) return;
    setOpen(false);
    openPerson(person, selfUid);
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const text = input.value.trim();
    seq++;
    if (normalize(text).length < 2) {
      results = [];
      setOpen(false);
      return;
    }
    results = [];
    active = -1;
    render('Buscando…');
    const current = seq;
    timer = setTimeout(async () => {
      try {
        const found = await searchPeople(text, selfUid);
        if (current !== seq) return; // chegou uma busca mais nova
        results = found;
        render(found.length ? '' : 'Ninguém encontrado. Tente o nome e o sobrenome.');
      } catch (error) {
        if (current === seq) render(firebaseErrorMessage(error) ?? '');
      }
    }, 300);
  });

  input.addEventListener('keydown', (event) => {
    if (list.hidden || !results.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      render();
      document.getElementById(`person-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  });

  // Enter escolhe a sugestão marcada (ou a primeira)
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (results.length) choose(Math.max(active, 0));
  });

  input.addEventListener('focus', () => {
    if (results.length) render();
  });
  input.addEventListener('blur', () => setTimeout(() => setOpen(false), 150));

  // mousedown em vez de click: escolhe antes de o campo perder o foco
  list.addEventListener('mousedown', (event) => {
    const option = event.target.closest('.search-option');
    if (!option) return;
    event.preventDefault();
    choose(Number(option.dataset.index));
  });
}
