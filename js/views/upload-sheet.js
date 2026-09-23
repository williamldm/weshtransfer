// Feuille "Ajouter des sons" : choix du morceau, du type, détails optionnels.
// L'upload démarre dès validation ; on peut naviguer pendant qu'il tourne.

import { enqueue, checkFile, guessKind, guessBpm, titleFromName } from "../upload.js?v=12";
import { listProjects, createProject } from "../api.js?v=12";
import { icon } from "../icons.js?v=12";
import { CATEGORY, categoryOf, isAudio } from "../files.js?v=12";
import { esc, h, openSheet, toast, errorText, formatBytes, KINDS } from "../ui.js?v=12";

// opts : { projectId, newTitle, tag, onQueued(jobs, projectId) }
export async function openUploadSheet(ctx, fileList, opts) {
  const o = opts || {};
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const checked = files.map((f) => ({ file: f, error: checkFile(f, ctx.space.maxFileBytes) }));
  const ok = checked.filter((c) => !c.error).map((c) => c.file);

  const kinds = [...new Set(ok.map((f) => guessKind(f.name)))];
  const kind = kinds.length === 1 ? kinds[0] : (ok.length > 1 ? "stems" : "autre");
  const bpm = ok.map((f) => guessBpm(f.name)).find(Boolean) || "";
  const suggested = o.newTitle || titleFromName(ok[0] ? ok[0].name : "");

  const total = ok.reduce((s, f) => s + f.size, 0);

  const body = h(
    '<form class="upload-form" novalidate>' +
      '<ul class="file-pick">' + checked.map((c) =>
        '<li class="' + (c.error ? "is-bad" : "") + '">' +
          icon(c.error ? "alert" : CATEGORY[categoryOf(c.file.name, c.file.type)].icon, 18) +
          '<span class="n">' + esc(c.file.name) + "</span>" +
          '<span class="s">' + (c.error ? esc(c.error) : formatBytes(c.file.size)) + "</span>" +
        "</li>").join("") +
      "</ul>" +

      '<div class="field"><span class="label">Morceau</span>' +
        '<select class="input" name="project"><option value="__new">+ Nouveau morceau</option></select>' +
      "</div>" +
      '<div class="field" data-newtitle><span class="label">Titre du nouveau morceau</span>' +
        '<input class="input" name="title" maxlength="80" value="' + esc(suggested) + '">' +
      "</div>" +

      '<div class="field"' + (ok.some((f) => isAudio(f.name, f.type)) ? "" : " hidden") + '><span class="label">Type</span><div class="chips" role="radiogroup">' +
        KINDS.map(([k, label]) =>
          '<label class="chip kind-chip kind-' + k + '"><input type="radio" name="kind" value="' + k + '"' +
          (k === kind ? " checked" : "") + "><span>" + label + "</span></label>").join("") +
      "</div></div>" +

      '<details class="more"><summary>BPM, tonalité, étiquette</summary>' +
        '<div class="grid-3">' +
          '<label class="field"><span class="label">BPM</span><input class="input" name="bpm" inputmode="numeric" maxlength="3" value="' + esc(bpm) + '"></label>' +
          '<label class="field"><span class="label">Tonalité</span><input class="input" name="key" maxlength="8" placeholder="Am"></label>' +
          '<label class="field"><span class="label">Étiquette</span><input class="input" name="label" maxlength="40" placeholder="take 2"></label>' +
        "</div>" +
      "</details>" +

      '<button class="btn btn-primary btn-block btn-xl" type="submit"' + (ok.length ? "" : " disabled") + ">" +
        icon("upload") + " " + (ok.length > 1 ? "Uploader " + ok.length + " fichiers" : "Uploader") +
        (ok.length ? ' <span class="btn-sub">' + formatBytes(total) + "</span>" : "") +
      "</button>" +
    "</form>"
  );

  const sheet = openSheet({ title: "Ajouter des sons", body });
  const select = body.querySelector("[name=project]");
  const titleField = body.querySelector("[data-newtitle]");

  const syncTitle = () => { titleField.hidden = select.value !== "__new"; };
  select.addEventListener("change", syncTitle);

  // Liste des morceaux existants, chargée pendant qu'on regarde la feuille.
  try {
    const projects = await listProjects(ctx.space.id);
    for (const p of projects) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.title;
      select.appendChild(opt);
    }
    if (o.projectId) select.value = o.projectId;
  } catch (err) {
    toast(errorText(err), "err");
  }
  syncTitle();

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!ok.length) return;
    const btn = body.querySelector("[type=submit]");
    btn.disabled = true;

    try {
      const form = new FormData(body);
      let projectId = select.value;
      let projectTitle = select.options[select.selectedIndex].textContent;

      if (projectId === "__new") {
        const title = String(form.get("title") || "").trim() || suggested;
        const created = await createProject(ctx.space.id, title);
        projectId = created.id;
        projectTitle = created.title;
      }

      const bpmValue = parseInt(String(form.get("bpm") || ""), 10);
      const jobs = enqueue(ok, {
        spaceId: ctx.space.id,
        projectId,
        projectTitle,
        kind: String(form.get("kind") || "autre"),
        label: String(form.get("label") || "").trim() || null,
        bpm: bpmValue >= 40 && bpmValue <= 300 ? bpmValue : null,
        musicalKey: String(form.get("key") || "").trim() || null,
        tag: o.tag || null
      });

      sheet.close();
      if (o.onQueued) o.onQueued(jobs, projectId);
      else ctx.navigate("#/p/" + projectId);
    } catch (err) {
      btn.disabled = false;
      toast(errorText(err), "err");
    }
  });
}
