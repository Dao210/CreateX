import { defaultStorage } from "@auro/core/platform";
import { MePage } from "@auro/views/me";

export function MePageRoute() {
  return <MePage storage={defaultStorage} />;
}
