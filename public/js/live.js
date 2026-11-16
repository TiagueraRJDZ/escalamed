// Leituras em tempo real (onSnapshot) que se recuperam sozinhas.
// Um listener do Firestore que falha (índice ainda sendo criado logo depois de publicar,
// conexão caindo, permissão que mudou) para de vez. Aqui ele tenta de novo a cada 30 s;
// enquanto isso, fica a última resposta que chegou.
import { onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { isLeaving } from './firebase.js';

const RETRY_MS = 30000;

// ref: documento ou consulta. onNext(snapshot) a cada mudança; onError(error) quando falha
// (antes de tentar de novo). metadata: avisa também quando o servidor só confirma o que o
// cache já tinha (para saber se a resposta já veio do servidor).
// Devolve a função que para de escutar.
export function listenWithRetry(ref, onNext, label, { onError, metadata = false } = {}) {
  let stop = () => {};
  let timer = null;
  let stopped = false;
  const start = () => {
    stop = onSnapshot(ref, { includeMetadataChanges: metadata }, onNext, (error) => {
      if (stopped || isLeaving()) return;
      console.warn(`${label}: a leitura falhou; tentando de novo em 30 s.`, error.message);
      onError?.(error);
      timer = setTimeout(start, RETRY_MS);
    });
  };
  start();
  return () => {
    stopped = true;
    clearTimeout(timer);
    stop();
  };
}

// Junta várias mudanças seguidas (ex.: várias consultas respondendo juntas) num redesenho só
export function batched(fn, wait = 30) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, wait);
  };
}
