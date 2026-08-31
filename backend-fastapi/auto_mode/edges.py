"""
Conditional routing. Every decision node in nodes.py already determines
its own correct successor (including cap-enforcement for loop_back_count/
training_attempts) and writes it to state["current_node"] before
returning — so every edge in this graph is the SAME dispatch: read
current_node, route there. Kept as named functions (rather than one bare
lambda reused everywhere) purely for readability of graph.py's
add_conditional_edges calls and because this is also the natural place to
add real branch-specific logic later without touching graph.py.
"""
from .state import PRISMState


def _route(state: PRISMState) -> str:
    return state.get("current_node", "end")


# feature_select -> feature_engineer (combine-loop) | review_feature_selection (forward)
route_after_feature_select = _route
FEATURE_SELECT_MAP = {"feature_engineer": "feature_engineer", "review_feature_selection": "review_feature_selection"}

# eval_metrics -> retry_train (bounded, autonomous) | sample | feature_select
# (both loop-backs, HITL-gated) | review_training (accepted, forward)
route_after_eval_metrics = _route
EVAL_METRICS_MAP = {"retry_train": "retry_train", "sample": "sample",
                     "feature_select": "feature_select", "review_training": "review_training"}

# explain -> sample | feature_select (loop-backs, HITL-gated) | review_explain (forward)
route_after_explain = _route
EXPLAIN_MAP = {"sample": "sample", "feature_select": "feature_select", "review_explain": "review_explain"}
