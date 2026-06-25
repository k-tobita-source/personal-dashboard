import { NextResponse } from "next/server";

import { exchangeCodeAndSave } from "@pdash/integrations";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const base = url.origin;
  if (!code) {
    return NextResponse.redirect(`${base}/?google=error`);
  }
  try {
    await exchangeCodeAndSave(code);
    return NextResponse.redirect(`${base}/?google=connected`);
  } catch {
    return NextResponse.redirect(`${base}/?google=error`);
  }
}
