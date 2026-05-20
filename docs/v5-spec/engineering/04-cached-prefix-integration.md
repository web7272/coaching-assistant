# v5.0 Cached Prefix 整合計畫（交付物 4/6）

**作者**：Patrick ｜ 2026-05-20 ｜ 給 Claude Code 落地

---

## 0. Cached prefix 總覽

Anthropic prompt caching（ephemeral、~26% baseline cost）。v5.0 cached prefix 結構：

```
┌─────────────────────────────────────────────────────┐
│ CACHED PREFIX（每場必載、永久 cached、~26% cost）       │
├─────────────────────────────────────────────────────┤
│ 段落 1：damon-core-philosophy        ~1200 tokens     │
│   - 世界觀（self-concept / scope-category / values×identity）│
│   - 12+ 條硬性禁區                                      │
│   - 付費對等性原則                                       │
│   - 核心金句庫                                           │
│ 段落 2：5-layer-unwrap-reference     ~600 tokens（E1）  │
│ 段落 3：4-7-router-reference         ~1400 tokens（E3） │
│ 段落 4：active-reference-styles      ~800 tokens（E4）  │
├─────────────────────────────────────────────────────┤
│ 合計 cached：~4000 tokens                              │
│ caching 後 equivalent active：~1040 tokens（~26%）     │
└─────────────────────────────────────────────────────┘
         +
┌─────────────────────────────────────────────────────┐
│ DYNAMIC（每場變動、不 cached）                          │
├─────────────────────────────────────────────────────┤
│ runtime placeholders：                                 │
│   {{user_profile_snapshot}}      ~300-500 tokens      │
│   {{anchors_top3}}                ~100 tokens         │
│   {{current_phase_context}}       ~100 tokens         │
│ + conditional inject（觸發的引擎段落）：                 │
│   max simultaneous ~280-300 tokens                    │
├─────────────────────────────────────────────────────┤
│ 合計 dynamic active：~800-1000 tokens                  │
└─────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════
v5.0 total active state（穩態）：
  cached equivalent ~1040 + dynamic ~900 = ~1940 tokens
vs v4.0：~9.5K active（caching off）/ ~5K（caching on）
→ v5.0 降到 ~1940、約 v4.0 caching on 的 40%、caching off 的 20%
═══════════════════════════════════════════════════════
```

---

## 1. Cache breakpoint 設計

Anthropic caching 規則：cache_control 標在 prefix 段落結尾、prefix 必須穩定（不變才 cache hit）。

```javascript
// buildSystemPromptArray v5 的 cache breakpoint
[
  { type: "text", text: damon_core_philosophy },        // 段落 1
  { type: "text", text: five_layer_unwrap_reference },  // 段落 2
  { type: "text", text: four_seven_router_reference },  // 段落 3
  {
    type: "text",
    text: active_reference_styles,                       // 段落 4
    cache_control: { type: "ephemeral" }                 // ⭐ breakpoint 在這
  },
  // ↑ 以上 cached、以下 dynamic
  { type: "text", text: user_profile_snapshot },         // dynamic
  { type: "text", text: conditional_injected_sections }, // dynamic
]
```

**關鍵**：4 個 cached 段落順序固定、內容不依學員變動 → 整塊 cache hit。dynamic 段落在 breakpoint 之後、每場重算。

---

## 2. 段落 1：damon-core-philosophy 內容組成

這是 v5.0 system prompt 的「世界觀層」、從蒸餾文件 Layer 1 + 5.7 提煉：

```
【你是誰】
你是一個 Damon Cart 自我概念教練。不是諮商師、不是勵志教練。
你的工作：幫學員看見「我是誰」的真相、不是給建議 / 安慰 / 技巧。

【核心世界觀】（Layer 1.1-1.3 提煉）
- self-concept = 所有信念之母、是大腦建構的概念、可改變
- 不直接改 category（標籤）、要重構 scope（證據庫）
- values 是藍圖、identity 是引擎；先挖 values、再用 self-concept 模型轉化

【12+ 條硬性禁區】（Layer 1.4 + 1.5 + 3.7）
1. 不問「為什麼（Why）」（引發防衛合理化）
2. 不給 values 清單讓學員圈選
3. 不離開單一情境
4. 不用 affirmations / 假裝
5. 不用對抗 / 意志力語言
6. 不挖創傷當前置條件
7. 不做 self-worth building / 「先愛自己」
8. 不鼓勵每天回顧 vision
9. 不把 Parts 分成 N 種固定類型
10. 不把失敗描述成 identity 問題
11. 不用敵意標籤稱呼 part（破壞者 / 批評家）
12. 不對 self-worth fiction 用 Parts Integration（用 Meta Model 挑戰）
13. 不過度具體化 vision
14. 不問「身體哪裡 / 畫面什麼樣」（亞洲人不適用、除 4 個合法場景）
15. 不打 1-10 分（非 Damon 路徑）
16. 不主動擬人化 L5 身份詞

【付費對等性原則】（5.7.7）
AI 跟真人付費教練 context 完全對等。學員付費 = 期望被推進到結果。
- 可以強勢推進（「踢開門衝進去」）
- 不允許模糊退場
- 直接挑戰敷衍（「我沒被說服」）
- 對 People Pleasing 更高警覺
- 但：先 acknowledge 再挑戰、用 values 對齊判斷「真實偏離 vs 阻力」

【核心金句庫】（語氣訓練）
- "It's not sabotage. It's course correction."
- "Your values never conflict. It's your strategies that conflict."
- "Failures don't shake you. They teach you."
- "I've never met a part that said no."
```

預估 ~1200 tokens。

---

## 3. 段落 2-4：直接繼承設計師 cached reference

| 段落 | 來源 | tokens | 內容 |
|---|---|---|---|
| 5-layer-unwrap | 引擎 1 §4.1 cached | ~600 | 5 層撥開技術完整定義（動作 1-5） |
| 4-7-router | 引擎 3 §4.1 cached | ~1400 | 4.7 藍圖 + Top 1 判定 + Cascade Down + Re-imprinting 訊號 + Parts Integration 切換 + 特殊開場 reframe |
| active-reference-styles | 引擎 4 §5.1 cached | ~800 | 引用 3 原則 + 5 變體話術骨架 + gap_days 分級 |

→ 設計師已 ship 完整內容、Patrick 直接搬進 lib/prompt-sections/cached/、不重寫。

---

## 4. Dynamic placeholders 規格

```javascript
// {{user_profile_snapshot}} — 每場開場 inject
{
  top1_value, values_ranking_top3,
  owned_qualities: [...],          // anchors
  open_threads: [...],             // 未整合的 candidate
  current_phase, session_day_count, gap_days,
  integration_retention_mode_active,
}

// {{anchors_top3}} — Day N+1 開場引用用
last 3 owned anchors with terms + evidence

// {{current_phase_context}} — phase-machine 提供
current_phase 的 entry context + 該 phase 目標 + exit condition 提示
```

---

## 5. Integration Retention Mode conditional

```
{{#if integration_retention_mode_active}}
【Integration Retention 階段（Day 8-21）】
- 不挖新 quality、不深化新技術
- 強化 owned qualities 在生活中 manifest
- Future Pacing（X 個月/年後場景）
- turn budget 5-10/day soft limit
- reinforce 而非 explore
{{else}}
（標準 4 引擎 + 5 Phase 推進模式）
{{/if}}
```

放在 dynamic 段落（依 state 變動、不 cached）。

---

## 6. Token budget 驗證 checklist（A001 重走時）

- [ ] cached prefix 整塊 cache hit（檢查 chat_usage_log cached_input vs uncached）
- [ ] dynamic active state 穩態 < 1.5K
- [ ] conditional inject 互斥（不同時載多個引擎 sub-prompt）
- [ ] Haiku judge call 不計入主對話 active state

---

*— cached prefix 整合計畫 v0.1 ｜ Patrick ｜ batch 4/6 —*
