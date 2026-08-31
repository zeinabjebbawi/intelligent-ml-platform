"""
StateGraph assembly. Checkpointer is a local SQLite file, NOT Postgres —
this is deliberate (see the approved plan's "two persistence layers"
decision): FastAPI never touches Postgres directly anywhere else in this
codebase, and this checkpointer is purely internal graph-pause/resume
mechanics, not the user-facing audit trail (that's Django's Experiment/
AgentDecision, written via django_client.py).

Verified directly against the installed langgraph version before writing
this file (see conversation): graph.invoke(state, config) returns a dict
containing "__interrupt__": [Interrupt(value=..., id=...)] when a node
calls interrupt(...); graph.invoke(Command(resume=value), config) resumes
that same node, which is RE-RUN from its top with interrupt() returning
`value` immediately instead of pausing again — hence nodes.py's strict
"read-only context + LLM decision + interrupt() + mutating calls after"
node shape.
"""
import os
import sqlite3
import threading

from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.sqlite import SqliteSaver

from .state import PRISMState
from . import nodes as N
from . import edges as E

CHECKPOINT_DB_PATH = os.path.join(os.path.dirname(__file__), "checkpoints.db")

_conn = sqlite3.connect(CHECKPOINT_DB_PATH, check_same_thread=False)
_conn_lock = threading.Lock()
_checkpointer = SqliteSaver(_conn)


def _build() -> StateGraph:
    g = StateGraph(PRISMState)

    g.add_node("intake", N.node_intake)
    g.add_node("diagnose", N.node_diagnose)
    g.add_node("clean_duplicates", N.node_clean_duplicates)
    g.add_node("clean_outliers", N.node_clean_outliers)
    g.add_node("clean_missing_cols", N.node_clean_missing_cols)
    g.add_node("clean_missing_rows", N.node_clean_missing_rows)
    g.add_node("review_cleaning", N.node_review_cleaning)
    g.add_node("encode_scale", N.node_encode_scale)
    g.add_node("review_encoding", N.node_review_encoding)
    g.add_node("set_goal", N.node_set_goal)
    g.add_node("feature_engineer", N.node_feature_engineer)
    g.add_node("review_feature_engineering", N.node_review_feature_engineering)
    g.add_node("sample", N.node_sample)
    g.add_node("review_sampling", N.node_review_sampling)
    g.add_node("feature_select", N.node_feature_select)
    g.add_node("review_feature_selection", N.node_review_feature_selection)
    g.add_node("select_model", N.node_select_model)
    g.add_node("train", N.node_train)
    g.add_node("retry_train", N.node_retry_train)
    g.add_node("eval_metrics", N.node_eval_metrics)
    g.add_node("review_training", N.node_review_training)
    g.add_node("explain", N.node_explain)
    g.add_node("review_explain", N.node_review_explain)
    g.add_node("report", N.node_report)
    g.add_node("end", N.node_end)

    g.add_edge(START, "intake")
    g.add_edge("intake", "diagnose")

    # Deterministic single-destination transitions — each of these nodes
    # always sets state["current_node"] to exactly this one value, so a
    # plain edge is both correct and, unlike a conditional edge mapped to
    # every node, honestly reflects that there is only one real destination.
    # Every mutating stage now follows the same propose -> execute ->
    # review -> (user continues) -> next stage's propose shape (see
    # nodes.py's module docstring) - each review_* node is a real,
    # separate graph node specifically so re-running it from the top on
    # resume (LangGraph's own semantic) never re-executes the mutation
    # that already happened one node earlier.
    g.add_edge("diagnose", "clean_duplicates")          # after the cleaning-plan HITL checkpoint
    g.add_edge("clean_duplicates", "clean_outliers")
    g.add_edge("clean_outliers", "clean_missing_cols")
    g.add_edge("clean_missing_cols", "clean_missing_rows")
    g.add_edge("clean_missing_rows", "review_cleaning")
    g.add_edge("review_cleaning", "encode_scale")
    g.add_edge("encode_scale", "review_encoding")       # after the encoding HITL checkpoint + apply
    g.add_edge("review_encoding", "set_goal")
    g.add_edge("set_goal", "feature_engineer")          # after the goal HITL checkpoint
    g.add_edge("feature_engineer", "review_feature_engineering")  # both the LLM-decision pass and the combine-consume pass land here
    g.add_edge("review_feature_engineering", "sample")
    g.add_edge("sample", "review_sampling")             # after the sampling HITL checkpoint + apply
    g.add_edge("review_sampling", "feature_select")
    g.add_edge("review_feature_selection", "select_model")
    g.add_edge("select_model", "train")                 # after the model-selection HITL checkpoint
    g.add_edge("train", "eval_metrics")
    g.add_edge("retry_train", "eval_metrics")
    g.add_edge("review_training", "explain")
    g.add_edge("review_explain", "report")

    # The three genuine branch points (see edges.py's module docstring)
    g.add_conditional_edges("feature_select", E.route_after_feature_select, E.FEATURE_SELECT_MAP)
    g.add_conditional_edges("eval_metrics", E.route_after_eval_metrics, E.EVAL_METRICS_MAP)
    g.add_conditional_edges("explain", E.route_after_explain, E.EXPLAIN_MAP)

    g.add_edge("report", "end")
    g.add_edge("end", END)

    return g


def build_graph():
    return _build().compile(checkpointer=_checkpointer)


def get_checkpointer() -> SqliteSaver:
    return _checkpointer


def get_connection() -> sqlite3.Connection:
    return _conn


prism_graph = build_graph()
