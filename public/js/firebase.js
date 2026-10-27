// Conexão única com o Firebase, importada por todas as páginas.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore,
  connectFirestoreEmulator,
  terminate,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { firebaseConfig, useEmulators } from './config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// E-mails do Firebase (verificação, recuperar senha) em português.
auth.languageCode = 'pt-BR';

if (useEmulators) {
  connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, location.hostname, 8080);
}

// ---------- Troca de página sem deixar conexões abertas ----------
// O app tem várias páginas. Ao trocar de página, o Chrome guarda a anterior no
// cache do botão Voltar com as conexões em tempo real do Firestore ainda abertas.
// Em HTTP/1.1 (emuladores, alguns proxies corporativos) o limite é de 6 conexões
// por servidor: depois de algumas trocas de página, leituras e gravações travam.
// Por isso, antes de navegar, encerramos o Firestore da página atual.

let leaving = false;

// true enquanto a página está sendo trocada: as listas em tempo real recebem um
// erro "Firestore shutting down" nesse momento, que deve ser ignorado.
export const isLeaving = () => leaving;

export async function navigate(url, { replace = false } = {}) {
  leaving = true;
  const timeout = new Promise((resolve) => setTimeout(resolve, 1500));
  await Promise.race([terminate(db).catch(() => {}), timeout]);
  if (replace) location.replace(url);
  else location.assign(url);
}

// Links internos passam pelo navigate()
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (
    !link ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    link.target ||
    link.hasAttribute('download')
  ) {
    return;
  }
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return;
  // Âncoras na mesma página (ex.: #entrar, #cadastro) continuam normais
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  event.preventDefault();
  navigate(url.href);
});

// Botão Voltar/Avançar: melhor esforço para fechar as conexões ao sair...
window.addEventListener('pagehide', () => {
  leaving = true;
  terminate(db).catch(() => {});
});

// ...e, se o navegador restaurar a página do cache, recarrega para reconectar.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});
