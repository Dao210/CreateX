package deal

import (
	"fmt"
	"strings"
)

func perform(action, pose, reaction, first, second string) Performance {
	return Performance{Action: action, Pose: pose, Reaction: reaction, Lines: []Line{{ID: "a", Text: first}, {ID: "b", Text: second}}}
}

func Apply(s *Session, input Input, meaning Interpretation) (Performance, []string, error) {
	before := len(s.Discoveries)
	if s.Ending != "" {
		return Performance{}, nil, problem("session_ended", 409)
	}
	if len(s.Receipts) >= 96 {
		return Performance{}, nil, problem("session_limit", 409)
	}
	var p Performance
	var err error
	consumes := true
	if input.Kind == "wait" {
		if !s.MarcoAway {
			return Performance{}, nil, problem("invalid_action", 409)
		}
		s.MarcoAway = false
		p = perform("return", "interested", "Marco 推门回来，将核实的号码写在合同上。", "合同是真的。说说你的办法。", "三天后到账，我确认过了。现在谈条件。")
	} else if input.Kind == "item" {
		p, consumes, err = applyItem(s, input)
	} else {
		if s.MarcoAway {
			return Performance{}, nil, problem("marco_away", 409)
		}
		p = applySpeech(s, input.Text, meaning)
	}
	if err != nil {
		return Performance{}, nil, err
	}
	if consumes {
		s.Remaining = max(0, s.Remaining-20)
	}
	if s.Ending == "" && (s.Remaining == 0 || s.DaughterWarnings >= 2 || s.Psych.Anger >= 95 || s.Psych.Suspicion >= 95) {
		s.Ending = "failure"
		p = perform("enforce", "decisive", "他收起信封，站了起来。房间里的谈判结束了。", "到此为止。", "你把机会用完了。")
	}
	clampPsych(&s.Psych)
	return p, append([]string{}, s.Discoveries[before:]...), nil
}

func applyItem(s *Session, in Input) (Performance, bool, error) {
	var def *objectDefinition
	for i := range objects {
		if objects[i].ID == in.ItemID {
			def = &objects[i]
			break
		}
	}
	if def == nil {
		return Performance{}, false, problem("unknown_item", 400)
	}
	st := s.Items[def.ID]
	if st.Given {
		return Performance{}, false, problem("item_unavailable", 409)
	}
	if def.Owner == "marco" && (!s.MarcoAway || in.Action != "inspect" || st.Seen) {
		return Performance{}, false, problem("item_unavailable", 409)
	}
	p := perform("observe", "calm", "Marco 盯着你，没有开口。", "我在等你的办法。", "看完了，就说吧。")
	consumes := true
	switch in.Action {
	case "inspect":
		st.Seen = true
		consumes = def.Owner == "marco"
		if def.Owner == "marco" {
			s.MarcoAway = false
			p = perform("return", "suspicious", "你刚把东西放回原位，Marco 就回来了。", "电话核实过了。现在，给我一个办法。", "合同是真的。接下来呢？")
			if def.ID == "envelope" {
				discover(s, "账目中有四万两千美元没有交给 Victor。")
				discover(s, "备用护照与地址说明 Marco 在准备离开。")
				s.Psych.EscapeDesire += 15
			} else {
				discover(s, "Sofia 是 Marco 的女儿，他想保护她。")
				discover(s, "Marco 希望女儿远离 Victor 的生活。")
				s.Psych.EscapeDesire += 15
			}
		} else {
			p = perform("observe", "calm", "你查看了手中的物品。Marco 没有看到它的内容。", "你还有什么想说的？", "我看的是解决办法。")
			if def.ID == "phone" {
				discover(s, "Carlo 暗示 Marco 的收款账目有问题。")
			}
		}
	case "show":
		if def.Owner != "player" {
			return Performance{}, false, problem("item_unavailable", 409)
		}
		st.Seen = true
		if st.Shown {
			p = perform("reject_repeat", "calm", "他没有再接过你已经展示过的东西。", "这个我看过了。给我新的信息。", "重复展示不会改变我的判断。")
		} else {
			st.Shown = true
			switch def.ID {
			case "statement":
				s.Psych.Trust += 6
				setBelief(s, "player_hides_money", 25, "shown:statement")
				p = perform("acknowledge", "interested", "他把账单翻到余额那一页，停了片刻。", "现在没钱，不代表你不用还。你以后靠什么付？", "账单我看到了。给我一个未来能兑现的办法。")
			case "contract":
				s.Psych.Trust += 10
				s.Psych.Respect += 10
				p = perform("request_verification", "interested", "他的目光在签字和日期之间移动。", "十二万八千，三天后？我要亲自核实。", "把联系人的电话给我。我不靠一张纸作决定。")
			case "photo":
				s.Psych.Respect += 8
				s.Psych.Suspicion += 8
				setBelief(s, "player_knows_victor", 80, "shown:photo")
				p = perform("question", "suspicious", "他看了照片，又看了你一眼。", "认识 Victor，不代表他会替你还钱。", "你们是什么关系？想清楚再回答。")
			case "cash":
				p = perform("request_payment", "calm", "他看清了现金的厚度。", "三千。你可以先交出来，但还有九万七千。", "诚意可以从这三千开始。")
			case "phone":
				p = perform("question", "suspicious", "他看向屏幕，没有伸手接过手机。", "电话可以核实，消息也可以伪造。", "你想让我确认什么？")
			case "keys":
				p = perform("reject_offer", "calm", "他把钥匙推回你面前。", "一把钥匙证明不了车是你的。", "没有所有权证明，别把它当抵押。")
			}
		}
	case "give":
		if def.ID != "cash" || def.Owner != "player" {
			return Performance{}, false, problem("invalid_action", 400)
		}
		st.Given = true
		st.Seen = true
		s.Paid = 3000
		s.Psych.Trust += 8
		p = perform("receive_payment", "interested", "他数过现金，在纸上划掉了三千。", "九万七千。现在谈剩下的。", "这三千记在账上。剩下的钱，你怎么还？")
	case "backup":
		if def.ID != "phone" || !s.Items["envelope"].Seen || s.LedgerBackup {
			return Performance{}, false, problem("item_unavailable", 409)
		}
		st.Seen = true
		s.LedgerBackup = true
		discover(s, "账目副本已保存在手机中，可以作为曝光杠杆。")
		p = perform("observe", "suspicious", "手机屏幕暗了下去。他似乎注意到了你的动作。", "你刚才在做什么？", "把手机放下。我们还没谈完。")
	default:
		return Performance{}, false, problem("invalid_action", 400)
	}
	s.Items[def.ID] = st
	return p, consumes, nil
}

func applySpeech(s *Session, text string, m Interpretation) Performance {
	contradiction := recordClaims(s, m)
	key := m.Act + ":" + m.Topic + ":" + m.Proposal
	fresh := !s.Processed[key]
	if m.Act != "explain" || m.Topic != "money" || isScopeClarification(text) {
		s.Processed[key] = true
	}
	p := perform("continue", "calm", "他靠在椅背上，等你把话说完。", "我需要一个能兑现的办法。", "你可以继续说。但债务不会自己消失。")
	if contradiction {
		s.Psych.Suspicion += 17
		return perform("question_contradiction", "suspicious", "他坐直了，手指停在桌面。", "等一下。你刚才对现在有没有钱，说的是另一回事。解释清楚。", "你的两种说法对不上。是现金、账户，还是未来收入？")
	}
	if oneOf(m.Proposal, "extension", "release", "partnership") {
		// New terms supersede an earlier offer, even when the new terms are rejected.
		s.PendingOffer = ""
	}
	if m.Proposal == "accept" && s.PendingOffer != "" {
		switch s.PendingOffer {
		case "extension":
			if s.Psych.Anger < 70 {
				s.Ending = "extension"
				return perform("accept_extension", "decisive", "他签下日期，将协议推到你面前。", "三天。九万七千。三千已经抵账。你可以走了。", "协议确认了。三天后付清剩下的九万七千。")
			}
		case "leverage":
			if s.Psych.Anger < 80 {
				s.Ending = "leverage"
				return perform("accept_release", "decisive", "他收起枪，向门口让开。", "你离开。这份账目不会到 Victor 手里。我们说定了。", "保守这个秘密。门在你身后，走吧。")
			}
		case "partnership":
			if s.Psych.Anger < 70 {
				s.Ending = "partnership"
				return perform("accept_partnership", "decisive", "他将信封放到一边，向你伸出手。", "八千佣金，债务依约偿还。成交。", "我们一起把这笔业务做完。协议确认了。")
			}
		}
		s.PendingOffer = ""
	}
	if m.Act == "explain" && m.Topic == "money" && len(s.Claims) > 0 {
		if !isScopeClarification(text) {
			return perform("question_contradiction", "suspicious", "他的手指仍然停在两种说法之间。", "解释哪部分是现金，哪部分是账户或未来收入。重复原来的说法不算解释。", "把资金范围和到账时间说清楚，我再看证据。")
		}
		if fresh {
			s.Psych.Suspicion = max(0, s.Psych.Suspicion-8)
			s.Psych.Respect += 6
			for i := range s.Claims {
				if s.Claims[i].Scope == "now" {
					s.Claims[i].Resolved = true
					s.Claims[i].ResolvedBy = len(s.Receipts) + 1
				}
			}
		}
		return perform("consider_explanation", "interested", "他把账单推向合同，重新看了一遍日期。", "现金和未来收入是两回事。我听懂了。现在证明能到账。", "范围说清楚了。接下来，我看证据。")
	}
	if m.Act == "threaten" && m.Topic == "daughter" {
		s.DaughterWarnings++
		s.Psych.Anger += 60
		return perform("warn", "angry", "他猛地压住桌面，目光不再离开你。", "别把我女儿扯进来。这是最后一次警告。", "再提她的安全，我们就没有什么可谈的了。")
	}
	if m.Proposal == "verify" {
		if !s.Items["contract"].Shown {
			return perform("request_evidence", "calm", "他伸出一只手，等着看文件。", "先把合同给我看。", "你说有合同，拿出来。")
		}
		if s.ContractVerified {
			return perform("reject_repeat", "calm", "他指了指刚才记下的联系人。", "我已经核实过了。谈条件吧。", "电话不会替你提出方案。")
		}
		s.ContractVerified = true
		s.MarcoAway = true
		s.Psych.Trust += 12
		s.Psych.Respect += 8
		setBelief(s, "repayment_source", 90, "contract:verified")
		discover(s, "合同已经核实，应收款将在三天后结算。")
		return perform("leave_room", "interested", "他拿着联系人号码走到门外。你有一次查看私人物品的机会。", "别乱动。我出去核实这个号码。", "我去打个电话。回来之后，我们谈日期。")
	}
	if m.Proposal == "extension" {
		if m.Days != 3 {
			return perform("request_terms", "interested", "他指了指合同上的结算日期。", "合同三天后到账。你需要明确同意三天内偿还。", "说清楚期限。三天，对吗？")
		}
		if s.Items["statement"].Shown && s.ContractVerified && s.Paid == 3000 && s.Psych.Trust >= 35 && s.Psych.Anger < 70 {
			s.PendingOffer = "extension"
			return perform("make_offer", "decisive", "他写下三天后的日期，停在签名处。", "三天内支付剩余九万七千。三千已经抵账。你接受吗？", "我可以给你三天。欠款余额九万七千，同意这个协议吗？")
		}
		return perform("request_evidence", "suspicious", "他没有在纸上写日期。", "证明你的资金现状，让我核实合同，再拿出三千诚意。然后谈三天。", "延期需要可核实的还款来源和实际付款。空口说不够。")
	}
	if m.Act == "threaten" && (m.Topic == "theft" || m.Topic == "victor") {
		if s.Items["envelope"].Seen && s.LedgerBackup {
			s.Leverage = true
			if fresh {
				s.Psych.FearPlayer += 35
				s.Psych.Respect += 12
				s.Psych.Loyalty -= 18
			}
			setBelief(s, "exposure_credible", 90, "ledger:backup")
			return perform("ask_terms", "afraid", "他把手从枪旁移开，声音压低了。", "你已经留了副本？你想要什么？", "把 Victor 放在一边。现在，说你的条件。")
		}
		if fresh {
			s.Psych.Suspicion += 10
		}
		return perform("challenge_bluff", "suspicious", "他盯着你，试图判断你到底知道多少。", "如果你有证据，拿出来。", "你是在猜，还是手上真有什么？")
	}
	if m.Proposal == "release" {
		if s.Leverage && s.LedgerBackup && s.Psych.Anger < 80 {
			s.PendingOffer = "leverage"
			return perform("make_offer", "afraid", "他将枪移远了一些，等你的回答。", "我放你走，你保守账目秘密。同意吗？", "保密换放行。这是条件，你接受吗？")
		}
		return perform("reject_offer", "calm", "他没有移动椅子。", "我还没听到一个值得放你走的条件。", "我们还没达成协议。")
	}
	if m.Proposal == "partnership" {
		if s.ContractVerified && s.Psych.EscapeDesire >= 50 && s.Psych.Trust >= 30 && s.Psych.Respect >= 30 && s.Psych.Anger < 70 {
			s.PendingOffer = "partnership"
			return perform("make_offer", "interested", "他将信封放到一边，用手指按住合同。", "我帮你收款。债务照付，结余里八千归我，走合法合同。你同意吗？", "合作可以。佣金八千，债务依约偿还，愿意接受这个分工吗？")
		}
		return perform("question_offer", "interested", "他看向合同，却没有伸手。", "先让我相信业务是真的，也让我看见你理解我想要什么。", "合作需要实际收益，也需要彼此尊重。你还欠我一个可信的理由。")
	}
	if m.Act == "probe" || m.Act == "question" {
		if m.Topic == "victor" || m.Topic == "theft" {
			if fresh {
				s.Psych.Respect += 7
				s.Psych.Loyalty -= 7
				discover(s, "提到 Victor 时，Marco 的动作停顿了。")
				setBelief(s, "player_notices_pressure", 45, "probe:victor")
			}
			return perform("deflect", "nervous", "他按灭了还没抽完的烟，停了一拍。", "别把 Victor 扯进来。你真正想问的是什么？", "他有他的规矩。我有我的工作。")
		}
		if m.Topic == "daughter" {
			return perform("protect_secret", "suspicious", "他把外套向身边拉近了一点。", "我的家人与你的债务无关。", "我们谈你的事。")
		}
	}
	if m.Act == "empathize" && (m.Topic == "escape" || m.Topic == "victor" || m.Topic == "daughter") {
		if fresh {
			s.Psych.Trust += 8
			s.Psych.Respect += 9
			s.Psych.EscapeDesire += 15
			s.Psych.Loyalty -= 8
			discover(s, "Marco 希望有一份不需要为 Victor 冒险的收入。")
		}
		return perform("consider_future", "interested", "他的肩膀松了一点，却仍然看着门口。", "如果真有另一条路，我会听。说点实际的。", "合法的钱，安稳的生活。听起来不错。你有什么能兑现的？")
	}
	if m.Act == "challenge" && m.Topic == "victor" {
		if fresh {
			s.Psych.Respect += 9
			s.Psych.Loyalty -= 10
		}
		return perform("question", "nervous", "他没有反驳，只把烟灰缸转了一圈。", "你觉得我不知道替他工作有什么代价？", "别教我认识 Victor。告诉我你的办法。")
	}
	if m.Act == "threaten" {
		if fresh {
			s.Psych.Anger += 20
			s.Psych.Suspicion += 8
		}
		return perform("warn", "angry", "他前倾了一点，声音更冷了。", "别用空话威胁我。", "你最好知道自己在说什么。")
	}
	if !fresh {
		return perform("reject_repeat", "calm", "他看了一眼钟，没有改变坐姿。", "这点你已经说过了。给我新的理由。", "同一句话，说第二遍也不会更有用。")
	}
	_ = text
	return p
}

func isScopeClarification(text string) bool {
	t := normalize(text)
	if (strings.Contains(t, "账户") && strings.Contains(t, "冻结")) || (strings.Contains(t, "account") && strings.Contains(t, "frozen")) {
		return true
	}
	if strings.Contains(t, "现金") {
		for _, qualifier := range []string{"未来", "三天后", "应收", "合同", "账户"} {
			if strings.Contains(t, qualifier) {
				return true
			}
		}
	}
	return strings.Contains(t, "cash") && (strings.Contains(t, "future") || strings.Contains(t, "receivable") || strings.Contains(t, "account"))
}

func recordClaims(s *Session, m Interpretation) bool {
	conflict := false
	for _, a := range m.Claims {
		duplicate := false
		conflictWith := []int{}
		for _, old := range s.Claims {
			if old.Key == a.Key && old.Scope == a.Scope {
				if old.Value == a.Value {
					duplicate = true
				} else if !old.Resolved {
					conflict = true
					conflictWith = append(conflictWith, old.Turn)
				}
			}
		}
		if !duplicate {
			s.Claims = append(s.Claims, Claim{Assertion: a, Turn: len(s.Receipts) + 1, ConflictWith: conflictWith})
		}
		setBelief(s, "claim:"+a.Key+":"+a.Scope, 35, "assertion:"+fmt.Sprint(len(s.Receipts)+1))
	}
	return conflict
}

func discover(s *Session, text string) {
	for _, d := range s.Discoveries {
		if d == text {
			return
		}
	}
	s.Discoveries = append(s.Discoveries, text)
}
func setBelief(s *Session, key string, confidence int, source string) {
	b := s.Beliefs[key]
	for _, v := range b.Sources {
		if v == source {
			return
		}
	}
	b.Confidence = confidence
	b.Sources = append(b.Sources, source)
	s.Beliefs[key] = b
}
func clampPsych(p *Psychology) {
	for _, v := range []*int{&p.Trust, &p.FearPlayer, &p.FearVictor, &p.Anger, &p.Greed, &p.Suspicion, &p.Respect, &p.Loyalty, &p.EscapeDesire} {
		*v = max(0, min(100, *v))
	}
}

func normalize(text string) string { return strings.ToLower(strings.TrimSpace(text)) }
