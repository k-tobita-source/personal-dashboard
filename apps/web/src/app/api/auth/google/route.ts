import { NextResponse } from "next/server";

import { getAuthUrl } from "@pdash/integrations";

export function GET() {
  return NextResponse.redirect(getAuthUrl());
}
