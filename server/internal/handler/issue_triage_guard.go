package handler

// Write protection for a Triage entry (MUL-7189 §2.1, §2.2).
//
// Triage is not a status — it lives in issue.triage_state — so status, project,
// assignee, priority and labels on a Triage entry are the triager's PROPOSAL,
// and accept is what confirms them. Ordinary writes reach all of those.
//
// The parent is not a proposal, and is the one field held back. Two reasons,
// and the second is behavior rather than display:
//
//   - the routing panel has no parent field. "Merge into an existing issue" is
//     a separate action that links rather than re-parents, so a Triage entry
//     hanging off a parent is a half-state the product never asks for;
//   - a child in Triage carries a proposed status, so it is never terminal.
//     the child_done stage frontier would wait on it forever — holding the whole sibling
//     set, or one stage's frontier — and ChildIssueProgress would count it in
//     the denominator. Both read through parent_issue_id, so refusing the write
//     is what keeps them out of reach.
//
// Carrying the field counts as writing it, even with the value already stored
// and even when null (which clears). The rule stays one a client can predict.
