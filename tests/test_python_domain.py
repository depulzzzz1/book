import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from litera_core.domain_engine import (
    analyze_readability,
    compute_revision_diff,
    recommend_novels,
    sanitize_editorial_html,
)


class TestLiteraPythonDomain(unittest.TestCase):
    def test_xss_sanitization_strips_scripts_and_iframes(self):
        dirty = (
            '<p>Opening line.</p>'
            '<script>alert("xss")</script>'
            '<iframe src="https://evil.example"></iframe>'
            '<blockquote>Quoted prose.</blockquote>'
        )
        res = sanitize_editorial_html(dirty)
        self.assertNotIn("<script", res["sanitized_html"])
        self.assertNotIn("alert", res["sanitized_html"])
        self.assertNotIn("<iframe", res["sanitized_html"])
        self.assertIn("<p>Opening line.</p>", res["sanitized_html"])
        self.assertIn("<blockquote>Quoted prose.</blockquote>", res["sanitized_html"])
        self.assertIn("script", res["stripped_tags"])
        self.assertEqual(res["word_count"], 4)

    def test_readability_telemetry(self):
        prose = "<p>The brass astrolabe caught the winter sun. Silence filled the workshop.</p>"
        metrics = analyze_readability(prose)
        self.assertEqual(metrics["word_count"], 11)
        self.assertEqual(metrics["sentence_count"], 2)
        self.assertGreater(metrics["lexical_diversity"], 0.7)
        self.assertGreaterEqual(metrics["estimated_minutes"], 1)

    def test_revision_diff_computation(self):
        v1 = "<p>First paragraph.</p><p>Second paragraph.</p>"
        v2 = "<p>First paragraph.</p><p>Revised second paragraph.</p><p>Third paragraph.</p>"
        diff = compute_revision_diff(v1, v2)
        self.assertTrue(diff["changed"])
        self.assertGreaterEqual(diff["added_paragraphs"], 2)
        self.assertGreaterEqual(diff["removed_paragraphs"], 1)

    def test_recommendation_scoring_excludes_target_and_ranks_overlap(self):
        res = recommend_novels(
            {
                "target_novel_id": "n1",
                "target_genres": ["literary-fiction", "historical-chronicle"],
                "candidates": [
                    {"id": "n1", "genres": ["literary-fiction"], "avg_rating": 5.0, "view_count": 9000},
                    {"id": "n2", "genres": ["mystery-noir"], "avg_rating": 4.2, "view_count": 100},
                    {"id": "n3", "genres": ["literary-fiction", "historical-chronicle"], "avg_rating": 4.8, "view_count": 500},
                ],
                "limit": 2,
            }
        )
        ids = [r["id"] for r in res["recommendations"]]
        self.assertEqual(ids[0], "n3")
        self.assertNotIn("n1", ids)


if __name__ == "__main__":
    unittest.main()
