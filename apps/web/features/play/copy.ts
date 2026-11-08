import type { SupportedLocale } from "@auro/core/i18n";
import type { PlayCopy } from "./types";

const en: PlayCopy = {
  eyebrow: "A world you create your way into",
  intro: "What you create becomes how you play.",
  choose: "Choose a way to play", how: "See how it works", recorded: "Gameplay recording", accelerated: "Gameplay · time-lapse", play: "Play gameplay recording", pause: "Pause gameplay recording", mediaError: "The recording could not load. You can still start creating below.", example: "Example creation",
  gamesTitle: "What will you bring into the game?", gamesLead: "Each creation opens a different way to play.",
  stepsTitle: "From an idea to something you can play with.",
  steps: [
    { title: "Start with an idea", body: "Choose a game and decide what makes your creation yours." },
    { title: "Create and refine", body: "Adjust and save your design. Your own agent can also create tanks and fish." },
    { title: "Bring it into the game", body: "Take the controls, release your fish, or welcome a resident to town." },
  ],
  closing: "Your next game starts with your own creation.", chooseFirst: "Choose my first creation",
  games: {
    tank: { label: "Tank", creation: "Create a tank.", experience: "Defend the castle.", action: "Create my tank", mode: "Take the controls", description: "Choose a chassis, armor, cannon and colors. Drive your tank, defeat incoming enemies and defend your base.", example: "Terra", exampleDetail: "Sand-gold · rapid cannon · striped paint", sceneLabel: "A sand-gold custom tank moving and firing in the actual castle-defense game." },
    fish: { label: "Fish", creation: "Create a fish.", experience: "Swim through the bay.", action: "Create my fish", mode: "Release and observe", description: "Shape its body, fins, tail and colors. Release your fish into the ocean and follow it swimming among the shoals.", example: "Azure sail", exampleDetail: "Blue body · sail-shaped fins · flowing tail", sceneLabel: "The Azure sail example fish swimming in the actual ocean renderer." },
    resident: { label: "Resident", creation: "Create a resident.", experience: "Live a life in town.", action: "Create my resident", mode: "Observe and interact", description: "Give a resident a name, occupation, background and interests. Follow their days at work and in conversation, and take part in town life.", example: "Rowan", exampleDetail: "Farmer · an interest in nature", sceneLabel: "Residents walking and working in the actual town simulation, shown at an accelerated pace." },
  },
};
const zh: PlayCopy = {
  eyebrow: "创造，然后进入游戏",
  intro: "你创造的东西，就是你参与游戏的方式。",
  choose: "选择一种玩法", how: "先看看怎么玩", recorded: "游戏实录", accelerated: "游戏实录 · 加速展示", play: "播放游戏实录", pause: "暂停游戏实录", mediaError: "实录暂时无法播放，你仍可以从下方开始创造。", example: "示例作品",
  gamesTitle: "你的第一份创造，会是什么？", gamesLead: "每一种创造，都有自己的玩法。",
  stepsTitle: "让一个想法，走进游戏。",
  steps: [
    { title: "从一个想法开始", body: "选一种玩法，想想你的作品有什么特点。" },
    { title: "把它变成你的作品", body: "调整并保存。坦克和鱼也可以交给自己的 Agent 创造。" },
    { title: "带它进入游戏", body: "驾驶坦克、投放鱼，或迎接一位小镇居民。" },
  ],
  closing: "下一场游戏，从你的创造开始。", chooseFirst: "选择我的第一份创造",
  games: {
    tank: { label: "坦克", creation: "创造一辆坦克，", experience: "保卫城堡。", action: "创造我的坦克", mode: "亲自操控", description: "选择底盘、装甲、炮塔和涂装。驾驶你创造的坦克，击退来袭的敌人，守住基地。", example: "Terra", exampleDetail: "沙金色 · 速射炮 · 条纹涂装", sceneLabel: "沙金色自定义坦克在真实坦克守卫游戏中移动、射击，保卫基地。" },
    fish: { label: "鱼", creation: "创造一条鱼，", experience: "在海湾中畅游。", action: "创造我的鱼", mode: "投放与观赏", description: "设计身体、鳍尾和配色。把鱼放入海洋，跟随它转向、摆尾，与鱼群一起游动。", example: "蓝帆鱼", exampleDetail: "蓝色身体 · 帆形鱼鳍 · 舒展的尾巴", sceneLabel: "蓝帆鱼在真实海洋场景中摆尾游动。" },
    resident: { label: "居民", creation: "创造一位居民，", experience: "在小镇生活。", action: "创造我的居民", mode: "观察与互动", description: "为居民设定名字、职业、背景和兴趣。看他工作、交谈，参与小镇日常，也与他互动。", example: "Rowan", exampleDetail: "农夫 · 喜欢自然", sceneLabel: "真实小镇模拟中的居民行走、工作画面，经过加速展示。" },
  },
};
const ja: PlayCopy = {
  eyebrow: "創造から、ゲームの中へ",
  intro: "あなたの創造が、あなたの遊び方になる。",
  choose: "遊び方を選ぶ", how: "遊び方を見る", recorded: "ゲームプレイ映像", accelerated: "ゲームプレイ · 早送り", play: "ゲームプレイ映像を再生", pause: "ゲームプレイ映像を一時停止", mediaError: "映像を読み込めませんでした。下から創作を始められます。", example: "作品例",
  gamesTitle: "最初に、何を創りますか？", gamesLead: "創るものによって、遊び方も変わります。",
  stepsTitle: "ひとつのアイデアを、ゲームの中へ。",
  steps: [
    { title: "アイデアから始める", body: "遊びたいゲームを選び、作品の個性を考えましょう。" },
    { title: "創って、調整する", body: "調整して保存。戦車と魚は、自分の Agent に創ってもらうこともできます。" },
    { title: "ゲームに迎え入れる", body: "戦車を操縦し、魚を海に放ち、住民を町へ迎えましょう。" },
  ],
  closing: "次のゲームは、あなたの創造から。", chooseFirst: "最初の作品を選ぶ",
  games: {
    tank: { label: "戦車", creation: "戦車を創って、", experience: "城を守ろう。", action: "自分の戦車を創る", mode: "自分で操縦", description: "車体、装甲、砲と塗装を選択。自作の戦車を操縦し、迫りくる敵を倒して基地を守ります。", example: "Terra", exampleDetail: "砂金色 · 速射砲 · ストライプ", sceneLabel: "実際の防衛ゲームで、砂金色のカスタム戦車が移動して射撃する映像。" },
    fish: { label: "魚", creation: "魚を創って、", experience: "入り江を泳ごう。", action: "自分の魚を創る", mode: "海に放って観察", description: "体、ひれ、尾や配色をデザイン。海へ放ち、魚群と泳ぐ姿や尾の動きを見守れます。", example: "青い帆の魚", exampleDetail: "青い体 · 帆のようなひれ · 長い尾", sceneLabel: "実際の海の描画エンジンで、青い帆の魚が泳ぐ映像。" },
    resident: { label: "住民", creation: "住民を創って、", experience: "町で暮らそう。", action: "自分の住民を創る", mode: "見守って交流", description: "名前、職業、背景、興味を設定。仕事や会話の様子を見守り、町の暮らしに関われます。", example: "Rowan", exampleDetail: "農家 · 自然が好き", sceneLabel: "実際の町のシミュレーションで、住民が歩き、働く様子の早送り映像。" },
  },
};
const ko: PlayCopy = {
  eyebrow: "창작에서 게임 속으로",
  intro: "내가 만든 것이 나만의 플레이 방식이 됩니다.",
  choose: "플레이 방식 선택", how: "플레이 방법 보기", recorded: "실제 게임 영상", accelerated: "실제 게임 · 빠르게 보기", play: "게임 영상 재생", pause: "게임 영상 일시 정지", mediaError: "영상을 불러오지 못했습니다. 아래에서 창작을 시작할 수 있습니다.", example: "예시 작품",
  gamesTitle: "처음에는 무엇을 만들까요?", gamesLead: "창작물마다 새로운 플레이가 기다립니다.",
  stepsTitle: "아이디어 하나를 게임 속으로.",
  steps: [
    { title: "아이디어로 시작하기", body: "게임을 고르고 창작물만의 특징을 떠올려 보세요." },
    { title: "만들고 다듬기", body: "조정하고 저장하세요. 탱크와 물고기는 자신의 Agent로 만들 수도 있습니다." },
    { title: "게임으로 데려오기", body: "탱크를 조종하고, 물고기를 바다에 놓고, 주민을 마을에 맞이하세요." },
  ],
  closing: "다음 게임은 나만의 창작에서 시작됩니다.", chooseFirst: "첫 창작물 선택하기",
  games: {
    tank: { label: "탱크", creation: "탱크를 만들고,", experience: "성을 지키세요.", action: "나만의 탱크 만들기", mode: "직접 조종", description: "차체, 장갑, 포와 도색을 선택하세요. 직접 만든 탱크를 조종해 다가오는 적을 물리치고 기지를 지킵니다.", example: "Terra", exampleDetail: "모래빛 금색 · 속사포 · 줄무늬", sceneLabel: "실제 기지 방어 게임에서 모래빛 금색 커스텀 탱크가 움직이고 발사하는 영상." },
    fish: { label: "물고기", creation: "물고기를 만들고,", experience: "바다를 누비세요.", action: "나만의 물고기 만들기", mode: "놓아주고 관찰", description: "몸과 지느러미, 꼬리와 색을 디자인하세요. 바다에 놓아주고 무리와 함께 헤엄치는 모습을 따라가 보세요.", example: "푸른 돛 물고기", exampleDetail: "푸른 몸 · 돛 모양 지느러미 · 긴 꼬리", sceneLabel: "실제 바다 렌더러에서 푸른 돛 물고기가 헤엄치는 영상." },
    resident: { label: "주민", creation: "주민을 만들고,", experience: "마을에서 살아요.", action: "나만의 주민 만들기", mode: "관찰과 교류", description: "이름, 직업, 배경과 관심사를 정하세요. 일하고 대화하는 일상을 지켜보며 마을 생활에 참여할 수 있습니다.", example: "Rowan", exampleDetail: "농부 · 자연을 좋아함", sceneLabel: "실제 마을 시뮬레이션에서 주민이 걷고 일하는 모습을 빠르게 보여주는 영상." },
  },
};
export function playCopyForLocale(locale: SupportedLocale): PlayCopy {
  return ({ en, "zh-Hans": zh, ja, ko, fr: en })[locale];
}
