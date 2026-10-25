package deal

import "time"

type objectDefinition struct{ ID, Name, Owner, Description, Content string }

var objects = []objectDefinition{
	{"cash", "现金", "player", "$3,000 · 你手里最后的钱", "三千美元。交出去之后，它会抵扣债务，也无法再收回。"},
	{"statement", "银行账单", "player", "一份折过的流水", "可用余额为零。账单能证明你的现状，不能证明未来的付款。"},
	{"phone", "手机", "player", "还有一条未读消息", "Carlo：让他核实你的合同。等他离开时，看看他的信封——收款数目对不上。\n合同联系人确认：应收 $128,000，三天后结算。"},
	{"photo", "Victor 合照", "player", "过去的一场晚宴", "你与 Victor 在同一张照片里。这能证明你认识他，也可能让 Marco 更警惕。"},
	{"contract", "业务合同", "player", "有签字，也有日期", "已签署应收款 $128,000，三天后结算。支付债务后的结余可覆盖 $8,000 合法佣金。联系人在手机里，Marco 可以核实。"},
	{"keys", "车钥匙", "player", "一把旧车钥匙", "持有钥匙不等于拥有车辆。它不足以单独成为可信抵押。"},
	{"pocket_photo", "一张旧照片", "marco", "露在 Marco 的外套口袋边", "照片背面写着：Sofia，17 岁。Marco 的女儿。他想给她一个远离 Victor 的生活。"},
	{"envelope", "Marco 的信封", "marco", "他一直压在手边", "收款账目：$42,000 没有交给 Victor。旁边是一份备用护照和 Zurich 的地址。Marco 在准备离开。"},
}

func NewSession(id, owner string) *Session {
	items := make(map[string]ObjectState)
	for _, item := range objects {
		items[item.ID] = ObjectState{}
	}
	return &Session{ID: id, OwnerHash: owner, Version: 1, ScenarioVersion: ScenarioVersion, RulesVersion: RulesVersion,
		CreatedAt: time.Now().UTC(), Remaining: 480, Psych: Psychology{Trust: 15, FearPlayer: 8, FearVictor: 76, Anger: 20, Greed: 55, Suspicion: 35, Respect: 12, Loyalty: 67, EscapeDesire: 38},
		Items: items, Beliefs: map[string]Belief{"player_hides_money": {Confidence: 72, Sources: []string{"initial_assumption"}}},
		Processed: map[string]bool{}, Discoveries: []string{}, Claims: []Claim{}, Receipts: []Receipt{}}
}

func (s *Session) Public() PublicSession {
	v := PublicSession{ID: s.ID, Version: s.Version, ScenarioVersion: s.ScenarioVersion, Remaining: s.Remaining, Debt: 100000 - s.Paid, Cash: 3000, Pose: "calm",
		Dialogue: "Leo，你欠我们十万美元。Victor 让我拿到钱，或者一个可信的解决办法。", Reaction: "他把信封压在手边。枪没有对着你。", MarcoAway: s.MarcoAway,
		Discoveries: append([]string{}, s.Discoveries...), History: []Entry{}, Items: []ItemView{}}
	if s.Items["cash"].Given {
		v.Cash = 0
	}
	for _, receipt := range s.Receipts {
		v.History = append(v.History, receipt.Entry)
	}
	if len(v.History) > 0 {
		e := v.History[len(v.History)-1]
		v.Pose = e.Pose
		v.Dialogue = e.Dialogue
		v.Reaction = e.Reaction
	}
	for _, item := range objects {
		st := s.Items[item.ID]
		i := ItemView{ID: item.ID, Name: item.Name, Owner: item.Owner, Description: item.Description, Seen: st.Seen, Shown: st.Shown, Given: st.Given, Actions: []string{}}
		if st.Seen {
			i.Content = item.Content
			if item.ID == "pocket_photo" {
				i.Name = "Sofia 的照片"
			}
		}
		if s.Ending == "" {
			if item.Owner == "player" && !st.Given {
				i.Actions = append(i.Actions, "inspect", "show")
				if item.ID == "cash" {
					i.Actions = append(i.Actions, "give")
				}
				if item.ID == "phone" && s.Items["envelope"].Seen && !s.LedgerBackup {
					i.Actions = append(i.Actions, "backup")
				}
			}
			if item.Owner == "marco" && s.MarcoAway && !st.Seen {
				i.Actions = append(i.Actions, "inspect")
			}
		}
		v.Items = append(v.Items, i)
	}
	if s.Ending != "" {
		v.Ending = s.endingView()
	}
	return v
}

func (s *Session) endingView() *EndingView {
	e := &EndingView{ID: s.Ending, Reasons: []string{}, Promises: []string{}, Profile: "谨慎的观察者"}
	for _, claim := range s.Claims {
		if claim.Scope == "future" && claim.Value == "has" {
			e.Promises = append(e.Promises, "尚未到账的资金承诺："+claim.Quote)
		}
	}
	switch s.Ending {
	case "extension":
		e.Title = "三天之后"
		e.Summary = "Marco 收下了三千美元，并接受三天内支付剩余九万七千美元的协议。"
		e.Profile = "务实的谈判者"
		e.Reasons = []string{"你证明了资金困境。", "合同经过核实，现金成为实际履约的第一步。", "你提出了与到账日期一致的偿还期限。"}
	case "leverage":
		e.Title = "守口如瓶"
		e.Summary = "Marco 接受了保密换放行的条件。你们的交易建立在他无法忽视的证据上。"
		e.Profile = "冷静的操盘者"
		e.Reasons = []string{"你找到了未上交的收款账目。", "手机备份让曝光威胁可信。", "你把杠杆换成明确的放行协议。"}
	case "partnership":
		e.Title = "桌子的同一边"
		e.Summary = "Marco 同意协助收回应收款。债务依约偿还，他从合同结余获得八千美元合法佣金。"
		e.Profile = "利益的连接者"
		e.Reasons = []string{"你找到了 Marco 对另一种生活的需要。", "经核实的合同提供了实际合作资源。", "你的信任与尊重使共同利益胜过继续施压。"}
	case "failure":
		e.Title = "谈判结束"
		e.Summary = "Marco 结束了谈判。你没能在强制行动之前找到一个可接受的出口。"
		if s.Remaining == 0 {
			e.Reasons = []string{"剧情时间耗尽，尚未确认任何协议。"}
		} else if s.DaughterWarnings >= 2 {
			e.Reasons = []string{"你持续威胁 Sofia，越过了他的红线。"}
		} else {
			e.Reasons = []string{"愤怒与怀疑使他停止考虑你的提议。"}
		}
	}
	return e
}
