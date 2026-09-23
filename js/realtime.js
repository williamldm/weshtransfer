// Temps réel : un seul canal par espace. Les changements en base arrivent
// déjà filtrés par la RLS ; on les relaie sur le bus de l'appli, et la
// présence dit qui a l'appli ouverte en ce moment.

import { sb } from "./db.js?v=17";

const TABLES = ["projects", "files", "comments", "participants", "transfers", "transfer_recipients"];

export function connectSpace(space, bus) {
  const channel = sb.channel("space:" + space.id, {
    config: { presence: { key: space.participantId } }
  });

  for (const table of TABLES) {
    channel.on("postgres_changes",
      { event: "*", schema: "public", table, filter: "space_id=eq." + space.id },
      (payload) => bus.emit("db", { table, type: payload.eventType, row: payload.new, old: payload.old }));
  }

  channel.on("presence", { event: "sync" }, () => {
    bus.emit("presence", Object.keys(channel.presenceState()));
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
    sb.removeChannel(channel);
  };
}
