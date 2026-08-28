// Shared label/color mapping for target-quality verdicts returned by the
// backend's check_target_balance() (backend-fastapi/utils/balance_checker.py).
//
// PLATFORM RULE: every page that displays a balance/imbalance or target-skew
// verdict (Sampling, Visualization, and any future page) must import and use
// this SAME map — never redefine its own local level->color table. The whole
// point of the shared backend utility is that the same dataset gets the same
// verdict everywhere; a page with its own duplicate frontend mapping could
// silently drift out of sync (different label text, different color) even
// though the underlying `level` string is identical. `level` is always one
// of: balanced | mild | moderate | severe | invalid | no_target.
export function getBalanceLevelConfig(C) {
  return {
    balanced:   { label: 'Balanced',   color: C.success },
    mild:       { label: 'Mild Imb.',  color: '#84cc16' },
    moderate:   { label: 'High',       color: C.warning },
    severe:     { label: 'Severe',     color: C.danger },
    invalid:    { label: 'Invalid',    color: C.muted },
    no_target:  { label: 'No Target',  color: C.muted },
    // Distinct from no_target: "no target" reads as a gap the user should
    // go fix ("Set target in the Upload step"), which is actively wrong
    // advice for clustering - there's deliberately no target column and
    // never will be, not a step someone forgot. Any card that would
    // otherwise fall back to no_target should check isClustering first
    // and use this instead.
    clustering: { label: 'N/A',        color: C.muted },
  }
}

// check_target_balance() deliberately reuses the SAME 'balanced' | 'mild' |
// 'moderate' | 'severe' level enum for a regression target's skewness as it
// does for a classification target's class imbalance (see that function's
// own docstring) - one shared severity scale, two different underlying
// measurements. But "Balanced" / "Mild Imb." / "Severe" is class-imbalance
// wording; showing it for a skewness verdict claims a regression target has
// "classes" being "balanced", which is meaningless and was the actual bug
// (a Target Skew card reading "Balanced" for a continuous target). Any card
// showing a regression target's skew verdict (targetInfo.is_classification
// === false, i.e. is_regression) should pull its label text from HERE
// instead of getBalanceLevelConfig above - same `level` keys, same colors
// (the severity scale itself is still valid), skew-appropriate words only.
export function getSkewLevelConfig(C) {
  return {
    balanced: { label: 'Symmetric',      color: C.success },
    mild:     { label: 'Mild Skew',      color: '#84cc16' },
    moderate: { label: 'Moderate Skew',  color: C.warning },
    severe:   { label: 'Severe Skew',    color: C.danger },
    invalid:  { label: 'Invalid',        color: C.muted },
  }
}
