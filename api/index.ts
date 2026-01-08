import { Hono } from "hono";
import { handle } from "hono/vercel";
import { cors } from "hono/cors";
import { parseCancellationHtml } from "../utils/parser";

// ベースパスを /api に設定
const app = new Hono().basePath("/api");

// CORS許可
app.use("*", cors());

const DEFAULT_POST_ID = "65544";
const BASE_API_URL = "https://www.ibaraki-ct.ac.jp/info/wp-json/wp/v2/posts";

/**
 * 共通処理: WordPressからデータを取得して解析
 */
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
        502,
      );
    }

    const wpData = await wpResponse.json();

    // Cheerioで解析
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

// ルート: ヘルスチェック
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

// ルート: 最新の休講情報
app.get("/cancellations", async (c) => {
  return await fetchAndParse(c, DEFAULT_POST_ID);
});

// ルート: 指定IDの休講情報
app.get("/cancellations/:id", async (c) => {
  const id = c.req.param("id");
  return await fetchAndParse(c, id);
});

// ==========================================
// 1. Vercel用のエクスポート (必須)
// ==========================================
export default handle(app);

// ==========================================
// 2. ローカル開発用 (bun run api/index.ts で動く)
// ==========================================
// @ts-ignore: Bun types
if (import.meta.main) {
  const port = 3000;
  console.log(`🚀 Server is running on http://localhost:${port}/api`);
  console.log(`   Try: http://localhost:${port}/api/cancellations`);

  // @ts-ignore: Bun types
  Bun.serve({
    port,
    fetch: app.fetch,
  });
}
