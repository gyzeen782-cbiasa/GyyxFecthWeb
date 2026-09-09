export const config = { api: { bodyParser: true } };

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function detectType(url, contentType = "") {
  const u = url.toLowerCase().split("?")[0];
  if (u.endsWith(".css") || contentType.includes("css")) return "css";
  if (u.endsWith(".js") || u.endsWith(".mjs") || contentType.includes("javascript")) return "js";
  if ([".png",".jpg",".jpeg",".gif",".webp",".svg",".ico"].some(e => u.endsWith(e))) return "image";
  if (u.endsWith(".json") || contentType.includes("json")) return "json";
  if (u.endsWith(".woff") || u.endsWith(".woff2") || u.endsWith(".ttf")) return "font";
  if (contentType.includes("html") || u.endsWith(".html") || u.endsWith(".htm")) return "html";
  return "other";
}

function detectTechs(html, files) {
  const all = html + files.map(f => f.content || "").join(" ");
  const techs = [];
  const checks = [
    ["React", /react(?:\.min)?\.js|from ['"]react['"]|__reactFiber/],
    ["Vue.js", /vue(?:\.min)?\.js|Vue\.component|createApp\(/],
    ["Next.js", /__NEXT_DATA__|next\/dist/],
    ["Nuxt", /nuxt|__nuxt/],
    ["Angular", /ng-version|angular\.min\.js/],
    ["Svelte", /svelte|__svelte/],
    ["jQuery", /jquery(?:\.min)?\.js|\$\(document\)\.ready/],
    ["Tailwind", /tailwind(?:css)?|tw-/],
    ["Bootstrap", /bootstrap(?:\.min)?\.(?:css|js)/],
    ["Vite", /from 'vite'|vite\/dist/],
    ["Webpack", /__webpack_require__|webpackJsonp/],
    ["TypeScript", /\.ts['"]|tsconfig/],
    ["GSAP", /gsap(?:\.min)?\.js|TweenLite|gsap\.to\(/],
    ["Three.js", /three(?:\.min)?\.js|THREE\./],
    ["Cloudflare", /cloudflare|__cf_chl/],
  ];
  for (const [name, re] of checks) {
    if (re.test(all)) techs.push(name);
  }
  return techs;
}

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return null;
  }
}

function extractLinks(html, baseUrl) {
  const links = new Set();
  const patterns = [
    /href=["']([^"']+\.(?:css|js))["']/gi,
    /src=["']([^"']+\.(?:js|mjs))["']/gi,
    /<link[^>]+href=["']([^"'?#]+)["'][^>]*>/gi,
    /<script[^>]+src=["']([^"'?#]+)["'][^>]*>/gi,
    /url\(["']?([^"')]+\.(?:css|js|woff2?|ttf|png|jpg|svg))["']?\)/gi,
    /import\s+["']([^"']+)["']/gi,
  ];

  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(html)) !== null) {
      const resolved = resolveUrl(baseUrl, m[1]);
      if (resolved) links.add(resolved);
    }
  }
  return [...links];
}

async function fetchSafe(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GyyxFetch/1.0)",
        "Accept": "*/*",
      },
    });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, message: "Method not allowed" });

  const { url } = req.body || {};
  if (!url || !url.trim()) return res.status(400).json({ ok: false, message: "URL wajib diisi." });

  let targetUrl;
  try {
    targetUrl = new URL(url.trim());
    if (!["http:", "https:"].includes(targetUrl.protocol))
      return res.status(400).json({ ok: false, message: "Hanya URL http/https yang didukung." });
  } catch {
    return res.status(400).json({ ok: false, message: "Format URL tidak valid." });
  }

  // Block private/local IPs
  const hostname = targetUrl.hostname.toLowerCase();
  if (["localhost","127.0.0.1","0.0.0.0","::1"].includes(hostname) || hostname.startsWith("192.168.") || hostname.startsWith("10."))
    return res.status(400).json({ ok: false, message: "URL lokal tidak diperbolehkan." });

  let mainHtml, mainCt;
  try {
    const mainRes = await fetchSafe(targetUrl.href);
    mainCt = mainRes.headers.get("content-type") || "";
    if (!mainRes.ok) return res.status(502).json({ ok: false, message: `Target mengembalikan status ${mainRes.status}.` });
    mainHtml = await mainRes.text();
  } catch (e) {
    return res.status(502).json({ ok: false, message: "Tidak bisa mengakses URL target: " + e.message });
  }

  // Collect linked assets
  const assetUrls = extractLinks(mainHtml, targetUrl.href);
  const MAX_ASSETS = 30;
  const limited = assetUrls.slice(0, MAX_ASSETS);

  const files = [];
  let idCounter = 1;

  // Add main HTML
  files.push({
    id: idCounter++,
    name: "index.html",
    type: "html",
    url: targetUrl.href,
    content: mainHtml,
    size: new TextEncoder().encode(mainHtml).length,
  });

  // Fetch assets in parallel (max 15 concurrent)
  const chunks = [];
  for (let i = 0; i < limited.length; i += 15)
    chunks.push(limited.slice(i, i + 15));

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (assetUrl) => {
        const r = await fetchSafe(assetUrl, 6000);
        const ct = r.headers.get("content-type") || "";
        const type = detectType(assetUrl, ct);

        // Skip binary assets
        if (["image","font"].includes(type))
          return { url: assetUrl, type, name: assetUrl.split("/").pop().split("?")[0] || "asset", content: `[Binary file — ${type}]`, size: 0 };

        const text = await r.text();
        const name = assetUrl.split("/").pop().split("?")[0] || "file";
        return { url: assetUrl, type, name, content: text, size: new TextEncoder().encode(text).length };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        files.push({ id: idCounter++, ...r.value });
      }
    }
  }

  const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
  const technologies = detectTechs(mainHtml, files);

  return res.status(200).json({
    ok: true,
    data: {
      url: targetUrl.href,
      fileCount: files.length,
      totalSize,
      technologies,
      files,
    },
  });
}
