import "@auro/views/fish/fish.css";
import { defaultStorage } from "@auro/core/platform";
import { FishPage } from "@auro/views/fish";
export function OceanPage() { return <FishPage storage={defaultStorage} />; }
