// Configurações do app. Estes dados NÃO são senha: o Firebase protege os dados
// pelas regras de segurança (firestore.rules), não por esconder esta configuração.

// Em localhost, conecta nos emuladores (Auth e Firestore) em vez do projeto real.
export const useEmulators = ['localhost', '127.0.0.1'].includes(location.hostname);

// Projeto real (Firebase, conta tiago.tlmsmartins@gmail.com).
const prodConfig = {
  apiKey: 'AIzaSyA1MGKuclBlaiIyU5PdSzzJZBMx9GOiNQ8',
  authDomain: 'escalamed-hapvida.firebaseapp.com',
  projectId: 'escalamed-hapvida',
  storageBucket: 'escalamed-hapvida.firebasestorage.app',
  messagingSenderId: '227779900020',
  appId: '1:227779900020:web:ae042600792986f3781721',
};

// Projeto "demo-": só existe nos emuladores, então nada local chega ao projeto real.
const emulatorConfig = {
  apiKey: 'demo-api-key',
  authDomain: 'demo-escalamed.firebaseapp.com',
  projectId: 'demo-escalamed',
  appId: 'demo-app-id',
};

export const firebaseConfig = useEmulators ? emulatorConfig : prodConfig;

// Link do botão "Falar pelo WhatsApp" (gaveta de Ajuda).
export const whatsappUrl = 'https://wa.me/5500000000000';

export const appName = 'EscalaMed';
