// Bot JetSMART All You Can Fly: login + chequeo + aviso por Telegram
const { chromium } = require('playwright');
const fs = require('fs');

const URL_CANJE = 'https://go.jetsmart.com/es-co/ja/subscriptions/spa/private-page/redemption';

// TODO: selector CSS de los vuelos DISPONIBLES (se ajusta inspeccionando la página)
const SELECTOR_VUELO_DISPONIBLE = '.flight-card:not(.sold-out)';

const { JS_USER, JS_PASS, TG_TOKEN, TG_CHAT_ID } = process.env;
const STATE_FILE = 'state.json';

const state = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  : { huella: '', errorAvisado: false };
const guardar = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state));

async function telegram(texto) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text: texto }),
  });
  if (!r.ok) console.log('Telegram respondió', r.status);
}

async function hayFormularioLogin(page) {
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
  const ctx = await browser.newContext({ locale: 'es-CO' });
  const page = await ctx.newPage();

  try {
    await page.goto(URL_CANJE, { waitUntil: 'domcontentloaded' });

    if (await hayFormularioLogin(page)) {
      console.log('Iniciando sesión...');
      await login(page);
      await page.goto(URL_CANJE, { waitUntil: 'networkidle' });
      if (await hayFormularioLogin(page)) throw new Error('El login no se completó (¿credenciales incorrectas?)');
    }
    console.log('Sesión activa');

    // TODO: aquí puede hacer falta elegir origen/destino/fecha antes de ver resultados
    await page.waitForTimeout(4000);

    const vuelos = await page.locator(SELECTOR_VUELO_DISPONIBLE).allInnerTexts();
    const huella = vuelos.map((t) => t.replace(/\s+/g, ' ').trim()).join('|');
    console.log(`Vuelos disponibles detectados: ${vuelos.length}`);

    if (vuelos.length && huella !== state.huella) {
      await telegram(`✈️ ¡${vuelos.length} vuelo(s) disponible(s) en JetSMART!\n\n${vuelos[0].slice(0, 200)}\n\n${URL_CANJE}`);
    }
    state.huella = huella;
    state.errorAvisado = false;
    guardar();
  } catch (e) {
    console.error('Error:', e.message);
    if (!state.errorAvisado) {
      await telegram(`⚠️ El bot de JetSMART falló: ${e.message}`);
      state.errorAvisado = true;
      guardar();
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
