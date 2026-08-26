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
    balanced:  { label: 'Balanced',   color: C.success },
    mild:      { label: 'Mild Imb.',  color: '#84cc16' },
    moderate:  { label: 'High',       color: C.warning },
    severe:    { label: 'Severe',     color: C.danger },
    invalid:   { label: 'Invalid',    color: C.muted },
    no_target: { label: 'No Target',  color: C.muted },
  }
}
