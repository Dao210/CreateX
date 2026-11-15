# Capture the Flag

Adapted from **夺旗Agent游戏 v4.0**, authored by **黄仲生**, at the user's request.

The imported gameplay contract is `12-rts-1.0`, strategy format `1.0`.
`engine.js`, `validator.js`, `rating.js`, the ZS examples and rule-kit documents
originate from that project. The JavaScript engine keeps its original rule
semantics, with DOM, account, network and wall-clock dependencies removed.
The declarations describe the public simulation boundary; portable frame
serialization is explicit in `simulation.ts`.

Rules, validation and official simulation share these canonical modules.
The rule-kit download is generated from them; generated copies are not edited.
Original accounts, private submissions and historic results are not imported.
