from __future__ import annotations

from dataclasses import dataclass

from app.ranking import rank_results, score


def test_score_priority_exact_prefix_substring_fuzzy():
    q = "naruto"
    exact = score(q, ["Naruto"])
    prefix = score(q, ["Naruto Shippuden"])
    substring = score(q, ["Best of Naruto moments"])
    # Not a prefix/substr: should only match via fuzzy fallback.
    fuzzy = score(q, ["Nartuo"])

    assert exact > prefix
    assert prefix > substring
    assert substring > fuzzy


def test_score_uses_max_across_candidate_titles():
    q = "bleach"
    s = score(q, ["something else", "BLEACH", "another"])
    assert s >= 1000.0


def test_rank_results_tie_break_is_deterministic_by_url_then_title_then_index():
    # Same score for all (all exact), but different URLs.
    results = [
        {"title": "One Piece", "url": "https://b.example/item"},
        {"title": "One Piece", "url": "https://a.example/item"},
        {"title": "One Piece", "url": "https://c.example/item"},
    ]
    ranked = rank_results("one piece", results, source="animego")
    assert [r["url"] for r in ranked] == [
        "https://a.example/item",
        "https://b.example/item",
        "https://c.example/item",
    ]


def test_rank_results_does_not_mutate_nested_episode_order():
    episodes = [3, 1, 2]
    r1 = {"title": "Foo", "url": "u1", "episodes": episodes}
    r2 = {"title": "Foo Bar", "url": "u2", "episodes": [1]}
    ranked = rank_results("foo", [r2, r1], source="animego")

    # Ensure the original list object and order are preserved.
    picked = next(r for r in ranked if r["url"] == "u1")
    assert picked["episodes"] is episodes
    assert picked["episodes"] == [3, 1, 2]


@dataclass
class Obj:
    title: str
    url: str
    synonyms: list[str] | None = None


def test_rank_results_uses_synonyms_best_score():
    r1 = Obj(title="Something", url="u1", synonyms=["My Hero Academia"])
    r2 = Obj(title="My Hero", url="u2", synonyms=None)
    ranked = rank_results("my hero academia", [r2, r1], source="animego")
    assert ranked[0].url == "u1"
