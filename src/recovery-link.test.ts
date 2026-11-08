import { describe, expect, it, vi } from "vitest";
import { takeRecoveryLink } from "./recovery-link";
const token = "a".repeat(43);
function inspect(hash: string) {
  const replaceState = vi.fn();
  const state = { navigation: "preserved" };
  const result = takeRecoveryLink(
    { hash, pathname: "/loja", search: "?sort=newest" },
    { state, replaceState },
  );
  return { result, replaceState, state };
}
describe("Recovery fragment handling", () => {
  it("captures a valid reset credential and removes it from the URL before rendering", () => {
    const { result, replaceState, state } = inspect(`#reset-password=${token}`);
    expect(result).toEqual({ present: true, token });
    expect(replaceState).toHaveBeenCalledExactlyOnceWith(
      state,
      "",
      "/loja?sort=newest",
    );
  });
  it.each([
    "#reset-password=",
    "#reset-password=invalid",
    `#reset-password=${token}&reset-password=${token}`,
    `#reset-password=${token}&other=1`,
    `#reset-password=${token}=`,
    `#reset-password=${token}%20`,
  ])("scrubs an invalid or duplicated credential %#", (hash) => {
    const { result, replaceState } = inspect(hash);
    expect(result).toEqual({ present: true, token: null });
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0][2]).not.toContain(token);
  });
  it.each(["", "#catalogo", "#produto-025", "#other=value"])(
    "preserves ordinary navigation fragment %#",
    (hash) => {
      const { result, replaceState } = inspect(hash);
      expect(result).toEqual({ present: false, token: null });
      expect(replaceState).not.toHaveBeenCalled();
    },
  );
});
