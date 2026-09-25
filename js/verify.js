// Vérifier qu'une adresse email est bien à soi : code à 6 chiffres reçu
// par email, tapé dans une feuille. Utilisé pour envoyer "de la part de",
// se connecter à son compte, recevoir les récapitulatifs de retours.
// Module léger (pas d'upload, pas de lecteur) : l'accueil le charge aussi.

import { emailVerified, knownVerified, requestEmailCode, confirmEmailCode } from "./api.js?v=62";
import { icon } from "./icons.js?v=62";
import { esc, h, toast, errorText, openSheet } from "./ui.js?v=62";


// "ok" : adresse vérifiée ; "skip" : on continue sans (lien seul) ;
// "cancel" : on revient au formulaire. `api` est remplaçable pour le banc
// d'essai (dev/views.html), qui n'a pas de serveur.
const realApi = { knownVerified, emailVerified, requestEmailCode, confirmEmailCode };

export async function ensureVerified(email, opts, api) {
  api = api || realApi;
  if (api.knownVerified(email)) return "ok";
  try {
    if (await api.emailVerified(email)) return "ok";
    const r = await api.requestEmailCode(email);
    if (r && r.verified) return "ok";
  } catch (err) {
    toast(errorText(err), "err");
    return "cancel";
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      if (timer) clearInterval(timer);
      resolve(value);
      sheet.close();
    };

    const body = h(
      '<div class="verify">' +
        '<p class="muted">On vient d\'envoyer un code à 6 chiffres à <strong>' + esc(email) + "</strong>. " +
          "C'est la seule fois sur cet appareil.</p>" +
        '<input class="input code-input mono" type="text" inputmode="numeric" autocomplete="one-time-code" ' +
          'maxlength="6" pattern="[0-9]*" placeholder="000000" aria-label="Code reçu par email" data-code>' +
        '<p class="hint verify-msg" data-msg>Pas reçu ? Regarde dans les spams, il peut mettre une minute.</p>' +
        '<button class="btn btn-primary btn-block" type="button" data-ok>Valider</button>' +
        '<div class="row-2 verify-more">' +
          '<button class="btn btn-ghost btn-sm" type="button" data-resend></button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-change>Changer d\'adresse</button>' +
        "</div>" +
        (opts && opts.optional
          ? '<button class="btn btn-ghost btn-block btn-sm" type="button" data-skip>Continuer sans vérifier</button>' +
            '<p class="hint center">Tu auras ton lien, mais pas d\'avis quand c\'est téléchargé.</p>'
          : "") +
      "</div>"
    );
    const sheet = openSheet({ title: "Vérifie ton email", body, onClose: () => finish("cancel") });

    const input = body.querySelector("[data-code]");
    const msg = body.querySelector("[data-msg]");
    const ok = body.querySelector("[data-ok]");
    const resend = body.querySelector("[data-resend]");

    let wait = 30;
    let timer = null;
    const tick = () => {
      resend.disabled = wait > 0;
      resend.textContent = wait > 0 ? "Renvoyer (" + wait + " s)" : "Renvoyer le code";
      if (wait-- <= 0) { clearInterval(timer); timer = null; }
    };
    const startTimer = () => { wait = 30; tick(); if (!timer) timer = setInterval(tick, 1000); };
    startTimer();

    let checking = false;
    async function check() {
      const code = input.value.replace(/\D/g, "");
      if (code.length !== 6 || checking) return;
      checking = true;
      ok.disabled = true;
      ok.innerHTML = '<span class="spinner"></span><span>Vérification...</span>';
      try {
        if (await api.confirmEmailCode(email, code)) {
          if (timer) clearInterval(timer);
          toast("Email vérifié", "ok");
          return finish("ok");
        }
      } catch (err) {
        msg.textContent = errorText(err);
        msg.classList.add("is-bad");
        input.select();
      }
      checking = false;
      ok.disabled = false;
      ok.textContent = "Valider";
    }

    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
      msg.classList.remove("is-bad");
      if (input.value.length === 6) check();
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); check(); } });
    ok.onclick = check;

    resend.onclick = async () => {
      resend.disabled = true;
      try {
        await api.requestEmailCode(email);
        msg.textContent = "Nouveau code envoyé. L'ancien ne marche plus.";
        msg.classList.remove("is-bad");
        input.value = "";
        input.focus();
        startTimer();
      } catch (err) {
        msg.textContent = errorText(err);
        msg.classList.add("is-bad");
        resend.disabled = false;
      }
    };
    body.querySelector("[data-change]").onclick = () => {
      if (timer) clearInterval(timer);
      finish("cancel");
      const field = document.querySelector("[name=reply]");
      if (field) { field.focus(); field.select(); }
    };
    const skip = body.querySelector("[data-skip]");
    if (skip) skip.onclick = () => { if (timer) clearInterval(timer); finish("skip"); };

    setTimeout(() => input.focus(), 250);
  });
}

