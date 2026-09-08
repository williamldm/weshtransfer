// Squelette de l application : routeur a hash + montage des vues.
// Les vues elles-memes (projets, projet, fichier) arrivent au prochain lot,
// une fois Supabase configure.

import { toast } from "./ui.js?v=1";

const view = document.getElementById("view");
const backBtn = document.getElementById("nav-back");

const routes = [
  { pattern: /^#\/projects$/,        name: "projects" },
  { pattern: /^#\/p\/([\w-]+)$/,     name: "project" },
  { pattern: /^#\/f\/([\w-]+)$/,     name: "file" }
];

function resolve(hash) {
  for (const route of routes) {
    const match = hash.match(route.pattern);
    if (match) return { name: route.name, id: match[1] || null };
  }
  return { name: "projects", id: null };
}

async function render() {
  const route = resolve(location.hash || "#/projects");
  backBtn.hidden = route.name === "projects";

  view.innerHTML = '<p class="empty">Vue "' + route.name + '" a brancher.</p>';
}

backBtn.addEventListener("click", () => history.back());
window.addEventListener("hashchange", render);

render().catch((err) => toast(err.message, "err"));
