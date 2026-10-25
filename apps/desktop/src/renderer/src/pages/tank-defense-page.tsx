import "@auro/views/tank-defense/tank-defense.css";
import { defaultStorage } from "@auro/core/platform";
import { TankDefensePage } from "@auro/views/tank-defense";

export function TanksPage() {
  return <TankDefensePage storage={defaultStorage} />;
}
