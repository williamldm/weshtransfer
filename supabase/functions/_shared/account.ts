// Comptes par email, sans mot de passe (voir migration ..._seminar_accounts).
//
// loginAccount : l'appareil `uid` a prouvé (code reçu par email) qu'il lit
// `email`. On le rattache au compte de cette adresse :
//   - l'appareil est anonyme et aucun compte n'existe : il DEVIENT le compte
//     (on lui pose l'adresse) ; rien à changer côté session ;
//   - l'appareil est anonyme et le compte existe : ses espaces passent au
//     compte (merge_users), puis on ouvre la session du compte ;
//   - l'appareil est déjà connecté à un autre compte : on ouvre la session
//     du compte demandé (créé s'il n'existe pas), sans rien déplacer.
// Ouvrir la session = jeton de lien magique généré ici, jamais envoyé par
// email ; le navigateur l'échange contre une session (verifyOtp).

// deno-lint-ignore-file no-explicit-any

export type Login = { accountId: string; token: string | null };

export async function loginAccount(db: any, uid: string, email: string): Promise<Login> {
  const { data: me } = await db.auth.admin.getUserById(uid);
  const myEmail = (me?.user?.email || "").toLowerCase() || null;
  if (myEmail === email) return { accountId: uid, token: null };

  // compte non confirmé posé sur l'adresse par quelqu'un d'autre : effacé
  await db.rpc("drop_email_squatters", { p_email: email });
  const { data: existing } = await db.rpc("account_for_email", { p_email: email });
  let accountId = (existing as string | null) || null;

  if (accountId) {
    if (!myEmail) {
      const { error } = await db.rpc("merge_users", { p_from: uid, p_to: accountId });
      if (error) throw new Error("FUSION : " + error.message);
    }
  } else if (!myEmail) {
    const { error } = await db.auth.admin.updateUserById(uid, { email, email_confirm: true });
    if (error) throw new Error("COMPTE : " + error.message);
    await db.from("sender_emails").upsert({ user_id: uid, email }, { onConflict: "user_id,email" });
    return { accountId: uid, token: null };
  } else {
    const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw new Error("COMPTE : " + error.message);
    accountId = data.user.id;
  }

  // l'adresse est prouvée : le compte peut envoyer en son nom sans recode
  await db.from("sender_emails").upsert({ user_id: accountId, email }, { onConflict: "user_id,email" });
  const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error("SESSION : " + error.message);
  return { accountId: accountId!, token: link.properties.hashed_token };
}
