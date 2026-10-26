import type { SupportedLocale } from "@auro/core/i18n";

export const SITE_URL = "https://weavea.world";
export const BRAND_NAME = "Weave a World";
export const BRAND_NAME_ZH = "织个世界";
export const BRAND_SLOGAN = "Create a Life. Weave a World.";

export const BRAND = {
  en: {
    name: BRAND_NAME,
    slogan: BRAND_SLOGAN,
    genre: "Creative adventure & virtual civilization simulation",
    value: "Your creations change the world.",
    intro: "Create characters and equipment, explore an evolving world, and see your creations become part of its story.",
    description: "Weave a World is a creative adventure and virtual civilization simulation game. Create characters and equipment, explore an evolving world, and shape its story.",
    about: "About Weave a World",
    story: [
      "Every world begins with a creation: a character, a tool, a new way to survive. Weave a World brings those creations into a shared, evolving simulation.",
      "You create characters and equipment, bring them into the world, and follow what happens next. Their encounters, battles, and traces become part of the world's story.",
      "Creative adventure and virtual civilization simulation are the direction of this world. The current world preview lets you observe its simulation; the creation tools are where you begin shaping your own contribution.",
    ],
    play: "Start creating",
    world: "Explore the world",
    rules: "How it works",
    faqTitle: "Before you enter the world",
    faq: [
      { question: "What is Weave a World?", answer: "Weave a World is a creative adventure and virtual civilization simulation game, also known as 织个世界. Its core idea is simple: your creations change the world." },
      { question: "What can I create?", answer: "Begin with characters and equipment. Give a creation its own shape and attributes, then explore how it fits into the world." },
      { question: "Can I watch before I join?", answer: "Yes. You can view the world preview in your browser without signing up or downloading an app. The world view indicates whether it is showing a live simulation or preview data." },
    ],
  },
  "zh-Hans": {
    name: BRAND_NAME_ZH,
    slogan: "创造生命，编织世界",
    genre: "创造型冒险与虚拟文明模拟游戏",
    value: "你的创造，让世界发生改变",
    intro: "创造角色与装备，探索不断演化的世界，让你的创造成为世界故事的一部分。",
    description: "织个世界（Weave a World）是一款创造型冒险与虚拟文明模拟游戏。创造角色与装备，探索不断演化的世界，让你的创造成为世界故事的一部分。创造生命，编织世界。",
    about: "关于织个世界",
    story: [
      "一个角色、一件工具、一种新的生存方式，都可以成为世界的起点。织个世界让这些创造进入同一个不断演化的模拟世界。",
      "你创造角色与装备，把作品带入世界，再观察接下来发生的事。它们的相遇、战斗和留下的痕迹，都会成为世界故事的一部分。",
      "创造型冒险与虚拟文明模拟，是这个世界的发展方向。当前的世界预览让你观察模拟如何运转；创作工具则是你开始改变世界的地方。",
    ],
    play: "开始创造",
    world: "探索世界",
    rules: "世界如何运转",
    faqTitle: "进入世界之前",
    faq: [
      { question: "织个世界是什么游戏？", answer: "织个世界（Weave a World）是一款创造型冒险与虚拟文明模拟游戏。它的核心价值是：你的创造，让世界发生改变。" },
      { question: "我可以创造什么？", answer: "从角色与装备开始，为作品设计外形与属性，再探索它们如何融入这个世界。" },
      { question: "可以先看看再加入吗？", answer: "可以。无需注册或下载应用，就能在浏览器中观看世界预览。世界视图会标明当前展示的是实时模拟还是预览数据。" },
    ],
  },
} as const;

export function brandForLocale(locale: SupportedLocale) {
  return BRAND[locale === "zh-Hans" ? "zh-Hans" : "en"];
}
