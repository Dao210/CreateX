import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Banknote,
  FileText,
  KeyRound,
  Smartphone,
  Image,
  Mail,
  RefreshCw,
  Download,
  ChevronDown,
  Eye,
  Hand,
  Copy,
  LoaderCircle,
  Clock3,
  HelpCircle,
} from "lucide-react";
import { Button } from "@auro/ui/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@auro/ui/components/ui/dialog";
import {
  DealClient,
  DealError,
  dealRecap,
  formatDealTime,
  type DealInput,
  type DealItem,
  type DealSession,
} from "@auro/core/deal";
import { Marco } from "./marco";
import { gameStorage } from "./storage";

const client = new DealClient();
const storageKey = "deal.current-session";
const money = (value: number) => `$${value.toLocaleString("en-US")}`;
const icons: Record<string, typeof FileText> = {
  cash: Banknote,
  statement: FileText,
  phone: Smartphone,
  photo: Image,
  contract: FileText,
  keys: KeyRound,
  pocket_photo: Image,
  envelope: Mail,
};
const poses: Record<string, string> = {
  calm: "不动声色",
  interested: "开始倾听",
  suspicious: "目光警惕",
  amused: "意味深长",
  angry: "压住怒火",
  nervous: "片刻迟疑",
  afraid: "声音变低",
  decisive: "作出决定",
};
const labels = {
  inspect: "查看",
  show: "展示",
  give: "交付",
  backup: "备份账目",
};
const errors: Record<string, string> = {
  network_unavailable: "连接中断。你的话仍在这里，可以重试。",
  model_unavailable: "Marco 的回应暂时中断。此回合没有扣除剧情时间，可以重试。",
  model_invalid_response: "回应未通过校验。此回合未提交，请重试。",
  model_not_configured:
    "AI 尚未配置。请先在服务端配置模型，或显式开启规则试玩。",
  invalid_response: "收到的游戏数据不完整。请重新读取存档。",
  version_conflict:
    "这局进度已在另一处改变。存档已重新读取，请按当前局面再说一次。",
  not_found:
    "这份存档不属于当前浏览器，或已不可用。你可以回到入口开始新的一局。",
  item_unavailable: "现在不能这样操作这件物品。",
  invalid_action: "这个动作在当前局面不可用。",
  marco_away: "Marco 还在门外。你可以查看一件私人物品，或等他回来。",
  rate_limited: "你刚刚开启了多局游戏。请稍等一分钟再开始。",
  capacity_reached: "试玩存档已满，请联系维护者清理或扩容。",
  invalid_input: "请检查输入；每次最多 1,200 字。",
  session_ended: "这场谈判已经结束。",
  session_limit: "这局操作已达上限。请开始新的一局。",
  storage_unavailable: "存档暂时无法保存。请重试。",
  unsupported_session: "这份存档使用不同的关卡版本，请开始新的一局。",
  invalid_origin: "游戏连接来源不匹配。请从同一个游戏地址重新进入。",
};
function errorMessage(error: unknown) {
  return error instanceof DealError
    ? errors[error.code] || "暂时无法完成操作，请重试。"
    : "暂时无法完成操作，请重试。";
}

export function DealApp() {
  const queryClient = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(() =>
    gameStorage.getItem(storageKey),
  );
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState<DealInput | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const status = useQuery({
    queryKey: ["deal", "status"],
    queryFn: () => client.status(),
  });
  const game = useQuery({
    queryKey: ["deal", "session", sessionId],
    queryFn: () => client.read(sessionId!),
    enabled: sessionId !== null,
  });
  const create = useMutation({
    mutationFn: () => client.create(),
    onSuccess: (session) => {
      queryClient.setQueryData(["deal", "session", session.id], session);
      gameStorage.setItem(storageKey, session.id);
      setSessionId(session.id);
      setDraft("");
      setSelected(null);
      setFailed(null);
      setRestartOpen(false);
      turn.reset();
    },
  });
  const turn = useMutation({
    mutationFn: (input: DealInput) => client.turn(sessionId!, input),
    onSuccess: (session, input) => {
      queryClient.setQueryData(["deal", "session", session.id], session);
      setFailed(null);
      if (input.kind === "talk") setDraft("");
    },
    onError: (error, input) => {
      if (error instanceof DealError && error.code === "version_conflict") {
        setFailed(null);
        void game.refetch();
      } else setFailed(input);
    },
  });
  const session = game.data;
  const busy = turn.isPending || create.isPending;
  const available = status.data?.ready === true;
  const send = (fields: Omit<DealInput, "request_id" | "expected_version">) => {
    if (!session || busy || failed || session.ending || !available) return;
    turn.mutate({
      request_id: crypto.randomUUID(),
      expected_version: session.version,
      ...fields,
    });
  };
  const forget = () => {
    gameStorage.removeItem(storageKey);
    setSessionId(null);
    setFailed(null);
    turn.reset();
    create.reset();
  };
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [session?.version]);

  const restart = (
    <Dialog open={restartOpen} onOpenChange={setRestartOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="game-button"
            disabled={busy}
          />
        }
      >
        <RefreshCw />
        重开
      </DialogTrigger>
      <DialogContent className="deal-dialog">
        <DialogHeader>
          <DialogTitle>另开一局？</DialogTitle>
          <DialogDescription>
            当前记录会保留，游戏将切换到新的一局。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            继续这局
          </DialogClose>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !available}
          >
            {create.isPending ? "正在开始…" : "开始新局"}
          </Button>
        </DialogFooter>
        {create.isError && <p role="alert">{errorMessage(create.error)}</p>}
      </DialogContent>
    </Dialog>
  );

  return (
    <main className="deal-app dark">
      <header className="game-header">
        <a href="/deal/" className="wordmark" aria-label="DEAL 游戏首页">
          DEAL<span>每句话，都有代价</span>
        </a>
        {session && (
          <div className="header-metrics">
            <div>
              <span>剩余欠款</span>
              <strong>{money(session.debt_remaining)}</strong>
            </div>
            <div
              className={
                session.remaining_seconds <= 80 ? "clock urgent" : "clock"
              }
            >
              <Clock3 />
              <strong>{formatDealTime(session.remaining_seconds)}</strong>
              <span>剧情时间</span>
            </div>
          </div>
        )}
        <div className="header-actions">
          {status.data?.mode === "scripted" && (
            <span className="practice-badge">规则试玩</span>
          )}
          {session && !session.ending && restart}
          <Help />
        </div>
      </header>

      {!sessionId ? (
        <section className="intro">
          <div className="intro-copy">
            <p className="eyebrow">第一场对决 · 欠债的人</p>
            <h1>
              你没有钱。
              <br />
              <em>但你还有话。</em>
            </h1>
            <p className="intro-story">
              你欠 Victor 十万美元。
              <br />
              他派来的男人，正坐在你对面。
            </p>
            <div className="intro-facts">
              <span>一个房间</span>
              <span>八分钟剧情时间</span>
              <span>由你开口</span>
            </div>
            <Button
              className="begin-button"
              size="lg"
              onClick={() => create.mutate()}
              disabled={!available || create.isPending}
            >
              {create.isPending ? (
                <LoaderCircle className="spin" />
              ) : (
                <ArrowRight />
              )}
              {create.isPending ? "正在进入房间…" : "坐到桌前"}
            </Button>
            {(status.isError || create.isError) && (
              <div role="alert" className="error-panel">
                <p>{errorMessage(create.error || status.error)}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    create.reset();
                    void status.refetch();
                  }}
                >
                  重新连接
                </Button>
              </div>
            )}
            {status.data && !available && (
              <div role="status" className="error-panel">
                <p>{errors.model_not_configured}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void status.refetch()}
                >
                  检查配置
                </Button>
              </div>
            )}
            {status.data?.mode === "scripted" && (
              <p className="mode-note">
                此模式使用编排规则理解常见表达。AI 自由表达体验需要配置模型。
              </p>
            )}
          </div>
          <div className="intro-scene">
            <div className="overhead-light" />
            <Marco pose="calm" />
            <div className="intro-table" />
            <p className="intro-quote">
              “我被告知，不能空手离开。”<span>MARCO BELLINI</span>
            </p>
          </div>
        </section>
      ) : game.isPending ? (
        <div className="loading-room" role="status">
          <LoaderCircle className="spin" />
          正在读取房间…
        </div>
      ) : game.isError || !session ? (
        <div className="loading-room">
          <p role="alert">{errorMessage(game.error)}</p>
          <Button onClick={() => void game.refetch()} variant="outline">
            重新读取
          </Button>
          <Button onClick={forget} variant="ghost">
            回到入口
          </Button>
        </div>
      ) : session.ending ? (
        <Ending
          session={session}
          restart={restart}
          onDownload={() => {
            const url = URL.createObjectURL(
              new Blob([dealRecap(session)], {
                type: "text/plain;charset=utf-8",
              }),
            );
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `DEAL-${session.ending?.id}-${session.id.slice(0, 8)}.txt`;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        />
      ) : (
        <div className="room-layout">
          <section className="room-stage" aria-label="Marco 与桌面">
            <div className="overhead-light" />
            <div className="room-label">
              <span>房间 01</span>
              <span>
                {session.marco_away ? "门外传来电话声" : "门仍然关着"}
              </span>
            </div>
            <Marco pose={session.pose} away={session.marco_away} />
            <div className="marco-label">
              <span className="eyebrow">MARCO BELLINI</span>
              <span className="pose-label">
                {session.marco_away ? "暂时离开" : poses[session.pose]}
              </span>
              <p role="status">{session.reaction}</p>
            </div>
            <div className="table-surface">
              <div className="table-heading">
                <span>你的桌面</span>
                <span>现金 {money(session.cash)}</span>
              </div>
              <div className="inventory">
                {session.items
                  .filter((item) => item.owner === "player")
                  .map((item) => (
                    <ItemButton
                      key={item.id}
                      item={item}
                      selected={selected === item.id}
                      onClick={() => setSelected(item.id)}
                    />
                  ))}
              </div>
              <div className="marco-items">
                <span>Marco 身边</span>
                {session.items
                  .filter((item) => item.owner === "marco")
                  .map((item) => (
                    <ItemButton
                      key={item.id}
                      item={item}
                      selected={selected === item.id}
                      onClick={() => setSelected(item.id)}
                      compact
                    />
                  ))}
                {session.marco_away && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="game-button"
                    disabled={busy || !!failed || !available}
                    onClick={() => send({ kind: "wait" })}
                  >
                    等他回来
                  </Button>
                )}
              </div>
            </div>
          </section>
          <section className="conversation" aria-label="谈判">
            <div className="conversation-heading">
              <div>
                <span className="eyebrow">正在谈判</span>
                <h2>找到他的软肋。</h2>
              </div>
              <span className="room-dot" />
            </div>
            <div className="dialogue-log" ref={logRef} aria-label="对话记录">
              <div className="line npc">
                <span>MARCO</span>
                <p>
                  Leo，你欠我们十万美元。Victor
                  让我拿到钱，或者一个可信的解决办法。
                </p>
              </div>
              {session.history.map((entry) => (
                <div className="turn-pair" key={entry.turn}>
                  <div className="line player">
                    <span>你</span>
                    <p>{entry.player}</p>
                  </div>
                  <div className="line npc">
                    <span>MARCO</span>
                    <p>{entry.dialogue}</p>
                    {entry.discoveries.map((discovery) => (
                      <p className="discovery-inline" key={discovery}>
                        <Eye />
                        {discovery}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
              {turn.isPending && (
                <p className="thinking" role="status">
                  <span />
                  <span />
                  <span />
                  他在听。
                </p>
              )}
            </div>
            {selected && (
              <ItemDetail
                item={session.items.find((item) => item.id === selected)!}
                disabled={busy || !!failed || !available}
                onAction={(action) =>
                  send({ kind: "item", item_id: selected, action })
                }
                onClose={() => setSelected(null)}
              />
            )}
            {turn.isError && (
              <div className="error-panel" role="alert">
                <p>{errorMessage(turn.error)}</p>
                {failed && (
                  <div className="error-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => turn.mutate(failed)}
                    >
                      重试这次操作
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setFailed(null);
                        turn.reset();
                        void game.refetch();
                      }}
                    >
                      读取存档
                    </Button>
                  </div>
                )}
              </div>
            )}
            {!available && status.data && (
              <p className="error-panel" role="status">
                {errors.model_not_configured}
              </p>
            )}
            <form
              className="talk-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (draft.trim()) send({ kind: "talk", text: draft.trim() });
              }}
            >
              <label htmlFor="player-words">轮到你了</label>
              <textarea
                id="player-words"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={1200}
                placeholder={
                  session.marco_away
                    ? "他在门外。查看一件物品，或等他回来。"
                    : "你想对 Marco 说什么？"
                }
                disabled={busy || session.marco_away || !!failed || !available}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault();
                    if (draft.trim())
                      send({ kind: "talk", text: draft.trim() });
                  }
                }}
              />
              <div className="talk-footer">
                <span>Ctrl / ⌘ + Enter</span>
                <Button
                  type="submit"
                  className="speak-button"
                  disabled={
                    busy ||
                    !draft.trim() ||
                    session.marco_away ||
                    !!failed ||
                    !available
                  }
                >
                  {busy ? <LoaderCircle className="spin" /> : <ArrowRight />}
                  开口
                </Button>
              </div>
            </form>
            {session.discoveries.length > 0 && (
              <details className="notebook">
                <summary>
                  <Eye />
                  你的观察 <span>{session.discoveries.length}</span>
                  <ChevronDown />
                </summary>
                <ul>
                  {session.discoveries.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function ItemButton({
  item,
  selected,
  onClick,
  compact = false,
}: {
  item: DealItem;
  selected: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  const Icon = icons[item.id] || FileText;
  return (
    <button
      type="button"
      className={`item-button ${compact ? "compact" : ""} ${selected ? "selected" : ""} ${item.given ? "given" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <Icon />
      <span>{item.name}</span>
      {item.given ? (
        <small>已交付</small>
      ) : item.shown ? (
        <small>已展示</small>
      ) : item.seen ? (
        <small>已查看</small>
      ) : null}
    </button>
  );
}

function ItemDetail({
  item,
  disabled,
  onAction,
  onClose,
}: {
  item: DealItem;
  disabled: boolean;
  onAction: (action: DealInput["action"]) => void;
  onClose: () => void;
}) {
  return (
    <section className="item-detail" aria-label={item.name}>
      <div className="item-detail-heading">
        <strong>{item.name}</strong>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="game-button"
        >
          收起
        </Button>
      </div>
      <p>{item.content || item.description}</p>
      {item.actions.length ? (
        <div className="item-actions">
          {item.actions.map((action) => (
            <Button
              key={action}
              variant={action === "show" ? "default" : "outline"}
              size="sm"
              className="game-button"
              disabled={disabled}
              onClick={() => onAction(action)}
            >
              {action === "inspect" ? (
                <Eye />
              ) : action === "backup" ? (
                <Copy />
              ) : (
                <Hand />
              )}
              {labels[action]}
            </Button>
          ))}
        </div>
      ) : (
        <p className="item-constraint">
          {item.given
            ? "这件物品已经交出。"
            : item.seen
              ? "你已经查看过这件物品。"
              : "他还在这里。现在没有查看私人物品的机会。"}
        </p>
      )}
    </section>
  );
}

function Help() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="game-button"
            aria-label="玩法与隐私"
          />
        }
      >
        <HelpCircle />
      </DialogTrigger>
      <DialogContent className="deal-dialog">
        <DialogHeader>
          <DialogTitle>观察，然后开口</DialogTitle>
          <DialogDescription>
            你可以说任何话，也可以用桌上的物品证明它。
          </DialogDescription>
        </DialogHeader>
        <div className="help-copy">
          <p>
            查看自己的物品不耗时，也不会让 Marco
            自动看见内容。展示、交付、备份、搜查或说话，每次推进 20
            秒剧情时间。网络和模型等待不计时。
          </p>
          <p>
            注意他的动作。重复同一理由不会积累说服力。达成协议前，需要明确接受条款。
          </p>
          <p>
            AI
            模式会将输入和最近公开对话发送给配置的模型服务。规则试玩不调用模型。存档保存在游戏服务端，由当前浏览器的独立
            cookie 保护。
          </p>
          <p>手机和备份均为游戏内动作，不会发送真实消息。语音尚未接入。</p>
        </div>
        <DialogFooter>
          <DialogClose render={<Button />}>回到房间</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Ending({
  session,
  restart,
  onDownload,
}: {
  session: DealSession;
  restart: React.ReactNode;
  onDownload: () => void;
}) {
  const ending = session.ending!;
  return (
    <section
      className={`ending-screen ${ending.id === "failure" ? "ending-failure" : ""}`}
    >
      <div className="ending-art">
        <Marco pose="decisive" />
        <span>
          {ending.id === "failure" ? "END OF THE LINE" : "A DEAL IS A DEAL"}
        </span>
      </div>
      <div className="ending-copy">
        <p className="eyebrow">谈判结束 · {ending.profile}</p>
        <h1>{ending.title}</h1>
        <p className="ending-summary">{ending.summary}</p>
        <ul className="ending-reasons">
          {ending.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        {ending.promises.length > 0 && (
          <div className="ending-promises">
            {ending.promises.map((promise) => (
              <p key={promise}>{promise}</p>
            ))}
          </div>
        )}
        <div className="ending-stats">
          <div>
            <strong>
              {session.history.filter((entry) => entry.time_cost > 0).length}
            </strong>
            <span>有效行动</span>
          </div>
          <div>
            <strong>{session.discoveries.length}</strong>
            <span>信息发现</span>
          </div>
          <div>
            <strong>{money(100000 - session.debt_remaining)}</strong>
            <span>实际偿还</span>
          </div>
        </div>
        <div className="ending-actions">
          {restart}
          <Button
            variant="outline"
            onClick={onDownload}
            className="game-button"
          >
            <Download />
            下载谈判复盘
          </Button>
        </div>
        <details className="ending-transcript">
          <summary>
            回看这一局 <ChevronDown />
          </summary>
          {session.history.map((entry) => (
            <div key={entry.turn}>
              <p>你：{entry.player}</p>
              <p>Marco：{entry.dialogue}</p>
            </div>
          ))}
        </details>
      </div>
    </section>
  );
}
