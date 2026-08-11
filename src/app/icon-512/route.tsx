import { appIcon } from "@/lib/app-icon";

/** The install-prompt size. See `icon-192` for why this is a plain route. */
export function GET() {
  return appIcon(512);
}
