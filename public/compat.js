/*
 * GestiMarket : compatibilité avec les anciens moteurs web, chargée AVANT le programme.
 * Écrit en ancien JavaScript (ES5) pour être lu partout : anciens Android, boîtiers TV, BlueStacks, iOS 13.
 *
 * 1. Fonctions récentes ajoutées si le moteur ne les a pas.
 * 2. Couleurs « mélangées » (color-mix) calculées ici quand le moteur ne sait pas le faire.
 * 3. Si GestiMarket ne démarre pas, un message clair remplace l'écran bloqué (version du moteur web,
 *    marche à suivre pour le mettre à jour).
 */
(function () {
  "use strict";
  var w = window;

  // ---------- 1. Fonctions récentes ----------
  function define(obj, name, fn) {
    if (obj && !obj[name]) {
      try {
        Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true });
      } catch (e) {
        obj[name] = fn;
      }
    }
  }
  if (typeof w.globalThis === "undefined") w.globalThis = w;
  define(Object, "fromEntries", function (entries) {
    var o = {};
    var list = Array.from(entries);
    for (var i = 0; i < list.length; i++) o[list[i][0]] = list[i][1];
    return o;
  });
  define(Object, "hasOwn", function (o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  });
  function at(i) {
    var n = Math.trunc(i) || 0;
    if (n < 0) n += this.length;
    return n < 0 || n >= this.length ? undefined : this[n];
  }
  define(Array.prototype, "at", at);
  define(String.prototype, "at", at);
  define(Array.prototype, "findLast", function (f, t) {
    for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i];
    return undefined;
  });
  define(Array.prototype, "findLastIndex", function (f, t) {
    for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return i;
    return -1;
  });
  // Android 7 et 8 non mis à jour (moteur web d'avant Chrome 69).
  define(Array.prototype, "flat", function flat(depth) {
    var d = depth === undefined ? 1 : Number(depth);
    var out = [];
    (function walk(list, level) {
      for (var i = 0; i < list.length; i++) {
        if (Array.isArray(list[i]) && level > 0) walk(list[i], level - 1);
        else out.push(list[i]);
      }
    })(this, d);
    return out;
  });
  define(Array.prototype, "flatMap", function (f, t) {
    return Array.prototype.map.call(this, f, t).flat(1);
  });
  define(String.prototype, "replaceAll", function (search, rep) {
    if (search instanceof RegExp) return this.replace(search, rep);
    return this.split(String(search)).join(typeof rep === "function" ? rep(String(search)) : rep);
  });
  if (typeof Promise !== "undefined") {
    define(Promise, "allSettled", function (list) {
      return Promise.all(
        Array.from(list).map(function (p) {
          return Promise.resolve(p).then(
            function (value) { return { status: "fulfilled", value: value }; },
            function (reason) { return { status: "rejected", reason: reason }; }
          );
        })
      );
    });
    define(Promise, "withResolvers", function () {
      var out = {};
      out.promise = new Promise(function (res, rej) {
        out.resolve = res;
        out.reject = rej;
      });
      return out;
    });
  }
  define(w, "queueMicrotask", function (fn) {
    Promise.resolve().then(fn);
  });

  // ---------- 2. Couleurs mélangées ----------
  var mixSupported = false;
  try {
    mixSupported = !!(w.CSS && CSS.supports && CSS.supports("color", "color-mix(in srgb, red 50%, blue)"));
  } catch (e) {
    mixSupported = false;
  }

  function parseColor(s) {
    s = s.trim().toLowerCase();
    if (s === "transparent") return [0, 0, 0, 0];
    if (s === "white") return [255, 255, 255, 1];
    if (s === "black") return [0, 0, 0, 1];
    var m = /^#([0-9a-f]{3,8})$/.exec(s);
    if (m) {
      var h = m[1];
      if (h.length === 3 || h.length === 4) h = h.replace(/./g, "$&$&");
      return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16), h.length === 8 ? parseInt(h.substr(6, 2), 16) / 255 : 1];
    }
    m = /^rgba?\(([^)]*)\)$/.exec(s);
    if (m) {
      var p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    return null;
  }

  function closing(text, open) {
    var depth = 0;
    for (var i = open; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")" && --depth === 0) return i;
    }
    return -1;
  }

  function splitArgs(inner) {
    var out = [];
    var depth = 0;
    var start = 0;
    for (var i = 0; i < inner.length; i++) {
      var c = inner[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) {
        out.push(inner.slice(start, i).trim());
        start = i + 1;
      }
    }
    out.push(inner.slice(start).trim());
    return out;
  }

  /** « color-mix(in srgb, A p%, B q%) » → « rgba(...) », mélange dans l'espace sRGB. */
  function mix(args) {
    function part(a) {
      var m = /^(.*?)\s+(\d+(?:\.\d+)?)%$/.exec(a);
      return m ? { color: m[1], share: parseFloat(m[2]) } : { color: a, share: null };
    }
    var a = part(args[1] || "");
    var b = part(args[2] || "");
    var pa = a.share;
    var pb = b.share;
    if (pa === null && pb === null) pa = pb = 50;
    else if (pa === null) pa = 100 - pb;
    else if (pb === null) pb = 100 - pa;
    var ca = parseColor(resolve(a.color));
    var cb = parseColor(resolve(b.color));
    if (!ca || !cb || pa + pb <= 0) return null;
    var ka = pa / (pa + pb);
    var kb = pb / (pa + pb);
    // Mélange avec prise en compte de la transparence (couleurs prémultipliées).
    var alpha = ca[3] * ka + cb[3] * kb;
    var rgb = [0, 1, 2].map(function (i) {
      return alpha > 0 ? Math.round((ca[i] * ca[3] * ka + cb[i] * cb[3] * kb) / alpha) : 0;
    });
    alpha = alpha * Math.min(1, (pa + pb) / 100);
    return "rgba(" + rgb[0] + ", " + rgb[1] + ", " + rgb[2] + ", " + Math.round(alpha * 1000) / 1000 + ")";
  }

  /** Remplace chaque color-mix(...) d'un texte par la couleur calculée (les plus imbriqués d'abord). */
  function resolve(text) {
    var guard = 0;
    var i;
    while ((i = text.lastIndexOf("color-mix(")) >= 0 && guard++ < 20) {
      var open = i + "color-mix".length;
      var close = closing(text, open);
      if (close < 0) break;
      var color = mix(splitArgs(text.slice(open + 1, close)));
      if (!color) return text;
      text = text.slice(0, i) + color + text.slice(close + 1);
    }
    return text;
  }

  var mixedVars = null;
  function collectMixedVars() {
    var names = {};
    for (var s = 0; s < document.styleSheets.length; s++) {
      var rules;
      try {
        rules = document.styleSheets[s].cssRules;
      } catch (e) {
        continue;
      }
      for (var r = 0; rules && r < rules.length; r++) {
        var st = rules[r].style;
        if (!st) continue;
        for (var k = 0; k < st.length; k++) {
          var name = st[k];
          if (name.indexOf("--") === 0 && st.getPropertyValue(name).indexOf("color-mix(") >= 0) names[name] = true;
        }
      }
    }
    return Object.keys(names);
  }

  var lastKey = null;
  function applyMixFallback() {
    var root = document.documentElement;
    if (!mixedVars || !mixedVars.length) mixedVars = collectMixedVars();
    if (!mixedVars.length) return;
    var key = [root.getAttribute("data-theme"), root.getAttribute("data-sidebar"), root.style.getPropertyValue("--brand")].join("|");
    if (key === lastKey) return;
    lastKey = key;
    // On efface les valeurs calculées précédemment, puis on recalcule à partir des styles du thème actuel.
    mixedVars.forEach(function (n) {
      root.style.removeProperty(n);
    });
    var cs = w.getComputedStyle(root);
    var values = mixedVars.map(function (n) {
      return resolve(cs.getPropertyValue(n));
    });
    mixedVars.forEach(function (n, i) {
      if (values[i] && values[i].indexOf("color-mix(") < 0) root.style.setProperty(n, values[i].trim());
    });
  }

  if (!mixSupported) {
    var started = false;
    var start = function () {
      if (started) return;
      started = true;
      applyMixFallback();
      if (w.MutationObserver) {
        new MutationObserver(applyMixFallback).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-sidebar", "style"] });
      }
    };
    // La feuille de styles arrive avec le programme : on attend qu'elle soit là.
    var tries = 0;
    var wait = function () {
      mixedVars = collectMixedVars();
      if (mixedVars.length || tries++ > 100) start();
      else setTimeout(wait, 100);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wait);
    else wait();
  }

  // ---------- 3. Démarrage bloqué : message clair ----------
  var ua = navigator.userAgent || "";
  var engine = (function () {
    var m = /Chrome\/(\d+)/.exec(ua);
    if (m) return "Chrome " + m[1];
    m = /OS (\d+)_(\d+)/.exec(ua);
    if (m && /iPhone|iPad|iPod/.test(ua)) return "iOS " + m[1] + "." + m[2];
    m = /Version\/(\d+(?:\.\d+)?).*Safari/.exec(ua);
    if (m) return "Safari " + m[1];
    m = /Firefox\/(\d+)/.exec(ua);
    return m ? "Firefox " + m[1] : "inconnu";
  })();
  w.__GM_ENGINE__ = engine;
  var errors = [];
  w.addEventListener("error", function (e) {
    if (!w.__GM_READY__ && errors.length < 3) errors.push(String((e && (e.message || (e.target && e.target.src))) || "erreur"));
  }, true);

  function showStuck() {
    if (w.__GM_READY__ || document.getElementById("gm-compat")) return;
    var fr = /^fr/i.test(navigator.language || "fr");
    var android = /Android/.test(ua);
    var ios = /iPhone|iPad|iPod/.test(ua);
    var tips = android
      ? fr
        ? "Ouvrez le Play Store et mettez à jour « Android System WebView » et « Google Chrome », puis relancez GestiMarket."
        : "Open the Play Store and update “Android System WebView” and “Google Chrome”, then restart GestiMarket."
      : ios
      ? fr
        ? "Mettez à jour l'iPhone ou l'iPad (Réglages → Général → Mise à jour logicielle). iOS 13 au minimum."
        : "Update the iPhone or iPad (Settings → General → Software Update). iOS 13 or later is required."
      : fr
      ? "Mettez à jour le navigateur, ou utilisez Chrome, Edge, Firefox ou Safari récents."
      : "Update the browser, or use a recent Chrome, Edge, Firefox or Safari.";
    var box = document.createElement("div");
    box.id = "gm-compat";
    box.setAttribute("style", "position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;background:#0b1a24;color:#fff;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center");
    var inner = document.createElement("div");
    inner.setAttribute("style", "max-width:460px");
    var h = document.createElement("h2");
    h.setAttribute("style", "margin:0 0 12px;font-size:21px");
    h.textContent = fr ? "GestiMarket n'arrive pas à démarrer" : "GestiMarket cannot start";
    var p = document.createElement("p");
    p.setAttribute("style", "margin:0 0 12px;opacity:.9");
    p.textContent = (fr ? "Le moteur web de cet appareil est peut-être trop ancien (" : "This device's web engine may be too old (") + engine + "). " + tips;
    var small = document.createElement("p");
    small.setAttribute("style", "margin:0 0 18px;font-size:12.5px;opacity:.6;word-break:break-word");
    small.textContent = errors.join(" · ");
    var btn = document.createElement("button");
    btn.setAttribute("style", "font:inherit;padding:10px 22px;border-radius:10px;border:0;background:#0f766e;color:#fff");
    btn.textContent = fr ? "Réessayer" : "Try again";
    btn.onclick = function () {
      w.location.reload();
    };
    inner.appendChild(h);
    inner.appendChild(p);
    inner.appendChild(small);
    inner.appendChild(btn);
    box.appendChild(inner);
    (document.body || document.documentElement).appendChild(box);
  }
  w.__GM_SHOW_STUCK__ = showStuck;

  // Moteur sans modules JavaScript : GestiMarket ne peut pas démarrer du tout.
  var modules = "noModule" in document.createElement("script");
  if (!modules) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showStuck);
    else showStuck();
  } else {
    // Programme qui ne démarre pas (fichier refusé par le moteur) : message après 20 secondes.
    setTimeout(showStuck, 20000);
  }
})();
