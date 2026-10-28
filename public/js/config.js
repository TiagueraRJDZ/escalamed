// Configurações do app. Estes dados NÃO são senha: o Firebase protege os dados
// pelas regras de segurança (firestore.rules), não por esconder esta configuração.

// O app usa o projeto real em qualquer endereço, inclusive localhost e Go Live.
// Para testar sem mexer no banco real: troque para true, rode "firebase emulators:start"
// e "node scripts/seed-emulator.mjs" (dados de teste). Só vale em localhost/127.0.0.1.
const USE_LOCAL_EMULATORS = false;

export const useEmulators = USE_LOCAL_EMULATORS && ['localhost', '127.0.0.1'].includes(location.hostname);

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

// Serviço de contas (Cloudflare Worker, pasta worker/): login, cadastro e senhas.
// Com os emuladores, use o Worker local: "npx wrangler dev" na pasta worker/ (porta 8787).
export const authApiUrl = useEmulators
  ? 'http://127.0.0.1:8787'
  : 'https://escalamed-auth.tiago-tlmsmartins.workers.dev';

// App Check com reCAPTCHA v3 (invisível): bloqueia robôs no login, no cadastro e no banco.
// Vazio = desligado. Para ligar, veja "App Check" no README e cole aqui a chave do site.
export const appCheckSiteKey = '';

// Link do botão "Falar pelo WhatsApp" (gaveta de Ajuda).
export const whatsappUrl = 'https://wa.me/5500000000000';

export const appName = 'EscalaMed';
