import { load } from "cheerio";

// 記号と意味のマッピング
const SYMBOLS: Record<string, string> = {
  "◉": "休講",
  "◎": "補講",
  "◇": "遠隔",
  "☆": "変更",
};

export interface CancellationItem {
  date: string;
  type: string;
  symbol: string;
  target_class: string;
  period: string;
  subject: string;
  // 変更情報がある場合の追加フィールド
  subject_from?: string; // 変更前
  subject_to?: string; // 変更後
  raw_text: string;
}

/**
 * 全角英数字・スペース・一部記号を半角に変換する
 */
const toHalfWidth = (str: string): string => {
  return str
    .replace(/[！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0)) // 英数字・記号
    .replace(/　/g, " ") // 全角スペース -> 半角スペース
    .replace(/／/g, "/") // スラッシュ
    .replace(/（/g, "(") // カッコ
    .replace(/）/g, ")");
};

/**
 * HTML文字列から休講情報を抽出する (Cheerio版・強化済み)
 */
export const parseCancellationHtml = (
  htmlString: string,
): CancellationItem[] => {
  const $ = load(htmlString);
  const results: CancellationItem[] = [];
  let currentDate = "";

  $("p").each((_, element) => {
    const p = $(element);
    const rawText = p.text().trim();

    // 解析用にテキストを半角化 (例: "１／６（火）" -> "1/6(火)")
    const normalizedText = toHalfWidth(rawText);

    // ---------------------------------------------------
    // 1. 日付行の判定ロジック
    // ---------------------------------------------------
    // 条件A: <mark>タグが含まれている (強調表示されている日付)
    const hasMark = p.find("mark").length > 0;

    // 条件B: 行頭が "数字/数字" または "数字/数字(曜日)" のパターン
    // かつ、"日程" や "について" といった説明文言が含まれていないこと (誤検知防止)
    const dateMatch = normalizedText.match(/^(\d{1,2}\/\d{1,2}(?:\(.\))?)/);
    const isLinkOrDescription =
      normalizedText.includes("日程") || normalizedText.includes("について");

    const isDateLine = hasMark || (dateMatch && !isLinkOrDescription);

    if (isDateLine) {
      if (dateMatch) {
        // マッチした日付部分だけを取り出す (例: "1/6(火)")
        currentDate = dateMatch[1];
      } else {
        // マッチしないがMarkタグがある場合などは、テキスト全体を使って空白を除去
        currentDate = normalizedText.replace(/\s/g, "");
      }
      return; // 次の行へ
    }

    // ---------------------------------------------------
    // 2. 休講情報の判定ロジック
    // ---------------------------------------------------
    // 行頭が特定の記号で始まっているか
    const symbolMatch = rawText.match(/^([◉◎◇☆])/);
    if (symbolMatch) {
      const symbol = symbolMatch[1];

      // 記号より後ろの部分を取得し、半角化する
      let content = rawText.substring(1).trim();
      content = toHalfWidth(content);

      // スペースで分割して解析
      const parts = content.split(/\s+/);

      let targetClass = parts[0] || "";
      let period = "";
      let subjectStartIndex = 1;

      // "3限" や "1・2限"、"7・8限"、"空きコマ" などのパターン判定
      // 数字が含まれている、または "限" "コマ" が含まれている場合
      if (
        parts.length > 1 &&
        (parts[1].match(/\d/) ||
          parts[1].includes("限") ||
          parts[1].includes("コマ"))
      ) {
        period = parts[1];
        subjectStartIndex = 2;
      }

      let subject = parts.slice(subjectStartIndex).join(" ");

      // ---------------------------------------------------
      // 3. 授業変更（矢印）のスマート解析
      // ---------------------------------------------------
      // "応用物理Ⅱ(山口)⇒物質工学実用数学(佐藤稔)" のようなパターンを分割
      let subjectFrom: string | undefined;
      let subjectTo: string | undefined;

      // 矢印（⇒, →, =>, ->）で分割
      const arrowRegex = /\s*(?:⇒|→|=>|->)\s*/;
      const splitSubjects = subject.split(arrowRegex);

      if (splitSubjects.length > 1) {
        subjectFrom = splitSubjects[0];
        // 念のため2つ目以降も結合しておく（稀なケース対策）
        subjectTo = splitSubjects.slice(1).join("⇒");
      }

      const item: CancellationItem = {
        date: currentDate || "日付不明", // 上で保持した正規化済み日付が入る
        type: SYMBOLS[symbol] || "その他",
        symbol: symbol,
        target_class: targetClass,
        period: period,
        subject: subject,
        raw_text: symbol + content, // 記号 + 半角化されたテキスト
      };

      // 変更情報（矢印）がある場合のみ、from/toを追加
      if (subjectFrom && subjectTo) {
        item.subject_from = subjectFrom;
        item.subject_to = subjectTo;
      }

      results.push(item);
    }
  });

  return results;
};
