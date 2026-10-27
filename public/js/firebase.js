// Conexão única com o Firebase, importada por todas as páginas.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
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
