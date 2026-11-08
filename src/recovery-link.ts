export interface RecoveryLink {
  present: boolean;
  token: string | null;
}

/** The mail link uses a fragment so the credential is not sent to web servers. */
export function takeRecoveryLink(
  location: Pick<Location, "hash" | "pathname" | "search">,
  history: Pick<History, "replaceState" | "state">,
): RecoveryLink {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.has("reset-password")) return { present: false, token: null };
  const values = params.getAll("reset-password");
  const candidate = values[0] ?? "";
  // Scrub even malformed/duplicate credentials before rendering other content.
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${location.search}`,
  );
  return {
    present: true,
    token:
      values.length === 1 &&
      [...params.keys()].length === 1 &&
      /^[A-Za-z0-9_-]{43}$/.test(candidate)
        ? candidate
        : null,
  };
}
