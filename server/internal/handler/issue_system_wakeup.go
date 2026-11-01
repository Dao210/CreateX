package handler

// The child_done system rule is an issue_wakeup row owned by the platform (see
// service.SystemRuleChildDone). These endpoints show what one parent is
// waiting for and let people change the rule on that issue, and set its
// workspace default. People's own rules use the ordinary wakeup endpoints.
