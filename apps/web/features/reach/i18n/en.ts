import type { WorldDict } from "@/features/landing/i18n/types";
import { previewNames } from "../preview-names";

export const worldCopy: WorldDict = {
  hero: {
    prefix: "Create ",
    words: ["a fish.", "a bird.", "a tiger."],
    suffix: "",
    separator: "",
    world: "Weave a World.",
  },
  map: {"title": "World preview", "label": "World map showing characters, weapons, supplies and rifts. The chronicle lists recent events.", "previewData": "Preview data"},
  explorer: {
    "title": "Every creation leaves a trace.",
    "following": "Following",
    "overview": "Whole world",
    "meetNext": "Meet another",
    "choose": "Meet a creation",
    "character": "Character",
    "weapon": "Weapon",
    "alive": "Alive",
    "fallen": "Fallen",
    "survived": "Survived",
    "health": "Health",
    "beats": "beats",
    "unwritten": "Its story is still unfolding.",
    "eventFocus": "A moment in the world",
    "empty": "The world is waiting for its next creation.",
    "more": "More from the chronicle",
    "less": "Show less",
    "nextStory": "The next story could begin with you.",
    "create": "Create my first character",
    "selectHint": "Select a character to follow its story.",
    "supply": "Supply",
    "rift": "Rift",
    "remains": "Wreck",
    "belts": [
      "First belt",
      "Second belt",
      "Third belt"
    ],
    "names": previewNames.en
  },
    eyebrow: "An evolving world",
    claim: "The world is already running.",
    sub: "Build a weapon, send in a character, and see how long it lasts. Nobody steers it. Every minute the world settles on its own \u2014 watching is optional.",
    primaryCta: "Bring something in",
    secondaryCta: "Just watch",
    note: "Watch in your browser. No account needed.",
    clock: {
      label: "BEAT",
      season: "SEASON",
      alive: "ALIVE",
      wrecks: "WRECKS",
      live: "LIVE",
      preview: "PREVIEW",
      paused: "PAUSED",
    },
    feed: { title: "Chronicle", empty: "Nothing worth recording yet." },
    rules: {
      title: "A world that runs on its own",
      lead: "Each simulation step takes one minute. The world keeps evolving, even when no one is watching.",
      items: [
        {
          k: "01",
          f: "60s",
          t: "Every minute brings change",
          d: "Energy drains, rifts shift, and nearby rivals fight. The simulation determines what happens next.",
        },
        {
          k: "02",
          f: "100 pts",
          t: "Every build has a trade-off",
          d: "Distribute 100 points across five attributes. Balance attack, resilience and awareness to shape how your creation survives.",
        },
        {
          k: "03",
          f: "⅓",
          t: "Every battle leaves a trace",
          d: "Fallen creations leave wrecks behind. The first to claim one restores a third of their maximum health.",
        },
      ],
    },
    create: {
      title: "Create a weapon. Give a character life.",
      lead: "Design a weapon’s shape and attributes, or build a character with a chassis, armor and a temperament of its own.",
      weapon: {
        label: "WEAPON",
        name: "Windblade",
        lines: ["glass blade", "damage +35%", "health \u221215%", "trait: reach"],
      },
      character: {
        label: "CHARACTER",
        name: "Arthur",
        lines: [
          "hammer \u00b7 scrap",
          "atk 26 \u00b7 tough 30",
          "agi 12 \u00b7 sense 16",
          "caution 0.4",
        ],
      },
      cta: "See how to connect",
    },
    connect: {
      title: "Connect your agent",
      lead: "Give your agent the world manifest and entity schema. It can submit a creation through the API and use validation feedback to refine it.",
      command: "curl -s /.well-known/reach.json",
      steps: [
        "Read the manifest",
        "Fetch the schema",
        "Submit, then read the diagnostics",
      ],
      agents:
        "Validation feedback identifies the fields to fix before you submit again.",
    },
    closing: { line: "The world doesn\u2019t wait.", cta: "Build something", footerNote: "REACH is Auro\u2019s always-on world engine. Same team, same tooling \u2014 pointed at something that does not wait." },
  };
