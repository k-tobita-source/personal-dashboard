import { describe, expect, it } from "vitest";

import { buildAuthUrl, GOOGLE_SCOPES } from "./oauth";

describe("buildAuthUrl", () => {
  const url = buildAuthUrl({
    clientId: "cid.apps.googleusercontent.com",
    redirectUri: "http://localhost:3000/api/auth/google/callback",
  });
  const parsed = new URL(url);

  it("Google の認可エンドポイントを指す", () => {
    expect(parsed.origin + parsed.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  });

  it("client_id と redirect_uri を含む", () => {
    expect(parsed.searchParams.get("client_id")).toBe(
      "cid.apps.googleusercontent.com",
    );
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/google/callback",
    );
  });

  it("offline + consent で refresh token を要求する", () => {
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
  });

  it("readonly スコープのみを要求する", () => {
    const scope = parsed.searchParams.get("scope") ?? "";
    expect(scope).toContain("calendar.readonly");
    expect(scope).toContain("gmail.readonly");
    expect(scope).not.toContain("calendar.events");
    expect(GOOGLE_SCOPES.every((s) => s.endsWith(".readonly"))).toBe(true);
  });
});
