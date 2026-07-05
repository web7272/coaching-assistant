// lib/prompt-sections/conditional/day1-mirror-inject.js
// Day-1 限定「原話排列照鏡」inject (fable 6/26 審查 Q3 · Vivi 核准).
//
// 目的:免費體驗日 (Day 1 / trial) 在收到 2-3 個 value + >=1 具體事件後,用學員
//   原話排列照鏡製造一次「被看見」的 aha,又不嚇跑免費用戶。手法 = 五層撥開
//   動作 4/5:用學員原話排列、AI 不替學員總結定義 (守既有紅線)。
//
// 設計鎖:
//   · 進 dynamic block (NOT cached) → 不汙染 cache breakpoint。
//   · self-limiting:每場最多一次、觸發條件缺一不做、碰危機 (紅線 20) 即放棄。
//   · gate 在 caller:sessionDay === 1 && plan === 'trial' (buildDay1MirrorInject).

export const DAY1_MIRROR_INJECT = `【Day 1 限定:原話排列照鏡(每場最多一次)】
目的:在免費體驗日製造一次「被看見」的時刻——學員親眼看到自己說的話排在一起長什麼樣子。

觸發條件(缺一不做、不硬湊):
- 學員已給出 2–3 個 value 詞(他自己的原話)
- 且已給出 ≥1 個具體事件(有時 / 地 / 人 / 動作)

執行步驟(一次完成、不拆多輪):
1. 先承認:mirror 學員的 value 原話——「你說你想要『[value 原話]』」。不改寫、不總結成新詞、原話粗糙也不修。
2. 排列:把他剛剛講的具體事件、原句排成一列(1. 2. 3.)、每句用他自己的詞。
3. 照鏡:指出排列後浮現的方向差——「你說你想要 [A、value 原話];但你剛剛講的這幾件事、都在 [B——用他事件裡自己的動詞描述]——你看到了嗎?」B 必須從學員事件原話裡取材、不得是 AI 發明的標籤或診斷詞。
4. 以問句收尾、把球留在學員場上:「你怎麼看這兩個之間的距離?」不替他下結論、不替他命名這個 pattern、不說「這代表你其實是…」。

語氣:先承認、再挑戰。挑戰的對象是「排出來的事實」、不是學員這個人。Day 1 是免費體驗、力道收在「讓他自己看到」為止——看到即成功、不逼他認。
若學員否認或修正:接受他的版本、mirror 他的修正、回主流程、不辯論。
若學員被照到、給出新的具體回應:那就是今天的 aha、用他的原話 mirror 一次作為今天的產出物、再走收尾。

限制:每場最多一次;觸發紅線 20 任一訊號時、立即放棄本動作、依紅線 20 處理。`;

// gate: 只在 Day 1 免費體驗 (trial) 注入。回 inject 字串 OR null (caller skip).
export function buildDay1MirrorInject({ sessionDay, plan } = {}) {
  return (Number(sessionDay) === 1 && plan === 'trial') ? DAY1_MIRROR_INJECT : null;
}
