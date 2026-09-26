// Temps réel : un seul canal par espace. Les changements en base arrivent
// déjà filtrés par la RLS ; on les relaie sur le bus de l'appli, et la
// présence dit qui a l'appli ouverte en ce moment. Les messages "jam"
// (qui fait tourner quoi, où en est la lecture) passent en broadcast :
// rien n'est écrit en base.

import { sb } from "./db.js?v=94";

let live = null;

// Diffuse un état de lecture aux autres membres de l'espace.
export function sendJam(payload) {
  if (live) live.send({ type: "broadcast", event: "jam", payload }).catch(() => {});
}

const TABLES = ["projects", "files", "comments", "participants", "transfers", "transfer_recipients"];

export function connectSpace(space, bus) {
  const channel = sb.channel("space:" + space.id, {
    // canal privé : la base vérifie que l'appelant est membre de l'espace
    // (policies sur realtime.messages) avant de le laisser écouter ou parler
    config: { private: true, presence: { key: space.participantId }, broadcast: { self: false } }
  });
  live = channel;

  channel.on("broadcast", { event: "jam" }, (msg) => bus.emit("jam", msg.payload));

  for (const table of TABLES) {
    channel.on("postgres_changes",
      { event: "*", schema: "public", table, filter: "space_id=eq." + space.id },
      (payload) => bus.emit("db", { table, type: payload.eventType, row: payload.new, old: payload.old }));
  }

  channel.on("presence", { event: "sync" }, () => {
    const st = channel.presenceState();
    bus.emit("presence", Object.keys(st));
    bus.emit("presence-list", Object.keys(st).map((id) => ({ id, pseudo: (st[id][0] && st[id][0].pseudo) || "" })));
  });

  channel.subscribe(async (status) => {
    bus.emit("realtime", status);
    if (status === "SUBSCRIBED") {
      await channel.track({ pseudo: space.pseudo, since: Date.now() });
    }
  });

  // Le jeton de la session anonyme est renouvelé toutes les heures : le
  // canal doit suivre, sinon il se tait sans prévenir.
  const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
    if (session && event === "TOKEN_REFRESHED") sb.realtime.setAuth(session.access_token);
  });

  return () => {
    sub.subscription.unsubscribe();
    if (live === channel) live = null;
    sb.removeChannel(channel);
  };
}
