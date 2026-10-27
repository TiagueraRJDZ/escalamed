// Configurações do app. Estes dados NÃO são senha: o Firebase protege os dados
// pelas regras de segurança (firestore.rules), não por esconder esta configuração.

// Enquanto o projeto real não existe, usamos um projeto "demo-", que só funciona
// com os emuladores locais. Troque pelo bloco firebaseConfig do console do Firebase.
export const firebaseConfig = {
  apiKey: 'demo-api-key',
  authDomain: 'demo-escalamed.firebaseapp.com',
  projectId: 'demo-escalamed',
  appId: 'demo-app-id',
};

// Em localhost, conecta nos emuladores (Auth e Firestore) em vez do projeto real.
export const useEmulators = ['localhost', '127.0.0.1'].includes(location.hostname);

// Link do botão "Falar pelo WhatsApp" (gaveta de Ajuda).
export const whatsappUrl = 'https://wa.me/5500000000000';

export const appName = 'EscalaMed';
