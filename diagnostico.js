// Diagnóstico: inicia sesión y te manda por Telegram (chat privado) una captura,
// el HTML y un resumen de la estructura de la página de canje.
const { chromium } = require('playwright');

const URL_CANJE = 'https://go.jetsmart.com/es-co/ja/subscriptions/spa/private-page/redemption';
const { JS_USER, JS_PASS, TG_TOKEN, TG_CHAT_ID } = process.env;

async function tgTexto(texto) {
  for (let i = 0; i < texto.length; i += 3800) {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: texto.slice(i, i + 3800) }),
    });
  }
}

async function tgArchivo(metodo, campo, buffer, nombre, caption) {
  const fd = new FormData();
  fd.append('chat_id', TG_CHAT_ID);
  if (caption) fd.append('caption', caption);
  fd.append(campo, new Blob([buffer]), nombre);
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${metodo}`, { method: 'POST', body: fd });
  if (!r.ok) console.log('Telegram', metodo, r.status);
}

async function hayLogin(page) {
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
  await page.waitForTimeout(2000);
  return page.locator("input[type='password'], input[type='email']").first().isVisible();
}

async function login(page) {
  const email = page.locator("input[type='email'], input[name*='mail' i], input[name*='user' i]").first();
  if (await email.isVisible()) await email.fill(JS_USER);
  const pass = page.locator("input[type='password']").first();
  if (!(await pass.isVisible())) {
    await page.locator("button[type='submit'], button:has-text('Continuar'), button:has-text('Siguiente')").first().click();
    await pass.waitFor({ state: 'visible', timeout: 15000 });
  }
  await pass.fill(JS_PASS);
  await page.locator("button[type='submit'], button:has-text('Iniciar'), button:has-text('Ingresar')").first().click();
  await pass.waitFor({ state: 'detached', timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ locale: 'es-CO', viewport: { width: 1280, height: 900 } })).newPage();

  // Registro de llamadas JSON que hace la página
  const apis = [];
  page.on('response', (r) => {
    const ct = r.headers()['content-type'] || '';
    if (ct.includes('json') && ['xhr', 'fetch'].includes(r.request().resourceType())) {
      apis.push(`${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`);
    }
  });

  try {
    await page.goto(URL_CANJE, { waitUntil: 'domcontentloaded' });
    if (await hayLogin(page)) {
      await login(page);
      await page.goto(URL_CANJE, { waitUntil: 'networkidle' });
    }
    await page.waitForTimeout(6000);

    const logueado = !(await page.locator("input[type='password']").first().isVisible());

    await tgArchivo('sendPhoto', 'photo', await page.screenshot({ fullPage: true }), 'pagina.png',
      logueado ? 'Captura tras login' : 'OJO: sigue en pantalla de login');
    await tgArchivo('sendDocument', 'document', Buffer.from(await page.content()), 'pagina.html', 'HTML completo');

    const info = await page.evaluate(() => {
      const visible = (el) => el.offsetParent !== null;
      const limpiar = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const botones = [...document.querySelectorAll('button, [role=button], a')].filter(visible)
        .slice(0, 30).map((e) => `<${e.tagName.toLowerCase()} class="${limpiar(e.className)}"> ${limpiar(e.textContent)}`);
      const inputs = [...document.querySelectorAll('input, select, textarea')].filter(visible)
        .slice(0, 20).map((e) => `<${e.tagName.toLowerCase()} type=${e.type} name=${e.name} placeholder="${limpiar(e.placeholder)}" aria="${limpiar(e.getAttribute('aria-label'))}">`);
      const clases = [...new Set([...document.querySelectorAll('[class]')]
        .map((e) => e.className).filter((c) => typeof c === 'string' && /flight|vuelo|card|result|ticket|route|trip|itiner/i.test(c)))]
        .slice(0, 20);
      return { titulo: document.title, url: location.href, texto: limpiar(document.body.innerText).slice(0, 0) +
        document.body.innerText.replace(/\s+/g, ' ').slice(0, 1500), botones, inputs, clases };
    });

    await tgTexto(
      `📋 DIAGNÓSTICO\nURL: ${info.url}\nTítulo: ${info.titulo}\n\n` +
      `TEXTO VISIBLE:\n${info.texto}\n\n` +
      `BOTONES/ENLACES:\n${info.botones.join('\n')}\n\n` +
      `CAMPOS:\n${info.inputs.join('\n') || '(ninguno)'}\n\n` +
      `CLASES POSIBLES DE VUELOS:\n${info.clases.join('\n') || '(ninguna)'}\n\n` +
      `LLAMADAS JSON:\n${[...new Set(apis)].slice(0, 25).join('\n') || '(ninguna)'}`
    );
  } catch (e) {
    await tgTexto(`⚠️ Diagnóstico falló: ${e.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
