"""
Conditional routing for the graph's 3 real branch points. Every other node
in nodes.py is single-destination (it always sets state["current_node"] to
the same next node) and is wired with a plain g.add_edge(...) in graph.py
instead — using add_conditional_edges everywhere, mapped to every node,
would make the graph's edge list claim "any node can reach any node",
which is both misleading and defeats the whole point of this being an
explicit, inspectable graph rather than a free-form agent loop.

The three genuine branch points:
  - feature_select -> feature_engineer (combine-loop) | select_model (forward)
  - eval_metrics    -> retry_train | sample | feature_select | explain
  - explain         -> sample | feature_select | report
"""
from .state import PRISMState


def _route(state: PRISMState) -> str:
    return state.get("current_node", "end")


route_after_feature_select = _route
FEATURE_SELECT_MAP = {"feature_engineer": "feature_engineer", "select_model": "select_model"}

route_after_eval_metrics = _route
EVAL_METRICS_MAP = {"retry_train": "retry_train", "sample": "sample",
                     "feature_select": "feature_select", "explain": "explain"}

route_after_explain = _route
EXPLAIN_MAP = {"sample": "sample", "feature_select": "feature_select", "report": "report"}
