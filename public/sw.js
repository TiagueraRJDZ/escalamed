// Service worker do EscalaMed: só as notificações push (os avisos do sininho no celular).
// Não guarda páginas em cache nem mexe nas requisições do app.
// Fica na raiz para valer em todas as telas. Sem cache longo (firebase.json).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Número no ícone do app (iPhone e Android, quando o sistema suporta): avisos ainda na central
async function atualizarSelo() {
  if (!self.navigator.setAppBadge) return;
  const abertas = await self.registration.getNotifications();
  if (abertas.length) await self.navigator.setAppBadge(abertas.length);
  else await self.navigator.clearAppBadge?.();
}

// Mensagem do serviço de contas (worker/src/push.js): { titulo, corpo, url, tag }
self.addEventListener('push', (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { corpo: event.data?.text() };
  }
  const opcoes = {
    body: dados.corpo || 'Você tem uma notificação nova no EscalaMed.',
    icon: '/img/icon-192.png',
    badge: '/img/badge-96.png', // Android: ícone pequeno da barra de status
    lang: 'pt-BR',
    data: { url: dados.url || '/schedules.html' },
  };
  // Mesmo assunto (ex.: convite para o mesmo grupo): troca a anterior e toca de novo
  if (dados.tag) Object.assign(opcoes, { tag: dados.tag, renotify: true });
  event.waitUntil(
    self.registration
      .showNotification(dados.titulo || 'EscalaMed', opcoes)
      .then(atualizarSelo)
      .catch(() => {}),
  );
});

// Tocar na notificação: abre o EscalaMed na tela certa (reaproveita a janela já aberta)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL(event.notification.data?.url || '/schedules.html', self.location.origin).href;
  event.waitUntil(
    (async () => {
      await atualizarSelo().catch(() => {});
      const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const janela = janelas.find((j) => new URL(j.url).origin === self.location.origin);
      if (janela) {
        await janela.focus().catch(() => {});
        const aberta = janela.navigate ? await janela.navigate(destino).catch(() => null) : null;
        if (aberta) return;
      }
      await self.clients.openWindow(destino);
    })(),
  );
});

self.addEventListener('notificationclose', (event) => event.waitUntil(atualizarSelo().catch(() => {})));
