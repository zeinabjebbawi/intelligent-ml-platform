"""
LLM provider factory — a .env setting, not a code choice.

AUTOMODE_LLM_PROVIDER = "anthropic" | "openai" | "gemini" | "deepseek"
(default "anthropic"). Reads ANTHROPIC_API_KEY / OPENAI_API_KEY /
GOOGLE_API_KEY / DEEPSEEK_API_KEY via the same python-dotenv load_dotenv()
main.py already calls.

DeepSeek's API is OpenAI-compatible, so "deepseek" reuses ChatOpenAI with
base_url pointed at DeepSeek's endpoint rather than a separate LangChain
integration package — this is the one provider here that isn't its own
`langchain-<provider>` package.
"""
import os
from functools import lru_cache


@lru_cache(maxsize=3)
def get_llm(temperature: float = 0.0):
    provider = os.getenv("AUTOMODE_LLM_PROVIDER", "anthropic").strip().lower()

    if provider == "openai":
        from langchain_openai import ChatOpenAI
        model = os.getenv("AUTOMODE_OPENAI_MODEL", "gpt-4o-mini")
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("AUTOMODE_LLM_PROVIDER=openai but OPENAI_API_KEY is not set in .env")
        return ChatOpenAI(model=model, temperature=temperature, api_key=api_key)

    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        model = os.getenv("AUTOMODE_ANTHROPIC_MODEL", "claude-sonnet-4-5")
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError("AUTOMODE_LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set in .env")
        return ChatAnthropic(model=model, temperature=temperature, api_key=api_key)

    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        model = os.getenv("AUTOMODE_GEMINI_MODEL", "gemini-3.6-flash")
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("AUTOMODE_LLM_PROVIDER=gemini but GOOGLE_API_KEY is not set in .env")
        return ChatGoogleGenerativeAI(model=model, temperature=temperature, google_api_key=api_key)

    if provider == "deepseek":
        from langchain_openai import ChatOpenAI
        model = os.getenv("AUTOMODE_DEEPSEEK_MODEL", "deepseek-chat")
        api_key = os.getenv("DEEPSEEK_API_KEY")
        if not api_key:
            raise RuntimeError("AUTOMODE_LLM_PROVIDER=deepseek but DEEPSEEK_API_KEY is not set in .env")
        return ChatOpenAI(model=model, temperature=temperature, api_key=api_key,
                           base_url="https://api.deepseek.com/v1")

    raise RuntimeError(f"Unknown AUTOMODE_LLM_PROVIDER: {provider!r} "
                        f"(expected 'anthropic', 'openai', 'gemini', or 'deepseek')")



# with_structured_output's right METHOD is genuinely provider-specific —
# found empirically, not assumed, by actually running a real decision
# schema against each live key added to this project:
#   - gemini: with_structured_output's own default already worked; explicit
#     method="function_calling" also verified to work (tool-calling).
#   - deepseek (model "deepseek-v4-flash", a reasoning/"thinking" model):
#     BOTH the default strict-JSON-schema mode ("This response_format type
#     is unavailable now") AND method="function_calling" ("Thinking mode
#     does not support this tool_choice" — DeepSeek's thinking models
#     reject a FORCED tool choice, which is how function_calling gets its
#     guarantee) fail outright. Only method="json_mode" works, and even
#     then only once the exact field names are spelled out in the prompt
#     text itself (json_mode carries no schema alongside the request the
#     way a tool call does) via PydanticOutputParser.get_format_instructions().
#   - anthropic / openai: not yet tested against a real key in this
#     project (no key provided for either yet) — defaulted to
#     "function_calling" as the most broadly-supported method for
#     mainstream tool-calling-capable models; revisit empirically once a
#     real key exists, the same way gemini/deepseek were.
_STRUCTURED_METHOD = {
    "gemini": "function_calling",
    "deepseek": "json_mode",
    "anthropic": "function_calling",
    "openai": "function_calling",
}


def decide(schema, system_prompt: str, human_prompt: str):
    """One structured-output decision call. `schema` is a Pydantic model —
    every big-decision node uses this same helper so the "LLM reasons over
    numbers, returns structured JSON, gets executed deterministically"
    pattern stays identical across all ~12 decision nodes, regardless of
    which provider/method that provider actually needs under the hood."""
    from langchain_core.messages import SystemMessage, HumanMessage

    provider = os.getenv("AUTOMODE_LLM_PROVIDER", "anthropic").strip().lower()
    method = _STRUCTURED_METHOD.get(provider, "function_calling")

    prompt = human_prompt
    if method == "json_mode":
        # json_mode has no side-channel for field names the way a tool
        # call does — the exact schema has to be spelled out in the prompt
        # text itself, or the model invents its own field names (confirmed
        # empirically: without this, deepseek-v4-flash returned valid JSON
        # with correct reasoning but wrong keys, e.g. "metric" instead of
        # "optimization_goal").
        from langchain_core.output_parsers import PydanticOutputParser
        prompt = f"{human_prompt}\n\n{PydanticOutputParser(pydantic_object=schema).get_format_instructions()}"

    llm = get_llm().with_structured_output(schema, method=method)
    return llm.invoke([SystemMessage(content=system_prompt), HumanMessage(content=prompt)])
