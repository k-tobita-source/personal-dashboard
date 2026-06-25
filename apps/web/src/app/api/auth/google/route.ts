import { NextResponse } from "next/server";

import { getAuthUrl } from "@acme/integrations";

export function GET() {
  return NextResponse.redirect(getAuthUrl());
}
