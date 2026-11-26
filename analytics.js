// FocusReps site analytics, shared by every page.
// PostHog loads only after cookie consent (localStorage "fr.consent" === "yes").
// Events:
//   web.focusreps.pageview        every page (PostHog adds $pathname)
//   web.focusreps.appstore_click  any App Store link, { placement: nav|hero|get_app|final|article|tool|footer|... }
//   web.focusreps.pdf_download    any .pdf link, { file }
//   web.focusreps.404             404 page, { path, referrer }
// Demo events (web.focusreps.demo_*) are sent by demo/demo.js.
(function () {
  var KEY = 'phc_x9aujhwB7UGrY7GUKtDUT2NqDMefkAZk86peGeGWo5u2';
  var PRIVACY_URL = 'https://agilelabs.pl/apps/privacy_policy';

  function getConsent() { try { return localStorage.getItem('fr.consent'); } catch (e) { return null; } }
  function setConsent(v) { try { localStorage.setItem('fr.consent', v); } catch (e) {} }

  function capture(name, props, beacon) {
    if (!window.__frAnalytics || !window.posthog || !window.posthog.capture) return;
    try { window.posthog.capture('web.focusreps.' + name, props || {}, beacon ? { transport: 'sendBeacon' } : undefined); } catch (e) {}
  }

  function load() {
    if (window.__frAnalytics) return;
    window.__frAnalytics = true;
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    window.posthog.init(KEY, {
      api_host: 'https://eu.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: false,
      autocapture: false
    });
    window.posthog.register({ source: 'web.focusreps' });
    capture('pageview');
    if (document.documentElement.getAttribute('data-page') === '404') {
      capture('404', { path: location.pathname, referrer: document.referrer || null });
    }
  }
  window.frLoadAnalytics = load;

  // Where on the page a link sits, so we can compare CTAs.
  function placement(el) {
    if (el.closest('.site-header')) return 'nav';
    if (el.closest('.site-footer')) return 'footer';
    if (el.closest('.hero')) return 'hero';
    if (el.closest('.get-app')) return 'get_app';
    if (el.closest('.final-cta')) return 'final';
    var sec = el.closest('section[id], article, aside');
    if (sec && sec.id) return sec.id;
    if (el.closest('article')) return 'article';
    if (location.pathname.indexOf('/tools/') === 0) return 'tool';
    return 'body';
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.closest('.frd-overlay')) return; // demo popup tracks itself
    var href = a.getAttribute('href') || '';
    if (href.indexOf('apps.apple.com') !== -1) {
      capture('appstore_click', { placement: placement(a), page: location.pathname }, true);
    } else if (/\.pdf($|[?#])/i.test(href)) {
      capture('pdf_download', { file: href.split('/').pop().split(/[?#]/)[0], page: location.pathname }, true);
    }
  }, true);

  // Cookie banner: reuse one in the page, or inject it.
  function banner() {
    var b = document.getElementById('cookie-banner');
    if (b) return b;
    b = document.createElement('div');
    b.className = 'cookie-banner';
    b.id = 'cookie-banner';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-live', 'polite');
    b.setAttribute('aria-label', 'Cookie consent');
    b.hidden = true;
    b.innerHTML = '<p>By clicking “Accept all cookies”, you agree to the storing of cookies on your device and the use of similar technologies to enhance site navigation and analyze site traffic. See our <a href="' + PRIVACY_URL + '" rel="noopener">Privacy Policy</a>.</p>' +
      '<div class="cookie-actions"><button type="button" class="btn btn-ghost" data-consent="no">Decline</button>' +
      '<button type="button" class="btn" data-consent="yes">Accept all cookies</button></div>';
    document.body.appendChild(b);
    return b;
  }

  function init() {
    var b = banner();
    if (!getConsent()) b.hidden = false;
    b.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-consent]');
      if (!btn) return;
      var yes = btn.getAttribute('data-consent') === 'yes';
      setConsent(yes ? 'yes' : 'no');
      b.hidden = true;
      if (yes) load();
      else if (window.posthog && window.posthog.opt_out_capturing) window.posthog.opt_out_capturing();
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-cookie-settings]')) b.hidden = false;
    });
  }

  if (getConsent() === 'yes') load();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
