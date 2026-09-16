// Searches YouTube for a study question/topic and returns a clean, filtered
// list of real videos: no Shorts, no live streams, no unembeddable results.
export default async function handler(req, res) {
  const API_KEY = process.env.YOUTUBE_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "YOUTUBE_API_KEY is not set." });

  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Missing q" });

  const subject = (req.query.subject || "").trim(); // "physics" | "maths" | "chemistry" | ""
  const finalQuery = subject ? `${q} ${subject}` : q;

  try {
    // 1. Search for candidate videos
    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
      `&maxResults=24&order=relevance&safeSearch=strict` +
      `&q=${encodeURIComponent(finalQuery)}&key=${API_KEY}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    if (searchData.error) throw new Error(searchData.error.message);

    const ids = (searchData.items || [])
      .map((it) => it.id && it.id.videoId)
      .filter(Boolean);
    if (!ids.length) return res.status(200).json({ videos: [] });

    // 2. Fetch details to filter out Shorts / live / unembeddable
    const detailsUrl =
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics,snippet,status` +
      `&id=${ids.join(",")}&key=${API_KEY}`;
    const detailsRes = await fetch(detailsUrl);
    const detailsData = await detailsRes.json();
    if (detailsData.error) throw new Error(detailsData.error.message);

    const videos = (detailsData.items || [])
      .map((it) => {
        const durationSeconds = parseISODuration(it.contentDetails.duration);
        return {
          id: it.id,
          title: it.snippet.title,
          channelTitle: it.snippet.channelTitle,
          channelId: it.snippet.channelId,
          thumbnail:
            (it.snippet.thumbnails.medium && it.snippet.thumbnails.medium.url) ||
            it.snippet.thumbnails.default.url,
          publishedAt: it.snippet.publishedAt,
          durationSeconds,
          viewCount: Number(it.statistics.viewCount || 0),
          embeddable: it.status.embeddable !== false,
          liveBroadcastContent: it.snippet.liveBroadcastContent,
        };
      })
      // drop Shorts (under 2 min), live/upcoming streams, and unembeddable videos
      .filter(
        (v) =>
          v.durationSeconds >= 120 &&
          v.embeddable &&
          v.liveBroadcastContent === "none"
      );

    return res.status(200).json({ videos, query: finalQuery });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Search failed" });
  }
}

function parseISODuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return 0;
  const h = parseInt(m[1] || 0, 10);
  const min = parseInt(m[2] || 0, 10);
  const s = parseInt(m[3] || 0, 10);
  return h * 3600 + min * 60 + s;
}
