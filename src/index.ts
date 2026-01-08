import { Hono } from "hono";
import { cors } from "hono/cors";
import { parse } from "node-html-parser";

// ==========================================
// Parser (node-html-parserでHTML解析)
// ==========================================

// 記号と意味のマッピング
const SYMBOLS: Record<string, string> = {
  "◉": "休講",
  "◎": "補講",
  "◇": "遠隔",
  "☆": "変更",
};

interface CancellationItem {
  date: string;
  type: string;
  symbol: string;
  target_class: string;
  period: string;
  subject: string;
  subject_from?: string;
  subject_to?: string;
  raw_text: string;
}

interface WpPost {
  link: string;
  modified: string;
  title: {
    rendered: string;
  };
  content: {
    rendered: string;
  };
}

/**
 * 全角英数字・スペース・一部記号を半角に変換する
 */
const toHalfWidth = (str: string): string => {
  return str
    .replace(/[！-～]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ")
    .replace(/／/g, "/")
    .replace(/（/g, "(")
    .replace(/）/g, ")");
};

/**
 * HTML文字列から休講情報を抽出する
 */
const parseCancellationHtml = (htmlString: string): CancellationItem[] => {
  const root = parse(htmlString);
  const results: CancellationItem[] = [];
  let currentDate = "";

  const paragraphs = root.querySelectorAll("p");

  for (const p of paragraphs) {
    const rawText = p.textContent.trim();
    const normalizedText = toHalfWidth(rawText);

    const hasMark = p.querySelector("mark") !== null;
    const dateMatch = normalizedText.match(/^(\d{1,2}\/\d{1,2}(?:\(.\))?)/);
    const isLinkOrDescription =
      normalizedText.includes("日程") || normalizedText.includes("について");
    const isDateLine = hasMark || (dateMatch && !isLinkOrDescription);

    if (isDateLine) {
      if (dateMatch) {
        currentDate = dateMatch[1] ?? "";
      } else {
        currentDate = normalizedText.replace(/\s/g, "");
      }
      continue;
    }

    const symbolMatch = rawText.match(/^([◉◎◇☆])/);
    if (symbolMatch) {
      const symbol = symbolMatch[1] ?? "";
      let content = rawText.substring(1).trim();
      content = toHalfWidth(content);
      const parts = content.split(/\s+/);

      let targetClass = parts[0] || "";
      let period = "";
      let subjectStartIndex = 1;

      if (
        parts.length > 1 &&
        (parts[1]?.match(/\d/) ||
          parts[1]?.includes("限") ||
          parts[1]?.includes("コマ"))
      ) {
        period = parts[1];
        subjectStartIndex = 2;
      }

      let subject = parts.slice(subjectStartIndex).join(" ");

      let subjectFrom: string | undefined;
      let subjectTo: string | undefined;

      const arrowRegex = /\s*(?:⇒|→|=>|->)\s*/;
      const splitSubjects = subject.split(arrowRegex);

      if (splitSubjects.length > 1) {
        subjectFrom = splitSubjects[0];
        subjectTo = splitSubjects.slice(1).join("⇒");
      }

      const item: CancellationItem = {
        date: currentDate || "日付不明",
        type: SYMBOLS[symbol] || "その他",
        symbol: symbol,
        target_class: targetClass,
        period: period,
        subject: subject,
        raw_text: symbol + content,
      };

      if (subjectFrom && subjectTo) {
        item.subject_from = subjectFrom;
        item.subject_to = subjectTo;
      }

      results.push(item);
    }
  }

  return results;
};

// ==========================================
// Hono App
// ==========================================

const app = new Hono();

app.use("*", cors());

const DEFAULT_POST_ID = "65544";
const BASE_API_URL = "https://www.ibaraki-ct.ac.jp/info/wp-json/wp/v2/posts";

const fetchAndParse = async (c: any, postId: string) => {
  const targetUrl = `${BASE_API_URL}/${postId}`;

  try {
    console.log(`Fetching: ${targetUrl}`);

    const wpResponse = await fetch(targetUrl);

    if (!wpResponse.ok) {
      if (wpResponse.status === 404) {
        return c.json({ error: "Article Not Found", id: postId }, 404);
      }
      return c.json(
        { error: `WordPress API Error: ${wpResponse.status}` },
        502
      );
    }

    const wpData = (await wpResponse.json()) as WpPost;
    const parsedData = parseCancellationHtml(wpData.content?.rendered || "");

    return c.json({
      meta: {
        source_url: wpData.link,
        updated_at: wpData.modified,
        title: wpData.title?.rendered,
        api_version: "1.0.0",
      },
      data: parsedData,
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Internal Server Error" }, 500);
  }
};

app.get("/", (c) => {
  return c.json({
    message: "Ibaraki CT Cancellation Info API",
    endpoints: {
      latest: "/api/cancellations",
      specific: "/api/cancellations/:id",
    },
    status: "running",
  });
});

app.get("/api/cancellations", async (c) => {
  return await fetchAndParse(c, DEFAULT_POST_ID);
});

app.get("/api/cancellations/:id", async (c) => {
  const id = c.req.param("id");
  return await fetchAndParse(c, id);
});

export default app;
