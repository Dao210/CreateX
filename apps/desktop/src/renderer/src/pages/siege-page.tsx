import "@auro/views/siege/siege.css";
import { defaultStorage } from "@auro/core/platform";
import { SiegePage as SharedSiegePage } from "@auro/views/siege";
export function SiegePage() { return <SharedSiegePage storage={defaultStorage} />; }
export function SiegeCampaignPage() { return <SharedSiegePage storage={defaultStorage} campaign />; }
