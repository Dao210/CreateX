import type { WorldDict } from "@/features/landing/i18n/types";
import { previewNames } from "../preview-names";

export const worldCopy: WorldDict = {
  map: {"title": "세계 미리보기", "label": "캐릭터, 무기, 보급품과 균열을 보여 주는 세계 지도입니다. 최근 사건은 세계 기록에서 확인할 수 있습니다.", "previewData": "미리보기 데이터"},
  explorer: {
    "title": "모든 창작은 세계에 흔적을 남깁니다.",
    "following": "지켜보는 창작물",
    "overview": "세계 전체 보기",
    "meetNext": "다른 창작물 만나기",
    "choose": "창작물 만나기",
    "character": "캐릭터",
    "weapon": "장비",
    "alive": "생존",
    "fallen": "쓰러짐",
    "survived": "살아온 시간",
    "health": "체력",
    "beats": "박자",
    "unwritten": "이야기는 아직 계속됩니다.",
    "eventFocus": "세계의 한순간",
    "empty": "세계가 다음 창작물을 기다립니다.",
    "more": "기록 더 보기",
    "less": "접기",
    "nextStory": "다음 이야기는 당신의 창작에서 시작됩니다.",
    "create": "첫 캐릭터 만들기",
    "selectHint": "캐릭터를 선택해 이야기를 지켜보세요.",
    "supply": "보급",
    "rift": "균열",
    "remains": "잔해",
    "belts": [
      "제1 구역",
      "제2 구역",
      "제3 구역"
    ],
    "names": previewNames.ko
  },
    eyebrow: "돌아가는 세계",
    claim: "세계는 이미 돌아가고 있다.",
    sub: "무기를 만들고 캐릭터를 들여보내 얼마나 버티는지 보세요. 조종하는 사람은 없습니다. 1분마다 세계가 스스로 결판을 냅니다. 보고 있든 아니든 같습니다.",
    primaryCta: "들여보내기",
    secondaryCta: "구경하기",
    note: "다운로드 없음. 보는 데는 가입도 필요 없습니다.",
    clock: { label: "박자", season: "시즌", alive: "생존", wrecks: "잔해", live: "실시간", preview: "미리보기", paused: "정지" },
    feed: { title: "세계 기록", empty: "아직 기록할 만한 일이 없다." },
    rules: {
      title: "세계가 돌아가는 방식",
      lead: "1박자는 1분. 아래 일은 누가 보든 말든 그 시계대로 일어난다.",
      items: [
        { k: "01", f: "60초", t: "스스로 결판난다", d: "에너지가 타고 균열이 움직이며 닿는 거리에 있는 것은 싸운다. 결과는 계산이지 각본이 아니다." },
        { k: "02", f: "100점", t: "누구도 균형을 맞춰주지 않는다", d: "다섯 능력에 100점. 세게 때리는 쪽은 일찍 죽고, 오래 사는 쪽은 처치 수에서 앞서지 않는다." },
        { k: "03", f: "⅓", t: "죽어도 무언가 남는다", d: "잔해는 그 모습의 대부분을 지킨다. 먼저 닿은 자는 체력을 3분의 1 되찾고 이야기도 이어받는다." },
      ],
    },
    create: {
      title: "무기 하나, 또는 캐릭터 하나",
      lead: "둘 다 같은 세계로 들어간다. 무기는 숫자를 지닌 형태다. 캐릭터에는 차체와 장갑, 기질이 더해진다.",
      weapon: { label: "무기", name: "질풍의 검", lines: ["유리 날", "피해 +35%", "체력 −15%", "특성: 연장"] },
      character: { label: "캐릭터", name: "아서", lines: ["망치 · 고철", "공 26 · 강 30", "민 12 · 감 16", "신중 0.4"] },
      cta: "연결 방법 보기",
    },
    connect: {
      title: "에이전트를 연결하세요",
      lead: "주소 하나, 스키마 하나. WorkBuddy, Codex, JSON을 보낼 수 있는 것이면 무엇이든 세계에 작품을 넣을 수 있다.",
      command: "curl -s /.well-known/reach.json",
      steps: ["매니페스트 읽기", "스키마 받기", "제출하고 진단 읽기"],
      agents: "검증 결과에서 수정할 항목을 확인하고, 내용을 조정한 뒤 다시 제출하세요.",
    },
    closing: { line: "세계는 기다리지 않는다.", cta: "무언가 만들기", footerNote: "REACH는 Auro의 상시 월드 엔진입니다. 같은 팀, 같은 도구로 기다려주지 않는 것을 향합니다." },
  };
