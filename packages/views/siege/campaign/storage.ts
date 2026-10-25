import {
  CampaignLoadoutSchema,
  CampaignProgressSchema,
  compileCampaignWeapon,
  defaultProgress,
  presetBlueprint,
  validCheckpoint,
  WeaponKindSchema,
  type CampaignBlueprint,
  type CampaignCheckpoint,
  type CampaignProgress,
  type SiegePlatform,
  type WeaponKind,
} from "@auro/core/siege";

const PROGRESS_KEY = "siege-campaign-progress";
const CHECKPOINT_KEY = "siege-campaign-checkpoint";
const LOADOUT_KEY = "siege-campaign-loadout";

export const defaultLoadout = () =>
  Object.fromEntries(WeaponKindSchema.options.map(kind => [kind, presetBlueprint(kind)])) as Record<WeaponKind, CampaignBlueprint>;

/**
 * Campaign persistence, bound to an injected platform instead of localStorage.
 *
 * Storage failures are returned, not thrown: the campaign is playable without
 * persistence, so the caller turns `false` into a notice rather than an error.
 */
export function createCampaignStorage(platform: SiegePlatform) {
  const preferences = platform.preferences;

  function read(key: string): unknown {
    try {
      const text = preferences.getItem(key);
      return typeof text === "string" ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  function write(key: string, value: unknown): boolean {
    try {
      const text = JSON.stringify(value);
      preferences.setItem(key, text);
      return preferences.getItem(key) === text;
    } catch {
      return false;
    }
  }

  function readLoadout(): { loadout: Record<WeaponKind, CampaignBlueprint>; invalidLoadout: boolean } {
    const input = read(LOADOUT_KEY);
    const parsed = CampaignLoadoutSchema.safeParse(input);
    if (parsed.success) {
      try {
        for (const kind of WeaponKindSchema.options) compileCampaignWeapon(kind, parsed.data.blueprints[kind]);
        return { loadout: parsed.data.blueprints, invalidLoadout: false };
      } catch {
        /* Invalid geometry must never enter the live battle. */
      }
    }
    return { loadout: defaultLoadout(), invalidLoadout: input !== null };
  }

  function readProgress(): CampaignProgress {
    const parsed = CampaignProgressSchema.safeParse(read(PROGRESS_KEY));
    return parsed.success ? parsed.data : defaultProgress();
  }

  function readCheckpoint(): { checkpoint: CampaignCheckpoint | null; invalid: boolean } {
    const input = read(CHECKPOINT_KEY);
    const checkpoint = validCheckpoint(input);
    return { checkpoint, invalid: input !== null && !checkpoint };
  }

  return {
    readProgress,
    writeProgress: (progress: CampaignProgress) => write(PROGRESS_KEY, progress),
    readCheckpoint,
    writeCheckpoint: (checkpoint: CampaignCheckpoint) => write(CHECKPOINT_KEY, checkpoint),
    clearCheckpoint: () => preferences.removeItem(CHECKPOINT_KEY),
    readLoadout,
    writeLoadout: (blueprints: Record<WeaponKind, CampaignBlueprint>) => write(LOADOUT_KEY, { version: 1, blueprints }),
  };
}

export type CampaignStorage = ReturnType<typeof createCampaignStorage>;
