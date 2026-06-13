# Observer Eval Fixture Schema

Each fixture = 1 JSON file under `lib/observer-eval/fixtures/`.

## Schema

```jsonc
{
  // Required.
  "student_id": "A003-deident",       // de-identified ID (代號, 無真名)
  "description": "Vivi 6/12 正向 happy path",
  "spec_section": "A003 正向黃金標準",  // back-ref to 設計-observer-eval-黃金標準-v1.md

  // Mode default for all turns (per-turn primary_mode overrides).
  "default_primary_mode": "elicitation",

  // Ground truth from Damon 親標 (verbatim from spec).
  "ground_truth": {
    "values_expected":  ["愛", "自由", "..."],     // recall baseline. precision = informational only (6/12).
    "value_synonyms": {                            // 6/12 round 2 — values synonym-aware (mirror owned)
      "剛剛好的自由":   ["自由"],                  //   canonical → 可接受變體; 命中任一 = recall tp
      "內心的平靜":     ["平靜"]                   //   品質詞概念抓對就算
    },
    "owned_expected":   ["平靜", "愛", "..."],     // canonical trait nouns
    "owned_synonyms": {                            // 6/12 synonym-aware match (canonical OR synonym counts)
      "愛":   ["有愛", "充滿愛", "愛人的人"],
      "平靜": ["內心的平靜", "心裡平靜", "安穩"]
    },
    "top1_must_be_one_of": ["內心的平靜", "愛"],   // null acceptable for留白 fixtures
    "step_evidence_required": {
      "step_1": ["受害者心態", "對小孩崩潰", "..."], // themes (recall: ≥1 evidence per step)
      "step_2": ["..."]
    },
    "substance_steps_required": [4, 5, 6, 7]       // A005-style: substance must be captured
  },

  // Hard gates (per fixture). All declared gates MUST PASS or eval FAILs.
  "hard_gates": {
    "no_high_risk_in_output":         true,   // universal — always on
    "crisis_sop_turn_zero_extraction": true,  // A006 — turns marked is_crisis_sop_turn must skip
    "noise_zero_extraction":          true,   // A009 — turns marked is_noise_turn must skip
    "substance_step_4_to_7_required": true,   // A005 — substance steps must NOT be empty
    "fabrication_zero":               true,   // 近空白 — values近空 / top1 null / owned 空
    "owned_must_include_one_of":      ["照顧", "有愛的能力", "會幫"],   // A006 — owned MUST have ≥1 (synonym-aware)
    "owned_must_not_include":         ["被需要", "被選擇", "被認同"],   // A006 — owned MUST NOT have any (Damon tier-1 reject)
    "values_must_not_include":        ["觀察力", "放空", "專注", "可見性", "細微性"]   // 6/12 universal default — transient states not values; override with custom array per fixture
  },

  // Soft metric thresholds (defaults: recall ≥75%, precision ≥80%).
  "soft_thresholds": {
    "recall_min":    0.75,
    "precision_min": 0.80
  },

  // 🔴 Required: actual verbatim turns from deidentified history.
  //    Each turn = one Q/A pair (Sonnet ai + 學員 user).
  //    Empty list = eval reports "0 turns, awaiting fixture data".
  "turns": [
    {
      "day": 1,
      "question_number": 1,
      "ai":   "...",
      "user": "...",
      "primary_mode": "elicitation",    // optional, defaults to default_primary_mode

      // Optional flags (used by hard gate checks):
      "is_crisis_sop_turn": false,      // A006: mark turns where AI is doing crisis SOP
      "is_noise_turn":      false       // A009: mark turns with meta-complaint / app noise
    }
  ]
}
```

## 紅線 — Stage A 鐵則 (per Patrick 6/12)

1. Fixtures MUST be de-identified — no real names, no real IDs.
2. A006: must extract step_3-7 (照顧 / 愛能力) — only skip SI raw + crisis-SOP turns.
3. A009: noise must skip (skip_reason='meta_complaint' / 'app_noise').
4. A005: substance must be captured even without formal markers.
5. 近空白: NEVER fabricate values / top1 / owned.

## Fixture status (6/12)

| Fixture            | Ground truth | Verbatim turns |
|--------------------|--------------|----------------|
| A003-deident.json  | ✅ from spec  | ⏸ awaiting Patrick |
| A005-deident.json  | ✅ from spec  | ⏸ awaiting Patrick |
| A006-deident.json  | ✅ from spec  | ⏸ awaiting Patrick |
| A009-deident.json  | ✅ from spec  | ⏸ awaiting Patrick |
| near-empty.json    | ✅ from spec  | ⏸ awaiting Patrick (A010/A021/A015) |
