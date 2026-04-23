const {
  parseCookieString,
  mergeCookieStrings,
  buildCookieHeader,
  extractSetCookieParts,
  parseSetCookieHeader,
  normalizeCookieDomain,
} = require('./session');

async function walletLogin(bot, { force = false, baseUrl }) {
  if (!bot.walletAddress) {
    throw new Error('No wallet/private key configured for wallet auth');
  }

  const knownCookies = parseCookieString(bot.session?.cookies || '');
  let csrf = force ? null : (bot.session?.csrf || knownCookies.csrftoken || bot.accountConfig.csrf || null);
  let cookieString = force ? '' : mergeCookieStrings(bot.session?.cookies || '', bot.accountConfig.cookies || '');
  let cookieHeader = buildCookieHeader(cookieString);

  function applyResponseCookies(response) {
    const setCookieHeaders = extractSetCookieParts(response.headers);
    if (!setCookieHeaders.length) return;
    const newCookies = [];
    for (const header of setCookieHeaders) {
      const parsed = parseSetCookieHeader(header);
      if (!parsed) continue;
      const domain = normalizeCookieDomain(parsed.attrs.domain || new URL(baseUrl).hostname);
      if (domain !== 'inception.dachain.io') continue;
      newCookies.push(`${parsed.name}=${parsed.value}`);
    }
    if (!newCookies.length) return;
    cookieString = mergeCookieStrings(cookieString, newCookies.join('; '));
    // Preserve csrf token if server didn't send one in Set-Cookie
    const parsedAfter = parseCookieString(cookieString);
    if (!parsedAfter.csrftoken && csrf) {
      cookieString = mergeCookieStrings(cookieString, `csrftoken=${csrf}`);
    }
    cookieHeader = buildCookieHeader(cookieString);
    const parsedCsrf = parseCookieString(cookieString).csrftoken;
    if (parsedCsrf) csrf = parsedCsrf;
  }

  if (!csrf) {
    const bootstrapCsrf = '00000000000000000000000000000000';
    csrf = bootstrapCsrf;
    const bootstrapCookies = mergeCookieStrings(cookieString, `csrftoken=${bootstrapCsrf}`);
    const bootstrapResponse = await bot.fetchWithSession(`${baseUrl}/api/auth/wallet/`, {
      method: 'POST',
      headers: { 'x-csrftoken': bootstrapCsrf },
      body: { wallet_address: bot.walletAddress },
      sessionOverride: {
        cookies: bootstrapCookies,
        cookieHeader: buildCookieHeader(bootstrapCookies),
        csrf: bootstrapCsrf,
      },
    });
    const bootstrapType = bootstrapResponse.headers.get('content-type') || '';
    const bootstrapPayload = bootstrapType.includes('application/json')
      ? await bootstrapResponse.json()
      : { error: `Non-JSON response (${bootstrapResponse.status})`, body: (await bootstrapResponse.text()).slice(0, 300) };
    bootstrapPayload._status = bootstrapResponse.status;
    applyResponseCookies(bootstrapResponse);

    if (!bootstrapResponse.ok || !bootstrapPayload.success) {
      throw new Error(bootstrapPayload.error || `Wallet auth bootstrap failed (${bootstrapResponse.status})`);
    }

    const finalBootstrapCookies = mergeCookieStrings(bot.session?.cookies || '', cookieString);
    const finalBootstrapCsrf = parseCookieString(finalBootstrapCookies).csrftoken || bot.session?.csrf || bootstrapCsrf;
    bot.setSession(finalBootstrapCookies, finalBootstrapCsrf, true);
    return bootstrapPayload;
  }

  const response = await bot.fetchWithSession(`${baseUrl}/api/auth/wallet/`, {
    method: 'POST',
    body: { wallet_address: bot.walletAddress },
    sessionOverride: {
      cookies: cookieString,
      cookieHeader,
      csrf,
    },
  });

  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json')
    ? await response.json()
    : { error: `Non-JSON response (${response.status})`, body: (await response.text()).slice(0, 300) };
  payload._status = response.status;
  applyResponseCookies(response);

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || `Wallet auth failed (${response.status})`);
  }

  const mergedCookies = mergeCookieStrings(bot.session.cookies, cookieString, bot.accountConfig.cookies || '');
  const mergedParsed = parseCookieString(mergedCookies);
  const finalCsrf = mergedParsed.csrftoken || bot.session.csrf || csrf;
  bot.setSession(mergedCookies, finalCsrf, true);
  return payload;
}

async function ensureSession(bot, { force = false, currentSessionFile, currentAccountsFile }) {
  if (!force && bot.session?.cookieHeader && bot.session?.csrf) return true;
  if (!bot.walletAddress) {
    throw new Error(`No session found. Save one in ${currentSessionFile()} or ${currentAccountsFile()}, or provide --private-key for wallet auth.`);
  }
  await walletLogin(bot, { force, baseUrl: bot.baseUrl || 'https://inception.dachain.io' });
  return true;
}

module.exports = { walletLogin, ensureSession };
