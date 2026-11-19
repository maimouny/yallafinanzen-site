// Sendet eine Anfrage an Netlify Forms (von dort geht sie automatisch nach monday.com).
// Schlägt das Senden fehl, wird einmal neu versucht. Klappt auch das nicht, erscheint
// ein Hinweis mit WhatsApp und Telefon, damit kein Lead stillschweigend verloren geht.
(function () {
  var RETRY_DELAY_MS = 1500;
  var WHATSAPP_URL = 'https://wa.me/491631549878';
  var PHONE_URL = 'tel:+491631549878';
  var TEXT = {
    de: { msg: 'Deine Anfrage konnte gerade nicht gespeichert werden. Schreib uns bitte kurz per WhatsApp oder ruf an.', wa: 'WhatsApp', tel: 'Anrufen', close: 'Hinweis schließen' },
    ar: { msg: 'تعذّر حفظ طلبك الآن. من فضلك راسلنا عبر واتساب أو اتصل بنا.', wa: 'واتساب', tel: 'اتصال', close: 'إغلاق التنبيه' },
    en: { msg: 'We could not save your request just now. Please message us on WhatsApp or give us a call.', wa: 'WhatsApp', tel: 'Call', close: 'Close notice' }
  };

  function post(data) {
    return fetch('/', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString()
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response;
    });
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function link(href, label, primary) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (href.indexOf('https:') === 0) { a.target = '_blank'; a.rel = 'noopener'; }
    a.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:999px;font-weight:700;text-decoration:none;' +
      (primary ? 'background:#25d366;color:#0b2e13;' : 'border:2px solid #ffffff;color:#ffffff;');
    return a;
  }

  function showSendError() {
    if (document.getElementById('lead-send-error')) return;
    var lang = (document.documentElement.lang || 'de').slice(0, 2);
    var t = TEXT[lang] || TEXT.de;
    var box = document.createElement('div');
    box.id = 'lead-send-error';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:50;max-width:520px;margin:0 auto;padding:16px;border-radius:12px;background:#193329;color:#ffffff;font-family:Poppins,"Plex Arabic",Arial,sans-serif;font-size:15px;line-height:1.5;box-shadow:0 10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:12px';
    var p = document.createElement('p');
    p.style.margin = '0';
    p.textContent = t.msg;
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;align-items:center';
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', t.close);
    close.style.cssText = 'margin-inline-start:auto;min-width:44px;min-height:44px;border:0;background:transparent;color:#ffffff;font-size:24px;cursor:pointer';
    close.onclick = function () { box.remove(); };
    row.appendChild(link(WHATSAPP_URL, t.wa, true));
    row.appendChild(link(PHONE_URL, t.tel, false));
    row.appendChild(close);
    box.appendChild(p);
    box.appendChild(row);
    document.body.appendChild(box);
  }

  window.ylPostLead = function (data) {
    return post(data)
      .catch(function () { return wait(RETRY_DELAY_MS).then(function () { return post(data); }); })
      .catch(function (error) {
        console.warn('Formular nicht gesendet');
        showSendError();
        throw error;
      });
  };
})();
